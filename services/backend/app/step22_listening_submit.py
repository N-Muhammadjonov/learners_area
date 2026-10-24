"""Canonical Listening exam submission. Source: listening-attempt-write.ts.

The attempt's revision-bound question set is used for the score and answer writes.
"""
from __future__ import annotations
import json,re,unicodedata
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .step17_listening_start_port import test_detail
from .step17_listening_work_port import graded

router=APIRouter()

def norm(s):return re.sub(r'\s+',' ',str(s).strip().lower())

def matches(question, answer):
    if not answer.strip():return False
    key=question['correct_answer']
    opts=question['options'] if isinstance(question['options'],list) else []
    code=question['type_code']
    # Canonical choice answers allow option labels and exact option text.
    if code and code in ('multiple_choice','mcq_single','multiple_choice_single'):
        if norm(answer)==norm(key):return True
        match=re.fullmatch(r'[a-z]',key.strip(),re.I)
        if match and 0<=ord(match.group().upper())-65<len(opts):
            return norm(answer)==norm(str(opts[ord(match.group().upper())-65]))
    if code and (code.endswith('choose_two') or code.endswith('choose_three')):
        parse=lambda s:{norm(v) for v in re.split(r'[,;]',s) if norm(v)}
        return parse(answer)==parse(key)
    return norm(answer)==norm(key)

async def assigned_questions(con,attempt):
    rows=[]
    if attempt['content_version_id']:
        rows=await con.fetch('''SELECT * FROM listening_questions WHERE test_id=$1 AND content_version_id=$2 ORDER BY "order"''',attempt['test_id'],attempt['content_version_id'])
    if not rows:rows=await con.fetch('''SELECT * FROM listening_questions WHERE test_id=$1 AND content_version_id IS NULL ORDER BY "order"''',attempt['test_id'])
    if not rows:rows=await con.fetch('''SELECT * FROM listening_questions WHERE test_id=$1 ORDER BY "order"''',attempt['test_id'])
    return rows

@router.post('/api/listening/attempts/{id}/submit')
async def submit(req:Request,id:str):
    aid=core.uuid_value(id)
    if not aid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        current=await con.fetchrow('SELECT test_id FROM listening_attempts WHERE id=$1 AND user_id=$2',aid,user['id'])
        if current:
            valid=await test_detail(con,user,str(current['test_id']))
            if valid=='sequence_locked':return core.j({'error':'sequence_locked'},403)
        b=await core.payload(req)
        answers=b.get('answers') if isinstance(b,dict) else None
        if not isinstance(answers,list) or len(answers)>200 or not all(isinstance(a,dict) and core.uuid_value(a.get('questionId')) and isinstance(a.get('answer'),str) and len(a['answer'])<=500 for a in answers):return core.j({'error':'invalid_input'},400)
        async with con.transaction():
            attempt=await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',aid,user['id'])
            if not attempt:return core.j({'error':'not_found'},404)
            if attempt['status']!='in_progress':return core.j({'error':'already_submitted'},409)
            questions=await assigned_questions(con,attempt)
            allowed={str(q['id']) for q in questions}
            by={x['questionId']:x['answer'] for x in answers}
            if len(by)!=len(answers) or any(a['questionId'] not in allowed for a in answers):return core.j({'error':'invalid_input'},400)
            pkg=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',attempt['test_id'])
            package=pkg['payload'] if pkg else None
            if isinstance(package,str):package=json.loads(package)
            full=graded(package,{str(q['order']):by.get(str(q['id']),'') for q in questions}) if isinstance(package,dict) and isinstance(package.get('questions'),list) else None
            result={r['number']:r['correct'] for r in full} if full is not None else {}
            score=0
            for q in questions:
                answer=by.get(str(q['id']),'')
                correct=result[int(q['order'])] if int(q['order']) in result else matches(q,answer)
                score+=bool(correct)
                await con.execute('''INSERT INTO listening_answers(attempt_id,question_id,user_answer,is_correct) VALUES($1,$2,$3,$4)''',aid,q['id'],answer,correct)
            await con.execute('''UPDATE listening_attempts SET status='completed',score=$2,total_questions=$3,submitted_at=NOW() WHERE id=$1''',aid,score,len(questions))
            await con.execute('''INSERT INTO activity_events(user_id,type,payload) VALUES($1,'LISTENING_ATTEMPT_COMPLETED',$2::jsonb)''',user['id'],json.dumps({'attemptId':id,'score':score,'totalQuestions':len(questions)}))
    # Post-success meaningful activity is an independent original side-effect.
    async with db.acquire() as con:
        await con.execute('''UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,NOW()) WHERE id=$1''',user['id'])
    return core.j({'ok':True,'score':score,'totalQuestions':len(questions)})

def install():core.app.include_router(router)
