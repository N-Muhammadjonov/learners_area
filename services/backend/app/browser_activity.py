"""Learner summaries derived from owned records, without source answers or keys."""
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, existing, material_blocks


async def streak(con, uid):
    days = {str(r['day']) for r in await con.fetch("SELECT DISTINCT to_char(created_at AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD') AS day FROM activity_events WHERE user_id=$1", uid)}
    day = datetime.now(ZoneInfo('Asia/Tashkent')).date()
    if day.isoformat() not in days:
        day -= timedelta(days=1)
    count = 0
    while day.isoformat() in days:
        count += 1
        day -= timedelta(days=1)
    return count


async def mocks(con, uid):
    from .browser_optional import OptionalReads
    read=OptionalReads()
    tests=await read.read('catalogue',lambda:con.fetch("SELECT t.id,t.title,t.skill FROM mock_tests t JOIN courses c ON c.id=t.course_id WHERE c.slug='ielts' ORDER BY t.title,t.id"))
    rows=await read.read('attempts',lambda:con.fetch('SELECT id,mock_test_id,started_at,finished_at,raw_score,estimated_band,mock_snapshot FROM mock_attempts WHERE user_id=$1 ORDER BY started_at DESC,id DESC',uid))
    ids=list({r['mock_test_id'] for r in rows or [] if r['mock_test_id']})
    titles=await read.read('titles',lambda:con.fetch('SELECT id,title,skill FROM mock_tests WHERE id=ANY($1::uuid[])',ids)) if ids else []
    by={r['id']:r for r in titles or []}
    attempts=[]
    for r in rows or []:
        snapshot=r['mock_snapshot'] or {}
        title=by.get(r['mock_test_id'])
        a=camel({k:r[k] for k in ('id','mock_test_id','started_at','finished_at')})
        a.update(title=title['title'] if title else snapshot.get('title'),skill=title['skill'] if title else snapshot.get('kind') if not r['mock_test_id'] else None,rawScore=r['raw_score'] if r['finished_at'] else None,estimatedBand=r['estimated_band'] if r['finished_at'] else None)
        attempts.append(a)
    return {'tests':[camel(r) for r in tests or []],'attempts':attempts,'finishedCount':sum(bool(r['finishedAt']) for r in attempts),'catalogueUnavailable':'catalogue' in read.failed,'attemptsUnavailable':'attempts' in read.failed,'attemptTitlesUnavailable':'titles' in read.failed}


async def summary(con, uid):
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
    from .step31_coach import decoded, PUBLIC
    from .browser_optional import OptionalReads
    read=OptionalReads()
    profile=await read.read('profile',lambda:con.fetchrow('SELECT target_band FROM onboarding_profiles WHERE user_id=$1',uid))
    evaluation=await read.read('latestEvaluation',lambda:con.fetchrow('SELECT overall_estimate,weaknesses FROM evaluations WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1',uid))
    counts={}
    for skill,table in (('reading','reading_attempts'),('listening','listening_attempts'),('speaking','speaking_attempts'),('writing','writing_submissions')):
        counts[skill]=await read.read(skill+'Attempts',lambda table=table,skill=skill:con.fetchval(f'SELECT count(*)::int FROM {table} WHERE user_id=$1'+(' AND word_count>0' if skill=='writing' else ''),uid))
    upcoming=await read.read('nextLiveClass',lambda:con.fetchrow("SELECT l.id,l.title,l.scheduled_at FROM live_classes l JOIN courses c ON c.id=l.course_id WHERE c.slug='ielts' AND l.status='upcoming' ORDER BY l.scheduled_at LIMIT 1"))
    assignments=await read.read('assignments',lambda:con.fetch("SELECT id,title,status,due_at FROM assignments WHERE target_user_id=$1 AND status<>'completed' ORDER BY due_at",uid))
    due=await read.read('vocabDue',lambda:con.fetchval('SELECT count(*)::int FROM user_vocabulary WHERE user_id=$1 AND next_review_at<=now()',uid))
    active_streak=await read.read('streak',lambda:streak(con,uid))
    async def last_activity():
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
    last=await read.read('lastActivity',last_activity)
    return {'profile':camel(profile),'latestEvaluation':{**camel(evaluation),'weaknesses':decoded(evaluation['weaknesses']),'checkedByName':PUBLIC} if evaluation else None,
      'vocabDueCount':due,'streak':active_streak,'writingAttempts':counts['writing'],'skillCounts':counts,
      'openAssignments':[camel(r) for r in assignments] if assignments is not None else None,'nextLiveClass':camel(upcoming),'lastActivity':last,
      'unavailable':{k:k in read.failed for k in ('profile','latestEvaluation','vocabDue','streak','writingAttempts','readingAttempts','listeningAttempts','speakingAttempts','assignments','nextLiveClass','lastActivity')}}


async def live_classes(con, uid):
    course = await con.fetchval("SELECT id FROM courses WHERE slug='ielts'")
    upcoming, past = [], []
    if course:
        columns = 'id,title,status,scheduled_at,duration_minutes,teacher_user_id,meeting_url,recording_url'
        upcoming = [camel(r) for r in await con.fetch(f"SELECT {columns} FROM live_classes WHERE course_id=$1 AND status IN ('upcoming','live') ORDER BY scheduled_at", course)]
        past = [camel(r) for r in await con.fetch(f"SELECT {columns} FROM live_classes WHERE course_id=$1 AND status IN ('completed','recorded','cancelled') ORDER BY scheduled_at DESC LIMIT 10", course)]
    ids = [r['id'] for r in upcoming + past]
    attendance = [camel(r) for r in await con.fetch('SELECT live_class_id,joined_at FROM live_class_attendance WHERE user_id=$1 AND live_class_id=ANY($2::uuid[])', uid, ids)] if ids else []
    teachers = [camel(r) for r in await con.fetch('SELECT id,name FROM users WHERE id=ANY($1::uuid[])', list({r['teacherUserId'] for r in upcoming + past if r['teacherUserId']}))] if ids else []
    return {'courseAvailable': bool(course), 'upcoming': upcoming, 'past': past, 'attendance': attendance, 'teachers': teachers,
            'materials': {id: await material_blocks(con, 'live_class', id) for id in ids}, 'metadataUnavailable': False}


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
            return await live_classes(con, uid)
    raise HTTPException(400, 'invalid_region')
