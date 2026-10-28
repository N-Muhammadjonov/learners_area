"""Bounded administrative learning statistics, aggregated in PostgreSQL."""
import math
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo
from fastapi import HTTPException
from . import main as core
from .browser_common import camel, identifier, number
from .browser_reading import re_escape_like
from .browser_staff_people import student

MODULES = ('reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks')
# Explicit, record-based definitions: no profile band or acoustic score is used.
# The same relation feeds summaries, student rankings, calendar and history.
RELATION = """
 SELECT a.id,a.user_id,'reading'::text module,'attempt'::text activity,a.started_at AS at,a.status='completed' completed,
   a.score::float8 score,a.total_questions::float8 maximum,'questions'::text unit,p.title::text title FROM reading_attempts a LEFT JOIN reading_passages p ON p.id=a.passage_id
 UNION ALL SELECT a.id,a.user_id,'listening','attempt',a.started_at,a.status='completed',a.score::float8,a.total_questions::float8,'questions',p.title FROM listening_attempts a LEFT JOIN listening_tests p ON p.id=a.test_id
 UNION ALL SELECT a.id,a.user_id,'writing','submission',COALESCE(a.submitted_at,a.updated_at),a.status<>'draft',e.overall_estimate::float8,9::float8,'band',left(p.prompt,300) FROM writing_submissions a LEFT JOIN writing_prompts p ON p.id=a.prompt_id LEFT JOIN evaluations e ON e.source_type='writing_submission' AND e.source_id=a.id AND e.user_id=a.user_id
 UNION ALL SELECT a.id,a.user_id,'speaking','attempt',a.started_at,a.status<>'recording',e.overall_estimate::float8,9::float8,'band',left(p.prompt_text,300) FROM speaking_attempts a LEFT JOIN speaking_prompts p ON p.id=a.prompt_id LEFT JOIN evaluations e ON e.source_type='speaking_attempt' AND e.source_id=a.id AND e.user_id=a.user_id
 UNION ALL SELECT a.id,a.user_id,'retention','recall',a.created_at,a.status IN ('completed','timed_out'),a.score::float8,100::float8,'points',a.retention_label_snapshot FROM retention_attempts a
 UNION ALL SELECT a.id,a.user_id,'vocabulary','word',a.created_at,a.mastered_at IS NOT NULL,NULL::float8,NULL::float8,'',l.term FROM user_vocabulary a LEFT JOIN lexemes l ON l.id=a.lexeme_id
 UNION ALL SELECT a.id,a.user_id,'grammar',a.activity::text,a.attempted_at,TRUE,CASE WHEN a.is_correct THEN 1 ELSE 0 END::float8,1::float8,'questions',t.title FROM grammar_attempts a LEFT JOIN grammar_exercises e ON e.id=a.exercise_id LEFT JOIN grammar_topics t ON t.id=e.topic_id
 UNION ALL SELECT a.id,a.user_id,'video','lesson',a.updated_at,a.state='completed',NULL::float8,NULL::float8,'',v.title FROM video_lesson_progress a LEFT JOIN video_lessons v ON v.id=a.video_lesson_id
 UNION ALL SELECT a.id,a.user_id,'lessons','lesson',a.updated_at,a.state='completed',NULL::float8,NULL::float8,'',l.title FROM lesson_progress a LEFT JOIN lessons l ON l.id=a.lesson_id
 UNION ALL SELECT a.id,a.user_id,'mocks','mock',a.started_at,a.finished_at IS NOT NULL,a.estimated_band::float8,9::float8,'band',COALESCE(t.title,a.mock_snapshot->>'title') FROM mock_attempts a LEFT JOIN mock_tests t ON t.id=a.mock_test_id
"""


async def summary(con, uid=None):
    # Centre-wide summaries are student-only; staff accounts must not be mixed into
    # academic performance even if they have test records of their own.
    where = 'WHERE user_id=$1' if uid else "WHERE user_id IN (SELECT id FROM users WHERE role='student')"
    rows = await con.fetch(f'''WITH r AS ({RELATION}) SELECT module,count(*)::int started,
      count(*) FILTER(WHERE completed)::int completed,count(DISTINCT user_id)::int learners,
      100.0*sum(score) FILTER(WHERE completed AND unit<>'band')/NULLIF(sum(maximum) FILTER(WHERE completed AND unit<>'band'),0) accuracy,
      avg(score) FILTER(WHERE completed AND unit='band') band,max(at) latest FROM r {where} GROUP BY module''',*([uid] if uid else []))
    by = {r['module']:camel(r) for r in rows}
    if uid:
        from .fair_scores import averages
        fair=await averages(con,uid)
        for module,value in fair.items():
            if module in by:
                by[module]['band']=value['band']
                if value['accuracy'] is not None:by[module]['accuracy']=value['accuracy']
    return [by.get(module,{'module':module,'started':0,'completed':0,'learners':0,'accuracy':None,'band':None,'latest':None}) for module in MODULES]


ASSIGNMENT_ROWS = """
 SELECT a.id,a.title,a.module,t.student_user_id AS user_id,
   COALESCE(t.status,a.status)::text AS status,
   COALESCE(t.due_at,a.due_at) AS due_at,
   CASE WHEN t.status='completed' THEN COALESCE(t.completed_at,a.updated_at) END AS completed_at,
   a.created_at
 FROM assignments a JOIN assignment_targets t ON t.assignment_id=a.id
 UNION ALL
 SELECT a.id,a.title,a.module,a.target_user_id AS user_id,a.status::text AS status,a.due_at,
   CASE WHEN a.status='completed' THEN a.updated_at END AS completed_at,a.created_at
 FROM assignments a WHERE a.target_user_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id)
"""
ASSIGNMENT_STATE = "CASE WHEN status='completed' OR completed_at IS NOT NULL THEN 'completed' WHEN status='overdue' OR due_at<now() THEN 'overdue' WHEN status='in_progress' THEN 'in_progress' ELSE 'not_started' END"


def _owner_filter_values(query):
    today=datetime.now(ZoneInfo('Asia/Tashkent')).date()
    raw_from=(query.get('from') or '').strip()
    raw_to=(query.get('to') or '').strip()
    try:
        selected_from=date.fromisoformat(raw_from) if raw_from else None
        selected_to=date.fromisoformat(raw_to) if raw_to else None
        if (raw_from and selected_from.isoformat()!=raw_from) or (raw_to and selected_to.isoformat()!=raw_to):
            raise ValueError()
    except ValueError:
        raise HTTPException(400,'invalid_filter')
    explicit=bool(selected_from or selected_to)
    start=selected_from or (selected_to-timedelta(days=6) if selected_to else today-timedelta(days=6))
    end=selected_to or today
    if start>end or start>today or end>today or (end-start).days>89:
        raise HTTPException(400,'invalid_filter')
    module=(query.get('module') or '').strip()
    if module and module not in MODULES:
        raise HTTPException(400,'invalid_filter')
    return {
        'from':raw_from or None,'to':raw_to or None,
        'student':(query.get('student') or '').strip()[:100],
        'teacher':(query.get('teacher') or '').strip()[:100],
        'module':module or None,'explicitRange':explicit,
        'rangeStart':start,'rangeEnd':end,
    }


def _owner_people_where(args, alias, filters):
    conditions=[f"{alias}.role='student'"]
    student=filters['student']
    if student:
        args.append('%'+re_escape_like(student)+'%');slot=f'${len(args)}'
        conditions.append(f"({alias}.name ILIKE {slot} OR COALESCE({alias}.email,'') ILIKE {slot} OR {alias}.id::text ILIKE {slot})")
    teacher=filters['teacher']
    if teacher:
        args.append('%'+re_escape_like(teacher)+'%');slot=f'${len(args)}'
        conditions.append(f"EXISTS(SELECT 1 FROM teacher_student_links l JOIN users t ON t.id=l.teacher_user_id AND t.role='teacher' WHERE l.student_user_id={alias}.id AND (t.name ILIKE {slot} OR COALESCE(t.email,'') ILIKE {slot} OR t.id::text ILIKE {slot}))")
    return ' AND '.join(conditions)


def _owner_time_where(args, column, filters):
    if not filters['explicitRange']: return None
    args.extend((filters['rangeStart'],filters['rangeEnd']))
    start,end=len(args)-1,len(args)
    return f"{column} >= (${start}::date::timestamp AT TIME ZONE 'Asia/Tashkent') AND {column} < (${end}::date + 1)::timestamp AT TIME ZONE 'Asia/Tashkent'"


def _owner_module_where(args, column, filters):
    if not filters['module']: return None
    args.append(filters['module'])
    return f'{column}=${len(args)}'


async def owner_academic_overview(con, query=None):
    '''Recorded metrics only. Search filters use names/email; no group model is implied.'''
    filters=_owner_filter_values(query or {})
    writing_visible=filters['module'] in (None,'writing')
    presence=await con.fetchrow('''SELECT count(*) FILTER(WHERE u.account_status='active')::int AS active_students,
      count(*) FILTER(WHERE u.account_status='active' AND p.created_at>now()-interval '90 seconds')::int AS online_students
      FROM users u LEFT JOIN activity_events p ON p.id=md5('site-presence:'||u.id::text)::uuid AND p.type='SITE_PRESENCE'
      WHERE u.role='student' ''')

    # Activity/chart defaults to the last seven centre-local dates; explicit dates
    # also constrain historical learning, assignment and Writing records.
    args=[];people=_owner_people_where(args,'u',filters);conditions=[people]
    if module_condition:=_owner_module_where(args,'r.module',filters):conditions.append(module_condition)
    activity_range={**filters,'explicitRange':True}
    if time_condition:=_owner_time_where(args,'r.at',activity_range):conditions.append(time_condition)
    activity=await con.fetchrow(f'''WITH r AS ({RELATION})
      SELECT count(*)::int AS records,count(DISTINCT r.user_id)::int AS students
      FROM r JOIN users u ON u.id=r.user_id WHERE {' AND '.join(conditions)}''',*args)

    # Keep every canonical module in the strict UI DTO; unselected modules are
    # genuinely zero for a selected module filter.
    args=[];people=_owner_people_where(args,'u',filters);conditions=[people]
    if module_condition:=_owner_module_where(args,'r.module',filters):conditions.append(module_condition)
    if time_condition:=_owner_time_where(args,'r.at',filters):conditions.append(time_condition)
    summary_rows=await con.fetch(f'''WITH r AS ({RELATION}) SELECT r.module,count(*)::int started,
      count(*) FILTER(WHERE r.completed)::int completed,count(DISTINCT r.user_id)::int learners,
      100.0*sum(r.score) FILTER(WHERE r.completed AND r.unit<>'band')/NULLIF(sum(r.maximum) FILTER(WHERE r.completed AND r.unit<>'band'),0) accuracy,
      avg(r.score) FILTER(WHERE r.completed AND r.unit='band') band,max(r.at) latest
      FROM r JOIN users u ON u.id=r.user_id WHERE {' AND '.join(conditions)} GROUP BY r.module''',*args)
    summary_by={r['module']:camel(r) for r in summary_rows}
    module_summary=[summary_by.get(module,{'module':module,'started':0,'completed':0,'learners':0,'accuracy':None,'band':None,'latest':None}) for module in MODULES]

    args=[];people=_owner_people_where(args,'u',filters);homework_conditions=[people]
    if module_condition:=_owner_module_where(args,'r.module',filters):homework_conditions.append(module_condition)
    if time_condition:=_owner_time_where(args,'r.created_at',filters):homework_conditions.append(time_condition)
    homework=await con.fetchrow(f'''WITH raw AS ({ASSIGNMENT_ROWS}),rows AS (
        SELECT r.*,({ASSIGNMENT_STATE}) AS state FROM raw r JOIN users u ON u.id=r.user_id
        WHERE {' AND '.join(homework_conditions)})
      SELECT count(*)::int AS assigned,count(*) FILTER(WHERE state='completed')::int AS completed,
        count(*) FILTER(WHERE state='in_progress')::int AS in_progress,
        count(*) FILTER(WHERE state='overdue')::int AS overdue,
        count(*) FILTER(WHERE state='not_started')::int AS not_started FROM rows''',*args)

    pending=0;writing_count=0
    if writing_visible:
        args=[];people=_owner_people_where(args,'u',filters);conditions=[people]
        if time_condition:=_owner_time_where(args,'s.submitted_at',filters):conditions.append(time_condition)
        pending=await con.fetchval(f'''SELECT count(*)::int FROM writing_submissions s
          JOIN users u ON u.id=s.user_id WHERE {' AND '.join(conditions)}
          AND s.status IN ('submitted','evaluated') AND s.submitted_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM writing_feedback f WHERE f.submission_id=s.id AND f.source='teacher')''',*args)
        args=[];people=_owner_people_where(args,'u',filters);conditions=[people,"s.status IN ('submitted','evaluated')","s.submitted_at IS NOT NULL"]
        if time_condition:=_owner_time_where(args,'s.submitted_at',filters):conditions.append(time_condition)
        else:conditions.append("s.submitted_at>=now()-interval '7 days'")
        writing_count=await con.fetchval(f'''SELECT count(*)::int FROM writing_submissions s
          JOIN users u ON u.id=s.user_id WHERE {' AND '.join(conditions)}''',*args)

    # One centre-local daily record for each selected date (maximum 90 days).
    args=[filters['rangeStart'],filters['rangeEnd']]
    people=_owner_people_where(args,'u',filters);module_condition=_owner_module_where(args,'r.module',filters)
    daily_join=["(r.at AT TIME ZONE 'Asia/Tashkent')::date=days.d::date",
        f"EXISTS(SELECT 1 FROM users u WHERE u.id=r.user_id AND {people})"]
    if module_condition:daily_join.append(module_condition)
    daily=await con.fetch(f'''WITH r AS ({RELATION}),days AS (SELECT generate_series($1::date,$2::date,interval '1 day') AS d)
      SELECT to_char(days.d,'YYYY-MM-DD') AS day_key,count(r.id)::int AS count
      FROM days LEFT JOIN r ON {' AND '.join(daily_join)}
      GROUP BY days.d ORDER BY days.d''',*args)

    # Current attention is based on overdue persisted targets and unreviewed
    # submitted Writing rows, not presence or inferred assignment completion.
    args=[];people=_owner_people_where(args,'u',filters);overdue_conditions=[people]
    if module_condition:=_owner_module_where(args,'ar.module',filters):overdue_conditions.append(module_condition)
    if time_condition:=_owner_time_where(args,'ar.created_at',filters):overdue_conditions.append(time_condition)
    if writing_visible:
        people_pending=_owner_people_where(args,'u',filters);pending_conditions=[people_pending]
        if time_condition:=_owner_time_where(args,'s.submitted_at',filters):pending_conditions.append(time_condition)
        pending_sql=f'''SELECT s.user_id,count(*)::int AS count FROM writing_submissions s
          JOIN users u ON u.id=s.user_id WHERE {' AND '.join(pending_conditions)}
          AND s.status IN ('submitted','evaluated') AND s.submitted_at IS NOT NULL
          AND NOT EXISTS(SELECT 1 FROM writing_feedback f WHERE f.submission_id=s.id AND f.source='teacher') GROUP BY s.user_id'''
    else:
        pending_sql='SELECT NULL::uuid AS user_id,0::int AS count WHERE FALSE'
    people_activity=_owner_people_where(args,'u',filters);activity_conditions=[people_activity]
    if module_condition:=_owner_module_where(args,'r.module',filters):activity_conditions.append(module_condition)
    if time_condition:=_owner_time_where(args,'r.at',filters):activity_conditions.append(time_condition)
    attention=await con.fetch(f'''WITH raw AS ({ASSIGNMENT_ROWS}),assignment_rows AS (
        SELECT ar.*,({ASSIGNMENT_STATE}) AS state FROM raw ar JOIN users u ON u.id=ar.user_id
        WHERE {' AND '.join(overdue_conditions)}),
      overdue AS (SELECT user_id,count(*)::int AS count FROM assignment_rows WHERE state='overdue' GROUP BY user_id),
      pending AS ({pending_sql}),activity_rows AS ({RELATION}),
      activity AS (SELECT r.user_id,max(r.at) AS last_at FROM activity_rows r JOIN users u ON u.id=r.user_id
        WHERE {' AND '.join(activity_conditions)} GROUP BY r.user_id)
      SELECT u.id,u.name,COALESCE(o.count,0)::int AS overdue,COALESCE(p.count,0)::int AS pending_reviews,
        a.last_at AS last_academic_at FROM users u LEFT JOIN overdue o ON o.user_id=u.id
        LEFT JOIN pending p ON p.user_id=u.id LEFT JOIN activity a ON a.user_id=u.id
      WHERE u.role='student' AND u.account_status='active' AND (COALESCE(o.count,0)>0 OR COALESCE(p.count,0)>0)
      ORDER BY COALESCE(o.count,0) DESC,COALESCE(p.count,0) DESC,a.last_at NULLS FIRST,u.name,u.id LIMIT 12''',*args)
    return {
      'filters':{'from':filters['from'],'to':filters['to'],'student':filters['student'],'teacher':filters['teacher'],'module':filters['module']},
      'activeStudents':int(presence['active_students'] or 0),'onlineStudents':int(presence['online_students'] or 0),
      'activity':{'students':int(activity['students'] or 0),'records':int(activity['records'] or 0)},
      'homework':{'assigned':int(homework['assigned'] or 0),'completed':int(homework['completed'] or 0),
        'inProgress':int(homework['in_progress'] or 0),'overdue':int(homework['overdue'] or 0),'notStarted':int(homework['not_started'] or 0)},
      'completionPercent':round(100.0*int(homework['completed'] or 0)/int(homework['assigned']),1) if homework['assigned'] else None,
      'pendingReviews':int(pending or 0),'writingSubmissions':int(writing_count or 0),
      'daily':[{'day':r['day_key'],'count':r['count']} for r in daily],
      'moduleSummary':module_summary,
      'attention':[camel(r) for r in attention],
    }


async def read(req, user, kind, q):
    if kind=='centre-statistics' and user.get('role')!='owner': raise HTTPException(403,'forbidden')
    if kind=='student-learning' and user.get('role') not in ('teacher','owner'): raise HTTPException(403,'forbidden')
    selected = q.get('module') if q.get('module') in MODULES else None
    db = await core.pool()
    async with db.acquire() as con:
        if kind=='student-learning':
            uid = identifier(q.get('id'));await student(con,user,uid)
            args = [uid];where = 'user_id=$1'
            if selected: args.append(selected);where += ' AND module=$2'
            total = await con.fetchval(f'WITH r AS ({RELATION}) SELECT count(*)::int FROM r WHERE {where}',*args)
            pages = max(1,math.ceil(total/25));page = min(pages,number(q.get('page')))
            rows = await con.fetch(f'WITH r AS ({RELATION}) SELECT id,module,activity,at,completed,CASE WHEN completed THEN score END score,maximum,unit,title FROM r WHERE {where} ORDER BY at DESC,id DESC,module LIMIT 25 OFFSET {(page-1)*25}',*args)
            return {'summary':await summary(con,uid),'history':{'module':selected,'total':total,'pages':pages,'page':page,'rows':[camel(r) for r in rows]}}
        if kind!='centre-statistics': raise HTTPException(404,'not_found')
        args = [selected] if selected else []
        where = 'AND r.module=$1' if selected else ''
        rows = await con.fetch(f'''WITH r AS ({RELATION}) SELECT u.id,u.name,count(*)::int started,
          count(*) FILTER(WHERE r.completed)::int completed,
          100.0*sum(r.score) FILTER(WHERE r.completed AND unit<>'band')/NULLIF(sum(maximum) FILTER(WHERE r.completed AND unit<>'band'),0) accuracy,
          avg(score) FILTER(WHERE r.completed AND unit='band') band FROM r JOIN users u ON u.id=r.user_id
          WHERE u.role='student' {where} GROUP BY u.id,u.name ORDER BY started DESC,u.id LIMIT 100''',*args)
        daily = await con.fetch(f'''WITH r AS ({RELATION}),days AS (SELECT generate_series(
          (now() AT TIME ZONE 'Asia/Tashkent')::date-13,(now() AT TIME ZONE 'Asia/Tashkent')::date,interval '1 day') d)
          SELECT to_char(d.d,'YYYY-MM-DD') day_key,count(r.id)::int count FROM days d
          LEFT JOIN r ON (r.at AT TIME ZONE 'Asia/Tashkent')::date=d.d::date {where}
          GROUP BY d.d ORDER BY d.d''',*args)
        levels = await con.fetch("SELECT level,count(*)::int rounds,avg(score)::float8 average FROM retention_attempts WHERE status IN ('completed','timed_out') GROUP BY level ORDER BY level")
        return {'summary':await summary(con),'selected':selected,'students':[camel(r) for r in rows],'daily':[{'day':r['day_key'],'count':r['count']} for r in daily],'levels':[dict(r) for r in levels]}
