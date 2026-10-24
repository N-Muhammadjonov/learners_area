"""Selected draft-authoring endpoints converted from Next.js route.ts.

Queries intentionally enforce source draft/revision checks and use transactions where
Next.js used transactions. Does not stand in for full Content OS.
"""
from __future__ import annotations

import json
import re
import uuid
from urllib.parse import urlsplit
from fastapi import APIRouter, Request
from . import main as core
from .admin_validation import parse as parse_admin

router=APIRouter()
_UUID=re.compile(r'^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$',re.I)


def uuid_val(val):
    if not isinstance(val,str) or not _UUID.fullmatch(val):return None
    return uuid.UUID(val)


def valid_string(val, low, high=None):
    return isinstance(val,str) and len(val)>=low and (high is None or len(val)<=high)


def nonempty_options(val):
    return isinstance(val,list) and all(valid_string(s,1) for s in val)


async def admin_user(req,staff=False):
    user=await core.current_user(req,active=True)
    if not user:return None,core.auth_error()
    if user['role'] not in (('teacher','admin','owner') if staff else ('admin','owner')):
        return None,core.j({'error':'forbidden'},403)
    return user,None


@router.post('/api/admin/grammar/topics/{id}/exercises')
async def grammar_exercise(req:Request,id:str):
    ident=uuid_val(id)
    if not ident:return core.j({'error':'not_found'},404)
    user,error=await admin_user(req)
    if error:return error
    b,error=parse_admin(await core.payload(req),'grammar_exercise')
    if error:return core.j({'error':error},400)
    if b['correctOption'] not in b['options']:
        return core.j({'error':'correct_option_must_be_one_of_options'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        found=await conn.fetchval('SELECT id FROM grammar_topics WHERE id=$1 LIMIT 1',ident)
        if not found:return core.j({'error':'not_found'},404)
        submission=uuid_val(b.get('sourceSubmissionId'))
        if submission and not await conn.fetchval('SELECT id FROM writing_submissions WHERE id=$1 LIMIT 1',submission):
            return core.j({'error':'source_not_found'},404)
        current=await conn.fetchval('SELECT count(*)::int FROM grammar_exercises WHERE topic_id=$1',ident)
        created=await conn.fetchrow('''INSERT INTO grammar_exercises(topic_id,"order",prompt_text,options,
          correct_option,explanation,source_submission_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7) RETURNING id''',
          ident,int(current)+1,b['promptText'],json.dumps(b['options'],ensure_ascii=False),
          b['correctOption'],b['explanation'],submission)
    return core.j({'ok':True,'id':str(created['id'])})


_READ_EDITABLE='''SELECT p.publication_state='draft' AND
  NOT EXISTS(SELECT 1 FROM reading_attempts a WHERE a.passage_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM reading_assessment_passages a WHERE a.passage_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM general_reading_progress r WHERE r.passage_id=p.id)
  AND NOT EXISTS(SELECT 1 FROM content_versions v WHERE v.module='reading' AND (
    v.target_id=p.id OR v.source_ref=p.source_ref OR
    v.content_snapshot->'canonicalPassageIds' @> jsonb_build_array(p.id::text) OR
    EXISTS(SELECT 1 FROM general_reading_passages g WHERE g.passage_id=p.id AND g.set_id=v.target_id)
  )) AS editable FROM reading_passages p WHERE p.id=$1 FOR UPDATE'''


@router.post('/api/admin/reading/passages/{id}/questions')
async def reading_question(req:Request,id:str):
    ident=uuid_val(id)
    if not ident:return core.j({'error':'not_found'},404)
    user,error=await admin_user(req)
    if error:return error
    b,error=parse_admin(await core.payload(req),'reading_question')
    if error:return core.j({'error':error},400)
    if b['type']=='multiple_choice' and (not b.get('options') or len(b['options'])<2):
        return core.j({'error':'multiple_choice needs at least 2 options'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            editable=await conn.fetchval(_READ_EDITABLE,ident)
            if not editable:return core.j({'error':'revision_managed'},409)
            count=await conn.fetchval('SELECT count(*)::int FROM reading_questions WHERE passage_id=$1',ident)
            created=await conn.fetchrow('''INSERT INTO reading_questions
              (passage_id,"order",type,question_text,options,correct_answer,evidence_quote,explanation)
              VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8) RETURNING id''',
              ident,int(count)+1,b['type'],b['questionText'],
              json.dumps(b.get('options')) if b.get('options') else None,
              b['correctAnswer'],b.get('evidenceQuote'),b['explanation'])
    return core.j({'ok':True,'id':str(created['id'])})


@router.post('/api/admin/listening/tests/{id}/questions')
async def listening_question(req:Request,id:str):
    ident=uuid_val(id)
    if not ident:return core.j({'error':'not_found'},404)
    user,error=await admin_user(req,staff=True)
    if error:return error
    b,error=parse_admin(await core.payload(req),'listening_question')
    if error:return core.j({'error':error},400)
    if b['type']=='multiple_choice' and (not b.get('options') or len(b['options'])<2):
        return core.j({'error':'multiple_choice needs at least 2 options'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        state=await conn.fetchval('SELECT publication_state FROM listening_tests WHERE id=$1 LIMIT 1',ident)
        if state is None:return core.j({'error':'not_found'},404)
        if state in ('published','scheduled'):return core.j({'error':'revision_managed'},409)
        count=await conn.fetchval('SELECT count(*)::int FROM listening_questions WHERE test_id=$1',ident)
        created=await conn.fetchrow('''INSERT INTO listening_questions
          (test_id,"order",type,question_text,options,correct_answer,explanation)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id''',ident,int(count)+1,
          b['type'],b['questionText'],json.dumps(b['options']) if b.get('options') else None,
          b['correctAnswer'],b['explanation'])
    return core.j({'ok':True,'id':str(created['id'])})


def _valid_url(value:str):
    if not isinstance(value,str) or not value or any(ch.isspace() for ch in value):return False
    parts=urlsplit(value)
    return bool(parts.scheme and (parts.netloc or parts.scheme in ('mailto','data','tel')))


@router.post('/api/admin/listening/tests')
async def listening_test_create(req:Request):
    user,error=await admin_user(req,staff=True)
    if error:return error
    b,error=parse_admin(await core.payload(req),'listening_test')
    if error:return core.j({'error':error},400)
    upload_id=uuid_val(b.get('audioUploadId'))
    db=await core.pool()
    async with db.acquire() as conn:
        async with conn.transaction():
            upload=None
            if upload_id:
                upload=await conn.fetchrow('SELECT * FROM upload_intents WHERE id=$1 FOR UPDATE',upload_id)
                if (not upload or upload['user_id']!=user['id'] or upload['status']!='finalized'
                    or upload['used_at'] is not None or upload['purpose']!='material_primary'
                    or not upload['mime_type'].startswith('audio/')):
                    return core.j({'error':'upload_not_owned_or_finalized'},409)
            audio_url=f"/api/resources/{upload['object_key']}" if upload else b.get('audioUrl')
            created=await conn.fetchrow('''INSERT INTO listening_tests
              (created_by_user_id,title,audio_type,audio_url,transcript,difficulty_level,publication_state)
              VALUES($1,$2,$3,$4,$5,$6,'draft') RETURNING id''',
              user['id'],b['title'],b['audioType'],audio_url,b.get('transcript'),b['difficultyLevel'])
            if upload:
                await conn.execute('''INSERT INTO resource_blocks
                  (owner_type,owner_id,position,type,object_key,original_name,mime_type,size,created_by_user_id)
                  VALUES('listening',$1,0,'audio',$2,$3,$4,$5,$6)''',created['id'],upload['object_key'],
                  upload['original_name'],upload['mime_type'],upload['size'],user['id'])
                await conn.execute("UPDATE upload_intents SET status='attached',used_at=now() WHERE id=$1",upload['id'])
    return core.j({'ok':True,'id':str(created['id'])},201)


def install():
    core.app.include_router(router)
