"""Exact route-level translations of video authored answers/writing and live-class attendance.

Source: src/app/api/video-lessons/[id]/{answers,response}/route.ts,
        src/lib/data/video-lessons.ts,
        src/app/api/live-classes/[id]/join/route.ts and attendance.ts.
"""
from __future__ import annotations

import json
import math
import re
from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Request
from . import main as core
from .lesson_writing_port import is_js_uuid, js_length, lesson_live
from .video_progress_port import _video, _progress
from .rate_limit import RULES, client_key, counter, too_many

router = APIRouter()
RULES.setdefault('evaluation', (60, 900))


def as_obj(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (ValueError, TypeError):
            return {}
    return {}


def as_list(value):
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, list) else []
        except (ValueError, TypeError):
            return []
    return []


def normalise_answer(value: str) -> str:
    """Match the authored JS normalization, including apostrophe variants."""
    value = value.strip().lower().replace('’', "'").replace('‘', "'").replace('`', "'")
    value = re.sub(r"[^a-z0-9' ]+", ' ', value)
    return ' '.join(value.split())


def grade_answer(value: str, accepted: list[str]) -> bool:
    given = normalise_answer(value)
    return bool(given) and any(normalise_answer(candidate) == given for candidate in accepted if isinstance(candidate, str))


def js_iso(dt):
    if dt is None:
        return None
    if isinstance(dt, str):
        dt = datetime.fromisoformat(dt.replace('Z', '+00:00'))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


async def _touch_meaningful(conn, uid):
    try:
        # Source deliberately swallows failed bookkeeping writes. The learner's
        # actual response/answers must still commit even if this summary fails.
        await conn.execute('''UPDATE users SET last_meaningful_activity_at=
            greatest(last_meaningful_activity_at,$2::timestamptz)
            WHERE id=$1''', uid, datetime.now(timezone.utc))
    except Exception:
        pass


async def _recompute(conn, video_id, user_id, *, trusted_end=False):
    video = await _video(conn, video_id)
    if not video:
        return None
    questions = await conn.fetch('SELECT id FROM video_lesson_questions WHERE video_lesson_id=$1', video_id)
    p = await _progress(conn, user_id, video_id, True)
    ans = as_obj(p['answers'])
    duration = video['duration_seconds']
    known = duration is not None and duration > 0
    threshold = known and p['watched_seconds'] >= math.floor(duration * 0.8)
    all_correct = bool(questions) and all(
        isinstance(ans.get(str(q['id'])), dict) and ans[str(q['id'])].get('correct') is True
        for q in questions
    )
    watched_enough = (threshold if known else
        (p['completed_at'] is not None or (trusted_end and p['watched_seconds'] > 0))
        if video['lesson_id'] is None else bool(p['response_text'] or p['summary_text']))
    completed = (all_correct if video['lesson_id'] is not None and questions else bool(watched_enough))
    started = bool(p['watched_seconds'] > 0 or ans or p['response_text'] or p['summary_text'])
    state = 'completed' if completed else 'in_progress' if started else 'not_started'
    completed_at = (p['completed_at'] or datetime.now(timezone.utc)) if completed else None
    row = await conn.fetchrow('''UPDATE video_lesson_progress SET state=$3,
        completed_at=$4, updated_at=NOW() WHERE video_lesson_id=$1 AND user_id=$2
        RETURNING state,completed_at''', video_id, user_id, state, completed_at)
    return row or {'state':state,'completed_at':completed_at}


@router.post('/api/video-lessons/{id}/answers')
async def submit_video_answers(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error':'not_found'},404)
    user = await core.current_user(req,active=True)
    if not user:
        return core.auth_error()
    delay=counter('evaluation',client_key(req),consume=True)
    if delay:
        return too_many(delay)
    body=await core.payload(req)
    answers=body.get('answers') if isinstance(body,dict) else None
    if (not isinstance(answers,dict) or
        any(not isinstance(k,str) or not is_js_uuid(k) or
            not isinstance(v,str) or js_length(v)>500 for k,v in answers.items())):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        video=await _video(conn,id)
        if not lesson_live(video):
            return core.j({'error':'not_found'},404)
        questions=await conn.fetch('''SELECT id,accepted_answers FROM video_lesson_questions
            WHERE video_lesson_id=$1''',id)
        if not questions:
            return core.j({'error':'no_questions'},409)
        progress=await _progress(conn,user['id'],id,True)
        graded=as_obj(progress['answers']).copy()
        for q in questions:
            given=answers.get(str(q['id']))
            if given is None:
                continue
            graded[str(q['id'])]={'answer':given[:500],
                'correct':grade_answer(given,as_list(q['accepted_answers']))}
        await conn.execute('''UPDATE video_lesson_progress SET answers=$3::jsonb,
            updated_at=NOW() WHERE video_lesson_id=$1 AND user_id=$2''',
            id,user['id'],json.dumps(graded,ensure_ascii=False))
        row=await _recompute(conn,id,user['id'])
        if graded or (row and row['state']=='completed'):
            await _touch_meaningful(conn,user['id'])
    return core.j({'graded':graded,'state':row['state'] if row else 'not_started',
                   'completedAt':js_iso(row['completed_at']) if row else None})


@router.post('/api/video-lessons/{id}/response')
async def submit_video_response(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:
        return core.auth_error()
    delay=counter('evaluation',client_key(req),consume=True)
    if delay:
        return too_many(delay)
    body=await core.payload(req)
    if not isinstance(body,dict) or any(
        k in body and (not isinstance(body[k],str) or js_length(body[k])>4000)
        for k in ('responseText','summaryText')
    ):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        video=await _video(conn,id)
        if not lesson_live(video):
            return core.j({'error':'not_found'},404)
        await _progress(conn,user['id'],id,True)
        if 'responseText' in body or 'summaryText' in body:
            columns=[]; args=[id,user['id']]
            for field,col in (('responseText','response_text'),('summaryText','summary_text')):
                if field in body:
                    args.append(body[field][:4000]);columns.append(f'{col}=${len(args)}')
            await conn.execute('UPDATE video_lesson_progress SET '+', '.join(columns)+''',
                updated_at=NOW() WHERE video_lesson_id=$1 AND user_id=$2''',*args)
        else:
            await conn.execute('''UPDATE video_lesson_progress SET updated_at=NOW()
                WHERE video_lesson_id=$1 AND user_id=$2''',id,user['id'])
        row=await _recompute(conn,id,user['id'])
        if any(body.get(k,'').strip() for k in ('responseText','summaryText')):
            await _touch_meaningful(conn,user['id'])
    return core.j({'state':row['state'] if row else 'not_started'})


@router.post('/api/live-classes/{id}/join')
async def join_live_class(req: Request, id: str):
    if not is_js_uuid(id):
        return core.j({'error':'not_found'},404)
    user=await core.current_user(req,active=True)
    if not user:
        return core.auth_error()
    db=await core.pool()
    async with db.acquire() as conn:
        live=await conn.fetchrow('''SELECT id,status,scheduled_at,duration_minutes
            FROM live_classes WHERE id=$1 LIMIT 1''',id)
        if not live:
            return core.j({'error':'not_found'},404)
        scheduled=live['scheduled_at']
        if isinstance(scheduled,str):scheduled=datetime.fromisoformat(scheduled.replace('Z','+00:00'))
        if scheduled.tzinfo is None:scheduled=scheduled.replace(tzinfo=timezone.utc)
        opens=scheduled-timedelta(minutes=15)
        ends=scheduled+timedelta(minutes=live['duration_minutes']+30)
        now=datetime.now(timezone.utc)
        state=('cancelled' if live['status']=='cancelled' else
               'open' if live['status']=='live' else
               'too_early' if now<opens else
               'closed' if now>ends else 'open')
        if state!='open':
            return core.j({'error':state,'opensAt':js_iso(opens),'joined':False},409)
        # The parent-row FOR UPDATE lock is part of the source's concurrency fix.
        async with conn.transaction():
            locked=await conn.fetchrow('''SELECT id FROM live_classes WHERE id=$1 FOR UPDATE''',id)
            if not locked:
                joined_at=None
            else:
                existing=await conn.fetchrow('''SELECT joined_at FROM live_class_attendance
                    WHERE live_class_id=$1 AND user_id=$2 LIMIT 1''',id,user['id'])
                if existing:
                    joined_at=existing['joined_at']
                else:
                    new=await conn.fetchrow('''INSERT INTO live_class_attendance(live_class_id,user_id)
                        VALUES($1,$2) RETURNING joined_at''',id,user['id'])
                    joined_at=new['joined_at'] if new else None
                    await conn.execute('''INSERT INTO activity_events(user_id,type,payload)
                        VALUES($1,'LIVE_CLASS_ATTENDED',$2::jsonb)''',user['id'],
                        json.dumps({'liveClassId':id}))
    return core.j({'ok':True,'joined':True,'joinedAt':js_iso(joined_at or datetime.now(timezone.utc))})


def install():
    core.app.include_router(router)
