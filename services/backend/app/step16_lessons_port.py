"""Lesson progress and staff video catalogue, translated from source route/service logic.

No original files, frontend assets, or schema mutations are made on import.
"""
from __future__ import annotations
import json
from fastapi import APIRouter, Request
from . import main as core
from .lesson_writing_port import js_length, lesson_live

router = APIRouter()


@router.get('/api/admin/video-lessons')
async def staff_video_lessons(req: Request):
    # Next.js requireStaff() returns null for nonstaff, then route returns 403.
    user = await core.current_user(req, active=True)
    if not user or user['role'] not in ('owner', 'admin', 'teacher'):
        return core.j({'error': 'forbidden'}, 403)
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch('''SELECT v.id, v.lesson_id, l.title AS lesson_title,
          v.provider, v.video_id, v.title, v.is_active
          FROM video_lessons v LEFT JOIN lessons l ON l.id=v.lesson_id
          ORDER BY v.created_at ASC''')
    return core.j({'videoLessons': [
        {'id': str(r['id']), 'lessonId': str(r['lesson_id']) if r['lesson_id'] else None,
         'lessonTitle': r['lesson_title'], 'standalone': r['lesson_id'] is None,
         'provider': r['provider'], 'videoId': r['video_id'], 'title': r['title'],
         'isActive': r['is_active']}
        for r in rows]})


@router.post('/api/lessons/{id}/state')
async def set_lesson_state(req: Request, id: str):
    # UUID validation deliberately precedes authentication, as in the source.
    if not core.uuid_value(id):
        return core.j({'error': 'not_found'}, 404)
    user = await core.current_user(req, active=True)
    if not user:
        return core.auth_error()
    b = await core.payload(req)
    if (not isinstance(b, dict) or b.get('state') not in ('in_progress', 'completed') or
        ('notes' in b and (not isinstance(b['notes'], str) or js_length(b['notes']) > 4000))):
        return core.j({'error': 'invalid_input'}, 400)
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            await con.execute('SELECT pg_advisory_xact_lock(hashtext($1))', str(user['id']) + ':lesson:' + id)
            lesson = await con.fetchrow('''SELECT id, default_state, publication_state, publish_at
                FROM lessons WHERE id=$1 FOR SHARE''', id)
            if not lesson_live(lesson):
                return core.j({'error': 'not_found'}, 404)
            progress = await con.fetchrow('''SELECT id, state FROM lesson_progress
                WHERE lesson_id=$1 AND user_id=$2 LIMIT 1''', id, user['id'])
            current = progress['state'] if progress else lesson['default_state']
            if current in ('locked','scheduled'):
                return core.j({'error': 'locked', 'state': current}, 403)
            if current == 'completed':
                return core.j({'error': 'wrong_direction', 'state': current}, 409)
            requested = b['state']
            if progress:
                await con.execute('''UPDATE lesson_progress SET state=$2,
                    completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,
                    updated_at=now() WHERE id=$1''',progress['id'],requested)
            else:
                await con.execute('''INSERT INTO lesson_progress (user_id,lesson_id,state,completed_at,updated_at)
                    VALUES ($1,$2,$3,CASE WHEN $3='completed' THEN now() ELSE NULL END,now())''', user['id'],id,requested)
            if 'notes' in b:
                # The note is private; never save learner text in lesson_progress.notes.
                if not b['notes'].strip():
                    await con.execute('DELETE FROM lesson_notes WHERE user_id=$1 AND lesson_id=$2',user['id'],id)
                else:
                    await con.execute('''INSERT INTO lesson_notes(user_id,lesson_id,body,updated_at)
                     VALUES($1,$2,$3,now()) ON CONFLICT(user_id,lesson_id)
                     DO UPDATE SET body=excluded.body,updated_at=excluded.updated_at''',user['id'],id,b['notes'])
            if requested == 'completed':
                # Source touchMeaningfulActivity() swallows a failure independently;
                # use a SAVEPOINT so an update failure cannot poison the transaction.
                await con.execute('SAVEPOINT lesson_activity')
                try:
                    await con.execute('''UPDATE users SET last_meaningful_activity_at=GREATEST(last_meaningful_activity_at,now())
                        WHERE id=$1''',user['id'])
                    await con.execute('RELEASE SAVEPOINT lesson_activity')
                except Exception:
                    await con.execute('ROLLBACK TO SAVEPOINT lesson_activity')
                    await con.execute('RELEASE SAVEPOINT lesson_activity')
            await con.execute('''INSERT INTO activity_events(user_id,type,payload)
                VALUES($1,'LESSON_PROGRESS_UPDATED',$2::jsonb)''', user['id'],json.dumps({'lessonId':id,'state':requested}))
    return core.j({'ok': True, 'state': requested})


def install():
    core.app.include_router(router)
