"""Learner-safe TED/Podcast views, preserving course availability and saved answers."""
from __future__ import annotations

import os
import re
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, live
from .security import normalize_origin


def direct_media(video):
    origin=normalize_origin(os.getenv('AUTHORIZED_MEDIA_ORIGIN'))
    if video['provider']=='direct' and origin and origin.startswith('https://') and re.fullmatch(r'[A-Za-z0-9_-]{1,32}\.(mp4|webm)',video['video_id']):
        key=video['video_id']
        return {'src':origin+'/media/'+key,'captions':origin+'/media/'+re.sub(r'\.(mp4|webm)$','.vtt',key)}
    return None


async def studio(con, user, video, req):
    video_id=video['id']
    questions=await con.fetch('''SELECT id,stage,prompt,at_seconds FROM video_lesson_questions
        WHERE video_lesson_id=$1 ORDER BY position,id''',video_id)
    progress=await con.fetchrow('''SELECT state,watched_seconds,answers,response_text,summary_text
        FROM video_lesson_progress WHERE video_lesson_id=$1 AND user_id=$2''',video_id,user['id'])
    # Occurrence binding is authoritative. No spelling search substitutes for a missing binding.
    words=await con.fetch('''SELECT o.id AS "occurrenceId",o.lexeme_id AS id,s.term,
        s.part_of_speech,s.definition_en,s.translation_uz,s.example_sentence
        FROM lexical_occurrences o JOIN lexemes s ON s.id=o.lexeme_id
        WHERE o.video_lesson_id=$1 AND o.resolution_status='resolved' AND o.is_target_vocabulary=true
        ORDER BY o.start_char,o.id''',video_id)
    return {'videoLesson':camel(video),'questions':[camel(r) for r in questions],
            'progress':camel(progress),'vocabulary':{'ready':True,'items':[camel(r) for r in words]},
            'directMedia':direct_media(video),
            'embedOrigin':str(req.base_url).rstrip('/')}


async def course_video(req,user,lesson_id):
    db=await core.pool()
    async with db.acquire() as con:
        video=await con.fetchrow(f'SELECT * FROM video_lessons WHERE lesson_id=$1 AND {live()} ORDER BY created_at,id LIMIT 1',lesson_id)
        return await studio(con,user,video,req) if video else None


async def read(req,user,path,q):
    db=await core.pool()
    async with db.acquire() as con:
        if path=='/app/video-lessons':
            standalone=await con.fetch(f'''SELECT v.id,v.title,v.provider,v.video_id,v.duration_seconds,p.state AS "progressState",p.watched_seconds
                FROM video_lessons v LEFT JOIN video_lesson_progress p ON p.video_lesson_id=v.id AND p.user_id=$1
                WHERE v.lesson_id IS NULL AND {live('v')} ORDER BY v.created_at,v.id''',user['id'])
            course=await con.fetch(f'''SELECT v.id,v.title,v.provider,v.video_id,v.duration_seconds,l.id AS "lessonId",
                c.slug AS "courseSlug",c.title AS "courseTitle",u.title AS "unitTitle",coalesce(p.state,l.default_state) AS state,vp.state AS "progressState",vp.watched_seconds
                FROM video_lessons v JOIN lessons l ON l.id=v.lesson_id JOIN units u ON u.id=l.unit_id
                JOIN course_modules m ON m.id=u.module_id JOIN courses c ON c.id=m.course_id
                LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.user_id=$1
                LEFT JOIN video_lesson_progress vp ON vp.video_lesson_id=v.id AND vp.user_id=$1
                WHERE {live('v')} AND {live('l')} AND coalesce(p.state,l.default_state) IN ('available','assigned','in_progress')
                ORDER BY v.created_at,v.id''',user['id'])
            return {'standalone':[camel(r) for r in standalone],'course':[camel(r) for r in course]}
        video_id=identifier(path.rsplit('/',1)[-1])
        video=await con.fetchrow(f'SELECT * FROM video_lessons WHERE id=$1 AND lesson_id IS NULL AND {live()}',video_id)
        return {'detail':await studio(con,user,video,req) if video else None}
