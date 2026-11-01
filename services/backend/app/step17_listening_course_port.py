"""Native persisted original Listening course units and canonical progress semantics."""
from __future__ import annotations
import json,re
from pathlib import Path
from fastapi import APIRouter,Request
from . import main as core
from .rate_limit import async_counter as counter,RULES
from .step17_listening_start_port import test_detail,PRIVATE
router=APIRouter()
SPEC=json.loads(Path(__file__).with_name('original_listening_course.json').read_text())
CATALOGUE=json.loads(Path(__file__).with_name('original_listening_catalogue.json').read_text())
COURSE_KEY='la-course-progress-v1'; ORIGINAL1='e44e3d4b-3af6-41a9-b465-7d4bc21e1019'
RULES.setdefault('listening_course_work',(240,60))
def runtime_source(id,source):return source in CATALOGUE or source=='listening-test-1' and id==ORIGINAL1
def state_key(source):return CATALOGUE.get(source,{}).get('storageKey','la_listening_test_1_v2')
def read_work(values,spec):
    try:
        v=json.loads(values.get(COURSE_KEY,'null'))
        if v.get('version')==spec['version'] and type(v.get('exam')) is bool and isinstance(v.get('retry'),list) and isinstance(v.get('units'),dict):return v
    except (TypeError,ValueError,AttributeError):pass
    return {'version':spec['version'],'exam':False,'retry':[],'units':{}}
def course_status(spec,work):
    activities={}
    for key,required in spec['activities'].items():
        units=work['retry'] if key=='retry' and work['exam'] else required['units']
        total=len(units) if key=='retry' else required['minimum']
        submitted=set(work['units'].get(key,[]));done=total if key=='exam' and work['exam'] else 0 if key=='exam' else min(total,sum(x in submitted for x in units))
        activities[key]={'done':done,'total':total,'complete':(False if not work['exam'] else done==total) if key=='retry' else done==total,'available':total>0}
    avail=[v for v in activities.values() if v['available']]
    return {'activities':activities,'completed':sum(v['complete'] for v in avail),'total':len(avail),'complete':all(v['complete'] for v in activities.values()) and work['exam']}
async def current_work(con,user_id,test_id,source_id,values,*,completed_attempts=None):
    spec=SPEC.get(source_id)
    if not spec:return None
    work=read_work(values,spec)
    if work['exam']:return work
    try:state=json.loads(values.get(state_key(source_id),'{}'))
    except ValueError:return work
    if state.get('attemptStatus')!='submitted':return work
    row=await con.fetchrow("""SELECT id FROM listening_attempts WHERE user_id=$1 AND test_id=$2 AND status='completed' ORDER BY submitted_at DESC LIMIT 1""",user_id,core.uuid_value(test_id)) if completed_attempts is None else completed_attempts.get(core.uuid_value(test_id))
    if not row:return work
    count=await con.fetchval('SELECT count(*) FROM listening_answers WHERE attempt_id=$1',row['id']) if completed_attempts is None else row['answer_count']
    results=state.get('lastResults',[])
    if count!=40 or not isinstance(results,list) or len(results)!=40:return work
    return {**work,'exam':True,'retry':[str(r.get('q')) for r in results if r.get('ok') is False]}
def combine(spec,work,activity,answers):
    expected=spec['activities'].get(activity)
    if not expected or activity=='exam':raise ValueError('invalid_activity')
    ids=work['retry'] if activity=='retry' and work['exam'] else expected['units']
    if activity=='multi':
        for key,value in answers.items():
            n=len({v.strip() for v in value.split(',') if v.strip()})
            if n!=expected.get('choices',{}).get(key,2):raise ValueError('invalid_answers')
    if not answers or any(key not in ids or not isinstance(val,str) or not val.strip() or len(val)>4000 for key,val in answers.items()):raise ValueError('invalid_answers')
    return {**work,'units':{**work['units'],activity:list(dict.fromkeys([*work['units'].get(activity,[]),*answers.keys()]))}}
async def context(con,req,id,user):
    if not user:return None,core.auth_error()
    if not core.uuid_value(id):return None,core.j({'error':'not_found'},404,PRIVATE)
    detail=await test_detail(con,user,id,requires_package=True)
    if detail=='sequence_locked':return None,core.j({'error':'sequence_locked'},403,PRIVATE)
    if not detail or not runtime_source(id,detail[1]['source_id']):return None,core.j({'error':'not_found'},404,PRIVATE)
    return (user,detail[1]['source_id']),None
@router.get('/api/listening/full/{id}/progress')
async def progress_get(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        ctx,err=await context(con,req,id,user)
        if err:return err
        u,source=ctx
        from .step21_listening_authored_reads import loaded_values
        values=await loaded_values(con,u,id,source)
        work=await current_work(con,u['id'],id,source,values)
        answer=course_status(SPEC[source],work) if source in SPEC else None
    return core.j(answer,headers=PRIVATE)
@router.post('/api/listening/full/{id}/progress')
async def progress_post(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401,PRIVATE)
    if not core.uuid_value(id):return core.j({'error':'not_found'},404,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        ctx,err=await context(con,req,id,user)
        if err:return err
        u,source=ctx
        delay=await counter('listening_course_work',str(u['id']),consume=True, connection=con)
        if delay:return core.j({'error':'rate_limited'},429,{'Retry-After':str(delay)})
        b=await core.payload(req)
        act=b.get('activity') if isinstance(b,dict) else None;answers=b.get('answers') if isinstance(b,dict) else None
        if act not in ('review','script','mcq','matching','map','multi','completion','vocab','retry') or not isinstance(answers,dict) or len(answers)>80 or any(not isinstance(k,str) or not 1<=len(k)<=160 or not isinstance(v,str) or not 1<=len(v)<=4000 for k,v in answers.items()):
            return core.j({'error':'invalid_input'},400,PRIVATE)
        spec=SPEC.get(source)
        if not spec:return core.j({'error':'not_found'},404,PRIVATE)
        async with con.transaction():
            await con.fetchrow('SELECT id FROM users WHERE id=$1 FOR UPDATE',u['id'])
            from .step21_listening_authored_reads import loaded_values
            values=await loaded_values(con,u,id,source)
            work=await current_work(con,u['id'],id,source,values)
            try:work=combine(spec,work,act,answers)
            except ValueError as ex:return core.j({'error':str(ex)},400,PRIVATE)
            values[COURSE_KEY]=json.dumps(work,ensure_ascii=False,separators=(',',':'))
            await con.execute('''INSERT INTO listening_authored_checkpoints(user_id,test_id,values) VALUES($1,$2,$3::jsonb)
                ON CONFLICT(user_id,test_id) DO UPDATE SET values=excluded.values,updated_at=now()''',u['id'],core.uuid_value(id),json.dumps(values,ensure_ascii=False))
    return core.j(course_status(spec,work),headers=PRIVATE)
def install():core.app.include_router(router)
