"""Writing Activation Lab: strict external gate, item resolution, tokenized presence
check, one transactional usage/event write, and persisted per-session statistics.
"""
from __future__ import annotations
import hashlib,json,math,re,unicodedata,uuid
import regex as uregex
from fastapi import APIRouter,Request
from . import main as core
from . import step23_writing_provider as ai
from .rate_limit import evaluation_limit
router=APIRouter()
LEVELS={'5.5','6.0','6.5','7.0','7.5+'};KEYS=('meaning','form','collocation','naturalness','grammar')
PLACEHOLDERS={'sb','sth','someone','something','somebody',"one's",'x','y'}
OPTIONAL={'a','an','the'}
IRREGULAR={'make':['made'],'take':['took','taken'],'give':['gave','given'],'do':['did','done','does'],'have':['has','had'],'go':['went','gone','goes'],'get':['got','gotten'],'bring':['brought'],'come':['came'],'keep':['kept'],'hold':['held'],'pay':['paid'],'run':['ran'],'see':['saw','seen'],'set':['set'],'put':['put'],'draw':['drew','drawn'],'meet':['met'],'catch':['caught'],'think':['thought'],'lead':['led'],'fall':['fell','fallen'],'rise':['rose','risen'],'grow':['grew','grown'],'be':['is','are','was','were','been','being','am']}

def tokens(s):
    s=unicodedata.normalize('NFKC',s).lower().translate(str.maketrans({'\u2018':"'",'\u2019':"'",'\u02bc':"'",'`':"'"}))
    s=re.sub('[\u2010-\u2015\u2212-]',' ',s)
    return re.findall(r"[\w']+",s)

def same(word,target):
    if word==target or word in IRREGULAR.get(target,[]):return True
    if target.endswith('e') and word==target[:-1]+'ing':return True
    if len(target)<=4:return word in (target+'s',target+'es',target+'d',target+'ed')
    stem=target[:max(4,len(target)-3)]
    return word.startswith(stem) and len(word)-len(target)<=4

def contains(answer,item):
    a=tokens(answer);raw=tokens(item);target=[];slot=False
    for w in raw:
        if w in PLACEHOLDERS:slot=True;continue
        if w in OPTIONAL and len(raw)>1:continue
        target.append((w,0 if not target else 4 if slot else 2));slot=False
    if not target:return False
    for pos,w in enumerate(a):
        if not same(w,target[0][0]):continue
        current=pos;ok=True
        for term,gap in target[1:]:
            found=next((j for j in range(current+1,min(len(a),current+gap+2)) if same(a[j],term)),None)
            if found is None:ok=False;break
            current=found
        if ok:return True
    return False

def custom(raw):
    if not isinstance(raw,str):return None
    s=re.sub(r'\s+',' ',raw.strip())
    return s if 2<=len(s)<=80 and bool(uregex.fullmatch(r"[\p{L}][\p{L}\p{N}'’ ,.\u2010-\u2015-]*",s)) else None

def score(bands):
    if not bands or any(type(bands.get(k)) not in (int,float) for k in KEYS):return None
    return max(0,min(100,round(sum(bands[k] for k in KEYS)/5/9*100)))

def stats(events):
    items={str(e.get('term','')).lower() for e in events};totals={};scores=[]
    for e in events:
        for k,v in (e.get('bands') or {}).items():
            if type(v) in (int,float):totals.setdefault(k,[]).append(v)
        if type(e.get('activationScore')) in (int,float):scores.append(e['activationScore'])
    return {'attempts':len(events),'accepted':sum(e.get('verdict') in ('correct','acceptable') for e in events),
      'needsRevision':sum(e.get('verdict')=='needs_revision' for e in events),'items':len(items),
      'usageRecorded':sum(e.get('usageRecorded') is True for e in events),
      'averageBands':{k:math.floor(sum(vals)/len(vals)*2+0.5)/2 for k,vals in totals.items()},
      'averageActivation':round(sum(scores)/len(scores)) if scores else None}

def err(code,msg,retry=None):return {'error':{'code':code,'message':msg,**({'retryable':retry} if retry is not None else {})}}

@router.post('/api/writing/activation/check')
async def check_activation(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j(err('unauthenticated','Sign in again.'),401)
    limited=await evaluation_limit(user['id'],lightweight=True)
    if limited is not None:return limited
    b=await core.payload(req)
    allowed={'sessionId','entryId','customTerm','mode','targetLevel','uzbekPrompt','upgradeFrom','answer'}
    if (not isinstance(b,dict) or set(b)-allowed or not {'sessionId','mode','targetLevel','uzbekPrompt','answer'}<=set(b)
        or core.uuid_value(b.get('sessionId')) is None or (b.get('entryId') is not None and core.uuid_value(b['entryId']) is None)
        or (b.get('entryId') is not None)==bool(b.get('customTerm')) or b.get('mode') not in ('writing','speaking')
        or b.get('targetLevel') not in LEVELS or type(b.get('uzbekPrompt')) is not bool
        or not isinstance(b.get('answer'),str) or not 1<=len(b['answer'])<=600
        or (b.get('customTerm') is not None and (not isinstance(b['customTerm'],str) or len(b['customTerm'])>80))
        or (b.get('upgradeFrom') is not None and (not isinstance(b['upgradeFrom'],str) or len(b['upgradeFrom'])>600))):
        return core.j(err('invalid_input','Write a sentence with the item.','answer'),400)
    if not await ai.provider_spec():return core.j(err('unavailable','AI checking is not available right now.',False),503)
    answer=b['answer'].strip()
    if not answer:return core.j(err('empty','Could not check this sentence.',False),400)
    db=await core.pool()
    async with db.acquire() as con:
        if b.get('entryId'):
            entry=await con.fetchrow('''SELECT uv.*,lx.term,lx.definition_en,lx.translation_uz FROM user_vocabulary uv
               JOIN lexemes lx ON lx.id=uv.lexeme_id WHERE uv.id=$1 AND uv.user_id=$2''',core.uuid_value(b['entryId']),user['id'])
            if not entry:return core.j(err('not_found','Could not check this sentence.',False),404)
            item={'entryId':str(entry['id']),'term':entry['term'],'definitionEn':entry['definition_en'],'translationUz':entry['translation_uz']}
        else:
            item_term=custom(b.get('customTerm'))
            if not item_term:return core.j(err('invalid_item','Could not check this sentence.',False),400)
            item={'entryId':None,'term':item_term,'definitionEn':None,'translationUz':None}
        missing=not contains(answer,item['term']);r=None;verdict='needs_revision'
        if not missing:
            r,error=await ai.check(user.get('locale','en'),'activation',{'kind':'activation','item':item['term'],'meaningHint':item['definitionEn'],'mode':b['mode'],'targetLevel':b['targetLevel'],'uzbekPrompt':item['translationUz'] if b['uzbekPrompt'] else None,'upgradeFrom':(b.get('upgradeFrom') or '').strip() or None,'answer':answer},b['mode'])
            if error:return core.j(err('unavailable' if error=='unavailable' else 'failed','Could not check this sentence.',error=='failed'),503)
            verdict=r['verdict']
        activation_score=score(r['bands'] if r else None);used=False
        async with con.transaction():
            if item['entryId'] and r and verdict!='needs_revision':
                usage=await con.fetchrow('''INSERT INTO vocabulary_usages(user_id,user_vocabulary_id,sentence,origin,riwi_accepted,points_awarded)
                    VALUES($1,$2,$3,'manual',FALSE,0) RETURNING id''',user['id'],core.uuid_value(item['entryId']),answer)
                normalized=re.sub(r'\s+',' ',re.sub(r"[^a-z0-9' ]+",' ',answer.lower().replace('’',"'"))).strip()
                fingerprint=hashlib.sha256(normalized.encode()).hexdigest()[:32]
                key=f"sentence:{user['id']}:{item['entryId']}:{fingerprint}"
                awarded=await con.fetchval('''INSERT INTO vocab_point_events(user_id,kind,ref_type,ref_id,points,dedupe_key)
                    VALUES($1,'sentence','vocabulary_usage',$2,2,$3) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id''',user['id'],str(usage['id']),key)
                points=2 if awarded else 0
                await con.execute('''UPDATE vocabulary_usages SET origin='external_ai',riwi_accepted=TRUE,evaluation_id=$2,points_awarded=$3 WHERE id=$1''',usage['id'],core.uuid_value(r['evaluationId']) if r.get('evaluationId') and core.uuid_value(r['evaluationId']) else uuid.uuid4(),points)
                if awarded:
                    row=await con.fetchrow('''UPDATE user_vocabulary SET active_use_count=active_use_count+1 WHERE id=$1 RETURNING active_use_count,srs_stage''',core.uuid_value(item['entryId']))
                    mastery='mastered' if row['srs_stage']>=4 else 'active'
                    await con.execute('''UPDATE user_vocabulary SET mastery=$2,mastered_at=CASE WHEN $2='mastered' THEN NOW() ELSE mastered_at END WHERE id=$1''',core.uuid_value(item['entryId']),mastery)
                used=True
            await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'WRITING_ACTIVATION_CHECK',$2::jsonb)''',user['id'],json.dumps({'sessionId':b['sessionId'],'term':item['term'],'entryId':item['entryId'],'mode':b['mode'],'targetLevel':b['targetLevel'],'verdict':verdict,'itemMissing':missing,'bands':r['bands'] if r else None,'usageRecorded':used,'activationScore':activation_score,'uzbekApplied':bool(b['uzbekPrompt'] and item['translationUz']),'answer':answer,'feedback':r['feedback'] if r else None,'improved':r['improved'] if r else None,'fixes':(r['fixes'][:3] if r else [])}))
        rows=await con.fetch('''SELECT payload FROM activity_events WHERE user_id=$1 AND type='WRITING_ACTIVATION_CHECK'
          AND payload->>'sessionId'=$2 ORDER BY created_at DESC LIMIT 500''',user['id'],b['sessionId'])
        return core.j({'ok':True,'verdict':verdict,'result':r,'itemMissing':missing,'usageRecorded':used,
                       'activationScore':activation_score,'uzbekApplied':bool(b['uzbekPrompt'] and item['translationUz']),
                       'stats':stats([x['payload'] for x in rows])})

def install():core.app.include_router(router)
