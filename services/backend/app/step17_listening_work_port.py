"""Listening self-study and practice: source questions, grading and run history.

No practice operation is allowed to mutate official exam scores.
"""
from __future__ import annotations
import re,json,unicodedata
from fastapi import APIRouter,Request
from . import main as core
from .rate_limit import async_counter as counter,RULES
from .step17_listening_start_port import test_detail,PRIVATE
from .listening_review_access import exam_gate
router=APIRouter()
RULES.setdefault('listening_practice',(120,60))

def normalize(text):return re.sub(r'\s+',' ',unicodedata.normalize('NFKC',text).strip().lower())
def graded(pkg,answers):
    questions=pkg.get('questions',[]);by={x['number']:x for x in questions}
    result=[]
    for q in questions:
        n=q['number'];answer=normalize(answers.get(str(n),'') or '')
        keys=[q['key'],*q.get('alternatives',[]),*(by[x]['key'] for x in q.get('pair',[]) if x in by)]
        dup=any(x<n and normalize(answers.get(str(x),'') or '')==answer for x in q.get('pair',[]))
        result.append({'number':n,'correct':bool(answer and answer in [normalize(key) for key in keys] and not dup)})
    return result
async def prepare(req,id,require_questions=False):
    user=await core.current_user(req,active=True)
    if not user:return None,core.auth_error()
    if not core.uuid_value(id):return None,core.j({'error':'not_found'},404)
    db=await core.pool()
    async with db.acquire() as con:
        detail=await test_detail(con,user,id,requires_package=True)
        if detail=='sequence_locked':return None,core.j({'error':'sequence_locked'},403,PRIVATE)
        if not detail:return None,core.j({'error':'not_found'},404)
        pkg=detail[1]['payload'];pkg=json.loads(pkg) if isinstance(pkg,str) else pkg
        if require_questions and not pkg.get('questions'):return None,core.j({'error':'authored_runtime_only'},409)
        required,active=await exam_gate(con,user,core.uuid_value(id))
    if required:return None,core.j({'error':'exam_in_progress' if active else 'exam_required'},409,PRIVATE)
    return (user,pkg),None

def valid_answers(answers,key_max,value_max):
    return isinstance(answers,dict) and all(isinstance(k,str) and len(k)<=key_max and isinstance(v,str) and len(v)<=value_max for k,v in answers.items())

@router.post('/api/listening/full/{id}/study')
async def study(req:Request,id:str):
    ctx,err=await prepare(req,id,require_questions=True)
    if err:return err
    user,pkg=ctx
    body=await core.payload(req)
    answers=body.get('answers') if isinstance(body,dict) else None
    if not valid_answers(answers,2,500) or any(not re.fullmatch(r'(?:[1-9]|[1-3][0-9]|40)',k) for k in answers) or not any(v.strip() for v in answers.values()):return core.j({'error':'answer_required'},400)
    result=graded(pkg,answers)
    return core.j({'score':sum(row['correct'] for row in result),'total':len(pkg['questions']),
        'results':[{**row,'key':next(q['key'] for q in pkg['questions'] if q['number']==row['number'])} for row in result if answers.get(str(row['number']),'').strip()]},headers=PRIVATE)

async def exam_results(con,user,id):
    attempt=await con.fetchrow("SELECT id FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='completed' ORDER BY submitted_at DESC LIMIT 1",user['id'],core.uuid_value(id))
    if not attempt:return None
    # Same bound-set fallback as listeningQuestionsForAttempt: a revision first,
    # then legacy, then all rows. Wrong/missing answers count as retriable.
    questions=await con.fetch('SELECT id,"order" FROM listening_questions WHERE test_id=$1 ORDER BY "order"',core.uuid_value(id))
    checked=await con.fetch('SELECT question_id,is_correct FROM listening_answers WHERE attempt_id=$1',attempt['id'])
    wrong={r['question_id'] for r in checked if r['is_correct'] is False}
    order={q['id']:q['order'] for q in questions}
    return {order[i] for i in wrong if i in order}
@router.post('/api/listening/full/{id}/practice')
async def practice(req:Request,id:str):
    try:
        user=await core.current_user(req,active=True)
        if not user:return core.auth_error()
        delay=await counter('listening_practice',str(user['id']),consume=True)
        if delay:return core.j({'error':'rate_limited'},429,{'Retry-After':str(delay)})
        ctx,err=await prepare(req,id)
        if err:return err
        u,pkg=ctx
        body=await core.payload(req)
        if not isinstance(body,dict) or body.get('kind') not in ('matching','completion','retry','map') or not valid_answers(body.get('answers'),2,500) or type(body.get('complete')) is not bool or any(not re.fullmatch(r'\d{1,2}',k) for k in body['answers']):return core.j({'error':'invalid_input'},400)
        kind=body['kind'];answers=body['answers'];complete=body['complete']
        if kind not in (pkg.get('studyPack') or {}).get('activities',[]):return core.j({'error':'not_found'},404)
        questions=[q for q in pkg['questions'] if q.get('kind')==kind]
        if kind=='retry':
            db=await core.pool()
            async with db.acquire() as con:missed=await exam_results(con,u,id)
            questions=[q for q in pkg['questions'] if missed and q['number'] in missed]
        ids={str(q['number']) for q in questions}
        if not ids or not answers or any(k not in ids for k in answers) or complete and any(not answers.get(k,'').strip() for k in ids):return core.j({'error':'invalid_questions'},400)
        results=[r for r in graded(pkg,answers) if str(r['number']) in answers]
        score=sum(r['correct'] for r in results)
        db=await core.pool()
        async with db.acquire() as con:
            await con.execute('''INSERT INTO listening_activity_runs(user_id,test_id,activity,answers,completed,score,total)
                VALUES($1,$2,4,$3::jsonb,$4,$5,$6)''',u['id'],core.uuid_value(id),json.dumps({**answers,'_practice':kind}),complete,score,len(ids))
        return core.j({'ok':True,'score':score,'total':len(ids),'results':[{**r,'key':next(q['key'] for q in pkg['questions'] if q['number']==r['number']),
            'evidence':next(q['evidence']['why'] for q in pkg['questions'] if q['number']==r['number'])} for r in results]},headers=PRIVATE)
    except Exception:return core.j({'error':'practice_unavailable'},503,PRIVATE)

async def speed_allowed(con,user,id,rate):
    if rate==1:return True
    rates=[1,1.25,1.5,1.75,2]
    if rate not in rates:return False
    index=rates.index(rate)
    if index<=1:
        rows=await con.fetch("SELECT score,total_questions total FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='completed'",user['id'],core.uuid_value(id))
        return any(r['total'] and r['score'] is not None and r['score']/r['total']>=0.8 for r in rows)
    prev=rates[index-1]
    rows=await con.fetch('SELECT score,total FROM listening_activity_runs WHERE user_id=$1 AND test_id=$2 AND activity=2 AND speed_rate=$3 AND completed=true',user['id'],core.uuid_value(id),prev)
    if not any(r['total'] and r['score'] is not None and r['score']/r['total']>=0.8 for r in rows):return False
    return await speed_allowed(con,user,id,prev)
@router.post('/api/listening/full/{id}/activity')
async def activity(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    ctx,err=await prepare(req,id,require_questions=True)
    if err:return err
    u,pkg=ctx
    b=await core.payload(req)
    if not isinstance(b,dict) or type(b.get('activity')) is not int or not 2<=b['activity']<=5 or not valid_answers(b.get('answers'),20,4000) or type(b.get('complete')) is not bool or 'speedRate' in b and (type(b['speedRate']) not in (float,int) or type(b['speedRate']) is bool):return core.j({'error':'invalid_input'},400)
    index=b['activity'];answers=b['answers'];complete=b['complete'];speed=b.get('speedRate')
    if index==2: ids=[str(q['number']) for q in pkg['questions']]
    elif index==3:ids=[str(q['q']) for q in pkg.get('keyword1',[])]
    elif index==4:ids=[str(q['part']) for q in pkg['studyPack']['recall']] if pkg.get('studyPack') else [str(q['q']) for q in pkg.get('keyword2',[])]
    else:ids=[str(i) for i,q in enumerate(pkg.get('vocabulary',[])) if q.get('quiz')]
    if any(k not in ids for k in answers):return core.j({'error':'foreign_question'},400)
    if complete and any(not answers.get(k,'').strip() for k in ids):return core.j({'error':'answer_every_item'},400)
    if speed is not None:
        db=await core.pool()
        async with db.acquire() as con:
            if index!=2 or not await speed_allowed(con,u,id,speed):return core.j({'error':'speed_locked'},403)
    score=None
    if complete:
        if index==2:score=len(ids) if speed is None else sum(r['correct'] for r in graded(pkg,answers))
        elif index==3:score=sum(normalize(answers.get(str(q['q']),'') or '')==normalize(q['link'].split(';')[0]) for q in pkg.get('keyword1',[]))
        elif index==4 and pkg.get('studyPack'):score=None
        elif index==4:score=sum(answers.get(str(q['q']))==str(q['correct']) if 'correct' in q else normalize(answers.get(str(q['q']),'') or '')==normalize(q['answer']) for q in pkg.get('keyword2',[]))
        else:score=sum(answers.get(str(i))==str(q['quiz']['correct']) for i,q in enumerate(pkg.get('vocabulary',[])) if q.get('quiz'))
    db=await core.pool()
    async with db.acquire() as con:
        row=await con.fetchrow('''INSERT INTO listening_activity_runs(user_id,test_id,activity,speed_rate,answers,completed,score,total)
            VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id''',u['id'],core.uuid_value(id),index,speed,json.dumps(answers,ensure_ascii=False),complete,score,len(ids))
    return core.j({'ok':True,'id':str(row['id']),'score':score,'total':len(ids)},headers=PRIVATE)
def install():core.app.include_router(router)
