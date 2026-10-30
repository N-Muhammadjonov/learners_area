"""Additional strictly session-owned study operations ported from source route contracts."""
from __future__ import annotations
import json, math, random
from fastapi import APIRouter, Request
from . import main as core
from .step17_listening_start_port import test_detail

router=APIRouter()
PRIVATE={'Cache-Control':'private, no-store'}
FALLBACK_TOPICS=['education','environment','health','technology','travel','work']

@router.put('/api/listening/attempts/{id}/draft')
async def save_listening_draft(req:Request,id:str):
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    ident=core.uuid_value(id)
    if not ident:return core.j({'error':'not_found'},404)
    b=await core.payload(req)
    if not isinstance(b,dict) or not isinstance(b.get('answers'),dict) or not all(core.uuid_value(k) and isinstance(v,str) and len(v)<=500 for k,v in b['answers'].items()) or type(b.get('audioPosition')) not in (float,int) or not math.isfinite(b['audioPosition']) or not 0<=b['audioPosition']<=7200 or ('startAudio' in b and type(b['startAudio']) is not bool):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            attempt=await con.fetchrow('SELECT * FROM listening_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',ident,u['id'])
            if not attempt:return core.j({'error':'not_found'},404,PRIVATE)
            # Source gates sequence before parsing answers. This order is equivalent for valid input.
            detail=await test_detail(con,u,str(attempt['test_id']))
            if detail=='sequence_locked':return core.j({'error':'sequence_locked'},403)
            if attempt['status']!='in_progress':return core.j({'error':'already_submitted'},409,PRIVATE)
            pkg=await con.fetchrow('SELECT payload FROM listening_packages WHERE test_id=$1',attempt['test_id'])
            content=pkg['payload'] if pkg else None
            if isinstance(content,str):content=json.loads(content)
            duration=((content or {}).get('audio') or {}).get('durationSec')
            if type(duration) in (float,int) and b['audioPosition']>duration:return core.j({'error':'invalid_input'},400,PRIVATE)
            # The same explicit precedence as listeningQuestionsForAttempt():
            # bound revision, legacy rows, then all rows. Never mingle revisions.
            ids=[]
            if attempt['content_version_id']:
                ids=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1 AND content_version_id=$2',attempt['test_id'],attempt['content_version_id'])
            if not ids:ids=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1 AND content_version_id IS NULL',attempt['test_id'])
            if not ids:ids=await con.fetch('SELECT id FROM listening_questions WHERE test_id=$1',attempt['test_id'])
            allowed={str(r['id']) for r in ids}
            if any(k not in allowed for k in b['answers']):return core.j({'error':'invalid_input'},400,PRIVATE)
            old=await con.fetchrow('SELECT audio_started_at,audio_position FROM listening_drafts WHERE attempt_id=$1',ident)
            await con.execute('''INSERT INTO listening_drafts(attempt_id,answers,audio_position,audio_started_at)
               VALUES($1,$2::jsonb,$3,CASE WHEN $4 THEN NOW() ELSE NULL END)
               ON CONFLICT(attempt_id) DO UPDATE SET answers=excluded.answers,
                 audio_position=GREATEST(listening_drafts.audio_position,excluded.audio_position),
                 audio_started_at=COALESCE(listening_drafts.audio_started_at,excluded.audio_started_at),updated_at=NOW()''',ident,json.dumps(b['answers']),b['audioPosition'],b.get('startAudio') is True)
    return core.j({'ok':True},headers=PRIVATE)

def install():core.app.include_router(router)
