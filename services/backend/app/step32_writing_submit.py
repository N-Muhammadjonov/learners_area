"""Writing submission finalization with persisted RIWI/provider evaluation and event."""
from __future__ import annotations
import json
from fastapi import APIRouter,Request
from . import main as core
from . import step31_coach as coach
from .step31_learning_production import _language
from .notification_events import notify_writing_review_required
router=APIRouter()

@router.post('/api/writing/submissions/{id}/submit')
async def writing_submit(req:Request,id:str):
    sid=core.uuid_value(id)
    if not sid:return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.j({'error':'unauthenticated'},401)
    db=await core.pool()
    async with db.acquire() as con:
        submission=await con.fetchrow('SELECT * FROM writing_submissions WHERE id=$1 AND user_id=$2',sid,user['id'])
        if not submission:return core.j({'error':'not_found'},404)
        if submission['status']!='draft':return core.j({'error':'already_submitted'},409)
        if len((submission['content'] or '').split())<20:return core.j({'error':'too_short'},400)
        prompt=await con.fetchrow('SELECT * FROM writing_prompts WHERE id=$1',submission['prompt_id'])
        if not prompt:return core.j({'error':'prompt_missing'},500)
    result=await coach.evaluate(user['id'],'writing','writing_submission',sid,
           {'taskType':prompt['task_type'],'prompt':prompt['prompt'],'content':submission['content'],
            'targetWordCount':prompt['target_word_count']},_language(req))
    if not result['ok']:return core.j({'error':result['error']},502)
    ev=result['evaluation']
    async with db.acquire() as con:
        async with con.transaction():
            transitioned=await con.fetchrow('''UPDATE writing_submissions SET status='evaluated',submitted_at=NOW(),updated_at=NOW()
                WHERE id=$1 AND user_id=$2 AND status='draft' RETURNING id''',sid,user['id'])
            if transitioned:
                await con.execute('''INSERT INTO activity_events(user_id,type,payload)
                                 VALUES($1,'WRITING_SUBMITTED',$2::jsonb)''',user['id'],json.dumps({'submissionId':str(sid),'overallBand':ev['overallEstimate'],'evaluatedBy':ev['providerId']}))
                await notify_writing_review_required(con, submission_id=sid, student_id=user['id'])
    return core.j({'ok':True,'evaluationId':ev['id'],'checkedBy':'RIWI','fallbackUsed':ev['fallbackUsed']})

def install():core.app.include_router(router)
