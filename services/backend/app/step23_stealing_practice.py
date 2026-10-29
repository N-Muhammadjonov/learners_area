"""Writing Language Stealing new-topic practice with a deterministic near-copy guard.
The near-copy outcome does not pretend to be AI evaluated.
"""
from __future__ import annotations
import json,math,re,unicodedata
from fastapi import APIRouter,Request
from . import main as core
from . import step23_writing_provider as ai
from .rate_limit import evaluation_limit
from .step16_stealing_port import FALLBACK
from .step23_typing_legacy import levenshtein
router=APIRouter()
STOP=set('the a an of to in on and or is are was were be it this that for with as by at from its their has have can will more than'.split())

def tokens(s):
    return re.findall(r"[\w']+",unicodedata.normalize('NFKC',s).lower().replace('’',"'").replace('-',' '))

def distwords(a,b):
    prev=list(range(len(b)+1))
    for i,x in enumerate(a,1):
        row=[i]
        for j,y in enumerate(b,1):row.append(min(row[-1]+1,prev[j]+1,prev[j-1]+(x!=y)))
        prev=row
    return prev[-1]

def near_copy(answer,source,pattern):
    a=tokens(answer);e=tokens(source)
    distance=distwords(a,e);pt=set(tokens(pattern))
    tw=list(dict.fromkeys(w for w in e if len(w)>=3 and w not in STOP and w not in pt))
    overlap=sum(w in set(a) for w in tw)/len(tw) if tw else 0
    if a==e:return {'nearCopy':True,'reason':'exact','editDistance':0,'topicOverlap':1}
    if distance<=max(2,math.floor(len(e)*.3)):reason='edit_distance'
    elif len(tw)>=2 and overlap>=.6:reason='topic_words'
    else:reason=None
    return {'nearCopy':bool(reason),'reason':reason,'editDistance':distance,'topicOverlap':overlap}

def err(code,msg,retry=None):return {'error':{'code':code,'message':msg,**({'retryable':retry} if retry is not None else {})}}

@router.post('/api/writing/stealing/practice')
async def post(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j(err('unauthenticated','Sign in again.'),401)
    limited=await evaluation_limit(user['id'],lightweight=True)
    if limited is not None:return limited
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'patternId','newTopic','answer'} or core.uuid_value(b.get('patternId')) is None or any(not isinstance(b.get(k),str) or not 1<=len(b[k])<=lim for k,lim in [('newTopic',120),('answer',800)]):
        return core.j(err('invalid_input','Write your adapted sentence.','answer'),400)
    spec=await ai.provider_spec()
    if spec is None:return core.j(err('unavailable','AI checking is not available right now.',False),503)
    db=await core.pool()
    async with db.acquire() as con:
        pattern=await con.fetchrow('''SELECT id,pattern,example,topic FROM writing_language_patterns
              WHERE id=$1 AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))''',core.uuid_value(b['patternId']))
        if not pattern:return core.j(err('not_found','Could not check this sentence.',False),404)
        ptopics=await con.fetch('''SELECT DISTINCT topic FROM writing_language_patterns WHERE publication_state='published' AND (publish_at IS NULL OR publish_at<=NOW())''')
        mtopics=await con.fetch('''SELECT DISTINCT topic FROM writing_model_texts WHERE publication_state='published' AND (publish_at IS NULL OR publish_at<=NOW())''')
        topics=(set(FALLBACK)|{s['topic'].strip().lower() for s in [*ptopics,*mtopics] if s['topic'] and s['topic'].strip()})-{(pattern['topic'] or '').strip().lower()}
        topic=b['newTopic'].strip().lower()
        if topic not in topics:return core.j(err('invalid_topic','Could not check this sentence.',False),400)
        text=b['answer'].strip()
        if not text:return core.j(err('empty','Could not check this sentence.',False),400)
        copy=near_copy(text,pattern['example'],pattern['pattern']);r=None;verdict='needs_revision'
        if not copy['nearCopy']:
            r,e=await ai.check(user.get('locale','en'),'pattern',{'kind':'pattern','pattern':pattern['pattern'],'sourceExample':pattern['example'],'sourceTopic':pattern['topic'] or '', 'newTopic':topic,'answer':text})
            if e:return core.j(err('unavailable' if e=='unavailable' else 'failed','Could not check this sentence.',e=='failed'),503)
            verdict=r['verdict'] if (r['bands']['adaptation'] or 0)>=5 else 'needs_revision'
        saved=bool(await con.fetchval('SELECT 1 FROM writing_pattern_bank WHERE user_id=$1 AND pattern_id=$2',user['id'],pattern['id']))
        await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'WRITING_PATTERN_PRACTICE',$2::jsonb)''',user['id'],json.dumps({'patternId':str(pattern['id']),'newTopic':topic,'verdict':verdict,'nearCopy':copy['reason'],'bands':r['bands'] if r else None}))
        return core.j({'ok':True,'verdict':verdict,'copy':copy,'result':r,'canSave':verdict!='needs_revision','saved':saved})

def install():core.app.include_router(router)
