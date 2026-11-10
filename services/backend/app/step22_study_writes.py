"""Additional strictly session-owned study operations ported from source route contracts."""
from __future__ import annotations
import json, math, random
from fastapi import APIRouter, Request
from . import main as core
from .step17_listening_start_port import test_detail
from .listening_draft import listening_draft_hash
import re

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
    if (not isinstance(b,dict) or not isinstance(b.get('answers'),dict)
        or not all(core.uuid_value(k) and isinstance(v,str) and len(v)<=500 for k,v in b['answers'].items())
        or type(b.get('audioPosition')) not in (float,int)
        or not math.isfinite(b['audioPosition']) or not 0<=b['audioPosition']<=7200
        or ('startAudio' in b and type(b['startAudio']) is not bool)):
        return core.j({'error':'invalid_input'},400)
    expected=b.get('expectedDraftHash')
    if expected is not None and (not isinstance(expected,str) or not re.fullmatch('[a-f0-9]{64}',expected)):
        return core.j({'error':'invalid_input'},400,PRIVATE)
    db=await core.pool()
    async with db.acquire() as con:
        # Avoid holding a row lock during content/sequence and answer-ID reads.
        attempt=await con.fetchrow(
            'SELECT test_id,content_version_id,status FROM listening_attempts WHERE id=$1 AND user_id=$2',
            ident,u['id'])
        if not attempt:return core.j({'error':'not_found'},404,PRIVATE)
        if attempt['status']!='in_progress':return core.j({'error':'already_submitted'},409,PRIVATE)
        detail=await test_detail(con,u,str(attempt['test_id']))
        if detail=='sequence_locked':return core.j({'error':'sequence_locked'},403,PRIVATE)
        if not detail:return core.j({'error':'not_found'},404,PRIVATE)
        # JSONB path projection avoids sending/parsing the full package payload.
        raw_duration=await con.fetchval(
            "SELECT payload #>> '{audio,durationSec}' FROM listening_packages WHERE test_id=$1",
            attempt['test_id'])
        try: duration=float(raw_duration) if raw_duration is not None else None
        except (ValueError,TypeError,OverflowError):duration=None
        if duration is not None and math.isfinite(duration) and b['audioPosition']>duration:
            return core.j({'error':'invalid_input'},400,PRIVATE)
        if b['answers']:
            # Same pinned revision -> legacy -> all precedence, in one query.
            rows=await con.fetch("""
                WITH mode AS (
                  SELECT CASE
                    WHEN $2::uuid IS NOT NULL AND EXISTS (
                      SELECT 1 FROM listening_questions
                      WHERE test_id=$1 AND content_version_id=$2
                    ) THEN 1
                    WHEN EXISTS (
                      SELECT 1 FROM listening_questions
                      WHERE test_id=$1 AND content_version_id IS NULL
                    ) THEN 2 ELSE 3 END AS choice
                )
                SELECT q.id FROM listening_questions q CROSS JOIN mode m
                WHERE q.test_id=$1
                  AND (m.choice=3
                    OR (m.choice=1 AND q.content_version_id=$2)
                    OR (m.choice=2 AND q.content_version_id IS NULL))
            """,attempt['test_id'],attempt['content_version_id'])
            allowed={str(row['id']) for row in rows}
            if any(k not in allowed for k in b['answers']):
                return core.j({'error':'invalid_input'},400,PRIVATE)
        async with con.transaction():
            # Serialize only final status verification and the upsert; a
            # concurrent submit must not be overwritten by a later draft.
            locked=await con.fetchrow(
                'SELECT status FROM listening_attempts WHERE id=$1 AND user_id=$2 FOR UPDATE',
                ident,u['id'])
            if not locked:return core.j({'error':'not_found'},404,PRIVATE)
            if locked['status']!='in_progress':return core.j({'error':'already_submitted'},409,PRIVATE)
            if expected is not None:
                prior=await con.fetchrow('SELECT answers,audio_position FROM listening_drafts WHERE attempt_id=$1',ident)
                answers=prior['answers'] if prior else {}
                if isinstance(answers,str):answers=json.loads(answers)
                current=listening_draft_hash(answers,prior['audio_position'] if prior else 0)
                if expected!=current and listening_draft_hash(b['answers'],b['audioPosition'])!=current:
                    return core.j({'error':'draft_conflict'},409,PRIVATE)
            await con.execute('''INSERT INTO listening_drafts(
                  attempt_id,answers,audio_position,audio_started_at)
                VALUES($1,$2::jsonb,$3,CASE WHEN $4 THEN NOW() ELSE NULL END)
                ON CONFLICT(attempt_id) DO UPDATE SET
                  answers=excluded.answers,
                  audio_position=excluded.audio_position,
                  audio_started_at=COALESCE(
                    listening_drafts.audio_started_at,excluded.audio_started_at),
                  updated_at=NOW()''',
                  ident,json.dumps(b['answers']),b['audioPosition'],b.get('startAudio') is True)
    return core.j({'ok':True,**({'draftHash':listening_draft_hash(b['answers'],b['audioPosition'])} if expected is not None else {})},headers=PRIVATE)

def install():core.app.include_router(router)
