"""Idempotent in-app notifications for persisted Learners Area events."""
from __future__ import annotations
import json


async def create_notification(conn, *, user_id, event_id, notification_type, title, body, href, payload=None):
    """Insert once per recipient/event, using the existing notifications API/table."""
    event_id = str(event_id).strip()
    if not event_id:
        raise ValueError('notification_event_id_required')
    values = dict(payload or {})
    values['eventId'] = event_id
    await conn.execute('''INSERT INTO notifications(user_id,type,title,body,href,payload)
        VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING''',
        user_id, notification_type, title, body, href,
        json.dumps(values, separators=(',', ':')))


async def notify_assignment_assigned(conn, *, assignment_id, student_id, title, module=None):
    await create_notification(conn, user_id=student_id,
        event_id=f'assignment:{assignment_id}:assigned:{student_id}',
        notification_type='ASSIGNMENT_ASSIGNED', title='New homework assignment',
        body='A new homework assignment is ready.', href='/app/assignments',
        payload={'assignmentId': str(assignment_id), 'assignmentTitle': str(title)[:200],
                 'module': module})


async def notify_writing_review_required(conn, *, submission_id, student_id):
    """Notify only active Teachers who currently have this learner on their roster."""
    rows = await conn.fetch('''SELECT u.id AS teacher_id, COALESCE(s.name,'A learner') AS student_name
        FROM teacher_student_links l
        JOIN users u ON u.id=l.teacher_user_id AND u.role='teacher' AND u.account_status='active'
        JOIN users s ON s.id=l.student_user_id AND s.role='student'
        WHERE l.student_user_id=$1 ORDER BY u.id''', student_id)
    for row in rows:
        sid, subid = str(student_id), str(submission_id)
        href = f'/app/teacher/students/{sid}?submission={subid}#submission-{subid}'
        await create_notification(conn, user_id=row['teacher_id'],
            event_id=f'writing-review:{submission_id}:teacher:{row["teacher_id"]}',
            notification_type='WRITING_REVIEW_REQUIRED', title='Writing submission needs review',
            body='A learner on your roster submitted a Writing response.', href=href,
            payload={'submissionId': subid, 'studentId': sid,
                     'studentName': row['student_name']})


async def notify_teacher_feedback(conn, *, submission_id, student_id, teacher_id):
    await create_notification(conn, user_id=student_id,
        event_id=f'teacher-feedback:{submission_id}:{teacher_id}',
        notification_type='TEACHER_FEEDBACK_RECEIVED', title='Teacher feedback is available',
        body='Your Writing submission has teacher feedback.', href='/app/writing',
        payload={'submissionId': str(submission_id), 'teacherId': str(teacher_id)})


async def notify_assignment_deadlines(conn, *, student_id):
    """Materialize deadline events through the existing inbox, once per due event.

    Called by the existing notification count/list reads (not a new poller or
    scheduler). The partial due indexes keep this reconciliation bounded; a
    small batch per category prevents a backlog of old assignments from flooding
    the inbox in one request.
    """
    await conn.execute('''WITH assigned AS (
      SELECT a.id,a.title,a.module,COALESCE(t.due_at,a.due_at) AS due_at
      FROM assignments a JOIN assignment_targets t ON t.assignment_id=a.id
      WHERE t.student_user_id=$1 AND t.status<>'completed' AND COALESCE(t.due_at,a.due_at) IS NOT NULL
      UNION ALL
      SELECT a.id,a.title,a.module,a.due_at
      FROM assignments a WHERE a.target_user_id=$1 AND a.due_at IS NOT NULL AND a.status<>'completed'
        AND NOT EXISTS(SELECT 1 FROM assignment_targets t WHERE t.assignment_id=a.id)
    ), due_events AS (
      SELECT id,title,module,due_at,'ASSIGNMENT_OVERDUE'::text AS event_type,
        'assignment:'||id::text||':overdue:'||$1::text AS event_id,0 AS priority
      FROM assigned WHERE due_at<NOW()
      UNION ALL
      SELECT id,title,module,due_at,'ASSIGNMENT_DEADLINE_APPROACHING'::text,
        'assignment:'||id::text||':deadline:'||$1::text||':'||
          to_char(due_at AT TIME ZONE 'UTC','YYYYMMDDHH24MISS'),1
      FROM assigned WHERE due_at>=NOW() AND due_at<NOW()+interval '24 hours'
    ), unseen AS (
      SELECT e.* FROM due_events e WHERE NOT EXISTS(
        SELECT 1 FROM notifications n WHERE n.user_id=$1 AND n.payload->>'eventId'=e.event_id)
    ), overdue_batch AS (
      SELECT * FROM unseen WHERE event_type='ASSIGNMENT_OVERDUE' ORDER BY due_at DESC,id LIMIT 10
    ), approaching_batch AS (
      SELECT * FROM unseen WHERE event_type='ASSIGNMENT_DEADLINE_APPROACHING' ORDER BY due_at,id LIMIT 10
    ), batch AS (SELECT * FROM overdue_batch UNION ALL SELECT * FROM approaching_batch)
    INSERT INTO notifications(user_id,type,title,body,href,payload)
    SELECT $1,event_type,
      CASE event_type WHEN 'ASSIGNMENT_OVERDUE' THEN 'Assignment overdue' ELSE 'Assignment deadline approaching' END,
      CASE event_type WHEN 'ASSIGNMENT_OVERDUE' THEN 'This assigned task is overdue.' ELSE 'An assigned task is due within 24 hours.' END,
      '/app/assignments',jsonb_build_object('eventId',event_id,'assignmentId',id::text,
        'assignmentTitle',left(title,200),'module',module,'dueAt',due_at)
    FROM batch ON CONFLICT DO NOTHING''',student_id)


async def reconcile_staff_notifications(conn, *, user_id, role):
    """Reconcile open admissions and support reports in the existing inbox.

    Owner/admin admission notifications can originate from Telegram and other
    entry points. The read-side reconciliation catches paths that do not call
    create_access_request, without sending duplicates or resurrecting closed
    cases. The user/event unique index preserves read state on later polls.
    """
    if role not in ('owner', 'admin'):
        return
    await conn.execute("""
      UPDATE notifications n SET read_at=NOW()
      WHERE n.user_id=$1 AND n.type='ACCESS_REQUESTED'
        AND n.read_at IS NULL
        AND (
          EXISTS (SELECT 1 FROM access_requests r
            WHERE r.id::text=n.payload->>'requestId'
              AND r.status<>'pending')
          OR EXISTS (SELECT 1 FROM users u
            WHERE u.id::text=n.payload->>'applicantId'
              AND u.account_status<>'pending')
        )
    """, user_id)
    await conn.execute("""
      WITH pending_requests AS (
        SELECT r.id,r.user_id,r.created_at
        FROM access_requests r JOIN users applicant ON applicant.id=r.user_id
        WHERE r.status='pending' AND applicant.account_status='pending'
        ORDER BY r.created_at DESC LIMIT 100
      )
      INSERT INTO notifications(user_id,type,title,body,href,payload)
      SELECT $1,'ACCESS_REQUESTED','New access request',
             'An applicant is waiting for approval.','/app/admin/admissions',
             jsonb_build_object('eventId','access-request:'||r.id::text,
                                'requestId',r.id::text,'applicantId',r.user_id::text)
      FROM pending_requests r
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications existing WHERE existing.user_id=$1
          AND existing.type='ACCESS_REQUESTED'
          AND existing.payload->>'requestId'=r.id::text)
      ON CONFLICT DO NOTHING
    """, user_id)
    await conn.execute("""
      WITH pending_accounts AS (
        SELECT u.id,u.created_at
        FROM users u
        WHERE u.account_status='pending'
          AND NOT EXISTS (
            SELECT 1 FROM access_requests r
            WHERE r.user_id=u.id AND r.status='pending')
        ORDER BY u.created_at DESC LIMIT 100
      )
      INSERT INTO notifications(user_id,type,title,body,href,payload)
      SELECT $1,'ACCESS_REQUESTED','Account awaiting approval',
             'An account is waiting for approval.','/app/admin/people',
             jsonb_build_object('eventId','pending-account:'||u.id::text,
                                'applicantId',u.id::text)
      FROM pending_accounts u
      WHERE NOT EXISTS (
        SELECT 1 FROM notifications existing WHERE existing.user_id=$1
          AND existing.type='ACCESS_REQUESTED'
          AND existing.payload->>'applicantId'=u.id::text)
      ON CONFLICT DO NOTHING
    """, user_id)
    if role != 'owner':
        return
    await conn.execute("""
      UPDATE notifications n SET read_at=NOW()
      WHERE n.user_id=$1 AND n.type='SUPPORT_REPORT_RECEIVED'
        AND n.read_at IS NULL AND EXISTS (
          SELECT 1 FROM problem_reports r
          WHERE r.id::text=n.payload->>'reportId' AND r.status='resolved'
        )
    """, user_id)
    await conn.execute("""
      WITH unresolved AS (
        SELECT id,route,module,message,created_at
        FROM problem_reports
        WHERE status <> 'resolved'
        ORDER BY created_at DESC LIMIT 100
      )
      INSERT INTO notifications(user_id,type,title,body,href,payload)
      SELECT $1,'SUPPORT_REPORT_RECEIVED','New problem report or suggestion',
             left(r.message,220),
             '/app/notifications',
             jsonb_build_object('eventId','support-report:'||r.id::text,
                                'reportId',r.id::text,'module',r.module,
                                'route',r.route)
      FROM unresolved r
      ON CONFLICT DO NOTHING
    """, user_id)
