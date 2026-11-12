"""Server-authoritative Writing Typing trainer: signed prepare/start/pause/resume/finish.
Port of typing-runs.ts, typing-metrics.ts and typing-keystrokes.ts; migration 0048
fallback is limited to a proven missing schema, never a general DB outage.
"""
from __future__ import annotations
import base64,hashlib,hmac,json,math,os,random,re,time,uuid
from datetime import datetime,timezone
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .security import secret
router=APIRouter()
PREP='learners-area:typing-prep';RUN='learners-area:typing-live';LEGACY='learners-area:typing-run'
PRESETS=(0,30,60,120,180)
HEAD={'cache-control':'no-store'}
CORPUS=json.loads(Path(__file__).with_name('typing_corpus_original.json').read_text())

class TokenProblem(ValueError):pass

def b64(blob):return base64.urlsafe_b64encode(blob).rstrip(b'=').decode()
def fromb64(value):
    if not isinstance(value,str) or not re.fullmatch('[A-Za-z0-9_-]+',value):raise TokenProblem()
    return base64.urlsafe_b64decode(value+'='*((-len(value))%4))

def sign(payload,audience,subject,now_ms=None,lifetime=600000,jti=None):
    at=int(now_ms if now_ms is not None else time.time()*1000)
    claims={**payload,'sub':str(subject),'aud':audience,'iat':at//1000,'exp':(at+lifetime)//1000}
    if jti:claims['jti']=jti
    segments=[b64(json.dumps({'alg':'HS256'},separators=(',',':')).encode()),b64(json.dumps(claims,separators=(',',':')).encode())]
    text='.'.join(segments)
    return text+'.'+b64(hmac.new(secret(),text.encode(),'sha256').digest())

def verify(token,audience,subject,now_ms=None):
    if not isinstance(token,str) or len(token)>2500:raise TokenProblem()
    try:
        head,body,checksum=token.split('.')
        if not hmac.compare_digest(hmac.new(secret(),f'{head}.{body}'.encode(),'sha256').digest(),fromb64(checksum)):raise TokenProblem()
        h=json.loads(fromb64(head));p=json.loads(fromb64(body));now=int(now_ms if now_ms is not None else time.time()*1000)//1000
        if h.get('alg')!='HS256' or p.get('aud')!=audience or p.get('sub')!=str(subject) or type(p.get('exp'))!=int or p['exp']<=now or type(p.get('iat'))!=int or p['iat']>now:return None
        if p.get('nbf') is not None and p['nbf']>now:return None
        return p
    except Exception:raise TokenProblem()

def typing_schema_missing(e):
    code=getattr(e,'sqlstate',None) or getattr(e,'code',None)
    return code in ('42P01','42703') and ('typing_texts' in str(e) or 'typing_text' in str(e))

def valid_json_object(data,required,optional=()):
    return isinstance(data,dict) and set(required)<=set(data) and set(data)<=set(required)|set(optional)

def valid_uuid(value):return isinstance(value,str) and core.uuid_value(value) is not None

def split_words(s):return s.strip().split()

def read_corpus(uid):return next((r for r in CORPUS if r['id']==str(uid)),None)

async def published_texts(con):
    try:
        rows=await con.fetch('''SELECT id,external_id,title,body,word_count,difficulty,topic FROM typing_texts
          WHERE publication_state='published' AND language='en' AND (publish_at IS NULL OR publish_at<=NOW()) ORDER BY external_id''')
        return [{'id':str(r['id']),'externalId':r['external_id'],'title':r['title'],'body':r['body'],
         'wordCount':r['word_count'],'difficulty':r['difficulty'],'topic':r['topic']} for r in rows]
    except Exception as e:
        if not typing_schema_missing(e):raise
        return list(CORPUS)

async def typing_text(con,uid):
    try:
        r=await con.fetchrow('SELECT id,title,body FROM typing_texts WHERE id=$1',core.uuid_value(uid))
        return {'id':str(r['id']),'title':r['title'],'body':r['body']} if r else None
    except Exception as e:
        if not typing_schema_missing(e):raise
        return read_corpus(uid)

@router.post('/api/writing/typing/prepare')
async def prepare(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    b=await core.payload(req)
    if not valid_json_object(b,{'preset'},{'textId','excludeTextId'}) or type(b['preset']) is not int or b['preset'] not in PRESETS or any(not valid_uuid(b[k]) for k in ('textId','excludeTextId') if k in b):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:all_texts=await published_texts(con)
    if b.get('textId'):selection=next((t for t in all_texts if t['id']==b['textId']),None)
    else:
        choices=[t for t in all_texts if t['id']!=b.get('excludeTextId')] if b.get('excludeTextId') and len(all_texts)>1 else all_texts
        selection=random.choice(choices) if choices else None
    if not selection:return core.j({'error':'no_text'},404)
    at=int(time.time()*1000)
    token=sign({'tt':selection['id'],'ps':b['preset']},PREP,u['id'],now_ms=at,lifetime=600000)
    return core.j({'token':token,'text':{'id':selection['id'],'title':selection['title'],
      'words':split_words(selection['body']),'wordCount':selection['wordCount'],
      'difficulty':selection['difficulty'],'topic':selection['topic']}},headers=HEAD)

@router.post('/api/writing/typing/start')
async def start(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':{'code':'unauthenticated','message':'Sign in again.'}},401)
    b=await core.payload(req)
    if not valid_json_object(b,{'token'}) or not isinstance(b['token'],str) or not 20<=len(b['token'])<=2500:
        return core.j({'error':{'code':'invalid_input','message':'Invalid typing preparation.'}},400)
    at=int(time.time()*1000)
    try:p=verify(b['token'],PREP,u['id'],at)
    except TokenProblem:p=None
    if not p or not isinstance(p.get('tt'),str) or type(p.get('ps')) is not int or p['ps'] not in PRESETS:
        return core.j({'error':{'code':'invalid_token','message':'This typing preparation expired.'}},403)
    preset=p['ps'];lifetime=86400000 if preset==0 else preset*1000+720000
    run=sign({'tt':p['tt'],'ps':preset,'st':at,'pm':0,'pc':0},RUN,u['id'],at,lifetime,str(uuid.uuid4()))
    return core.j({'ok':True,'runToken':run,'startedAt':at},headers=HEAD)

async def toggle(req,action):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    b=await core.payload(req)
    if not valid_json_object(b,{'runToken'}) or not isinstance(b['runToken'],str) or not 20<=len(b['runToken'])<=2500:
        return core.j({'error':'invalid_input'},400)
    at=int(time.time()*1000)
    try:p=verify(b['runToken'],RUN,u['id'],at)
    except TokenProblem:p=None
    if not p or not isinstance(p.get('tt'),str) or type(p.get('st')) not in (int,float) or not isinstance(p.get('jti'),str) or type(p.get('ps')) is not int or p['ps'] not in PRESETS:
        return core.j({'error':('pause_not_allowed' if action=='pause' else 'resume_not_allowed')},409)
    pause_ms=p.get('pm',0) if type(p.get('pm',0)) in (float,int) and p.get('pm',0)>=0 else 0
    paused_at=p.get('pa') if type(p.get('pa')) in (float,int) and p['pa']>=p['st'] else None
    pause_count=p.get('pc',0) if type(p.get('pc',0)) in (float,int) and p.get('pc',0)>=0 else 0
    if action=='pause':
        if paused_at is not None:return core.j({'runToken':b['runToken'],'paused':True,'pausedMs':pause_ms},headers=HEAD)
        if pause_count>=100:return core.j({'error':'pause_not_allowed'},409)
        claims={'tt':p['tt'],'ps':p['ps'],'st':p['st'],'pm':pause_ms,'pa':at,'pc':pause_count+1}
        paused=True
    else:
        if paused_at is None:return core.j({'runToken':b['runToken'],'paused':False,'pausedMs':pause_ms},headers=HEAD)
        pause_ms+=min(max(0,at-paused_at),180000,max(0,600000-pause_ms))
        claims={'tt':p['tt'],'ps':p['ps'],'st':p['st'],'pm':pause_ms,'pc':pause_count}
        paused=False
    return core.j({'runToken':sign(claims,RUN,u['id'],at,86400000,p['jti']),'paused':paused,'pausedMs':pause_ms},headers=HEAD)

@router.post('/api/writing/typing/pause')
async def pause(req:Request):return await toggle(req,'pause')
@router.post('/api/writing/typing/resume')
async def resume(req:Request):return await toggle(req,'resume')

# Same metrics formula as computeWordTypingMetrics in the TS trainer.
def consistency(samples):
    if len(samples)<4:return None
    rates=[(v-(samples[i-1] if i else 0))*12 for i,v in enumerate(samples)]
    avg=sum(rates)/len(rates)
    if avg<=0:return None
    sd=math.sqrt(sum((v-avg)**2 for v in rates)/len(rates))
    x=sd/avg
    return round(100*(1-math.tanh(x+x**3/3+x**5/5)),1)

def typed_chars(ws):return sum(len(w)+1 for w in ws[:-1])+len(ws[-1])
def sanitize_samples(s,chars,seconds):
    if not isinstance(s,list) or len(s)>math.ceil(seconds)+2:return []
    out=[];prev=0
    for x in s:
        if type(x) not in (int,float) or not math.isfinite(x) or x<0:return []
        c=min(max(math.floor(x),prev),chars)
        if c-prev>40:return []
        out.append(c);prev=c
    return out

def metrics(target,words,seconds,samples):
    committed=words[:-1];partial=words[-1]
    correct=incorrect=extra=missed=good=spaces=0
    for i,word in enumerate(committed+[partial]):
        expected=target[i] if i<len(target) else ''
        for pos in range(min(len(word),len(expected))):
            if word[pos]==expected[pos]:correct+=1
            else:incorrect+=1
        extra+=max(0,len(word)-len(expected))
        if i<len(committed):
            missed+=max(0,len(expected)-len(word))
            if word==expected and expected:good+=len(expected);spaces+=1
    partial_i=len(committed);pt=target[partial_i] if partial_i<len(target) else ''
    if partial_i==len(target)-1 and pt and partial==pt:good+=len(pt)
    chars=typed_chars(words);total_chars=len(' '.join(target));sec=max(1,seconds)
    completed=min(total_chars,sum(len(target[i])+1 for i in range(min(len(committed),len(target))))+min(len(partial),len(pt)))
    den=correct+incorrect+extra+missed
    return {'wpm':round((good+spaces)/5*60/sec,1),'rawWpm':round(chars/5*60/sec,1),
      'accuracy':round(correct/den*100,1) if den else 0,'consistency':consistency(samples),
      'correct':correct,'incorrect':incorrect,'extra':extra,'missed':missed,'typedChars':chars,
      'targetChars':total_chars,'mistakes':incorrect+extra+missed,
      'completion':round(completed/total_chars*100,1) if total_chars else 0,'durationMs':round(sec*1000)}

def validate_finish(target,words,seconds):
    if not isinstance(words,list) or not 1<=len(words)<=len(target)+1:return False
    if any(not isinstance(w,str) or len(w)>80 or ' ' in w for w in words):return False
    return typed_chars(words)/max(1,seconds)<=25

def replay_keystrokes(target,words,keys,missed):
    committed=[];buf='';attempts=correct=0
    for key in keys:
        if not isinstance(key,str) or len(key)!=1 or (ord(key)<32 and key not in ('\b','\x17')) or ord(key)==127:return None
        if key in ('\b','\x17'):
            if buf:buf=buf[:-1] if key=='\b' else ''
            elif committed and committed[-1]!=target[len(committed)-1]:
                value=committed.pop();buf=value if key=='\b' else ''
            continue
        if len(committed)>=len(target):continue
        expected=target[len(committed)]
        if key==' ':
            if not buf:continue
            attempts+=1;correct+=int(buf==expected);committed.append(buf);buf='';continue
        if len(buf)>=min(80,len(expected)+20):continue
        attempts+=1;correct+=int(key==expected[len(buf):len(buf)+1]);buf+=key
    if [*committed,buf]!=words:return None
    denominator=attempts+missed
    return {'accuracy':round(correct/denominator*100,1) if denominator else 0,'mistakes':attempts-correct+missed}

async def typing_stats(con,user_id):
    row=await con.fetchrow('SELECT count(*)::int AS count,max(wpm) AS best_wpm,max(accuracy) AS best_accuracy FROM typing_runs WHERE user_id=$1',user_id)
    runs=await con.fetch('''SELECT id,created_at,wpm,accuracy,duration_ms FROM typing_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10''',user_id)
    events=await con.fetch('''SELECT payload FROM activity_events WHERE user_id=$1 AND type='TYPING_RUN_COMPLETED' ORDER BY created_at DESC LIMIT 50''',user_id)
    by_run={r['payload']['runId']:r['payload'] for r in events if isinstance(r['payload'],dict) and isinstance(r['payload'].get('runId'),str)}
    links={}
    if runs:
        refs=[r['id'] for r in runs]
        linked=await con.fetch('''SELECT t.run_id,t.mistakes,t.preset_seconds,w.title FROM typing_run_texts t JOIN typing_runs r ON r.id=t.run_id LEFT JOIN writing_model_texts w ON w.id=t.model_text_id WHERE r.user_id=$1 AND t.run_id=ANY($2::uuid[])''',user_id,refs)
        links={str(r['run_id']):r for r in linked}
    history=[]
    for r in runs:
        event=by_run.get(str(r['id']),{});link=links.get(str(r['id']))
        created=r['created_at'].astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')
        history.append({'id':str(r['id']),'createdAt':created,'wpm':float(r['wpm']),'accuracy':float(r['accuracy']),
            'durationMs':r['duration_ms'],'mistakes':event.get('mistakes') if type(event.get('mistakes')) in (int,float) else link['mistakes'] if link else 0,
            'presetSeconds':event.get('presetSeconds') if type(event.get('presetSeconds')) in (int,float) else link['preset_seconds'] if link else None,
            'title':event.get('title') if isinstance(event.get('title'),str) else link['title'] if link and link['title'] else 'Typing'})
    return {'count':row['count'],'bestWpm':float(row['best_wpm']) if row['best_wpm'] is not None else None,
        'bestAccuracy':float(row['best_accuracy']) if row['best_accuracy'] is not None else None,'history':history}

async def canonical_event(con,user,run_id):
    event=await con.fetchrow('''SELECT payload FROM activity_events WHERE user_id=$1 AND type='TYPING_RUN_COMPLETED' AND payload->>'runId'=$2 ORDER BY created_at DESC LIMIT 1''',user,str(run_id))
    if not event or not isinstance(event['payload'],dict):return None
    p=event['payload']
    needed=('wpm','rawWpm','accuracy','correct','incorrect','extra','missed','mistakes','completion','targetChars','typedChars','durationMs')
    if any(type(p.get(x)) not in (int,float) or not math.isfinite(p[x]) for x in needed):return None
    if not isinstance(p.get('title'),str):return None
    return {x:p[x] for x in needed}|{'consistency':p.get('consistency'),'runId':str(run_id),'presetSeconds':p.get('presetSeconds'),'title':p['title']}

async def finish_run(user_id,b,db):
    at=int(time.time()*1000)
    try:p=verify(b['runToken'],RUN,user_id,at)
    except TokenProblem:p=None
    if not p or not isinstance(p.get('tt'),str) or type(p.get('st')) not in (int,float) or not isinstance(p.get('jti'),str) or type(p.get('ps'))!=int or p['ps'] not in PRESETS:return None,'invalid_token'
    preset=p['ps'];paused_ms=p.get('pm',0) if type(p.get('pm',0)) in (int,float) and p.get('pm',0)>=0 else 0
    paused_at=p.get('pa') if type(p.get('pa')) in (int,float) and p['pa']>=p['st'] else None
    if paused_at is not None:return None,'paused'
    async with db.acquire() as con:text=await typing_text(con,p['tt'])
    if text is None:return None,'not_found'
    target=split_words(text['body']);typed=b['typedWords'];elapsed=max(0,at-p['st']-paused_ms)
    committed=typed[:-1];partial=typed[-1];complete= len(committed)>=len(target) or (len(committed)==len(target)-1 and bool(target) and partial==target[-1])
    plausible=math.ceil(typed_chars(typed)/5/250*60000)
    if preset==0:
        if elapsed<3000:return None,'too_early'
        seconds=elapsed/1000
    else:
        if not complete and elapsed<preset*600:return None,'too_early'
        seconds=preset
    if elapsed+1500<plausible:return None,'too_early'
    if not validate_finish(target,typed,seconds):return None,'bad_submission'
    m=metrics(target,typed,seconds,sanitize_samples(b['samples'],typed_chars(typed),seconds))
    if 'keystrokes' in b:
        replay=replay_keystrokes(target,typed,b['keystrokes'],m['missed'])
        if replay is None:return None,'bad_submission'
        m.update(replay)
    try:
        async with db.acquire() as con:
            col=await con.fetchval('''SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name='typing_runs' AND column_name='run_token_id' ''')
            async with con.transaction():
                await con.fetchval('SELECT id FROM users WHERE id=$1 FOR UPDATE',user_id)
                prior=None
                if col:prior=await con.fetchval('SELECT id FROM typing_runs WHERE user_id=$1 AND run_token_id=$2',user_id,uuid.UUID(p['jti']))
                if prior:
                    saved=await canonical_event(con,user_id,prior)
                    if not saved:raise ValueError('canonical_replay_missing')
                    return saved,None
                event=await con.fetchrow('''SELECT payload FROM activity_events WHERE user_id=$1 AND type='TYPING_RUN_COMPLETED' AND payload->>'runTokenId'=$2 LIMIT 1''',user_id,p['jti'])
                if event:
                    prior=event['payload'].get('runId') if isinstance(event['payload'],dict) else None
                    saved=await canonical_event(con,user_id,prior) if prior else None
                    if not saved:raise ValueError('canonical_replay_missing')
                    return saved,None
                if col:
                    run_id=await con.fetchval('''INSERT INTO typing_runs(user_id,target_chars,typed_chars,duration_ms,wpm,accuracy,run_token_id) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id''',user_id,m['targetChars'],m['typedChars'],m['durationMs'],format(m['wpm'],'.1f'),format(m['accuracy'],'.1f'),uuid.UUID(p['jti']))
                else:
                    run_id=await con.fetchval('''INSERT INTO typing_runs(user_id,target_chars,typed_chars,duration_ms,wpm,accuracy) VALUES($1,$2,$3,$4,$5,$6) RETURNING id''',user_id,m['targetChars'],m['typedChars'],m['durationMs'],format(m['wpm'],'.1f'),format(m['accuracy'],'.1f'))
                outcome={**m,'runId':str(run_id),'presetSeconds':preset if preset else None,'title':text['title']}
                await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'TYPING_RUN_COMPLETED',$2::jsonb)''',user_id,json.dumps({**outcome,'runTokenId':p['jti'],'typingTextId':text['id'],'startedAt':p['st'],'pausedMs':paused_ms,'finishedAt':int(time.time()*1000)}))
                from .coin_rewards import award_coin
                await award_coin(con,user_id,f"writing:typing:{text['id']}",module='writing',
                                 activity_type='typing',parent_content_id=str(text['id']),
                                 exercise_id=str(text['id']),evidence_id=str(run_id))
                return outcome,None
    except Exception:return None,'conflict'

@router.post('/api/writing/typing/finish')
async def finish(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.j({'error':'unauthenticated'},401)
    b=await core.payload(req)
    if not valid_json_object(b,{'runToken','typedWords','samples'},{'keystrokes'}) or not isinstance(b['runToken'],str) or not 20<=len(b['runToken'])<=2500 or not isinstance(b['typedWords'],list) or not 1<=len(b['typedWords'])<=1000 or any(not isinstance(w,str) or len(w)>80 for w in b['typedWords']) or not isinstance(b['samples'],list) or len(b['samples'])>1900 or any(type(x)!=int or not 0<=x<=100000 for x in b['samples']) or ('keystrokes' in b and (not isinstance(b['keystrokes'],list) or len(b['keystrokes'])>50000 or any(not isinstance(v,str) or len(v)!=1 for v in b['keystrokes']))):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    result,problem=await finish_run(u['id'],b,db)
    if problem:
        return core.j({'error':problem},{'invalid_token':403,'not_found':404,'too_early':409,'paused':409,'bad_submission':422}.get(problem,409))
    try:
        async with db.acquire() as con:stats=await typing_stats(con,u['id'])
        return core.j({'run':result,'summary':{k:stats[k] for k in ('count','bestWpm','bestAccuracy')},'history':stats['history']})
    except Exception:return core.j({'run':result})

def install():core.app.include_router(router)
