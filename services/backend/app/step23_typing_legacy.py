"""Legacy model-text typing POST: exact JWT binding, canonical text and
server-side metrics, preserving a pre-0048-compatible SQL write unit.
"""
from __future__ import annotations
import math,re,time
from fastapi import APIRouter,Request
from . import main as core
from .step23_typing import verify,TokenProblem,LEGACY,typing_stats
router=APIRouter()

def levenshtein(a,b):
    if len(a)<len(b):a,b=b,a
    prev=list(range(len(b)+1))
    for i,ch in enumerate(a,1):
        row=[i]
        for j,c in enumerate(b,1):row.append(min(prev[j]+1,row[-1]+1,prev[j-1]+(ch!=c)))
        prev=row
    return prev[-1]

def result(target,typed,duration):
    if not target.strip() or not 3000<=duration<=1800000:raise ValueError()
    typed=typed[:len(target)+200];reference=target[:min(len(target),len(typed))]
    misses=levenshtein(reference,typed) if typed else 0
    correct=max(0,len(typed)-misses)
    # JavaScript Number rounds positive metrics to one decimal.
    r1=lambda x:math.floor(x*10+0.5)/10
    return {'wpm':r1(correct/5/(duration/60000)), 'rawWpm':r1(len(typed)/5/(duration/60000)),
      'accuracy':r1(correct/len(typed)*100) if typed else 0,'correctChars':correct,
      'mistakes':misses,'typedChars':len(typed),'targetChars':len(target),
      'completion':r1(min(100,min(len(typed),len(target))/len(target)*100)), 'durationMs':duration}

@router.post('/api/writing/typing')
async def submit_legacy(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    body=await core.payload(req)
    allowed={'modelTextId','typedText','durationMs','token'}
    if (not isinstance(body,dict) or set(body)!=allowed or core.uuid_value(body.get('modelTextId')) is None or
        not isinstance(body.get('typedText'),str) or len(body['typedText'])>8200 or type(body.get('durationMs')) is not int or body['durationMs']<=0 or
        not isinstance(body.get('token'),str) or not 20<=len(body['token'])<=2000):
        return core.j({'error':{'code':'invalid_input','message':'Could not record this run.'}},400)
    now=int(time.time()*1000);code=None
    try:
        p=verify(body['token'],LEGACY,user['id'],now)
        if not p:code='expired'
        elif p.get('mt')!=body['modelTextId'] or not isinstance(p.get('iat'),int) or (p.get('ps') is not None and p.get('ps') not in (30,60,120,180)):
            code='invalid_token'
    except TokenProblem:code='invalid_token'
    if code is None:
        db=await core.pool()
        async with db.acquire() as con:
            row=await con.fetchrow('''SELECT id,body FROM writing_model_texts WHERE id=$1 AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))''',core.uuid_value(body['modelTextId']))
            if not row:code='not_found'
            elif len(body['typedText'])>len(row['body'])+200:code='too_long'
            else:
                elapsed=now-p['iat']*1000;claimed=body['durationMs']
                duration=claimed if elapsed-3000<=claimed<=elapsed+1000 else elapsed
                if p.get('ps') is not None:duration=min(duration,p['ps']*1000)
                try:m=result(row['body'],body['typedText'],round(duration))
                except ValueError:code='invalid_duration'
                if code is None:
                    async with con.transaction():
                        run_id=await con.fetchval('''INSERT INTO typing_runs(user_id,target_chars,typed_chars,duration_ms,wpm,accuracy)
                        VALUES($1,$2,$3,$4,$5,$6) RETURNING id''',user['id'],m['targetChars'],m['typedChars'],m['durationMs'],str(m['wpm']),str(m['accuracy']))
                        await con.execute('''INSERT INTO typing_run_texts(run_id,model_text_id,mistakes,preset_seconds)
                        VALUES($1,$2,$3,$4)''',run_id,row['id'],m['mistakes'],p.get('ps'))
                        import json
                        await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'TYPING_RUN_COMPLETED',$2::jsonb)''',user['id'],json.dumps({'runId':str(run_id),'wpm':m['wpm'],'accuracy':m['accuracy'],'durationMs':m['durationMs'],'presetSeconds':p.get('ps')}))
                    stats=await typing_stats(con,user['id'])
                    return core.j({'run':{'id':str(run_id),**m,'presetSeconds':p.get('ps')},'summary':{k:stats[k] for k in ('count','bestWpm','bestAccuracy')},'history':stats['history']})
    status=404 if code=='not_found' else 409 if code=='expired' else 400
    return core.j({'error':{'code':code,'message':'The run was too short to measure.' if code=='invalid_duration' else 'Could not record this run.'}},status)

def install():core.app.include_router(router)
