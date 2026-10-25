from __future__ import annotations

import math
from datetime import datetime
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, identifier, live, number, safe_resource, material_blocks

AREAS = frozenset(('listening', 'reading', 'grammar'))


def mastery(rows):
    latest = {}
    days = set()
    for r in rows:
        k = (str(r['exercise_id']), r['activity'])
        if k not in latest or r['attempted_at'] > latest[k]['attempted_at']:
            latest[k] = r
        days.add(r['attempted_at'].astimezone(ZoneInfo('Asia/Tashkent')).date())
    by_activity = []
    for activity in ('correct_it', 'translate_it', 'activate_it'):
        selected = [r for r in latest.values() if r['activity'] == activity]
        correct = sum(bool(r['is_correct']) for r in selected)
        by_activity.append({'activity': activity, 'attempted': len(selected), 'correct': correct,
                            'percent': math.floor(correct / len(selected) * 100 + .5) if selected else 0})
    attempted = len(latest)
    correct = sum(bool(r['is_correct']) for r in latest.values())
    percent = math.floor(correct / attempted * 100 + .5) if attempted else 0
    all_activities = all(r['attempted'] for r in by_activity)
    return {'scorePercent': percent, 'attempted': attempted, 'correct': correct, 'byActivity': by_activity,
            'sessions': len(days), 'sessionsRemaining': max(0, 3-len(days)),
            'allActivitiesPractised': all_activities,
            'mastered': bool(all_activities and len(days)>=3 and attempted>0 and percent>=80)}


async def grammar(req, user, path, q):
    db = await core.pool()
    visible = '(e.source_owner_user_id=$1 OR (e.source_owner_user_id IS NULL AND e.source_submission_id IS NULL))'
    async with db.acquire() as con:
        from .browser_optional import OptionalReads
        reads=OptionalReads()
        if path == '/app/grammar':
            topics = await con.fetch("SELECT id,title,skill_area,\"order\" FROM grammar_topics WHERE publication_state='published' ORDER BY \"order\",id")
            exercises = await con.fetch(f'SELECT e.id,e.topic_id FROM grammar_exercises e WHERE {visible}', user['id'])
            attempts = await reads.read('mastery',lambda:con.fetch(f'''SELECT a.exercise_id,a.activity,a.is_correct,a.attempted_at,e.topic_id
                FROM grammar_attempts a JOIN grammar_exercises e ON e.id=a.exercise_id
                WHERE a.user_id=$1 AND {visible}''', user['id']))
            area = 'speaking' if q.get('tab') == 'speaking' else 'writing' if q.get('tab') else None
            return {'rows': [{'topic': camel(t), 'totalExercises': sum(e['topic_id']==t['id'] for e in exercises),
                'mastery': mastery([a for a in attempts if a['topic_id']==t['id']]) if attempts is not None else None, 'masteryUnavailable': attempts is None}
                for t in topics if area is None or t['skill_area']==area]}
        topic_id = identifier(path.rsplit('/', 1)[1])
        topic = await con.fetchrow("SELECT id,title,explanation,skill_area FROM grammar_topics WHERE id=$1 AND publication_state='published'", topic_id)
        if not topic:
            raise HTTPException(404, 'not_found')
        exercises = await con.fetch(f'''SELECT e.id,e."order",e.prompt_text,e.options,
            e.translate_prompt_uz,coalesce(e.target_structures,'[]'::jsonb) AS target_structures,e.activation_prompt,
            (e.source_owner_user_id=$1) AS "fromEssay" FROM grammar_exercises e
            WHERE {visible} AND e.topic_id=$2 ORDER BY e."order",e.id''', user['id'], topic_id)
        attempts = await reads.read('mastery',lambda:con.fetch(f'''SELECT a.exercise_id,a.activity,a.is_correct,a.attempted_at
            FROM grammar_attempts a JOIN grammar_exercises e ON e.id=a.exercise_id
            WHERE a.user_id=$1 AND {visible} AND e.topic_id=$2''', user['id'], topic_id))
        return {'kind':'topic', 'topic': camel(topic), 'exercises': [{**camel(r),'fromEssay':bool(r['fromEssay'])} for r in exercises],
                'mastery': mastery(attempts) if attempts is not None else None, 'masteryUnavailable': attempts is None,
                'materials':{'ok':True,'blocks':await material_blocks(con,'grammar',topic_id)}}


async def lessons(req, user, path, q):
    parts = path.strip('/').split('/')
    area = parts[1]
    db = await core.pool()
    if len(parts) == 4 and parts[3] == 'author':
        from .browser_authoring import lesson_authoring
        return await lesson_authoring(req, user, area, q)
    if len(parts) == 3:
        page = number(q.get('page'))
        size = 60 if area=='listening' else 24
        async with db.acquire() as con:
            rows = await con.fetch(f'''SELECT l.id,l.title,l.summary,l.estimated_minutes,
                (coalesce(length(trim(l.teacher_notes))>0,false) OR EXISTS(
                  SELECT 1 FROM video_lessons v WHERE v.lesson_id=l.id AND length(trim(v.notes))>0)) AS "hasTeacherNotes",
                EXISTS(SELECT 1 FROM lesson_blocks b WHERE b.lesson_id=l.id AND b.type IN ('audio','video','image','file')) AS "hasMedia"
                FROM lessons l WHERE l.learning_area=$1 AND {live('l')}
                ORDER BY l.updated_at DESC,l.id''', area)
        return {'library': {'rows': [camel(r) for r in rows], 'hasMore': False}}
    if len(parts) != 4:
        raise HTTPException(404, 'not_found')
    lesson_id = identifier(parts[3])
    data = await existing(req, '/api/lessons/' + str(lesson_id))
    async with db.acquire() as con:
        row = await con.fetchrow(f'SELECT id,learning_area,teacher_notes,default_state FROM lessons WHERE id=$1 AND {live()}', lesson_id)
        if not row or row['learning_area'] != area:
            raise HTTPException(404, 'not_found')
        note = await con.fetchval('SELECT body FROM lesson_notes WHERE user_id=$1 AND lesson_id=$2', user['id'], lesson_id)
        media = await con.fetchrow(f'SELECT id,title,media_kind,provider,video_id,before_you_watch,duration_seconds,notes FROM video_lessons WHERE lesson_id=$1 AND {live()} ORDER BY created_at,id LIMIT 1',lesson_id)
    data['lesson']['learningArea'] = area
    notes = row['teacher_notes'] if (row['teacher_notes'] or '').strip() else media['notes'] if media and (media['notes'] or '').strip() else None
    from .browser_video import direct_media
    direct = direct_media(media) if media else None
    data.update({'note': note or '', 'teacherNotes':notes,
      'teacherNotesSource':'lesson' if (row['teacher_notes'] or '').strip() else 'media' if notes else None,
      'media':{'id':str(media['id']),'title':media['title'],'mediaKind':media['media_kind'],'provider':media['provider'],'videoId':media['video_id'],'focus':media['before_you_watch'],'durationSeconds':media['duration_seconds']} if media else None,
      'mediaUrl':direct['src'] if direct else None})
    data['progress'] = data.get('progress') or {'state':row['default_state'], 'completedAt': None}
    for block in data['blocks']:
        if block.get('quiz'):
            block['quiz'] = {k:v for k,v in block['quiz'].items() if k not in ('answerKey','correctAnswer','explanation','key','answers','payload')}
        if block.get('referenced'):
            block['referenced']['content'] = {'title': block['referenced'].get('content',{}).get('title')}
    return {'kind':'lesson','detail':data}


async def roadmap(con, user):
    course = await con.fetchrow("SELECT id,title,description FROM courses WHERE slug='ielts'")
    if not course:
        return None
    modules = await con.fetch('SELECT id,title FROM course_modules WHERE course_id=$1 ORDER BY "order",id', course['id'])
    units = await con.fetch('''SELECT u.id,u.title,u.module_id FROM units u JOIN course_modules m ON m.id=u.module_id
        WHERE m.course_id=$1 ORDER BY u."order",u.id''', course['id'])
    lessons = await con.fetch(f'''SELECT l.id,l.unit_id,l.title,l.summary,coalesce(p.state,l.default_state) AS state
        FROM lessons l JOIN units u ON u.id=l.unit_id JOIN course_modules m ON m.id=u.module_id
        LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.user_id=$2
        WHERE m.course_id=$1 AND {live('l')} ORDER BY l."order",l.id''', course['id'], user['id'])
    return {'course': camel(course), 'modules': [{'id':str(m['id']), 'title':m['title'], 'units':[
        {'id':str(u['id']), 'title':u['title'], 'lessons':[{'id':str(l['id']),'title':l['title'],'summary':l['summary'],'state':l['state']}
        for l in lessons if l['unit_id']==u['id']]} for u in units if u['module_id']==m['id']]} for m in modules]}


async def course(req, user, path, q):
    db = await core.pool()
    async with db.acquire() as con:
        if path == '/app/courses/ielts':
            return {'roadmap': await roadmap(con,user)}
        match = __import__('re').fullmatch(r'/app/courses/ielts/lessons/([^/]+)', path)
        if not match:
            raise HTTPException(404, 'not_found')
        lesson_id = identifier(match[1])
        row = await con.fetchrow(f'''SELECT l.id,l.title,l.summary,l.recording_url,u.title AS "unitTitle",
            coalesce(p.state,l.default_state) AS state,p.completed_at FROM lessons l JOIN units u ON u.id=l.unit_id
            LEFT JOIN lesson_progress p ON p.lesson_id=l.id AND p.user_id=$2
            WHERE l.id=$1 AND {live('l')}''', lesson_id,user['id'])
        if not row:
            return {'detail': None}
        opened = row['state'] in ('available','assigned','in_progress')
        note = await con.fetchval('SELECT body FROM lesson_notes WHERE user_id=$1 AND lesson_id=$2',user['id'],lesson_id) if opened else None
        blocks = await material_blocks(con,'lesson',lesson_id) if opened else []
        detail={'ownerId':str(user['id']),'lesson':{'id':str(row['id']),'title':row['title'],'summary':row['summary'],
            'recordingUrl':row['recording_url'] if opened else None}, 'unitTitle':row['unitTitle'],
            'state':row['state'],'notes':note,'completedAt':row['completed_at'],'videoAvailable':False,'video':None,
            'materialBlocks':blocks}
    from .browser_video import course_video
    if opened:
        detail['video']=await course_video(req,user,lesson_id)
        detail['videoAvailable']=detail['video'] is not None
    return {'detail':detail}
