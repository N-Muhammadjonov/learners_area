"""Writing Exam lifecycle translation: start, revision-safe autosave, finalize.

Source: src/lib/services/writing/exam.ts plus three corresponding Next route.ts files.
Do not change deadlines from PostgreSQL to a client clock.
"""
from __future__ import annotations
from datetime import datetime, timezone
import re
from fastapi import APIRouter, Request
from . import main as core
from .writing_exam_read_port import writing_exam_read
from .lesson_writing_port import is_js_uuid, js_length
from .db import row_to_dict
from .writing_source_materials import FULL_TESTS,live_inventory,catalogue
import random

router = APIRouter()
MODES = {'task1': (1200, ['task1']), 'task2': (2400, ['task2']), 'full': (3600, ['task1', 'task2'])}
AUTH = {'code':'unauthenticated','message':'Sign in again.'}


def err(code, message, status, **extras):
    return core.j({'error':{'code':code,'message':message, **extras}},status)

async def expire_due(conn, paper_id):
    row=await conn.fetchrow('''UPDATE writing_exam_papers SET finalized_at=NOW(),finalize_reason='timeout'
       WHERE id=$1 AND finalized_at IS NULL AND NOW()>expires_at+make_interval(secs=>15) RETURNING id''',paper_id)
    if row:
        await mark_submitted(conn,paper_id)

async def mark_submitted(conn,paper_id):
    await conn.execute('''UPDATE writing_submissions SET status='submitted',submitted_at=NOW(),updated_at=NOW()
    WHERE status='draft' AND id IN (SELECT submission_id FROM writing_exam_paper_entries WHERE paper_id=$1)''',paper_id)

async def open_paper(conn, user_id):
    row=await conn.fetchrow('''SELECT id,mode FROM writing_exam_papers
        WHERE user_id=$1 AND finalized_at IS NULL LIMIT 1''',user_id)
    if not row: return None
    await expire_due(conn,row['id'])
    still=await conn.fetchval('''SELECT id FROM writing_exam_papers
        WHERE id=$1 AND user_id=$2 AND finalized_at IS NULL''',row['id'],user_id)
    return dict(row) if still else None

async def same_pair(conn,paper_id,pair):
    entries=await conn.fetch('SELECT prompt_id FROM writing_exam_paper_entries WHERE paper_id=$1 ORDER BY position',paper_id)
    return [str(e['prompt_id']) for e in entries]==pair['promptIds']

@router.post('/api/writing/exam')
async def exam_start(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return err('unauthenticated','Sign in again.',401)
    body=await core.payload(req)
    if (not isinstance(body,dict) or not {'mode'}<=set(body)<={'mode','fullTest'}
        or not isinstance(body['mode'],str) or body['mode'] not in MODES):
        return err('invalid_input','Choose Task 1, Task 2 or Full Writing.',400,field='mode')
    mode=body['mode']; duration,tasks=MODES[mode]
    selected=None
    if 'fullTest' in body:
        code=body['fullTest']
        if mode!='full' or not isinstance(code,str) or code not in FULL_TESTS or not FULL_TESTS[code]['ready']:
            return err('invalid_input','Choose an available full test.',400,field='fullTest')
        selected=FULL_TESTS[code]
    db=await core.pool()
    async with db.acquire() as conn:
        existing=await open_paper(conn,user['id'])
        if existing:
            if existing['mode']==mode and (not selected or await same_pair(conn,existing['id'],selected)):
                return core.j({'ok':True,'id':str(existing['id']),'resumed':True})
            return core.j({'error':{'code':'other_paper_open','message':'Another exam is open.','retryable':False},'openPaperId':str(existing['id'])},409)
        prompt_ids=[]
        if mode=='full':
            inventory=await live_inventory(conn)
            pairs=catalogue(inventory)['fullTests']
            if selected and selected not in pairs:
                return err('no_prompts','This full test is not published.',404)
            if selected or pairs:
                pair=selected or random.choice(pairs)
                prompt_ids=[core.uuid_value(id) for id in pair['promptIds']]
            elif inventory:
                return err('no_prompts','No complete published test pair is available.',404)
        for task in tasks if not prompt_ids else []:
            prompt=await conn.fetchval('''SELECT id FROM writing_prompts
                WHERE task_type=$1 AND (publication_state='published'
                OR (publication_state='scheduled' AND publish_at<=NOW()))
                ORDER BY random() LIMIT 1''',task)
            if not prompt:
                return core.j({'error':{'code':'no_prompts','message':'No published questions for this task.','retryable':False},},404)
            prompt_ids.append(prompt)
        async def insert_paper(connection):
            paper_id=await connection.fetchval('''INSERT INTO writing_exam_papers
              (user_id,mode,duration_seconds,started_at,expires_at) VALUES($1,$2,$3,NOW(),NOW()+make_interval(secs=>$3::integer)) RETURNING id''',user['id'],mode,duration)
            for i,(task,prompt) in enumerate(zip(tasks,prompt_ids),1):
                submission=await connection.fetchval('''INSERT INTO writing_submissions(user_id,prompt_id,content,word_count,status)
                   VALUES($1,$2,'',0,'draft') RETURNING id''',user['id'],prompt)
                await connection.execute('''INSERT INTO writing_exam_paper_entries
                   (paper_id,position,task_type,prompt_id,submission_id) VALUES($1,$2,$3,$4,$5)''',paper_id,i,task,prompt,submission)
            return paper_id
        try:
            async with conn.transaction():
                pid=await insert_paper(conn)
        except Exception:
            winner=await open_paper(conn,user['id'])
            if not winner: raise
            if winner['mode']!=mode or (selected and not await same_pair(conn,winner['id'],selected)):
                return core.j({'error':{'code':'other_paper_open','message':'Another exam is open.','retryable':False},'openPaperId':str(winner['id'])},409)
            return core.j({'ok':True,'id':str(winner['id']),'resumed':True})
    return core.j({'ok':True,'id':str(pid),'resumed':False})


def count_essay_words(text):
    # source `countEssayWords` splits trimmed text at whitespace.
    text=text.strip()
    return len(re.split(r'\s+',text)) if text else 0

@router.put('/api/writing/exam/{id}/draft')
async def exam_draft(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return err('unauthenticated','Sign in again.',401,retryable=True)
    if not is_js_uuid(id):return err('not_found','Not found.',404)
    body=await core.payload(req)
    if (not isinstance(body,dict) or set(body)!={'position','content','revision'}
        or type(body['position']) is not int or body['position'] not in (1,2)
        or not isinstance(body['content'],str) or js_length(body['content'])>20000
        or type(body['revision']) is not int or not 1<=body['revision']<=1000000):
        return err('invalid_input','Could not save this text.',400,retryable=False)
    db=await core.pool()
    async with db.acquire() as conn:
        row=await conn.fetchrow('''SELECT e.submission_id AS "submissionId",e.draft_revision AS "current",
              p.finalized_at AS "finalizedAt",(NOW()<=p.expires_at+make_interval(secs=>15)) AS "open"
              FROM writing_exam_paper_entries e JOIN writing_exam_papers p ON p.id=e.paper_id
              WHERE e.paper_id=$1 AND e.position=$2 AND p.user_id=$3 LIMIT 1''',id,body['position'],user['id'])
        if not row:return err('not_found','Could not save this text.',404,retryable=False)
        if row['finalizedAt'] or not row['open']:
            await expire_due(conn,id)
            return err('closed','This paper is closed.',409,retryable=False)
        updated=await conn.fetchrow('''UPDATE writing_exam_paper_entries SET draft_revision=$3,saved_at=NOW()
              WHERE paper_id=$1 AND position=$2 AND draft_revision<$3 RETURNING saved_at''',id,body['position'],body['revision'])
        if not updated:
            return core.j({'ok':True,'revision':row['current'], 'savedAt':datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00','Z'),'stale':True})
        await conn.execute('''UPDATE writing_submissions SET content=$2,word_count=$3,updated_at=NOW()
              WHERE id=$1''',row['submissionId'],body['content'],count_essay_words(body['content']))
    saved=updated['saved_at']
    if isinstance(saved,str): saved=datetime.fromisoformat(saved.replace('Z','+00:00'))
    return core.j({'ok':True,'revision':body['revision'],'savedAt':saved.isoformat(timespec='milliseconds').replace('+00:00','Z'),'stale':False})

@router.post('/api/writing/exam/{id}/finalize')
async def exam_finalize(req:Request,id:str):
    user=await core.current_user(req,active=True)
    if not user:return err('unauthenticated','Sign in again.',401,retryable=True)
    body=await core.payload(req)
    if not is_js_uuid(id) or not isinstance(body,dict) or set(body)!={'reason'} or body['reason'] not in ('submitted','abandoned'):
        return err('invalid_input','Could not finish this paper.',400)
    db=await core.pool()
    async with db.acquire() as conn:
        await expire_due(conn,id)
        closed=await conn.fetchrow('''UPDATE writing_exam_papers SET finalized_at=NOW(),finalize_reason=$3
             WHERE id=$1 AND user_id=$2 AND finalized_at IS NULL RETURNING id''',id,user['id'],body['reason'])
        if closed and body['reason']=='submitted':await mark_submitted(conn,id)
    # Reference's finalizeExamPaper calls getExamPaper() again, including timestamp expiry.
    from .writing_exam_read_port import writing_exam_read
    return await writing_exam_read(req,id)

def install():core.app.include_router(router)
