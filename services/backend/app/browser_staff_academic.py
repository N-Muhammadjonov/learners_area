"""Role-scoped staff monitoring built from persisted learning and assignment records.

Teachers are always constrained by teacher_student_links; Owners may see the
centre. This module intentionally does not treat presence duration as study time.
"""
from __future__ import annotations

import math
import re
from datetime import date, datetime, timezone
from fastapi import HTTPException

from . import main as core
from .browser_common import camel, identifier, number
from .browser_reading import re_escape_like
from .browser_staff_people import student

PAGE_SIZE = 25
MODULES = ('reading','listening','writing','speaking','retention','vocabulary','grammar','video','lessons','mocks','ted','lesson')
STATUSES = ('not_started','in_progress','completed','overdue')
ASSIGNMENT_ROWS = """
 SELECT a.id,a.title,a.description,a.instructions,a.module,a.content_type,a.source_ref,
   a.content_version_id,a.related_writing_prompt_id,t.student_user_id AS user_id,
   COALESCE(t.status,a.status)::text AS status,COALESCE(t.due_at,a.due_at) AS due_at,
   CASE WHEN t.status='completed' THEN COALESCE(t.completed_at,a.updated_at) END AS completed_at,
   a.created_at,a.created_by_user_id
 FROM assignments a JOIN assignment_targets t ON t.assignment_id=a.id
 UNION ALL
 SELECT a.id,a.title,a.description,a.instructions,a.module,a.content_type,a.source_ref,
   a.content_version_id,a.related_writing_prompt_id,a.target_user_id AS user_id,
   a.status::text AS status,a.due_at,
   CASE WHEN a.status='completed' THEN a.updated_at END AS completed_at,
   a.created_at,a.created_by_user_id
 FROM assignments a WHERE a.target_user_id IS NOT NULL
   AND NOT EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id)
"""
STATE_SQL = "CASE WHEN status='completed' OR completed_at IS NOT NULL THEN 'completed' WHEN status='overdue' OR due_at<now() THEN 'overdue' WHEN status='in_progress' THEN 'in_progress' ELSE 'not_started' END"


def _scope(user, alias='u'):
    if user['role']=='owner': return f"{alias}.account_status='active'", []
    if user['role']!='teacher': raise HTTPException(403,'forbidden')
    return f"{alias}.account_status='active' AND EXISTS(SELECT 1 FROM teacher_student_links l WHERE l.teacher_user_id=$1 AND l.student_user_id={alias}.id)", [user['id']]


def _date_filter(value, field):
    if not value: return None
    if not re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): raise HTTPException(400,'invalid_filter')
    try: return date.fromisoformat(value)
    except ValueError: raise HTTPException(400,'invalid_filter')


def _state(status, due_at, completed_at):
    if status=='completed' or completed_at is not None: return 'completed'
    if status=='overdue' or due_at is not None and due_at < datetime.now(timezone.utc): return 'overdue'
    if status=='in_progress': return 'in_progress'
    return 'not_started'


def _submission_scope(user, alias='u'):
    if user['role']=='owner': return f"{alias}.account_status='active'", []
    if user['role']!='teacher': raise HTTPException(403,'forbidden')
    return f"{alias}.account_status='active' AND EXISTS(SELECT 1 FROM teacher_student_links l WHERE l.teacher_user_id=$1 AND l.student_user_id={alias}.id)", [user['id']]


async def _action_queue(con,user):
    scope,base_args=_scope(user,'u')
    review_where=f"s.status IN ('submitted','evaluated') AND s.submitted_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM writing_feedback f WHERE f.submission_id=s.id AND f.source='teacher') AND {scope}"
    pending=await con.fetchval(f"""SELECT count(*)::int FROM writing_submissions s JOIN users u ON u.id=s.user_id AND u.role='student' WHERE {review_where}""",*base_args)
    review_rows=await con.fetch(f"""SELECT s.id,s.user_id AS student_id,u.name AS student_name,p.category,
      left(p.prompt,180) AS title,s.status,s.submitted_at
      FROM writing_submissions s JOIN users u ON u.id=s.user_id AND u.role='student'
      JOIN writing_prompts p ON p.id=s.prompt_id WHERE {review_where}
      ORDER BY s.submitted_at DESC,s.id DESC LIMIT 8""",*base_args)
    recent_where=f"s.status IN ('submitted','evaluated') AND s.submitted_at>=now()-interval '7 days' AND {scope}"
    recent_count=await con.fetchval(f"""SELECT count(*)::int FROM writing_submissions s JOIN users u ON u.id=s.user_id AND u.role='student' WHERE {recent_where}""",*base_args)
    recent_rows=await con.fetch(f"""SELECT s.id,s.user_id AS student_id,u.name AS student_name,p.category,
      left(p.prompt,180) AS title,s.status,s.submitted_at
      FROM writing_submissions s JOIN users u ON u.id=s.user_id AND u.role='student'
      JOIN writing_prompts p ON p.id=s.prompt_id WHERE {recent_where}
      ORDER BY s.submitted_at DESC,s.id DESC LIMIT 8""",*base_args)
    assignment_scope,assignment_args=_scope(user,'u')
    overdue_where=f"state='overdue' AND {assignment_scope}"
    overdue_count=await con.fetchval(f"""WITH raw AS ({ASSIGNMENT_ROWS}),rows AS (
      SELECT r.*,({STATE_SQL}) AS state FROM raw r)
      SELECT count(*)::int FROM rows JOIN users u ON u.id=rows.user_id AND u.role='student' WHERE {overdue_where}""",*assignment_args)
    overdue_rows=await con.fetch(f"""WITH raw AS ({ASSIGNMENT_ROWS}),rows AS (
      SELECT r.*,({STATE_SQL}) AS state FROM raw r)
      SELECT rows.id,rows.title,rows.user_id AS student_id,u.name AS student_name,rows.module,rows.due_at,rows.status,rows.completed_at
      FROM rows JOIN users u ON u.id=rows.user_id AND u.role='student' WHERE {overdue_where}
      ORDER BY rows.due_at NULLS FIRST,rows.title,rows.id LIMIT 8""",*assignment_args)
    return {
      'pendingReviews':int(pending or 0),'overdueAssignments':int(overdue_count or 0),
      'recentWritingSubmissions':int(recent_count or 0),
      'reviewItems':[camel(r) for r in review_rows],
      'overdueItems':[camel(r) for r in overdue_rows],
      'recentItems':[camel(r) for r in recent_rows],
    }


async def _roster(con,user,q):
    scope,scope_args=_scope(user,'u')
    page=number(q.get('page'),maximum=100000)
    scoped_count=await con.fetchval(f"SELECT count(*)::int FROM users u WHERE u.role='student' AND {scope}",*scope_args)
    pages=max(1,math.ceil((scoped_count or 0)/PAGE_SIZE));page=min(page,pages)
    rows=await con.fetch(f"""WITH raw AS ({ASSIGNMENT_ROWS}),targets AS (
      SELECT r.*,({STATE_SQL}) AS state FROM raw r)
      SELECT u.id,u.name,u.email,u.onboarding_completed_at,p.created_at AS last_seen_at,
        COALESCE(u.account_status='active' AND p.created_at>now()-interval '90 seconds',FALSE) AS online,
        CASE WHEN (p.payload->>'visitSeconds') ~ '^[0-9]+$' THEN (p.payload->>'visitSeconds')::int END AS current_visit_seconds,
        CASE WHEN (p.payload->>'totalSeconds') ~ '^[0-9]+$' THEN (p.payload->>'totalSeconds')::bigint END AS total_website_seconds,
        count(t.id)::int AS assigned,
        count(t.id) FILTER(WHERE t.state='completed')::int AS completed,
        count(t.id) FILTER(WHERE t.state='in_progress')::int AS in_progress,
        count(t.id) FILTER(WHERE t.state='not_started')::int AS not_started,
        count(t.id) FILTER(WHERE t.state='overdue')::int AS overdue,
        CASE WHEN count(t.id)>0 THEN round(100.0*count(t.id) FILTER(WHERE t.state='completed')/count(t.id),1) END::float8 AS completion_percent
      FROM users u LEFT JOIN activity_events p ON p.id=md5('site-presence:'||u.id::text)::uuid AND p.type='SITE_PRESENCE'
      LEFT JOIN targets t ON t.user_id=u.id
      WHERE u.role='student' AND {scope}
      GROUP BY u.id,u.name,u.email,u.onboarding_completed_at,u.account_status,p.created_at,p.payload
      ORDER BY u.name,u.id LIMIT {PAGE_SIZE} OFFSET {(page-1)*PAGE_SIZE}""",*scope_args)
    action_queue=await _action_queue(con,user)
    students=[]
    for row in rows:
        d=camel(row)
        d['homework']={k:d.pop(k) for k in ('assigned','completed','inProgress','notStarted','overdue','completionPercent')}
        students.append(d)
    return {'students':students,'page':page,'pageSize':PAGE_SIZE,'total':int(scoped_count or 0),'totalPages':pages,
      'actionQueue':action_queue,'scope':'owner' if user['role']=='owner' else 'assigned'}


async def _homework(con,user,q):
    scope,scope_args=_scope(user,'u')
    student_query=(q.get('student') or '').strip()[:100]
    assignment_query=(q.get('assignment') or '').strip()[:100]
    module=(q.get('module') or '').strip()
    status=(q.get('status') or '').strip()
    if module and module not in (*MODULES,'other'): raise HTTPException(400,'invalid_filter')
    if status and status not in STATUSES: raise HTTPException(400,'invalid_filter')
    due_from=_date_filter(q.get('dueFrom',''),'dueFrom');due_to=_date_filter(q.get('dueTo',''),'dueTo')
    if due_from and due_to and due_from>due_to: raise HTTPException(400,'invalid_filter')
    student_page=number(q.get('page'),maximum=100000)
    assignment_page=number(q.get('assignmentPage'),maximum=100000)
    args=list(scope_args)
    scoped_conditions=[f'u.role=\'student\'',scope]
    if student_query:
        args.append('%'+re_escape_like(student_query)+'%');scoped_conditions.append(f'u.name ILIKE ${len(args)}')
    student_cte='scoped_students AS (SELECT u.id,u.name FROM users u WHERE '+' AND '.join(scoped_conditions)+')'
    task_conditions=[]
    if module:
        if module=='other': task_conditions.append('r.module IS NULL')
        else:
            args.append(module);task_conditions.append(f'r.module=${len(args)}')
    if status:
        args.append(status);task_conditions.append(f'r.state=${len(args)}')
    if assignment_query:
        args.append('%'+re_escape_like(assignment_query)+'%');task_conditions.append(f'r.title ILIKE ${len(args)}')
    if due_from:
        args.append(due_from);task_conditions.append(f"(r.due_at AT TIME ZONE 'Asia/Tashkent')::date >= ${len(args)}::date")
    if due_to:
        args.append(due_to);task_conditions.append(f"(r.due_at AT TIME ZONE 'Asia/Tashkent')::date <= ${len(args)}::date")
    task_filter=(' AND '+' AND '.join(task_conditions)) if task_conditions else ''
    base_cte=f"""{student_cte},raw AS ({ASSIGNMENT_ROWS}),state_rows AS (
      SELECT r.*,({STATE_SQL}) AS state FROM raw r),base AS (
      SELECT r.* FROM state_rows r JOIN scoped_students s ON s.id=r.user_id WHERE TRUE{task_filter})"""
    total_students=await con.fetchval(f'WITH {base_cte} SELECT count(*)::int FROM scoped_students',*args)
    student_pages=max(1,math.ceil((total_students or 0)/PAGE_SIZE));student_page=min(student_page,student_pages)
    matrix=await con.fetch(f"""WITH {base_cte}
      SELECT s.id,s.name,count(b.id)::int AS assigned,count(b.id) FILTER(WHERE b.state='completed')::int AS completed,
        count(b.id) FILTER(WHERE b.state='in_progress')::int AS in_progress,
        count(b.id) FILTER(WHERE b.state='not_started')::int AS not_started,
        count(b.id) FILTER(WHERE b.state='overdue')::int AS overdue,
        CASE WHEN count(b.id)>0 THEN round(100.0*count(b.id) FILTER(WHERE b.state='completed')/count(b.id),1) END::float8 AS completion_percent
      FROM scoped_students s LEFT JOIN base b ON b.user_id=s.id GROUP BY s.id,s.name
      ORDER BY s.name,s.id LIMIT {PAGE_SIZE} OFFSET {(student_page-1)*PAGE_SIZE}""",*args)
    summary=await con.fetchrow(f"""WITH {base_cte}
      SELECT count(*)::int AS assigned,count(*) FILTER(WHERE state='completed')::int AS completed,
        count(*) FILTER(WHERE state='in_progress')::int AS in_progress,
        count(*) FILTER(WHERE state='not_started')::int AS not_started,
        count(*) FILTER(WHERE state='overdue')::int AS overdue FROM base""",*args)
    task_total=await con.fetchval(f"WITH {base_cte} SELECT count(*)::int FROM base",*args)
    task_pages=max(1,math.ceil((task_total or 0)/PAGE_SIZE));assignment_page=min(assignment_page,task_pages)
    tasks=await con.fetch(f"""WITH {base_cte}
      SELECT b.id,b.title,b.user_id AS student_id,s.name AS student_name,b.module,b.content_type,b.source_ref,
        b.status,b.state,b.due_at,b.completed_at,b.created_at
      FROM base b JOIN scoped_students s ON s.id=b.user_id
      ORDER BY b.due_at NULLS LAST,b.created_at DESC,b.id
      LIMIT {PAGE_SIZE} OFFSET {(assignment_page-1)*PAGE_SIZE}""",*args)
    return {'scope':'owner' if user['role']=='owner' else 'assigned',
      'filters':{'student':student_query,'assignment':assignment_query,'module':module or None,'status':status or None,
      'dueFrom':due_from.isoformat() if due_from else None,'dueTo':due_to.isoformat() if due_to else None},
      'summary':{'assigned':int(summary['assigned'] or 0),'completed':int(summary['completed'] or 0),
        'inProgress':int(summary['in_progress'] or 0),'notStarted':int(summary['not_started'] or 0),'overdue':int(summary['overdue'] or 0)},
      'completionPercent':round(100.0*int(summary['completed'] or 0)/int(summary['assigned']),1) if summary['assigned'] else None,
      'students':[camel(r) for r in matrix],'studentPage':student_page,'studentPages':student_pages,'totalStudents':int(total_students or 0),
      'assignments':[camel(r) for r in tasks],'assignmentPage':assignment_page,'assignmentPages':task_pages,'totalAssignments':int(task_total or 0)}


async def _assignment_detail(con,user,q):
    sid=identifier(q.get('student'));aid=identifier(q.get('id'))
    person=await student(con,user,sid)
    row=await con.fetchrow("""SELECT a.id,a.title,a.description,a.instructions,a.module,a.content_type,a.source_ref,
      a.content_version_id,a.created_at,a.due_at AS assignment_due_at,a.related_writing_prompt_id,
      COALESCE(t.status,a.status)::text AS status,COALESCE(t.due_at,a.due_at) AS due_at,
      CASE WHEN t.assignment_id IS NULL THEN CASE WHEN a.status='completed' THEN a.updated_at END
        WHEN t.status='completed' THEN COALESCE(t.completed_at,a.updated_at) END AS completed_at
      FROM assignments a LEFT JOIN assignment_targets t ON t.assignment_id=a.id AND t.student_user_id=$2
      WHERE a.id=$1 AND (t.assignment_id IS NOT NULL OR (a.target_user_id=$2 AND NOT EXISTS(
        SELECT 1 FROM assignment_targets tx WHERE tx.assignment_id=a.id)))""",aid,sid)
    if not row: raise HTTPException(404,'not_found')
    state=_state(row['status'],row['due_at'],row['completed_at'])
    response=await con.fetchrow('''SELECT content,created_at,updated_at FROM assignment_responses
      WHERE assignment_id=$1 AND user_id=$2 ORDER BY updated_at DESC,id DESC LIMIT 1''',aid,sid)
    evaluation=await con.fetchrow("""SELECT verdict,overall_estimate,weaknesses,strengths,created_at FROM evaluations
      WHERE source_type='assignment' AND source_id=$1 AND user_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1""",aid,sid)
    return {'student':person,'assignment':{**camel(row),'status':state,
      'response':camel(response) if response else None,'evaluation':camel(evaluation) if evaluation else None}}


async def _weakness_analysis(con,sid):
    def with_accuracy(rows):
        result=[]
        for row in rows:
            d=camel(row);attempts=int(d['attempts'] or 0);correct=int(d['correct'] or 0)
            d['accuracy']=round(100.0*correct/attempts,1) if attempts>=5 else None
            result.append(d)
        return result
    reading=await con.fetch("""SELECT COALESCE(NULLIF(q.type_code,''),q.type::text) AS type,
      count(a.is_correct)::int AS attempts,count(*) FILTER(WHERE a.is_correct IS TRUE)::int AS correct
      FROM reading_attempts r JOIN reading_answers a ON a.attempt_id=r.id JOIN reading_questions q ON q.id=a.question_id
      WHERE r.user_id=$1 AND r.status='completed' GROUP BY COALESCE(NULLIF(q.type_code,''),q.type::text)
      ORDER BY count(a.is_correct) DESC,type LIMIT 20""",sid)
    listening=await con.fetch("""SELECT COALESCE(NULLIF(q.type_code,''),q.type::text) AS type,
      count(a.is_correct)::int AS attempts,count(*) FILTER(WHERE a.is_correct IS TRUE)::int AS correct
      FROM listening_attempts r JOIN listening_answers a ON a.attempt_id=r.id JOIN listening_questions q ON q.id=a.question_id
      WHERE r.user_id=$1 AND r.status='completed' GROUP BY COALESCE(NULLIF(q.type_code,''),q.type::text)
      ORDER BY count(a.is_correct) DESC,type LIMIT 20""",sid)
    grammar=await con.fetch("""SELECT t.title AS topic,a.activity::text AS activity,count(a.is_correct)::int AS attempts,
      count(*) FILTER(WHERE a.is_correct IS TRUE)::int AS correct FROM grammar_attempts a
      JOIN grammar_exercises e ON e.id=a.exercise_id JOIN grammar_topics t ON t.id=e.topic_id
      WHERE a.user_id=$1 GROUP BY t.title,a.activity ORDER BY count(a.is_correct) DESC,t.title,a.activity LIMIT 30""",sid)
    vocabulary_summary=await con.fetchrow("""SELECT count(*) FILTER(WHERE mastered_at IS NULL AND next_review_at<=now())::int AS due_count,
      count(*) FILTER(WHERE mastered_at IS NOT NULL)::int AS mastered_count,
      count(*)::int AS tracked_count FROM user_vocabulary WHERE user_id=$1""",sid)
    vocabulary=await con.fetch("""SELECT l.term,v.incorrect_count,v.correct_count,v.mastery,v.next_review_at,v.last_reviewed_at
      FROM user_vocabulary v JOIN lexemes l ON l.id=v.lexeme_id WHERE v.user_id=$1 AND v.incorrect_count>=2
      ORDER BY v.incorrect_count DESC,v.last_reviewed_at DESC NULLS LAST,l.term LIMIT 10""",sid)
    return {'questionTypes':{'reading':with_accuracy(reading),'listening':with_accuracy(listening)},
      'grammar':[camel(r) for r in grammar],
      'vocabulary':{'dueCount':int(vocabulary_summary['due_count'] or 0),'masteredCount':int(vocabulary_summary['mastered_count'] or 0),
        'trackedCount':int(vocabulary_summary['tracked_count'] or 0),'repeated':[camel(r) for r in vocabulary]}}


async def _assessment(con,user,q):
    sid=identifier(q.get('student'));attempt_id=identifier(q.get('id'));module=q.get('module')
    if module not in ('reading','listening','speaking','mocks'): raise HTTPException(400,'invalid_module')
    person=await student(con,user,sid)
    if module=='speaking':
        row=await con.fetchrow('''SELECT a.id,a.status,a.started_at,a.submitted_at,a.part,a.transcript,
          a.transcript_origin,p.topic,p.prompt_text AS prompt_text,p.cue_card,
          a.recording_object_key,e.id AS evaluation_id,e.overall_estimate,e.confidence,e.verdict,
          e.strengths,e.weaknesses,e.created_at AS evaluation_created_at
          FROM speaking_attempts a LEFT JOIN speaking_prompts p ON p.id=a.prompt_id
          LEFT JOIN LATERAL (SELECT id,overall_estimate,confidence,verdict,strengths,weaknesses,created_at
            FROM evaluations WHERE user_id=a.user_id AND source_type='speaking_attempt' AND source_id=a.id
            ORDER BY created_at DESC,id DESC LIMIT 1) e ON TRUE
          WHERE a.id=$1 AND a.user_id=$2''',attempt_id,sid)
        if not row: raise HTTPException(404,'not_found')
        speaking={'part':row['part'],'topic':row['topic'],'prompt':row['prompt_text'],'cueCard':row['cue_card'],
          'transcript':row['transcript'],'transcriptOrigin':row['transcript_origin'],
          'recordingUrl':f"/api/resources/{row['recording_object_key']}" if row['recording_object_key'] else None,
          'evaluation':None if not row['evaluation_id'] else {'overallEstimate':row['overall_estimate'],
            'confidence':row['confidence'],'verdict':row['verdict'],'strengths':row['strengths'] or [],
            'weaknesses':row['weaknesses'] or [],'createdAt':row['evaluation_created_at']}}
        attempt={'id':str(row['id']),'status':row['status'],'startedAt':row['started_at'],
          'submittedAt':row['submitted_at'],'score':None,'totalQuestions':None,'rawScore':None,
          'estimatedBand':speaking['evaluation']['overallEstimate'] if speaking['evaluation'] else None}
        return {'student':person,'module':module,'title':row['topic'] or row['prompt_text'],'attempt':attempt,
          'questions':[],'answerKeyAvailable':False,'speaking':speaking,'sectionResults':[]}
    if module=='mocks':
        row=await con.fetchrow('''SELECT a.id,a.status,a.started_at,a.finished_at AS submitted_at,a.raw_score,
          a.estimated_band,a.section_results,COALESCE(t.title,a.mock_snapshot->>'title') AS title
          FROM mock_attempts a LEFT JOIN mock_tests t ON t.id=a.mock_test_id
          WHERE a.id=$1 AND a.user_id=$2''',attempt_id,sid)
        if not row: raise HTTPException(404,'not_found')
        attempt={'id':str(row['id']),'status':row['status'],'startedAt':row['started_at'],
          'submittedAt':row['submitted_at'],'score':None,'totalQuestions':None,
          'rawScore':row['raw_score'],'estimatedBand':row['estimated_band']}
        sections=row['section_results'] if isinstance(row['section_results'],list) else []
        return {'student':person,'module':module,'title':row['title'],'attempt':attempt,
          'questions':[],'answerKeyAvailable':False,'speaking':None,'sectionResults':sections}
    if module=='reading':
        row=await con.fetchrow("""SELECT a.id,a.status,a.started_at,a.submitted_at,a.score,a.total_questions,p.title
          FROM reading_attempts a LEFT JOIN reading_passages p ON p.id=a.passage_id WHERE a.id=$1 AND a.user_id=$2""",attempt_id,sid)
        if not row: raise HTTPException(404,'not_found')
        if row['status']!='completed':
            return {'student':person,'module':module,'title':row['title'],'attempt':camel(row),'questions':[],'answerKeyAvailable':False}
        from .browser_reading import attempt as reading_attempt
        value=(await reading_attempt(con,sid,attempt_id))['detail']
        answers={str(a['questionId']):a for a in value['answers']}
        questions=[]
        for qrow in value['questions']:
            answer=answers.get(str(qrow['id']),{})
            questions.append({'id':qrow['id'],'number':qrow.get('questionNo') or qrow.get('order'),
              'type':qrow.get('typeCode') or qrow.get('type'),'prompt':qrow.get('questionText') or '',
              'studentAnswer':answer.get('userAnswer'),'correctAnswer':qrow.get('correctAnswer'),
              'isCorrect':answer.get('isCorrect'),'explanation':qrow.get('explanation')})
        return {'student':person,'module':module,'title':value['passage'].get('title') or row['title'],
          'attempt':camel(row),'questions':questions,'answerKeyAvailable':True}
    row=await con.fetchrow("""SELECT a.id,a.status,a.started_at,a.submitted_at,a.score,a.total_questions,t.title
      FROM listening_attempts a LEFT JOIN listening_tests t ON t.id=a.test_id WHERE a.id=$1 AND a.user_id=$2""",attempt_id,sid)
    if not row: raise HTTPException(404,'not_found')
    if row['status']!='completed':
        return {'student':person,'module':module,'title':row['title'],'attempt':camel(row),'questions':[],'answerKeyAvailable':False}
    from .browser_listening_exercise import attempt_view
    reviewed=await attempt_view(con,{'id':sid,'role':user['role']},attempt_id,True)
    detail=reviewed.get('revision') or (reviewed.get('section') if reviewed.get('kind')=='section' else None)
    if not detail: raise HTTPException(404,'not_found')
    answers={str(a['questionId']):a for a in detail.get('answers',[])}
    questions=[]
    for qrow in detail.get('questions',[]):
        answer=answers.get(str(qrow.get('id')),{})
        questions.append({'id':qrow.get('id'),'number':qrow.get('order') or qrow.get('number'),
          'type':qrow.get('typeCode') or qrow.get('type'),'prompt':qrow.get('questionText') or qrow.get('text') or '',
          'studentAnswer':answer.get('userAnswer'),'correctAnswer':qrow.get('correctAnswer'),
          'isCorrect':answer.get('isCorrect'),'explanation':qrow.get('explanation')})
    return {'student':person,'module':module,'title':detail.get('test',{}).get('title') or row['title'],
      'attempt':camel(row),'questions':questions,'answerKeyAvailable':True}


async def read(req,user,kind,q):
    if user.get('role') not in ('teacher','owner'): raise HTTPException(403,'forbidden')
    db=await core.pool()
    async with db.acquire() as con:
        if kind=='teacher-students': return await _roster(con,user,q)
        if kind=='teacher-homework': return await _homework(con,user,q)
        if kind=='teacher-actions': return await _action_queue(con,user)
        if kind=='teacher-assignment': return await _assignment_detail(con,user,q)
        if kind=='teacher-assessment': return await _assessment(con,user,q)
        if kind=='teacher-student':
            sid=identifier(q.get('id'))
            from .browser_staff_people import teacher_student_detail
            detail=await teacher_student_detail(con,req,user,sid,q)
            detail['weaknesses']=await _weakness_analysis(con,sid)
            return detail
    raise HTTPException(404,'not_found')
