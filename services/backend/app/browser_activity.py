"""Learner summaries derived from owned records, without source answers or keys."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, material_blocks


async def streak(con, uid):
    from .browser_summary import STREAK_SQL
    return await con.fetchval(STREAK_SQL, uid, datetime.now(ZoneInfo('Asia/Tashkent')).date())


async def mocks(con, uid):
    from .browser_optional import OptionalReads
    read=OptionalReads()
    tests=await read.read('catalogue',lambda:con.fetch("SELECT t.id,t.title,t.skill FROM mock_tests t JOIN courses c ON c.id=t.course_id WHERE c.slug='ielts' ORDER BY t.title,t.id LIMIT 5001"))
    rows=await read.read('attempts',lambda:con.fetch('SELECT id,mock_test_id,started_at,finished_at,raw_score,estimated_band,mock_snapshot FROM mock_attempts WHERE user_id=$1 ORDER BY started_at DESC,id DESC LIMIT 5001',uid))
    catalogue_truncated=len(tests or [])>5000
    attempts_truncated=len(rows or [])>5000
    tests=(tests or [])[:5000]
    rows=(rows or [])[:5000]
    ids=list({r['mock_test_id'] for r in rows if r['mock_test_id']})
    titles=await read.read('titles',lambda:con.fetch('SELECT id,title,skill FROM mock_tests WHERE id=ANY($1::uuid[])',ids)) if ids else []
    by={r['id']:r for r in titles or []}
    attempts=[]
    for r in rows:
        snapshot=r['mock_snapshot'] or {}
        title=by.get(r['mock_test_id'])
        a=camel({k:r[k] for k in ('id','mock_test_id','started_at','finished_at')})
        a.update(title=title['title'] if title else snapshot.get('title'),skill=title['skill'] if title else snapshot.get('kind') if not r['mock_test_id'] else None,rawScore=r['raw_score'] if r['finished_at'] else None,estimatedBand=r['estimated_band'] if r['finished_at'] else None)
        attempts.append(a)
    return {'tests':[camel(r) for r in tests],'attempts':attempts,'finishedCount':sum(bool(r['finishedAt']) for r in attempts),
      'catalogueUnavailable':'catalogue' in read.failed,'catalogueTruncated':catalogue_truncated,
      'attemptsUnavailable':'attempts' in read.failed,'attemptsTruncated':attemptsTruncated if 'attemptsTruncated' in locals() else attempts_truncated,
      'attemptTitlesUnavailable':'titles' in read.failed}


async def summary(con, uid):
    from .browser_summary import summary_snapshot
    try:
        return await summary_snapshot(con, uid)
    except Exception:
        # Preserve existing per-widget degradation when an optional table is unavailable.
        return await summary_sequential(con, uid)


async def summary_sequential(con, uid):
    from .browser_optional import OptionalReads
    read=OptionalReads();result={}
    for skill in ('reading','listening'):
        row=await read.read('progress-'+skill,lambda skill=skill:con.fetchrow(f"SELECT count(*)::int attempts,count(*) FILTER(WHERE status='completed')::int submitted,COALESCE(sum(score) FILTER(WHERE status='completed'),0)::int score,COALESCE(sum(total_questions) FILTER(WHERE status='completed'),0)::int total FROM {skill}_attempts WHERE user_id=$1",uid))
        value=dict(row) if row else None
        if value:value['accuracy']=int(value['score']/value['total']*100+.5) if value['submitted'] and value['total'] else None
        result[skill]=value
    speaking=await read.read('progress-speaking',lambda:con.fetchrow("SELECT count(*)::int attempts,count(*) FILTER(WHERE status<>'recording')::int submitted,count(*) FILTER(WHERE transcript_provider IS NOT NULL)::int transcribed FROM speaking_attempts WHERE user_id=$1",uid))
    result['speaking']=dict(speaking) if speaking else None
    writing=await read.read('progress-writing-submissions',lambda:con.fetchrow('SELECT count(*)::int submissions,max(submitted_at) last_submitted_at FROM writing_submissions WHERE user_id=$1',uid))
    ev=await read.read('progress-writing-evaluation',lambda:con.fetchrow("SELECT overall_estimate,created_at FROM evaluations WHERE user_id=$1 AND source_type='writing_submission' ORDER BY created_at DESC LIMIT 1",uid))
    result['writing']={'submissions':writing['submissions'] if writing else None,'lastSubmittedAt':writing['last_submitted_at'] if writing else None,'latestBand':ev['overall_estimate'] if ev else None,'latestEvaluationAt':ev['created_at'] if ev else None,'evaluationUnavailable':'progress-writing-evaluation' in read.failed}
    vocab=await read.read('progress-vocabulary',lambda:con.fetch('SELECT state,count(*)::int n FROM user_vocabulary WHERE user_id=$1 GROUP BY state',uid))
    due=await read.read('progress-vocabulary-due',lambda:con.fetchval("SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1 AND next_review_at<=now() AND state<>'mastered'",uid))
    states={r['state']:r['n'] for r in vocab or []}
    result['vocabulary']={'total':sum(states.values()),'due':due,'byState':{k:states.get(k,0) for k in ('new','learning','review','known','mastered','activated')}} if vocab is not None else None
    totals=await read.read('progress-lesson-catalogue',lambda:con.fetchrow("SELECT count(*)::int total,count(*) FILTER(WHERE default_state<>'locked')::int open FROM lessons"))
    states=await read.read('progress-lesson-state',lambda:con.fetchrow("SELECT count(*) FILTER(WHERE state='in_progress')::int in_progress,count(*) FILTER(WHERE state='completed')::int completed FROM lesson_progress WHERE user_id=$1",uid))
    result['lessons']={'total':totals['total'] if totals else None,'open':totals['open'] if totals else None,'inProgress':states['in_progress'] if states else None,'completed':states['completed'] if states else None}
    assignments=await read.read('progress-assignments',lambda:con.fetchrow("SELECT count(*)::int total,count(*) FILTER(WHERE status<>'completed')::int open,count(*) FILTER(WHERE status='completed')::int completed FROM assignments WHERE target_user_id=$1",uid))
    result['assignments']=dict(assignments) if assignments else None
    mock=await read.read('progress-mocks',lambda:con.fetch('SELECT finished_at,estimated_band FROM mock_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 20',uid))
    bands=[float(r['estimated_band']) for r in mock or [] if r['finished_at'] and r['estimated_band'] is not None]
    result['mocks']={'attempts':len(mock),'finished':sum(bool(r['finished_at']) for r in mock),'bestBand':max(bands) if bands else None} if mock is not None else None
    result['unavailableRegions']=list(read.failed)
    return result


async def dashboard(req, con, uid):
    from .browser_dashboard_snapshot import dashboard_snapshot
    try:
        return await dashboard_snapshot(con,uid)
    except Exception:
        return await dashboard_sequential(req,con,uid)


async def dashboard_sequential(req, con, uid):
    from .step31_coach import decoded, PUBLIC
    from .browser_optional import OptionalReads
    read=OptionalReads()
    profile=await read.read('profile',lambda:con.fetchrow('SELECT target_band FROM onboarding_profiles WHERE user_id=$1',uid))
    evaluation=await read.read('latestEvaluation',lambda:con.fetchrow('SELECT overall_estimate,weaknesses FROM evaluations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',uid))
    counts={}
    try:
        counts=dict(await con.fetchrow("""SELECT
          (SELECT count(*)::int FROM reading_attempts WHERE user_id=$1) reading,
          (SELECT count(*)::int FROM listening_attempts WHERE user_id=$1) listening,
          (SELECT count(*)::int FROM speaking_attempts WHERE user_id=$1) speaking,
          (SELECT count(*)::int FROM writing_submissions WHERE user_id=$1 AND word_count>0) writing""",uid))
    except Exception:
        for skill,table in (('reading','reading_attempts'),('listening','listening_attempts'),('speaking','speaking_attempts'),('writing','writing_submissions')):
            counts[skill]=await read.read(skill+'Attempts',lambda table=table,skill=skill:con.fetchval(f'SELECT count(*)::int FROM {table} WHERE user_id=$1'+(' AND word_count>0' if skill=='writing' else ''),uid))
    upcoming=await read.read('nextLiveClass',lambda:con.fetchrow("SELECT l.id,l.title,l.scheduled_at FROM live_classes l JOIN courses c ON c.id=l.course_id WHERE c.slug='ielts' AND l.status='upcoming' ORDER BY l.scheduled_at LIMIT 1"))
    assignments=await read.read('assignments',lambda:con.fetch("SELECT id,title,status,due_at FROM assignments WHERE target_user_id=$1 AND status<>'completed' ORDER BY due_at",uid))
    due=await read.read('vocabDue',lambda:con.fetchval('SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1 AND next_review_at<=now()',uid))
    active_streak=await read.read('streak',lambda:streak(con,uid))
    async def legacy_last_activity():
        from .step21_history_port import SQL,build
        candidates=[]
        for skill in counts:
            rows=await con.fetch(SQL[skill],uid,1)
            if rows:
                entry=build(skill,rows[0]);candidates.append({'module':skill,'at':entry['occurredAt'],'href':entry['href']})
        vocabulary=await con.fetchrow('SELECT created_at FROM user_vocabulary WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',uid)
        if vocabulary:candidates.append({'module':'vocabulary','at':camel(vocabulary)['createdAt'],'href':'/app/vocabulary'})
        candidates.sort(key=lambda r:r['at'],reverse=True)
        return candidates[0] if candidates else None
    async def last_activity():
        try:
            row=await con.fetchrow("""SELECT module,at,href FROM (
              (SELECT 'reading' module,started_at at,'/app/reading/attempts/'||id::text href FROM reading_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1)
              UNION ALL (SELECT 'listening',started_at,'/app/listening/attempts/'||id::text FROM listening_attempts WHERE user_id=$1 ORDER BY started_at DESC LIMIT 1)
              UNION ALL (SELECT 'writing',updated_at,'/app/writing/submissions/'||id::text FROM writing_submissions WHERE user_id=$1 ORDER BY updated_at DESC LIMIT 1)
              UNION ALL (SELECT 'speaking',started_at,'/app/speaking/history' FROM speaking_attempts WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)
              UNION ALL (SELECT 'vocabulary',created_at,'/app/vocabulary' FROM user_vocabulary WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1)
              ) latest ORDER BY at DESC LIMIT 1""",uid)
            return camel(row) if row else None
        except Exception:
            return await legacy_last_activity()
    last=await read.read('lastActivity',last_activity)
    return {'profile':camel(profile),'latestEvaluation':{**camel(evaluation),'weaknesses':decoded(evaluation['weaknesses']),'checkedByName':PUBLIC} if evaluation else None,
      'vocabDueCount':due,'streak':active_streak,'writingAttempts':counts['writing'],'skillCounts':counts,
      'openAssignments':[camel(r) for r in assignments] if assignments is not None else None,'nextLiveClass':camel(upcoming),'lastActivity':last,
      'unavailable':{k:k in read.failed for k in ('profile','latestEvaluation','vocabDue','streak','writingAttempts','readingAttempts','listeningAttempts','speakingAttempts','assignments','nextLiveClass','lastActivity')}}


# Fixed-size result pages, independent of the number of enrolled students or past lessons.
RECORDINGS_PAGE_SIZE = 20


def _archive_cursor(raw):
    """Validate a (scheduled_at, id) keyset cursor without losing timestamp precision."""
    from .live_classes_port import parse_iso_datetime
    from uuid import UUID
    if raw is None or raw == '':
        return None, None
    if not isinstance(raw, str) or len(raw) > 128 or raw.count('|') != 1:
        raise HTTPException(400, 'invalid_recordings_cursor')
    stamp, identifier = raw.split('|')
    try:
        dt = parse_iso_datetime(stamp)
        item_id = UUID(identifier)
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(400, 'invalid_recordings_cursor') from None
    if dt is None:
        raise HTTPException(400, 'invalid_recordings_cursor')
    return dt, item_id


def _hub_class(row_dict, actor, *, extended):
    from .live_classes_port import (
        can_user_manage_class, compute_lifecycle_status,
        extract_youtube_video_id, youtube_thumbnail_url,
    )
    c = camel(row_dict)
    if not extended:
        return c
    status = c.get('status') or 'upcoming'
    recording = c.get('recordingStatus') or ('ready' if status == 'recorded' else 'none')
    lifecycle = compute_lifecycle_status(status, recording)
    video = c.get('youtubeVideoId')
    for url in (c.get('meetingUrl'), c.get('recordingUrl')):
        if not video and url:
            video, _ = extract_youtube_video_id(url)
    playable = status == 'live' or lifecycle == 'recording_ready' or can_user_manage_class(actor, row_dict)
    c['youtubeVideoId'] = video if playable else None
    if not playable:
        c['meetingUrl'] = None
        c['recordingUrl'] = None
    c['hasYoutubeVideo'] = bool(video)
    c['thumbnailUrl'] = youtube_thumbnail_url(video)
    c['lifecycleStatus'] = lifecycle
    c['recordingStatus'] = recording
    if c.get('description') is None:
        c['description'] = c.get('topic')
    return c


async def _archive_page_rows(con, actor, course_id, *, extended, before=None):
    """Only authorized historical lessons are paged, in the database, before LIMIT.

    The access predicates match can_user_access_class. This avoids retrieving
    arbitrary numbers of inaccessible lessons for a student and keeps every
    page capped regardless of total archive size or student count.
    """
    from .live_classes_port import chat_iso
    if not actor or actor.get('account_status') != 'active' or actor.get('role') not in ('owner','teacher','admin','student'):
        raise HTTPException(403, 'forbidden')
    cursor_at, cursor_id = _archive_cursor(before)
    role = actor['role']
    if extended:
        columns = ('id,course_id,title,topic,description,status,recording_status,scheduled_at,started_at,ended_at,'
                   'duration_minutes,recording_duration_seconds,teacher_user_id,meeting_url,recording_url,'
                   'youtube_video_id,access_scope')
    else:
        columns = 'id,course_id,title,topic,status,scheduled_at,duration_minutes,teacher_user_id,meeting_url,recording_url'
    if role == 'owner':
        access_sql = ''
    elif role in ('teacher','admin'):
        access_sql = 'AND l.teacher_user_id=$2::uuid'
    else:
        entitlement = """(
            EXISTS (SELECT 1 FROM enrollments e WHERE e.user_id=$2::uuid AND e.course_id=l.course_id)
            OR EXISTS (SELECT 1 FROM access_entitlements a WHERE a.user_id=$2::uuid
                       AND a.course_id=l.course_id AND (a.expires_at IS NULL OR a.expires_at > NOW()))
        )"""
        if extended:
            access_sql = f"""AND (
                (COALESCE(l.access_scope,'course')='course' AND {entitlement})
                OR (l.access_scope='teacher_roster' AND EXISTS (
                     SELECT 1 FROM teacher_student_links t
                     WHERE t.teacher_user_id=l.teacher_user_id AND t.student_user_id=$2::uuid))
                OR (l.access_scope='assigned' AND EXISTS (
                     SELECT 1 FROM live_class_enrollments e
                     WHERE e.live_class_id=l.id AND e.user_id=$2::uuid))
            )"""
        else:
            access_sql = f'AND {entitlement}'
    query = f"""SELECT {columns} FROM live_classes l
               WHERE l.course_id=$1::uuid AND $2::uuid IS NOT NULL
                 AND l.status IN ('completed','recorded')
                 {access_sql}
                 AND ($3::timestamptz IS NULL OR (l.scheduled_at,l.id)<($3::timestamptz,$4::uuid))
               ORDER BY l.scheduled_at DESC,l.id DESC LIMIT $5"""
    rows = [dict(r) for r in await con.fetch(query, course_id, actor['id'], cursor_at, cursor_id, RECORDINGS_PAGE_SIZE+1)]
    has_more = len(rows) > RECORDINGS_PAGE_SIZE
    page = rows[:RECORDINGS_PAGE_SIZE]
    last = page[-1] if has_more else None
    cursor = f"{chat_iso(last['scheduled_at'])}|{last['id']}" if last else None
    return page, {'hasMore':has_more,'nextCursor':cursor}


async def _archive_page_payload(con, actor, course_id, *, extended, before=None):
    rows, pagination = await _archive_page_rows(con, actor, course_id, extended=extended, before=before)
    past = [_hub_class(r, actor, extended=extended) for r in rows]
    ids = [r['id'] for r in past]
    attendance = ([camel(r) for r in await con.fetch(
        'SELECT live_class_id,joined_at FROM live_class_attendance WHERE user_id=$1 AND live_class_id=ANY($2::uuid[])',
        actor['id'], ids)] if ids else [])
    teacher_ids = list({r['teacherUserId'] for r in past if r.get('teacherUserId')})
    teachers = ([camel(r) for r in await con.fetch('SELECT id,name FROM users WHERE id=ANY($1::uuid[])',teacher_ids)]
                if teacher_ids else [])
    # Recording cards don't render material blocks: avoid 20 extra queries per page.
    return {'past':past,'pastPagination':pagination,'attendance':attendance,'teachers':teachers,'materials':{}}


async def load_recording_archive_page(con, user, *, before=None):
    """Called by the authenticated archive API; uses the exact hub access rules."""
    course = await con.fetchval("SELECT id FROM courses WHERE slug='ielts'")
    _archive_cursor(before)  # reject malformed input even when no course exists
    if not course:
        return {'past':[],'pastPagination':{'hasMore':False,'nextCursor':None},
                'attendance':[],'teachers':[],'materials':{}}
    from .live_classes_port import has_extended_live_schema
    return await _archive_page_payload(con, user, course, extended=await has_extended_live_schema(con), before=before)


async def live_classes(con, uid, user=None):
    from .live_classes_port import can_user_access_class, has_extended_live_schema
    course = await con.fetchval("SELECT id FROM courses WHERE slug='ielts'")
    upcoming, live_now = [], []
    actor = user or {'id':uid,'role':'student','account_status':'active'}
    extended = await has_extended_live_schema(con)
    archive = {'past':[],'pastPagination':{'hasMore':False,'nextCursor':None},
               'attendance':[],'teachers':[],'materials':{}}
    if course:
        if extended:
            columns = ('id,course_id,title,topic,description,status,recording_status,scheduled_at,started_at,ended_at,'
                       'duration_minutes,recording_duration_seconds,teacher_user_id,meeting_url,recording_url,'
                       'youtube_video_id,access_scope')
            raw_up = await con.fetch(
                f"SELECT {columns} FROM live_classes WHERE course_id=$1 AND status IN ('upcoming','live') "
                "ORDER BY CASE WHEN status='live' THEN 0 ELSE 1 END, scheduled_at", course)
        else:
            columns = 'id,course_id,title,topic,status,scheduled_at,duration_minutes,teacher_user_id,meeting_url,recording_url'
            raw_up = await con.fetch(
                f"SELECT {columns} FROM live_classes WHERE course_id=$1 AND status IN ('upcoming','live') ORDER BY scheduled_at",course)
        upcoming = [_hub_class(dict(r),actor,extended=extended) for r in raw_up
                    if await can_user_access_class(con,actor,dict(r))]
        live_now = [c for c in upcoming if c.get('status')=='live']
        archive = await _archive_page_payload(con,actor,course,extended=extended)
    past = archive['past']
    ids = [r['id'] for r in upcoming]
    attendance = archive['attendance'] + ([camel(r) for r in await con.fetch(
        'SELECT live_class_id,joined_at FROM live_class_attendance WHERE user_id=$1 AND live_class_id=ANY($2::uuid[])',
        uid,ids)] if ids else [])
    teacher_ids = list({r['teacherUserId'] for r in upcoming if r.get('teacherUserId')})
    existing_teachers = {r['id'] for r in archive['teachers']}
    new_teachers = ([camel(r) for r in await con.fetch(
        'SELECT id,name FROM users WHERE id=ANY($1::uuid[])', [i for i in teacher_ids if i not in existing_teachers])]
        if any(i not in existing_teachers for i in teacher_ids) else [])
    materials = {**archive['materials'], **{id: await material_blocks(con,'live_class',id) for id in ids}}
    return {
        'courseAvailable':bool(course),
        'liveNow':live_now,
        'upcoming':upcoming,
        'past':past,
        'pastPagination':archive['pastPagination'],
        'previousRecordings':[c for c in past if c.get('lifecycleStatus')=='recording_ready'
                              and (c.get('youtubeVideoId') or c.get('recordingUrl'))],
        'attendance':attendance,
        'teachers':archive['teachers']+new_teachers,
        'materials':materials,
        'metadataUnavailable':False,
    }


async def read(req, user, path, q, region):
    db = await core.pool()
    uid = user['id']
    async with db.acquire() as con:
        if path == '/app/reports':
            from .browser_staff_people import reporter
            return await reporter(con,user,q)
        if path in ('/app','/app/dashboard'):
            if region=='mock': return {'mock':await mocks(con,uid)}
            if region == 'openLessons':
                from .browser_curriculum import roadmap as load_roadmap
                roadmap = await load_roadmap(con,user)
                rows = [{'id': l['id'], 'title': l['title'], 'moduleTitle': m['title'], 'unitTitle': u['title'], 'state': l['state']}
                        for m in (roadmap or {}).get('modules', []) for u in m['units'] for l in u['lessons'] if l['state'] in ('available','assigned','in_progress')]
                return {'openLessonsResult': {'ok': True, 'lessons': rows[:4]}}
            if region != 'dashboard':
                raise HTTPException(400, 'invalid_region')
            return {'dashboard': await dashboard(req, con, uid)}
        if path == '/app/mocks':
            return {'mock': await mocks(con, uid)} if region == 'mock' else await mocks(con, uid)
        if path == '/app/progress':
            if region == 'progressSummary':
                return {region: await summary(con, uid)}
            if region == 'progressStreak':
                return {region: {'streak': await streak(con, uid)}}
            if region == 'progressMocks':
                return {region: await mocks(con, uid)}
            if region == 'progressTrends':
                from .browser_trends import trends
                return {region: await trends(con, uid)}
            raise HTTPException(400, 'invalid_region')
        if path == '/app/assignments' and region == 'assignmentDetails':
            rows = await con.fetch('''SELECT a.id,r.content,e.verdict FROM assignment_targets t
              JOIN assignments a ON a.id=t.assignment_id
              LEFT JOIN assignment_responses r ON r.assignment_id=a.id AND r.user_id=t.student_user_id
              LEFT JOIN evaluations e ON e.source_type='assignment' AND e.source_id=a.id AND e.user_id=t.student_user_id
              WHERE t.student_user_id=$1 ORDER BY a.created_at DESC LIMIT 500''', uid)
            return {region: [{'assignmentId': str(r['id']), 'response': r['content'], 'evaluation': {'checkedByName': 'RIWI', 'verdict': r['verdict']} if r['verdict'] is not None else None, 'materials': await material_blocks(con, 'assignment', r['id'])} for r in rows]}
        if path == '/app/coach' and region == 'coach':
            from .browser_coach import coach
            return {region: await coach(con, uid)}
        if path == '/app/live-classes':
            return await live_classes(con, uid, user=user)
        if path.startswith('/app/live-classes/'):
            from .live_classes_port import load_single_live_class_view
            class_id = path.split('/')[-1]
            detail, err_code, status_code = await load_single_live_class_view(req, con, user, class_id)
            if err_code:
                raise HTTPException(status_code, err_code)
            return detail
    raise HTTPException(400, 'invalid_region')
