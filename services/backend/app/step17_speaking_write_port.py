"""Speaking prompt authoring and guarded topic group writes from source TS."""
from __future__ import annotations
import re,json
import bleach
try:
    from bleach.css_sanitizer import CSSSanitizer
except ImportError:
    CSSSanitizer = None
from fastapi import APIRouter,Request
from . import main as core
from .db import row_to_dict
router=APIRouter()
TAGS=['p','div','span','br','b','strong','i','em','u','s','mark','font','ul','ol','li','blockquote','h2','h3','h4','table','tbody','tr','th','td','sub','sup']
PARTS=('part1','part2','part3'); CHANNELS=('practice_alone','live_partner','ai')

def clean_html(text):
    # The source's sanitize-html allowlist: no hrefs, media, scripts, or arbitrary attributes.
    # Bleach's HTML parser may serialize malformed HTML differently from sanitize-html.
    styles=['font-family','font-size','font-weight','font-style','text-decoration','text-align','color','background-color']
    kwargs=({'css_sanitizer':CSSSanitizer(allowed_css_properties=styles)} if CSSSanitizer else {'styles':styles})
    return bleach.clean(text,tags=TAGS,attributes=lambda tag,name,value: name=='style' or tag=='font' and name in ('face','color','size') or tag in ('td','th') and name in ('colspan','rowspan'),strip=True,**kwargs)

def draft(item):
    if not isinstance(item,dict):return None
    p=item.get('part'); topic=item.get('topic'); prompt=item.get('promptText')
    if p not in PARTS or not isinstance(topic,str) or not 1<=len(topic.strip())<=200 or not isinstance(prompt,str) or not 1<=len(prompt.strip())<=200:return None
    sid=item.get('id')
    if sid is not None and not core.uuid_value(sid):return None
    cue=item.get('cueCard',''); follow=item.get('followUps',[]);channels=item.get('availableIn');support=item.get('studySupport')
    if not isinstance(cue,str) or len(cue)>12000 or not isinstance(follow,list) or len(follow)>20 or any(not isinstance(x,str) or not 1<=len(x.strip())<=2000 for x in follow):return None
    if not isinstance(channels,list) or not 1<=len(channels)<=3 or any(x not in CHANNELS for x in channels):return None
    if not isinstance(support,dict):return None
    su={}
    for key in ('vocabularyHtml','modelAnswerHtml','ideasHtml'):
        val=support.get(key,'')
        if not isinstance(val,str) or len(val)>100000:return None
        su[key]=clean_html(val)
    vocab=support.get('vocabulary',[])
    if not isinstance(vocab,list) or len(vocab)>100:return None
    words=[]
    for word in vocab:
        if not isinstance(word,dict):return None
        rec={}
        for k,max_len,required in [('term',120,True),('definitionEn',500,True),('translationUz',500,False),('partOfSpeech',30,False),('exampleSentence',500,False)]:
            v=word.get(k,'')
            if not isinstance(v,str) or len(v.strip())>max_len or required and not v.strip():return None
            rec[k]=v.strip()
        words.append(rec)
    su['vocabulary']=words
    shared='practice_alone' in channels or 'live_partner' in channels
    channels=list(dict.fromkeys(channels+(['practice_alone','live_partner'] if shared else [])))
    return {'id':sid,'part':p,'category':p,'topic':topic.strip(),'prompt_text':prompt.strip(),'cue_card':cue,
        'follow_ups':[x.strip() for x in follow],'available_in':channels,'study_support':su,
        'prep_seconds':60 if p=='part2' else 0,'answer_seconds':120 if p=='part2' else 45 if p=='part3' else 30,
        'publication_state':'published'}

def returned(row):
    r=row_to_dict(row)
    mapping={'prompt_text':'promptText','cue_card':'cueCard','prep_seconds':'prepSeconds',
       'answer_seconds':'answerSeconds','follow_ups':'followUps','study_support':'studySupport',
       'external_id':'externalId','source_class':'sourceClass','available_in':'availableIn',
       'is_active':'isActive','publication_state':'publicationState','publish_at':'publishAt',
       'created_at':'createdAt'}
    for name in ('follow_ups','study_support','available_in'):
        if isinstance(r.get(name),str):r[name]=json.loads(r[name])
    return {mapping.get(k,k):v for k,v in r.items()}

async def save(con,item,position=0,publication=True):
    params=[item['part'],item['category'],item['topic'],item['prompt_text'],item['cue_card'],item['follow_ups'],item['available_in'],item['study_support'],item['prep_seconds'],item['answer_seconds']]
    base='''part=$1,category=$2,topic=$3,prompt_text=$4,cue_card=$5,follow_ups=$6::jsonb,available_in=$7::jsonb,study_support=$8::jsonb,prep_seconds=$9,answer_seconds=$10,publication_state='published' '''
    params[5]=json.dumps(params[5],ensure_ascii=False);params[6]=json.dumps(params[6],ensure_ascii=False);params[7]=json.dumps(params[7],ensure_ascii=False)
    if item['id']:
        row=await con.fetchrow(f'UPDATE speaking_prompts SET {base},publish_at=NULL WHERE id=$11 RETURNING *',*params,core.uuid_value(item['id']))
    else:
        row=await con.fetchrow('''INSERT INTO speaking_prompts(part,category,topic,prompt_text,cue_card,follow_ups,available_in,study_support,prep_seconds,answer_seconds,publication_state,created_at)
             VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,$10,'published',now()+($11::integer*interval '1 millisecond')) RETURNING *''',*params,position)
    return row

def identity(item):
    if not isinstance(item,dict) or item.get('part') not in PARTS or (item.get('topic') is not None and (not isinstance(item.get('topic'),str) or len(item['topic'])>200)) or item.get('bank') not in ('shared','ai'):return None
    ids=item.get('ids')
    if not isinstance(ids,list) or not 1<=len(ids)<=2000 or any(not core.uuid_value(i) for i in ids):return None
    return {'part':item['part'],'topic':item['topic'],'bank':item['bank'],'ids':ids}

async def selected(con,identity):
    sql='''SELECT * FROM speaking_prompts p WHERE p.part=$1 AND (p.topic IS NOT DISTINCT FROM $2)
      AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || p.id::text)::uuid AND e.type='CONTENT_DELETED')
      AND ( (p.available_in @> '["practice_alone"]'::jsonb OR p.available_in @> '["live_partner"]'::jsonb) = $3) FOR UPDATE'''
    return await con.fetch(sql,identity['part'],identity['topic'],identity['bank']=='shared')

@router.post('/api/speaking/prompts')
async def prompt_post(req:Request):
    user=await core.current_user(req,active=True)
    if not user or user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    item=draft(await core.payload(req))
    if not item:return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        row=await save(con,item)
    if not row:return core.j({'error':'not_found'},404)
    return core.j({'ok':True,'prompt':returned(row)},200 if item['id'] else 201)

@router.post('/api/speaking/topics')
async def topic_post(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('owner','admin'):return core.j({'error':'forbidden'},403)
    body=await core.payload(req)
    if not isinstance(body,dict) or not isinstance(body.get('questions'),list) or not 1<=len(body['questions'])<=100:return core.j({'error':'invalid_input'},400)
    items=[draft(i) for i in body['questions']]
    if any(i is None for i in items):return core.j({'error':'invalid_input'},400)
    first=items[0]; channels=body['questions'][0]['availableIn']
    if any(i['part']!=first['part'] or i['topic']!=first['topic'] or sorted(raw['availableIn'])!=sorted(channels) for i,raw in zip(items,body['questions'])) or first['part']=='part2' and len(items)!=1:return core.j({'error':'invalid_input'},400)
    original=identity(body['original']) if 'original' in body else None
    if 'original' in body and not original:return core.j({'error':'invalid_input'},400)
    ids=[i['id'] for i in items if i['id']]
    if len(ids)!=len(set(ids)) or any(i not in (original['ids'] if original else []) for i in ids):return core.j({'error':'invalid_input'},400)
    target={'part':first['part'],'topic':first['topic'],'bank':'shared' if any(x in first['available_in'] for x in ('practice_alone','live_partner')) else 'ai'}
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute('SELECT pg_advisory_xact_lock(76432109)')
            existing=await selected(con,original) if original else []
            if original and (len(existing)!=len(original['ids']) or any(str(r['id']) not in original['ids'] for r in existing)):return core.j({'error':'topic_conflict'},409)
            occupied=await selected(con,target)
            if any(str(r['id']) not in (original['ids'] if original else []) for r in occupied):return core.j({'error':'topic_conflict'},409)
            if original:await con.execute('UPDATE speaking_prompts SET topic=$1 WHERE id=ANY($2::uuid[])',first['topic'],original['ids'])
            removed={str(r['id']) for r in existing}-set(ids)
            if removed:await con.execute("UPDATE speaking_prompts SET publication_state='archived' WHERE id=ANY($1::uuid[])",list(removed))
            saved=[]
            for i,item in enumerate(items):
                row=await save(con,item,i)
                if row:saved.append(returned(row))
    return core.j({'ok':True,'prompts':saved})

@router.delete('/api/speaking/topics')
async def topic_delete(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    body=identity(await core.payload(req))
    if not body:return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute('SELECT pg_advisory_xact_lock(76432109)')
            existing=await selected(con,body)
            if len(existing)!=len(body['ids']) or any(str(r['id']) not in body['ids'] for r in existing):return core.j({'error':'topic_conflict'},409)
            for id in body['ids']:
                await con.execute('''INSERT INTO activity_events(id,user_id,type,payload) VALUES(md5('deleted-content:' || $1::text)::uuid,$2,'CONTENT_DELETED',$3::jsonb) ON CONFLICT(id) DO NOTHING''',id,user['id'],json.dumps({'contentType':'speaking-prompt','contentId':id,'resultsPreserved':True}))
                await con.execute("UPDATE speaking_prompts SET publication_state='draft',publish_at=NULL,is_active=false WHERE id=$1",core.uuid_value(id))
                versions=await con.fetch('SELECT id FROM content_versions WHERE target_id=$1',core.uuid_value(id))
                for v in versions:
                    await con.execute("UPDATE content_versions SET publication_state='draft' WHERE id=$1",v['id'])
                    await con.execute('''INSERT INTO activity_events(id,user_id,type,payload) VALUES(md5('deleted-content:' || $1::text)::uuid,$2,'CONTENT_DELETED',$3::jsonb) ON CONFLICT(id) DO NOTHING''',str(v['id']),user['id'],json.dumps({'contentType':'content-version','contentId':str(v['id']),'resultsPreserved':True}))
                await con.execute('''INSERT INTO audit_log(actor_user_id,action,target_type,target_id,metadata) VALUES($1,'content.updated','speaking-prompt',$2,$3::jsonb)''',user['id'],core.uuid_value(id),json.dumps({'operation':'delete','resultsPreserved':True}))
    return core.j({'ok':True})
def install():core.app.include_router(router)
