"""Language Stealing 7-stage server-side progression, learner-owned sessions."""
from __future__ import annotations
import json
import re
import unicodedata
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
from .writing_stealing_collection import metadata_for_model
from .writing_study_data import personal_patterns,usage_uz
router=APIRouter()
LIVE="(publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))"
STEPS={'read':1,'brainstorm':2,'draft':3,'analyse':4,'compare':5,'recall':6,'rewrite':7}

def words(s):
    norm=unicodedata.normalize('NFKC',s.lower())
    norm=re.sub("[\u2018\u2019\u02bc`]", "'",norm)
    norm=re.sub('[\u2010-\u2015\u2212-]',' ',norm)
    return re.findall(r"[^\W_]+(?:'[^\W_]+)*",norm,flags=re.UNICODE)

def match_key(s):return ' '.join(w for w in words(s) if w not in ('a','an','the'))

IRREGULAR={"make":["made"],"take":["took","taken"],"give":["gave","given"],"do":["did","done","does"],
"have":["has","had"],"go":["went","gone","goes"],"get":["got","gotten"],"bring":["brought"],"come":["came"],
"keep":["kept"],"hold":["held"],"pay":["paid"],"run":["ran"],"see":["saw","seen"],"set":["set"],
"put":["put"],"draw":["drew","drawn"],"meet":["met"],"catch":["caught"],"think":["thought"],
"lead":["led"],"fall":["fell","fallen"],"rise":["rose","risen"],"grow":["grew","grown"],
"be":["is","are","was","were","been","being","am"]}

def same_word(word,target):
    if word==target or word in IRREGULAR.get(target,[]):return True
    if target.endswith('e') and word==target[:-1]+'ing':return True
    if len(target)<=4:return any(word==target+ending for ending in ('s','es','d','ed'))
    stem=target[:max(4,len(target)-3)]
    return word.startswith(stem) and len(word)-len(target)<=4

def uses(text,pattern):
    pattern=re.sub(r'\.{2,}|…|\[[^]]*\]|\([^)]*\)',' sth ',pattern)
    source=words(text);raw=words(pattern)
    placeholders={'sb','sth','someone','something','somebody',"one's",'x','y'}
    optional={'a','an','the'}
    target=[];slot=False
    for token in raw:
        if token in placeholders:slot=True;continue
        if token in optional and len(raw)>1:continue
        target.append((token,0 if not target else 4 if slot else 2));slot=False
    if not target:return False
    for start,word in enumerate(source):
        if not same_word(word,target[0][0]):continue
        pos=start;match=True
        for goal,gap in target[1:]:
            nxt=next((j for j in range(pos+1,min(len(source),pos+2+gap)) if same_word(source[j],goal)),None)
            if nxt is None:match=False;break
            pos=nxt
        if match:return True
    return False

async def session_view(con,s,now):
    t=await con.fetchrow('''SELECT id,title,task_type,topic,target_band,body,source_ref FROM writing_model_texts WHERE id=$1''',s['model_text_id'])
    if not t:raise ValueError('source_not_found')
    patterns=[]
    if s['step']>=4:
        patterns=await con.fetch('''SELECT id,pattern,function,example,usage_note FROM writing_language_patterns
          WHERE source_ref=$1 AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))
          ORDER BY function ASC''',str(s['model_text_id']))
    own=await personal_patterns(con,s['user_id'],s['model_text_id']) if s['step']>=4 else []
    patterns=[*patterns,*[{'id':p['id'],'pattern':p['pattern'],'function':p['fn'],'example':p['example'],'usage_note':p['usageNote'],'personal':True} for p in own]]
    chosen=s['selected_pattern_ids'] or []
    memorised=s['memorised_pattern_ids'] or []
    selected=[]
    for p in patterns:
        data={'id':str(p['id']),'pattern':p['pattern'],'fn':p['function'],'example':p['example'],'usageNote':p['usage_note'],'usageNoteUz':p['usage_note'] if p.get('personal') else usage_uz(p['usage_note']),'personal':p.get('personal',False)}
        if s['step'] in (6,7) and not s['completed_at']:
            if str(p['id']) not in chosen:continue
            if s['step']==6 and str(p['id']) not in memorised:
                tokens={w for w in words(p['pattern']) if len(w)>2 or w not in ('a','an')}
                data['pattern']=''
                data['example']=re.sub(r"[^\W_]+(?:'[^\W_]+)*",lambda m:('_'*max(3,len(m.group()))) if m.group().lower() in tokens else m.group(),p['example'])
        selected.append(data)
    show=s['step']==1 or 4<=s['step']<7 or bool(s['completed_at'])
    dt=lambda x:x.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z') if x else None
    view={'id':str(s['id']),'step':s['step'],'source':{'id':str(t['id']),'title':t['title'],'taskType':t['task_type'],'topic':t['topic'],'targetBand':float(t['target_band'])},
      'brainstorm':s['brainstorm'],'draft':s['draft'],'comparison':s['comparison'],'rewrite':s['rewrite'],
      'modelBody':t['body'] if show else None,'patterns':selected if s['step']>=4 else None,
      'selectedPatternIds':chosen,'memorisedPatternIds':memorised,'rewritePatternIds':s['rewrite_pattern_ids'] or [],
      'rewriteAvailableAt':dt(s['rewrite_available_at']),
      'rewriteUnlocked':bool(s['rewrite_available_at'] and s['rewrite_available_at']<=now),
      'completedAt':dt(s['completed_at'])}
    metadata=metadata_for_model(t)
    if metadata:
        view['source'].update({k:v for k,v in metadata.items() if k!='feedback'})
        view['modelFeedback']=metadata['feedback'] if show and (s['step']>=4 or s['completed_at']) else None
        view['modelFeedbackUz']=metadata['feedbackUz'] if view['modelFeedback'] else None
    return view


def validate(b):
    if not isinstance(b,dict) or b.get('action') not in STEPS:return False
    a=b['action']
    if a=='read':return set(b)=={'action'}
    if a in ('brainstorm','draft','compare','rewrite'):
        return set(b)=={'action','text'} and isinstance(b.get('text'),str) and len(b['text'])<=6000
    if a=='analyse':
        ids=b.get('patternIds')
        return set(b)=={'action','patternIds'} and isinstance(ids,list) and 1<=len(ids)<=70 and all(isinstance(x,str) and core.uuid_value(x) for x in ids)
    if a=='recall':
        return set(b)=={'action','patternId','attempt'} and isinstance(b.get('patternId'),str) and core.uuid_value(b['patternId']) and isinstance(b.get('attempt'),str) and len(b['attempt'])<=300
    return False

@router.post('/api/writing/stealing/sessions/{id}')
async def advance_session(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    b=await core.payload(req)
    if not core.uuid_value(id) or not validate(b):return core.j({'error':{'code':'invalid_input','message':'Check your answer.'}},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            s=await con.fetchrow('SELECT * FROM writing_stealing_sessions WHERE id=$1 AND user_id=$2',id,u['id'])
            if not s:return core.j({'error':{'code':'not_found','message':'Step not completed.'}},404)
            action=b['action']; step=STEPS[action]
            if s['completed_at'] or s['step']!=step:return core.j({'error':{'code':'wrong_step','message':'Step not completed.'}},409)
            updated={'step':s['step']};recalled=None
            if action=='read':updated['step']=2
            elif action in ('brainstorm','draft','compare','rewrite'):
                limit={'brainstorm':8,'draft':40,'compare':12,'rewrite':40}[action]
                if len(words(b['text']))<limit:return core.j({'error':{'code':'too_short','message':'Step not completed.'}},400)
                if action=='rewrite':
                    if not s['rewrite_available_at'] or s['rewrite_available_at']>datetime.now(timezone.utc):return core.j({'error':{'code':'locked','message':'Step not completed.'}},400)
                    pats=await con.fetch('SELECT id,pattern FROM writing_language_patterns WHERE id=ANY($1::uuid[])',s['selected_pattern_ids'])
                    pats=[*pats,*[p for p in await personal_patterns(con,u['id'],s['model_text_id']) if p['id'] in s['selected_pattern_ids']]]
                    updated['rewrite_pattern_ids']=[str(x['id']) for x in pats if uses(b['text'],x['pattern'])]
                    updated['completed_at']=datetime.now(timezone.utc)
                updated[{'brainstorm':'brainstorm','draft':'draft','compare':'comparison','rewrite':'rewrite'}[action]]=b['text'].strip()
                if action!='rewrite':updated['step']=step+1
            elif action=='analyse':
                ps=await con.fetch('''SELECT id FROM writing_language_patterns WHERE source_ref=$1
                  AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))''',str(s['model_text_id']))
                allowed={str(p['id']) for p in ps}|{p['id'] for p in await personal_patterns(con,u['id'],s['model_text_id'])}
                selected=list(dict.fromkeys(p for p in b['patternIds'] if p in allowed))
                if not selected:return core.j({'error':{'code':'invalid','message':'Step not completed.'}},400)
                updated.update(selected_pattern_ids=selected,step=5)
            elif action=='recall':
                if b['patternId'] not in (s['selected_pattern_ids'] or []):return core.j({'error':{'code':'invalid','message':'Step not completed.'}},400)
                p=await con.fetchrow('SELECT pattern FROM writing_language_patterns WHERE id=$1',b['patternId'])
                if not p:p=next((x for x in await personal_patterns(con,u['id'],s['model_text_id']) if x['id']==b['patternId']),None)
                recalled=bool(p) and match_key(b['attempt'])==match_key(p['pattern'])
                if recalled:
                    mem=list(dict.fromkeys([*(s['memorised_pattern_ids'] or []),b['patternId']]))
                    updated['memorised_pattern_ids']=mem
                    if all(k in mem for k in s['selected_pattern_ids']):
                        updated['step']=7
                        updated['rewrite_available_at']=datetime.now(timezone.utc)+timedelta(days=3)
            sets=[];vals=[id,step]
            names={ 'step':'step','brainstorm':'brainstorm','draft':'draft','comparison':'comparison',
                     'selected_pattern_ids':'selected_pattern_ids','memorised_pattern_ids':'memorised_pattern_ids',
                     'rewrite_available_at':'rewrite_available_at','rewrite':'rewrite','rewrite_pattern_ids':'rewrite_pattern_ids','completed_at':'completed_at'}
            for k,v in updated.items():
                vals.append(json.dumps(v) if k.endswith('_ids') else v)
                sets.append(f'{names[k]}=${len(vals)}'+('::jsonb' if k.endswith('_ids') else ''))
            query='UPDATE writing_stealing_sessions SET '+', '.join(sets)+',updated_at=now() WHERE id=$1 AND step=$2 RETURNING *'
            saved=await con.fetchrow(query,*vals)
            if not saved:return core.j({'error':{'code':'wrong_step','message':'Step not completed.'}},409)
            if action=='rewrite' and saved['completed_at']:
                from .coin_rewards import award_coin
                await award_coin(con,u['id'],f"writing:stealing:{saved['model_text_id']}",module='writing',
                                 activity_type='language_stealing',
                                 parent_content_id=str(saved['model_text_id']),
                                 exercise_id=str(saved['model_text_id']),evidence_id=str(saved['id']))
            result={'ok':True,'view':await session_view(con,saved,datetime.now(timezone.utc))}
            if recalled is not None:result['recalled']=recalled
            return core.j(result)

def install():core.app.include_router(router)
