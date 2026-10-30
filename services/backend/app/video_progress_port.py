"""Video lesson progress, ported from src/lib/data/video-lessons.ts."""
from __future__ import annotations
import math
import json
from datetime import datetime,timezone
from fastapi import APIRouter,Request
from . import main as core
from .lesson_writing_port import lesson_live,is_js_uuid

router=APIRouter()

async def _video(conn,id):
    return await conn.fetchrow('''SELECT id,lesson_id,duration_seconds,publication_state,publish_at FROM video_lessons
            WHERE id=$1 LIMIT 1''',id)

async def _progress(conn,uid,id,create):
    row=await conn.fetchrow('''SELECT id,state,watched_seconds,answers,response_text,summary_text,completed_at,playback_duration_seconds
        FROM video_lesson_progress WHERE user_id=$1 AND video_lesson_id=$2 LIMIT 1''',uid,id)
    if not row and create:
        row=await conn.fetchrow('''INSERT INTO video_lesson_progress(user_id,video_lesson_id,state)
          VALUES($1,$2,'not_started') RETURNING id,state,watched_seconds,answers,response_text,summary_text,completed_at,playback_duration_seconds''',uid,id)
    return row

@router.get('/api/video-lessons/{id}/progress')
async def get_progress(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    db=await core.pool()
    async with db.acquire() as conn:
        video=await _video(conn,id)
        if not lesson_live(video):return core.j({'error':'not_found'},404)
        # Source getStandaloneVideoLesson() rejects non-standalone videos, while
        # getVideoLessonForLesson() resolves the course lesson's published video.
        if video['lesson_id']:
            linked=await conn.fetchval('''SELECT id FROM video_lessons WHERE lesson_id=$1
                    AND (publication_state='published' OR (publication_state='scheduled' AND publish_at<=now()))
                    LIMIT 1''',video['lesson_id'])
            if not linked:return core.j({'error':'not_found'},404)
            target=str(linked)
        else: target=id
        p=await _progress(conn,u['id'],target,False)
        if not video['lesson_id'] and target!=id:return core.j({'error':'not_found'},404)
        return core.j({'state':p['state'] if p else 'not_started',
                       'watchedSeconds':p['watched_seconds'] if p else 0,
                       'durationSeconds':video['duration_seconds'] or (p.get('playback_duration_seconds') if p else None),
                       'answers':p['answers'] or {} if p else {}})

@router.post('/api/video-lessons/{id}/progress')
async def watched_progress(req:Request,id:str):
    if not is_js_uuid(id):return core.j({'error':'not_found'},404)
    u=await core.current_user(req,active=True)
    if not u:return core.auth_error()
    b=await core.payload(req)
    seconds=b.get('watchedSeconds') if isinstance(b,dict) else None
    ended=b.get('ended') if isinstance(b,dict) else None
    duration=b.get('durationSeconds') if isinstance(b,dict) else None
    if (type(seconds) not in (int,float) or not math.isfinite(seconds) or not 0<=seconds<=43200 or
        ('ended' in b and type(ended) is not bool) or
        (duration is not None and (type(duration) not in (int,float) or not math.isfinite(duration) or not 1<=duration<=43200))):
        return core.j({'error':'invalid_input'},400)
    db=await core.pool()
    async with db.acquire() as conn:
        video=await _video(conn,id)
        if not lesson_live(video):return core.j({'error':'not_found'},404)
        p=await _progress(conn,u['id'],id,True)
        if not p:return core.j({'error':'not_found'},404)
        playback_duration=p.get('playback_duration_seconds')
        # This is private playback telemetry, never an edit to the authored
        # duration or an input to the completion threshold below.
        if not video['duration_seconds'] and duration is not None:
            playback_duration=math.ceil(duration)
            if playback_duration!=p.get('playback_duration_seconds'):
                await conn.execute('''UPDATE video_lesson_progress SET playback_duration_seconds=$3,updated_at=NOW()
                   WHERE user_id=$1 AND video_lesson_id=$2''',u['id'],id,playback_duration)
        seconds=int(seconds)
        cap=min(seconds,video['duration_seconds']) if video['duration_seconds'] else seconds
        next_watched=max(p['watched_seconds'],cap)
        if next_watched!=p['watched_seconds']:
            await conn.execute('''UPDATE video_lesson_progress SET watched_seconds=$3,updated_at=NOW()
               WHERE user_id=$1 AND video_lesson_id=$2''',u['id'],id,next_watched)
        questions=await conn.fetch('SELECT id FROM video_lesson_questions WHERE video_lesson_id=$1',id)
        correct=p['answers'] or {}
        if isinstance(correct,str):
            try:correct=json.loads(correct)
            except ValueError:correct={}
        all_correct=bool(questions) and all(isinstance(correct.get(str(q['id'])),dict) and correct[str(q['id'])].get('correct') is True for q in questions)
        duration_known=video['duration_seconds'] is not None and video['duration_seconds']>0
        threshold=duration_known and next_watched>=math.floor(video['duration_seconds']*.8)
        watched_enough=(threshold if duration_known else
          (bool(p['completed_at']) or (ended is True and next_watched>0)) if video['lesson_id'] is None else
           bool(p['response_text'] or p['summary_text']))
        completed=all_correct if video['lesson_id'] is not None and questions else bool(watched_enough)
        started=next_watched>0 or bool(correct) or bool(p['response_text']) or bool(p['summary_text'])
        state='completed' if completed else 'in_progress' if started else 'not_started'
        row=await conn.fetchrow('''UPDATE video_lesson_progress SET state=$3,completed_at=$4,updated_at=NOW()
           WHERE user_id=$1 AND video_lesson_id=$2 RETURNING state,watched_seconds,completed_at''',
           u['id'],id,state,(p['completed_at'] or datetime.now(timezone.utc)) if completed else None)
    dt=row['completed_at']
    return core.j({'state':row['state'],'watchedSeconds':row['watched_seconds'],
                   'durationSeconds':video['duration_seconds'] or playback_duration,
                   'completedAt':dt.isoformat(timespec='milliseconds').replace('+00:00','Z') if dt else None})


def install():core.app.include_router(router)
