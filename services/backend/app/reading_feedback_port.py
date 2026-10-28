"""Reading passage attempt/draft and roster-guarded Writing teacher feedback.
Derived from route.ts, reading.ts, timer.ts, assignments.ts. The Reading
publication scheduler's separate state-transition service is not reimplemented;
start runs the due timestamp predicate directly, without publishing revisions.
"""
from __future__ import annotations
import json,math,re
from datetime import datetime,timezone,timedelta
from fastapi import APIRouter,Request
from . import main as core
from .lesson_writing_port import js_length
from .notification_events import notify_teacher_feedback

router=APIRouter()

@router.post('/api/teacher/feedback')
async def teacher_feedback(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    if u['role'] not in ('teacher','owner'):return core.j({'error':'forbidden'},403)
    b=await core.payload(req)
    if not isinstance(b,dict) or not core.uuid_value(b.get('submissionId')) or not isinstance(b.get('comment'),str) or not 1<=js_length(b['comment'])<=2000:
        return core.j({'error':'invalid_input'},400)
    overall=None
    if 'overallBand' in b:
        try:
            value=b['overallBand']
            if isinstance(value,(dict,list)) and value not in ([],):return core.j({'error':'invalid_input'},400)
            overall=0.0 if value in (None,'',[]) else float(value)
            if not math.isfinite(overall) or not 0<=overall<=9:return core.j({'error':'invalid_input'},400)
        except (TypeError,ValueError):return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        submission=await con.fetchrow('SELECT id,user_id FROM writing_submissions WHERE id=$1',b['submissionId'])
        if not submission:return core.j({'error':'not_found'},404)
        async with con.transaction():
            # Same roster decision inside the write transaction, not before it.
            target=await con.fetchval('SELECT role FROM users WHERE id=$1',submission['user_id'])
            if target!='student':return core.j({'error':'not_found'},404)
            if u['role']=='teacher':
                has=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM teacher_student_links
                  WHERE teacher_user_id=$1 AND student_user_id=$2)''',u['id'],submission['user_id'])
                if not has:return core.j({'error':'not_found'},404)
            # Keep a teacher's latest feedback editable without creating duplicate
            # review rows on double-submit or a retried request.
            await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))',f'teacher-feedback:{submission["id"]}:{u["id"]}')
            existing=await con.fetchval('''SELECT id FROM writing_feedback WHERE submission_id=$1
              AND source='teacher' AND teacher_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1 FOR UPDATE''',submission['id'],u['id'])
            if existing:
                await con.execute('''UPDATE writing_feedback SET overall_band=$2,comment=$3
                  WHERE id=$1''',existing,overall,b['comment'])
            else:
                await con.execute('''INSERT INTO writing_feedback(submission_id,source,overall_band,comment,teacher_id)
                     VALUES($1,'teacher',$2,$3,$4)''',submission['id'],overall,b['comment'],u['id'])
                await con.execute('''INSERT INTO activity_events(user_id,type,payload)
                     VALUES($1,'TEACHER_FEEDBACK_RECEIVED',$2::jsonb)''',submission['user_id'],
                     json.dumps({'submissionId':str(submission['id']),'teacherId':str(u['id'])}))
                await notify_teacher_feedback(con, submission_id=submission['id'],
                    student_id=submission['user_id'], teacher_id=u['id'])
    return core.j({'ok':True})

@router.post('/api/reading/attempts')
async def start_reading(req:Request):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict) or set(b)!={'passageId'} or not core.uuid_value(b.get('passageId')):
        return core.j({'error':'invalid_input'},400)
    pid=b['passageId'];db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))',str(u['id'])+':'+pid)
            await con.fetchval('SELECT id FROM reading_passages WHERE id=$1 FOR SHARE',pid)
            row=await con.fetchrow('''SELECT id,source_ref,publication_state,publish_at
              FROM reading_passages p WHERE id=$1 AND NOT EXISTS(
                SELECT 1 FROM activity_events d WHERE d.id=md5('deleted-content:'||p.id::text)::uuid AND d.type='CONTENT_DELETED')''',pid)
            if not row or (row['publication_state']!='published' and not (row['publication_state']=='scheduled' and row['publish_at'] and row['publish_at']<=datetime.now(timezone.utc))):
                return core.j({'error':'not_found'},404)
            if await con.fetchval("SELECT to_regclass('public.general_reading_passages') IS NOT NULL"):
                general=await con.fetchval('''SELECT EXISTS(SELECT 1 FROM general_reading_passages g
                  JOIN general_reading_sets s ON s.id=g.set_id WHERE g.passage_id=$1
                  AND g.reading_mode='general_practice' AND NOT EXISTS(SELECT 1 FROM activity_events d
                  WHERE d.id=md5('deleted-content:'||s.id::text)::uuid AND d.type='CONTENT_DELETED'))''',pid)
                if general:return core.j({'error':'not_found'},404)
            existing=await con.fetchval("SELECT id FROM reading_attempts WHERE user_id=$1 AND passage_id=$2 AND status='in_progress' LIMIT 1",u['id'],pid)
            if existing:return core.j({'id':str(existing)})
            version=await con.fetchval("SELECT id FROM content_versions WHERE target_type='reading_passage' AND target_id=$1 AND status='published' ORDER BY version_no DESC LIMIT 1",pid)
            if not version and row['source_ref']:
                version=await con.fetchval('''SELECT id FROM content_versions WHERE module='reading' AND content_type IN ('general_set','passage')
                 AND source_ref=$1 AND status='published' ORDER BY CASE WHEN content_type='general_set' THEN 0 ELSE 1 END,version_no DESC LIMIT 1''',row['source_ref'])
            created=await con.fetchval('''INSERT INTO reading_attempts(user_id,passage_id,content_version_id)
               VALUES($1,$2,$3) RETURNING id''',u['id'],pid,version)
    return core.j({'id':str(created)})

@router.patch('/api/reading/attempts/{id}')
async def save_reading_draft(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    from .rate_limit import counter
    # A route-local counter is deliberately not used: existing rate limiter has
    # shared rule naming and retry semantics.
    b=await core.payload(req)
    if not isinstance(b,dict) or not isinstance(b.get('answers'),list) or len(b['answers'])>60:
        return core.j({'error':'invalid_input'},400)
    for answer in b['answers']:
        if not isinstance(answer,dict) or not core.uuid_value(answer.get('questionId')) or not isinstance(answer.get('answer'),str) or js_length(answer['answer'])>500:
            return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt=await con.fetchrow('''SELECT a.id,a.passage_id,a.started_at,a.status,p.suggested_minutes
              FROM reading_attempts a JOIN reading_passages p ON p.id=a.passage_id
              WHERE a.id=$1 AND a.user_id=$2 FOR UPDATE OF a''',id,u['id'])
            if not attempt:return core.j({'error':'not_found'},404)
            if attempt['status']!='in_progress':return core.j({'error':'already_submitted'},409)
            scope=await con.fetch('''SELECT p.passage_id,a.duration_minutes FROM reading_assessments a
                JOIN reading_assessment_passages p ON p.attempt_id=a.attempt_id
                WHERE a.attempt_id=$1 ORDER BY p.passage_no''',id) if await con.fetchval("SELECT to_regclass('public.reading_assessments') IS NOT NULL") else []
            if scope and len(scope)!=3:raise RuntimeError('invalid_assessment_membership')
            duration=scope[0]['duration_minutes'] if scope else attempt['suggested_minutes']
            duration=duration if isinstance(duration,int) and 5<=duration<=90 else 20
            deadline=attempt['started_at']+timedelta(minutes=duration)
            if datetime.now(timezone.utc)>=deadline:return core.j({'error':'expired'},410)
            pids=[r['passage_id'] for r in scope] if scope else [attempt['passage_id']]
            selected=await con.fetch('SELECT question_id FROM reading_assessment_questions WHERE attempt_id=$1 ORDER BY position',id) if scope and await con.fetchval("SELECT to_regclass('public.reading_assessment_questions') IS NOT NULL") else []
            if selected and len(selected)!=40:raise RuntimeError('invalid_assessment_question_membership')
            allowed_rows=await con.fetch('SELECT id FROM reading_questions WHERE passage_id=ANY($1::uuid[])',pids)
            allowed={str(r['id']) for r in allowed_rows}
            if selected:
                selected_ids={str(r['question_id']) for r in selected}
                allowed &=selected_ids
                if len(allowed)!=40:return core.j({'error':'not_found'},404)
            answer_map={str(row['questionId']):row['answer'] for row in b['answers'] if str(row['questionId']) in allowed}
            if datetime.now(timezone.utc)>=deadline:return core.j({'error':'expired'},410)
            await con.execute('DELETE FROM reading_answers WHERE attempt_id=$1 AND is_correct IS NULL',id)
            for qid,value in answer_map.items():
                await con.execute('''INSERT INTO reading_answers(attempt_id,question_id,user_answer,is_correct)
                VALUES($1,$2,$3,NULL)''',id,qid,value)
    return core.j({'saved':len(answer_map),'at':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z')})

def install():core.app.include_router(router)
