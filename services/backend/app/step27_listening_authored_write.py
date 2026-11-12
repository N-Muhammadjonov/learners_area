"""Canonical authored Listening checkpoint PUT.

Keeps the original account-first lock, revision-bound attempt, and grading in
one transaction, including the reserved course key and stale-tab guard.
"""
from __future__ import annotations
import json,re,math
from fastapi import APIRouter,Request
from . import main as core
from .rate_limit import RULES,async_counter as counter
from .step21_listening_authored_reads import PRIVATE,get_context,loaded_values
from .step17_listening_course_port import COURSE_KEY,SPEC,state_key,runtime_source,read_work,current_work,course_status
from .step17_listening_start_port import begin
from .step22_listening_submit import assigned_questions,graded,matches
from .listening_revision import revision_package

router=APIRouter()
RULES.setdefault('listening_authored_state',(240,60))

class BadAnswers(Exception):pass
class Stale(Exception):
    def __init__(self,values):self.values=values


def validate(body):
    if not isinstance(body,dict) or not all(isinstance(k,str) and len(k)<=100 and isinstance(v,str) and len(v)<=100000 for k,v in body.items()):return False
    return len(json.dumps(body,ensure_ascii=False,separators=(',',':')))<=100000

def parse_state(values,key):
    try:
        data=json.loads(values.get(key) or '{}')
        if not isinstance(data,dict):raise ValueError()
        answers=data.get('answers')
        if answers is not None and (not isinstance(answers,dict) or not all(isinstance(k,str) and re.fullmatch(r'(?:[1-9]|[1-3][0-9]|40)',k) and isinstance(v,str) and len(v)<=500 for k,v in answers.items())):raise ValueError()
        status=data.get('attemptStatus')
        if status is not None and status not in ('none','in_progress','submitted','exited'):raise ValueError()
        pos=data.get('audioPosition')
        if pos is not None and (type(pos) not in (int,float) or not math.isfinite(pos) or not 0<=pos<=7200):raise ValueError()
        attempt=data.get('attemptKey')
        if attempt is not None and (not isinstance(attempt,str) or not core.uuid_value(attempt)):raise ValueError()
        return data
    except (ValueError,TypeError,KeyError):raise BadAnswers()

def _decode(v):return json.loads(v) if isinstance(v,str) else dict(v or {})

async def persist_submit(con,u,attempt_id,questions,answers):
    attempt=await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',core.uuid_value(attempt_id),u['id'])
    if not attempt:raise ValueError('attempt_not_found')
    if attempt['status']!='in_progress':return
    if not questions:questions=await assigned_questions(con,attempt)
    pkg=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',attempt['test_id'])
    p=_decode(pkg['payload']) if pkg and pkg['payload'] else None
    p=await revision_package(con,attempt,p)
    full=graded(p,{str(q['order']):answers.get(str(q['id']),'') for q in questions}) if p and isinstance(p.get('questions'),list) else None
    correct={str(q['number']):q['correct'] for q in full} if full else {}
    score=0
    for q in questions:
        answer=answers.get(str(q['id']),'')
        ok=correct.get(str(q['order'])) if str(q['order']) in correct else matches(q,answer)
        score+=bool(ok)
        await con.execute('''INSERT INTO listening_answers(attempt_id,question_id,user_answer,is_correct)
             VALUES($1,$2,$3,$4)''',attempt['id'],q['id'],answer,ok)
    await con.execute("UPDATE listening_attempts SET status='completed',score=$2,total_questions=$3,submitted_at=NOW() WHERE id=$1",attempt['id'],score,len(questions))
    await con.execute('''INSERT INTO activity_events(user_id,type,payload)
      VALUES($1,'LISTENING_ATTEMPT_COMPLETED',$2::jsonb)''',u['id'],json.dumps({'attemptId':str(attempt['id']),'score':score,'totalQuestions':len(questions)}))
    # Authored checkpoints and canonical submit share one idempotent exam event.
    if questions and all(answers.get(str(q['id']), '').strip() for q in questions):
        from .coin_rewards import award_coin
        source = await con.fetchval('SELECT source_id FROM listening_packages WHERE test_id=$1',attempt['test_id'])
        identity = source or str(attempt['test_id'])
        await award_coin(con,u['id'],f"listening:{identity}:exam",module='listening',
                         activity_type='exam',parent_content_id=str(attempt['test_id']),
                         exercise_id='exam',evidence_id=str(attempt['id']))

async def save(con,u,test_id,values,pkg):
    source=pkg['source_id'];key=state_key(source)
    raw=parse_state(values,key)
    incoming=raw.get('answers') or {}
    await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',u['id'])
    old=await con.fetchrow('SELECT values,attempt_id FROM listening_authored_checkpoints WHERE user_id=$1 AND test_id=$2',u['id'],core.uuid_value(test_id))
    previous_values=_decode(old['values']) if old else {}
    try:previous=json.loads(previous_values.get(key,'{}'))
    except ValueError:raise BadAnswers()
    previous=previous if isinstance(previous,dict) else {}
    attempt_id=str(old['attempt_id']) if old and old['attempt_id'] else ''
    if previous.get('attemptKey') and raw.get('attemptKey') and previous['attemptKey']!=raw['attemptKey'] and raw.get('attemptStatus')!='in_progress':raise Stale(previous_values)
    if previous.get('attemptKey') and raw.get('attemptKey')==previous['attemptKey'] and previous.get('attemptStatus') in ('submitted','exited') and raw.get('attemptStatus')=='in_progress':return {'values':previous_values,'attemptId':attempt_id}
    status=raw.get('attemptStatus')
    if status in ('in_progress','submitted','exited') and (not attempt_id or status=='in_progress' and previous.get('attemptStatus')!='in_progress'):
        attempt_id=await begin(con,u,test_id) or ''
    if status in ('in_progress','submitted','exited') and attempt_id:
        attempt=await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2 AND test_id=$3',core.uuid_value(attempt_id),u['id'],core.uuid_value(test_id))
        if not attempt:raise ValueError('attempt_not_found')
        if attempt['status']=='in_progress':
            questions=await assigned_questions(con,attempt)
            answers={str(q['id']):incoming.get(str(q['order']),'') for q in questions}
            if status=='in_progress':
                length=(pkg['payload'].get('audio') or {}).get('durationSec',0)
                pos=max(0,min(length,raw.get('audioPosition',0))) if isinstance(length,(int,float)) else 0
                await con.execute('''INSERT INTO listening_drafts(attempt_id,answers,audio_position,audio_started_at)
                VALUES($1,$2::jsonb,$3,NOW()) ON CONFLICT(attempt_id) DO UPDATE SET answers=excluded.answers,
                audio_position=excluded.audio_position,updated_at=NOW()''',attempt['id'],json.dumps(answers),pos)
            elif status=='submitted':await persist_submit(con,u,attempt_id,questions,answers)
            # 'exited' only saves an unfinished checkpoint. Leaving without
            # submitting must never generate a completed Listening attempt.
        if status!='in_progress':
            questions=await assigned_questions(con,attempt)
            saved=await con.fetch('SELECT question_id,user_answer,is_correct FROM listening_answers WHERE attempt_id=$1',attempt['id'])
            indexed={str(x['question_id']):x for x in saved}
            raw['answers']={str(q['order']):indexed.get(str(q['id']),{}).get('user_answer') or '' for q in questions}
            raw['lastResults']=[{'q':q['order'],'user':indexed.get(str(q['id']),{}).get('user_answer') or '',
                                 'ok':bool(indexed.get(str(q['id']),{}).get('is_correct'))} for q in questions]
            values={**values,key:json.dumps(raw,ensure_ascii=False,separators=(',',':'))}
    values.pop(COURSE_KEY,None)
    if previous_values.get(COURSE_KEY):values[COURSE_KEY]=previous_values[COURSE_KEY]
    if status=='submitted' and isinstance(raw.get('lastResults'),list) and len(raw['lastResults'])==40 and source in SPEC:
        work=read_work(previous_values,SPEC[source])
        work.update({'exam':True,'retry':[str(r['q']) for r in raw['lastResults'] if not r.get('ok')]})
        values[COURSE_KEY]=json.dumps(work,ensure_ascii=False,separators=(',',':'))
    await con.execute('''INSERT INTO listening_authored_checkpoints(user_id,test_id,values,attempt_id)
       VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(user_id,test_id) DO UPDATE SET
       values=excluded.values,attempt_id=excluded.attempt_id,updated_at=NOW()''',u['id'],core.uuid_value(test_id),json.dumps(values,ensure_ascii=False),core.uuid_value(attempt_id))
    return {'values':values,'attemptId':attempt_id}

@router.put('/api/listening/full/{id}/authored-state')
async def authored_write(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        pkg,err=await get_context(con,user,id)
        if err:return err
        source=pkg['source_id']
        if not runtime_source(id,source):return core.j({'error':'not_found'},404,PRIVATE)
        delay=await counter('listening_authored_state',str(user['id']),consume=True, connection=con)
        if delay:return core.j({'error':'rate_limited'},429,{'Retry-After':str(delay)})
        data=await core.payload(req)
        if not validate(data):return core.j({'error':'invalid_input'},400,PRIVATE)
        try:
            async with con.transaction():
                saved=await save(con,user,id,dict(data),pkg)
                work=await current_work(con,user['id'],id,source,saved['values'])
                course=course_status(SPEC[source],work) if source in SPEC else None
            return core.j({**saved,'values':{k:v for k,v in saved['values'].items() if k!=COURSE_KEY},'course':course},headers=PRIVATE)
        except Stale as x:
            work=await current_work(con,user['id'],id,source,x.values)
            course=course_status(SPEC[source],work) if source in SPEC else None
            return core.j({'error':'stale_checkpoint','values':{k:v for k,v in x.values.items() if k!=COURSE_KEY},'course':course},409,PRIVATE)
        except (BadAnswers,ValueError,SyntaxError):return core.j({'error':'invalid_input'},400,PRIVATE)
        except Exception:return core.j({'error':'save_failed'},503,PRIVATE)

def install():core.app.include_router(router)
