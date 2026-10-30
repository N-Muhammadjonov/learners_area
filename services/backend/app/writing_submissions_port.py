"""Learner writing submission draft creation & autosave. Source route.ts + attempt-binding."""
from fastapi import APIRouter,Request
from datetime import datetime,timezone
from . import main as core
from .lesson_writing_port import is_js_uuid,js_length
from .exam_lifecycle_port import count_essay_words
router=APIRouter()

@router.post('/api/writing/submissions')
async def create_submission(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    b=await core.payload(req)
    if not isinstance(b,dict) or not is_js_uuid(b.get('promptId','')):
        return core.j({'error':'invalid_input'},400)
    pid=b['promptId'];db=await core.pool()
    async with db.acquire() as conn:
        prompt=await conn.fetchrow('''SELECT id, publication_state,publish_at FROM writing_prompts WHERE id=$1 LIMIT 1''',pid)
        if not prompt or not (prompt['publication_state']=='published' or
          (prompt['publication_state']=='scheduled' and prompt['publish_at'] and
           prompt['publish_at']<=datetime.now(timezone.utc))):
            return core.j({'error':'not_found'},404)
        exists=await conn.fetchval('''SELECT id FROM writing_submissions WHERE user_id=$1 AND prompt_id=$2
            AND status='draft' LIMIT 1''',user['id'],pid)
        if exists:return core.j({'id':str(exists)})
        version=await conn.fetchval('''SELECT id FROM content_versions WHERE target_type='writing_prompt'
            AND target_id=$1 AND status='published' ORDER BY version_no DESC LIMIT 1''',pid)
        created=await conn.fetchval('''INSERT INTO writing_submissions(user_id,prompt_id,content_version_id)
            VALUES($1,$2,$3) RETURNING id''',user['id'],pid,version)
    return core.j({'id':str(created)})

@router.patch('/api/writing/submissions/{id}')
async def update_submission(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    if not isinstance(body,dict) or not isinstance(body.get('content'),str) or js_length(body['content'])>20000:
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        updated=await conn.fetchrow('''UPDATE writing_submissions SET content=$3,word_count=$4,updated_at=NOW()
            WHERE id=$1 AND user_id=$2 AND status='draft' RETURNING id, word_count''',id,user['id'],body['content'],count_essay_words(body['content']))
    return core.j({'ok':True,'wordCount':updated['word_count']}) if updated else core.j({'error':'not_found_or_locked'},404)


def install():core.app.include_router(router)
