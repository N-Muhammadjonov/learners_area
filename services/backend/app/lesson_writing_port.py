"""Independently translated Notes, Writing Pattern, Writing Lesson, and Typing APIs.

The matching Next.js routes remain in the unchanged input ZIP. Only explicit
methods in this file are implemented; no generic response stubs are installed.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from decimal import Decimal
from fastapi import APIRouter, Request
from . import main as core
from .db import row_to_dict

router = APIRouter()
_UUID_RE = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', re.I)


def is_js_uuid(raw: str) -> bool:
    return bool(_UUID_RE.fullmatch(raw))


def js_length(s: str) -> int:
    """JavaScript string `.length` counts UTF-16 code units, not code points."""
    return len(s.encode('utf-16-le', 'surrogatepass')) // 2


async def note_lesson(conn, lesson_id):
    return await conn.fetchrow('''SELECT publication_state, publish_at FROM lessons
        WHERE id=$1 LIMIT 1''', lesson_id)


def lesson_live(row) -> bool:
    if not row:
        return False
    if row['publication_state'] == 'published':
        return True
    if row['publication_state'] == 'scheduled' and row['publish_at']:
        # Source isLive() compares the scheduled instant to Node's current time.
        publish_at = row['publish_at']
        if isinstance(publish_at, str):
            publish_at = datetime.fromisoformat(publish_at.replace('Z', '+00:00'))
        return publish_at <= datetime.now(timezone.utc)
    return False


@router.get('/api/lessons/{id}/notes')
async def lesson_note_read(req: Request, id: str):
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    db = await core.pool()
    async with db.acquire() as conn:
        lesson = await note_lesson(conn, id)
        if not lesson_live(lesson):
            return core.j({'error': 'not_found'}, 404)
        note = await conn.fetchrow('''SELECT body, updated_at AS "updatedAt" FROM lesson_notes
            WHERE user_id=$1 AND lesson_id=$2 LIMIT 1''', user['id'], id)
    data = row_to_dict(note) if note else {}
    return core.j({'notes': data.get('body'), 'updatedAt': data.get('updatedAt')})


@router.post('/api/lessons/{id}/notes')
async def lesson_note_save(req: Request, id: str):
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    if not is_js_uuid(id):
        return core.j({'error': 'not_found'}, 404)
    body = await core.payload(req)
    if not isinstance(body, dict) or any(
        k in body and body[k] is not None and (not isinstance(body[k], str) or js_length(body[k]) > 4000)
        for k in ('notes', 'body')
    ) or any(k in body and body[k] is None for k in ('notes', 'body')):
        # A specified null fails Zod's string().optional().
        return core.j({'error': 'invalid_input'}, 400)
    note_body = body.get('notes', body.get('body'))
    if note_body is None:
        return core.j({'error': 'invalid_input'}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        lesson = await note_lesson(conn, id)
        if not lesson_live(lesson):
            return core.j({'error': 'lesson_not_open' if lesson else 'lesson_not_found'},
                          403 if lesson else 404)
        if not note_body.strip():
            await conn.execute('''DELETE FROM lesson_notes WHERE user_id=$1 AND lesson_id=$2''', user['id'], id)
            return core.j({'ok': True, 'notes': None, 'updatedAt': None})
        saved = await conn.fetchrow('''INSERT INTO lesson_notes(user_id,lesson_id,body,updated_at)
            VALUES($1,$2,$3,now()) ON CONFLICT(user_id,lesson_id)
            DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at
            RETURNING body,updated_at AS "updatedAt"''', user['id'], id, note_body)
    data = row_to_dict(saved) if saved else {}
    return core.j({'ok': True, 'notes': data.get('body'), 'updatedAt': data.get('updatedAt')})


# The source liveWhere() combines publication scheduling with soft-deletion.
_LIVE_SQL = '''(
  (w.publication_state='published' OR (w.publication_state='scheduled' AND w.publish_at <= $2))
  AND NOT EXISTS (SELECT 1 FROM activity_events deleted_content
    WHERE deleted_content.id=md5('deleted-content:' || w.id::text)::uuid
    AND deleted_content.type='CONTENT_DELETED')
)'''


@router.put('/api/writing/patterns/{id}')
async def writing_pattern_save(req: Request, id: str):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({'error': {'code': 'unauthenticated', 'message': 'Sign in again.'}}, 401)
    body = await core.payload(req)
    if (not is_js_uuid(id) or not isinstance(body, dict) or set(body) != {'saved'}
        or not isinstance(body.get('saved'), bool)):
        return core.j({'error': {'code': 'invalid_input', 'message': 'Could not save.'}}, 400)
    db = await core.pool()
    async with db.acquire() as conn:
        published = await conn.fetchval('''SELECT w.id FROM writing_language_patterns w
            WHERE w.id=$1 AND ''' + _LIVE_SQL + ' LIMIT 1', id, datetime.now(timezone.utc))
        if not published:
            return core.j({'error': {'code': 'not_found', 'message': 'Not found.'}}, 404)
        if body['saved']:
            await conn.execute('''INSERT INTO writing_pattern_bank(user_id,pattern_id)
                VALUES($1,$2) ON CONFLICT DO NOTHING''', user['id'], id)
        else:
            await conn.execute('''DELETE FROM writing_pattern_bank
                WHERE user_id=$1 AND pattern_id=$2''', user['id'], id)
    return core.j({'ok': True, 'saved': body['saved']})


@router.post('/api/writing/lessons/{id}')
async def writing_lesson_completed(req: Request, id: str):
    # The source validates path UUID before checking the session.
    if not is_js_uuid(id):
        return core.j({'error': {'code': 'not_found', 'message': 'Not found.'}}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({'error': {'code': 'unauthenticated', 'message': 'Sign in again.'}}, 401)
    db = await core.pool()
    async with db.acquire() as conn:
        published = await conn.fetchval('''SELECT w.id FROM writing_lessons w WHERE w.id=$1 AND '''
                                        + _LIVE_SQL + ' LIMIT 1', id, datetime.now(timezone.utc))
        if not published:
            return core.j({'error': {'code': 'not_found', 'message': 'Not found.'}}, 404)
        await conn.execute('''INSERT INTO writing_lesson_progress(user_id,lesson_id)
            VALUES($1,$2) ON CONFLICT DO NOTHING''', user['id'], id)
    return core.j({'ok': True})


_TYPING_RUN_SQL = '''SELECT id, user_id AS "userId", target_chars AS "targetChars",
 typed_chars AS "typedChars", duration_ms AS "durationMs", wpm::text AS wpm,
 accuracy::text AS accuracy, run_token_id AS "runTokenId", raw_wpm::text AS "rawWpm",
 consistency::text AS consistency, chars_correct AS "charsCorrect",
 chars_incorrect AS "charsIncorrect", chars_extra AS "charsExtra",
 chars_missed AS "charsMissed", started_at AS "startedAt", finished_at AS "finishedAt",
 created_at AS "createdAt" FROM typing_runs WHERE user_id=$1 ORDER BY created_at DESC LIMIT 10'''


@router.get('/api/writing/typing')
async def writing_typing_history(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    db = await core.pool()
    async with db.acquire() as conn:
        # Original typingSummary() and listTypingRuns() both select only own data.
        summary = await conn.fetchrow('''SELECT count(*)::int AS count,
              max(wpm)::text AS "bestWpm", max(accuracy)::text AS "bestAccuracy"
              FROM typing_runs WHERE user_id=$1''', user['id'])
        rows = await conn.fetch(_TYPING_RUN_SQL, user['id'])
    n = int(summary['count']) if summary else 0
    result = {'count': n, 'bestWpm': float(summary['bestWpm']) if n and summary['bestWpm'] is not None else None,
              'bestAccuracy': float(summary['bestAccuracy']) if n and summary['bestAccuracy'] is not None else None}
    runs = []
    for row in rows:
        r = row_to_dict(row)
        # The original spreads the Drizzle row and converts ONLY wpm and accuracy.
        r['wpm'] = float(r['wpm']); r['accuracy'] = float(r['accuracy'])
        runs.append(r)
    return core.j({'summary': result, 'runs': runs})


def install():
    core.app.include_router(router)
