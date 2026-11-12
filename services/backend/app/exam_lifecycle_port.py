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
from .notification_events import notify_writing_review_required
from .writing_exam_bank import catalogue as exam_catalogue
import random

router = APIRouter()
MODES = {'task1': (1200, ['task1']), 'task2': (2400, ['task2']), 'full': (3600, ['task1', 'task2'])}
AUTH = {'code':'unauthenticated','message':'Sign in again.'}


def err(code, message, status, **extras):
    return core.j({'error':{'code':code,'message':message, **extras}},status)

async def expire_due(conn, paper_id, user_id):
    async with conn.transaction():
        row=await conn.fetchrow('''UPDATE writing_exam_papers SET finalized_at=NOW(),finalize_reason='timeout'
           WHERE id=$1 AND user_id=$2 AND finalized_at IS NULL AND NOW()>expires_at+make_interval(secs=>15) RETURNING id''',paper_id,user_id)
        if row:
            await mark_submitted(conn,paper_id)

async def mark_submitted(conn,paper_id):
    rows=await conn.fetch('''UPDATE writing_submissions SET status='submitted',submitted_at=NOW(),updated_at=NOW()
      WHERE status='draft' AND id IN (SELECT submission_id FROM writing_exam_paper_entries WHERE paper_id=$1)
      RETURNING id,user_id''',paper_id)
    for row in rows:
        await notify_writing_review_required(conn, submission_id=row['id'], student_id=row['user_id'])

async def open_paper(conn, user_id):
    row=await conn.fetchrow('''SELECT id,mode FROM writing_exam_papers
        WHERE user_id=$1 AND finalized_at IS NULL LIMIT 1''',user_id)
    if not row: return None
    await expire_due(conn,row['id'],user_id)
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
    if (not isinstance(body,dict) or not {'mode'}<=set(body)<={'mode','fullTest','promptId'}
        or not isinstance(body['mode'],str) or body['mode'] not in MODES):
        return err('invalid_input','Choose Task 1, Task 2 or Full Writing.',400,field='mode')
    mode=body['mode']; duration,tasks=MODES[mode]
    selected=None
    chosen_prompt=None
    if 'promptId' in body:
        if mode=='full' or 'fullTest' in body or not is_js_uuid(body['promptId']):
            return err('invalid_input','Choose a published question for this task.',400,field='promptId')
        chosen_prompt=core.uuid_value(body['promptId'])
    if 'fullTest' in body:
        code=body['fullTest']
        if mode!='full' or not isinstance(code,str) or not code or len(code)>100:
            return err('invalid_input','Choose an available full test.',400,field='fullTest')
        selected=FULL_TESTS.get(code)
    db=await core.pool()
    async with db.acquire() as conn:
        bank_pairs=[]
        if mode=='full':
            rows=await conn.fetch('''SELECT p.id,p.task_type,p.category,p.prompt,p.source_ref FROM writing_prompts p
              WHERE p.is_active AND (p.publication_state='published' OR (p.publication_state='scheduled' AND p.publish_at<=NOW()))
              AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || p.id::text)::uuid AND e.type='CONTENT_DELETED')''')
            bank_pairs=exam_catalogue(rows)['fullTests']
            if 'fullTest' in body:
                selected=next((p for p in bank_pairs if p['code']==body['fullTest']),selected)
                if not selected or selected.get('ready') is False:
                    return err('invalid_input','Choose an available full test.',400,field='fullTest')
        if chosen_prompt:
            available=await conn.fetchval('''SELECT p.id FROM writing_prompts p WHERE p.id=$1 AND p.task_type=$2
              AND p.is_active AND (p.publication_state='published' OR (p.publication_state='scheduled' AND p.publish_at<=NOW()))
              AND NOT EXISTS (SELECT 1 FROM activity_events e WHERE e.id=md5('deleted-content:' || p.id::text)::uuid AND e.type='CONTENT_DELETED')''',chosen_prompt,mode)
            if not available:return err('no_prompts','This question is not published for this task.',404)
        requested=selected or ({'promptIds':[str(chosen_prompt)]} if chosen_prompt else None)
        existing=await open_paper(conn,user['id'])
        if existing:
            if existing['mode']==mode and (not requested or await same_pair(conn,existing['id'],requested)):
                return core.j({'ok':True,'id':str(existing['id']),'resumed':True})
            return core.j({'error':{'code':'other_paper_open','message':'Another exam is open.','retryable':False},'openPaperId':str(existing['id'])},409)
        prompt_ids=[chosen_prompt] if chosen_prompt else []
        if mode=='full':
            inventory=await live_inventory(conn)
            pairs=bank_pairs+catalogue(inventory)['fullTests']
            if selected and selected not in pairs:
                return err('no_prompts','This full test is not published.',404)
            if selected or pairs:
                pair=selected or random.choice(pairs)
                prompt_ids=[core.uuid_value(id) for id in pair['promptIds']]
            elif inventory:
                return err('no_prompts','No complete published test pair is available.',404)
        for task in tasks if not prompt_ids else []:
            prompt=await conn.fetchval('''SELECT id FROM writing_prompts
                WHERE task_type=$1 AND is_active AND (publication_state='published'
                OR (publication_state='scheduled' AND publish_at<=NOW()))
                AND NOT EXISTS (SELECT 1 FROM activity_events e
                  WHERE e.id=md5('deleted-content:' || writing_prompts.id::text)::uuid AND e.type='CONTENT_DELETED')
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
            if winner['mode']!=mode or (requested and not await same_pair(conn,winner['id'],requested)):
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
        # Serialize autosaves with each other and finalization. Revision and text
        # commit together, so a failed/late save cannot acknowledge lost content.
        async with conn.transaction():
            row=await conn.fetchrow('''SELECT e.submission_id AS "submissionId",e.draft_revision AS "current",
                  p.finalized_at AS "finalizedAt",(NOW()<=p.expires_at+make_interval(secs=>15)) AS "open"
                  FROM writing_exam_paper_entries e JOIN writing_exam_papers p ON p.id=e.paper_id
                  WHERE e.paper_id=$1 AND e.position=$2 AND p.user_id=$3 LIMIT 1 FOR UPDATE OF p,e''',id,body['position'],user['id'])
            if not row:return err('not_found','Could not save this text.',404,retryable=False)
            if row['finalizedAt'] or not row['open']:
                await expire_due(conn,id,user['id'])
                return err('closed','This paper is closed.',409,retryable=False)
            updated=await conn.fetchrow('''UPDATE writing_exam_paper_entries SET draft_revision=$3,saved_at=NOW()
                  WHERE paper_id=$1 AND position=$2 AND draft_revision<$3 RETURNING saved_at''',id,body['position'],body['revision'])
            if not updated:
                current_content=await conn.fetchval('SELECT content FROM writing_submissions WHERE id=$1',row['submissionId'])
                if current_content!=body['content']:
                    return err('draft_conflict','A newer answer is already saved. Copy your local text before reloading.',409,retryable=False)
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
        async with conn.transaction():
            await expire_due(conn,id,user['id'])
            closed=await conn.fetchrow('''UPDATE writing_exam_papers SET finalized_at=NOW(),finalize_reason=$3
                 WHERE id=$1 AND user_id=$2 AND finalized_at IS NULL RETURNING id''',id,user['id'],body['reason'])
            if closed and body['reason']=='submitted':
                await mark_submitted(conn,id)
                # Only the server-finalized and substantively answered tasks earn
                # once; not drafts, abandoned papers, timeouts or duplicate prompts.
                from .coin_rewards import award_coin
                entries = await conn.fetch(
                    """SELECT s.id,s.prompt_id,s.word_count,s.status
                       FROM writing_exam_paper_entries e
                       JOIN writing_submissions s ON s.id=e.submission_id
                       WHERE e.paper_id=$1 AND s.user_id=$2""", id, user['id'])
                for entry in entries:
                    if entry['status']=='submitted' and entry['word_count'] >= 20:
                        await award_coin(
                            conn,user['id'],f"writing:{entry['prompt_id']}",
                            module='writing',activity_type='exam_submission',
                            parent_content_id=str(entry['prompt_id']),
                            exercise_id=str(entry['id']),evidence_id=str(entry['id']))
    # Reference's finalizeExamPaper calls getExamPaper() again, including timestamp expiry.
    from .writing_exam_read_port import writing_exam_read
    return await writing_exam_read(req,id)

def install():core.app.include_router(router)
