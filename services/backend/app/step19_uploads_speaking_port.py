"""Upload abort/sweep and speaking-recording claim/discard transitions.
Ported from data/uploads.ts, speaking/attempts/[id] route.ts.
"""
from __future__ import annotations
import math
from fastapi import APIRouter,Request
from . import main as core
from .step19_storage import delete_object
router=APIRouter()

@router.delete('/api/uploads/{id}')
async def abort_upload(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        intent=await con.fetchrow('SELECT id,user_id,status,object_key FROM upload_intents WHERE id=$1',id)
        if not intent or intent['user_id']!=user['id'] or intent['status']=='attached':return core.j({'error':'cannot_abort'},409)
        claimed=await con.fetchval('''UPDATE upload_intents SET status='aborted' WHERE id=$1
          AND status IN ('pending','finalized','aborted') RETURNING id''',id)
        if not claimed:return core.j({'error':'cannot_abort'},409)
        try:await delete_object(intent['object_key'])
        except Exception:pass # Original logs but returns successful abort.
        return core.j({'ok':True})

@router.post('/api/admin/uploads/cleanup')
async def cleanup_uploads(req:Request):
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    if user['role'] not in ('admin','owner'):return core.j({'error':'forbidden'},403)
    db=await core.pool(); removed_intents=0;removed_objects=0
    try:
        async with db.acquire() as con:
            stale=await con.fetch('''SELECT id,object_key FROM upload_intents WHERE status IN ('pending','aborted')
              AND expires_at<NOW() ORDER BY expires_at LIMIT 500''')
            for r in stale:
                claimed=await con.fetchval('''UPDATE upload_intents SET status='aborted' WHERE id=$1
                    AND status IN ('pending','aborted') AND expires_at<NOW() RETURNING id''',r['id'])
                if not claimed:continue
                try:await delete_object(r['object_key'])
                except Exception:continue
                removed_objects+=1
                gone=await con.fetchval("DELETE FROM upload_intents WHERE id=$1 AND status='aborted' RETURNING id",r['id'])
                removed_intents+=1 if gone else 0
        return core.j({'ok':True,'removedIntents':removed_intents,'removedObjects':removed_objects})
    except Exception:return core.j({'error':'cleanup_failed'},500)

@router.delete('/api/speaking/attempts/{id}')
async def delete_attempt(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as con:
        attempt=await con.fetchrow('SELECT user_id,status,recording_object_key FROM speaking_attempts WHERE id=$1',id)
        if not attempt:return core.j({'error':'not_found'},404)
        if attempt['user_id']!=user['id']:return core.j({'error':'forbidden'},403)
        if attempt['status']!='recording':return core.j({'error':'attempt_already_submitted'},409)
        # Evaluation source ids are polymorphic: no FK cascade.
        await con.execute("DELETE FROM evaluations WHERE source_type='speaking_attempt' AND source_id=$1",id)
        await con.execute('DELETE FROM speaking_attempts WHERE id=$1',id)
        if attempt['recording_object_key']:
            try:await delete_object(attempt['recording_object_key'])
            except Exception:pass
        return core.j({'ok':True})

@router.patch('/api/speaking/attempts/{id}')
async def attach_attempt(req:Request,id:str):
    if not core.uuid_value(id):return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:return core.auth_error()
    body=await core.payload(req)
    upload=body.get('uploadId') if isinstance(body,dict) else None
    duration=body.get('durationMs') if isinstance(body,dict) else None
    if not isinstance(upload,str):return core.j({'error':'invalid_upload_id'},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            intent=await con.fetchrow('SELECT * FROM upload_intents WHERE id=$1 FOR UPDATE',upload)
            if not intent or intent['user_id']!=user['id']:return core.j({'error':'upload_not_found'},404)
            if intent['purpose']!='speaking_recording' or str(intent['speaking_attempt_id'])!=id:
                return core.j({'error':'upload_purpose_mismatch'},400)
            if intent['status']!='finalized' or intent['used_at']:
                return core.j({'error':'upload_not_finalized'},409)
            attempt=await con.fetchrow('SELECT user_id,status FROM speaking_attempts WHERE id=$1 FOR UPDATE',id)
            if not attempt or attempt['user_id']!=user['id']:return core.j({'error':'attempt_not_found'},404)
            if attempt['status']!='recording':return core.j({'error':'attempt_already_submitted'},409)
            state=await con.fetchval('SELECT account_status FROM users WHERE id=$1 FOR UPDATE',user['id'])
            if state!='active':return core.j({'error':'forbidden'},403)
            await con.execute("UPDATE upload_intents SET status='attached',used_at=NOW() WHERE id=$1",upload)
            props=[id,intent['object_key'],intent['original_name'],intent['mime_type'],intent['size']]
            extra='';
            if type(duration) in (int,float) and math.isfinite(duration):extra=',recording_duration_ms=$6';props.append(int(duration))
            await con.execute('''UPDATE speaking_attempts SET recording_object_key=$2,recording_original_name=$3,
             recording_mime_type=$4,recording_size=$5'''+extra+' WHERE id=$1',*props)
            await con.execute('''UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,NOW())
              WHERE id=$1''',user['id'])
            return core.j({'ok':True,'objectKey':intent['object_key']})

def install():core.app.include_router(router)
