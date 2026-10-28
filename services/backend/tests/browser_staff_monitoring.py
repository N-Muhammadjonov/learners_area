"""Controlled role, homework, review, drill-down and owner-overview integration checks.

Runs only against the disposable PostgreSQL fixture created by browser_http_probe.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from zoneinfo import ZoneInfo
from fastapi.testclient import TestClient
from app.asgi import application
from app.browser_statistics import RELATION
from browser_fixtures import id


def run(con, learner_id, password):
    checks = 0
    teacher_id = id('teacher')
    other_teacher_id = id('other-teacher')
    other_student_id = id('other-student')
    prompt_id = id('writing-prompt')
    speaking_attempt_id=id('speaking-attempt')
    speaking_prompt_id=id('monitor-speaking-prompt')
    mock_attempt_id=id('monitor-mock-attempt')
    speaking_key=f'speaking/attempts/{speaking_attempt_id}/audio/{id("monitor-speaking-recording")}.webm'
    now = datetime.now(timezone.utc)

    def sql(statement, *args):
        return asyncio.run(con.execute(statement, *args))

    def fetchval(statement, *args):
        return asyncio.run(con.fetchval(statement, *args))

    sql('''INSERT INTO speaking_prompts(id,part,category,prompt_text,cue_card,topic)
         VALUES($1,'part2','part2','Describe a teacher who helped you.','Who they were; what they taught; why it mattered.','A helpful teacher')''',
         speaking_prompt_id)
    sql('UPDATE speaking_attempts SET prompt_id=$2,recording_object_key=$3 WHERE id=$1',
        speaking_attempt_id,speaking_prompt_id,speaking_key)
    sql('''INSERT INTO evaluations(user_id,evaluation_type,source_type,source_id,provider_id,
         provider_display_name,provider_type,provider_version,prompt_version,rubric_version,checked_by_name,
         overall_estimate,confidence,verdict,strengths,weaknesses)
         VALUES($1,'speaking','speaking_attempt',$2,'fixture','Saved fixture evaluation','internal',
         '1','prompt-v1','rubric-v1','RIWI',7.0,0.85,'mostly_correct',$3::jsonb,$4::jsonb)''',
         learner_id,speaking_attempt_id,json.dumps(['Clear development']),json.dumps(['Limited range of transitions']))
    section_results=[
        {'skill':'reading','sourceRef':'monitor-reading','raw':28,'total':40,'band':7.0,'contentVersionId':None,'attemptId':None},
        {'skill':'listening','sourceRef':'monitor-listening','raw':32,'total':40,'band':7.5,'contentVersionId':None,'attemptId':None},
    ]
    sql('''INSERT INTO mock_attempts(id,user_id,mock_test_id,mock_snapshot,status,started_at,finished_at,
         raw_score,estimated_band,section_results)
         VALUES($1,$2,NULL,$3::jsonb,'submitted',now()-interval '1 hour',now(),60,7.0,$4::jsonb)''',
         mock_attempt_id,learner_id,json.dumps({'title':'Saved section mock','kind':'full'}),json.dumps(section_results))

    # Ten unique assignments: one overdue target is still an in-progress persisted
    # target, so the projection must classify it once (overdue), not double-count it.
    statuses = ['completed'] * 7 + ['in_progress', 'in_progress', 'not_started']
    assignment_ids = []
    for n, status in enumerate(statuses, 1):
        aid = id(f'monitor-assignment-{n}')
        assignment_ids.append(aid)
        due = now - timedelta(days=1) if n == 8 else now + timedelta(days=7)
        completed_at = now if status == 'completed' else None
        sql('''INSERT INTO assignments(id,title,description,created_by_user_id,target_user_id,
             related_writing_prompt_id,module,due_at,updated_at)
             VALUES($1,$2,'Controlled homework fixture',$3,$4,$5,'reading',$6,now())''',
             aid, f'Monitor homework {n}', teacher_id, learner_id, prompt_id, due)
        sql('''INSERT INTO assignment_targets(assignment_id,student_user_id,status,due_at,completed_at)
             VALUES($1,$2,$3,$4,$5)''', aid, learner_id, status, due, completed_at)

    # A second teacher/student pair proves roster isolation for both directions.
    sql('''INSERT INTO teacher_student_links(teacher_user_id,student_user_id,assigned_by_user_id)
         VALUES($1,$2,$1) ON CONFLICT DO NOTHING''', other_teacher_id, other_student_id)
    foreign_assignment = id('monitor-foreign-assignment')
    sql('''INSERT INTO assignments(id,title,description,created_by_user_id,target_user_id,
         related_writing_prompt_id,module,due_at,updated_at)
         VALUES($1,'Foreign homework','Other roster fixture',$2,$3,$4,'writing',$5,now())''',
         foreign_assignment, other_teacher_id, other_student_id, prompt_id, now + timedelta(days=5))
    sql('''INSERT INTO assignment_targets(assignment_id,student_user_id,status,due_at)
         VALUES($1,$2,'not_started',$3)''', foreign_assignment, other_student_id, now + timedelta(days=5))

    submission_id = id('submission')
    # Normalize any earlier exam submissions from the broader browser fixture to
    # old, already-reviewed records so this focused queue has exactly one new item.
    sql("""UPDATE writing_submissions SET submitted_at=now()-interval '8 days',updated_at=now()-interval '8 days'
         WHERE user_id=$1 AND id<>$2 AND status IN ('submitted','evaluated')""", learner_id, submission_id)
    sql("""INSERT INTO writing_feedback(submission_id,source,comment,teacher_id)
         SELECT s.id,'teacher','Prior fixture review',$2 FROM writing_submissions s
         WHERE s.user_id=$1 AND s.id<>$3 AND s.status IN ('submitted','evaluated') AND s.submitted_at IS NOT NULL
           AND NOT EXISTS(SELECT 1 FROM writing_feedback f WHERE f.submission_id=s.id AND f.source='teacher')""", learner_id, teacher_id, submission_id)
    sql("UPDATE writing_submissions SET status='submitted',submitted_at=now(),updated_at=now() WHERE id=$1", submission_id)
    # More than one page of saved Writing records exercises bounded, stable detail reads.
    existing_submissions=fetchval('SELECT count(*)::int FROM writing_submissions WHERE user_id=$1',learner_id)
    for n in range(1,max(0,27-int(existing_submissions))+1):
        sql('''INSERT INTO writing_submissions(id,user_id,prompt_id,content,word_count,status)
             VALUES($1,$2,$3,$4,3,'draft')''', id(f'monitor-draft-{n}'), learner_id, prompt_id, f'Saved draft {n}.')
    submission_total=int(fetchval('SELECT count(*)::int FROM writing_submissions WHERE user_id=$1',learner_id))

    # Actual graded answer rows: 11/20 TFNG answers, with no answer-key inference.
    passage_id = id('monitoring-reading-passage')
    sql("""INSERT INTO reading_passages(id,title,body_text,publication_state,suggested_minutes)
         VALUES($1,'Monitoring TFNG test','Controlled passage for recorded answer review.','published',20)""", passage_id)
    attempt_id = id('monitoring-reading-attempt')
    sql('''INSERT INTO reading_attempts(id,user_id,passage_id,status,score,total_questions,started_at,submitted_at)
         VALUES($1,$2,$3,'completed',11,20,now()-interval '10 minutes',now())''', attempt_id, learner_id, passage_id)
    for n in range(1, 21):
        qid = id(f'monitoring-reading-question-{n}')
        correct = n <= 11
        sql('''INSERT INTO reading_questions(id,passage_id,"order",type,type_code,question_text,correct_answer,explanation)
             VALUES($1,$2,$3,'true_false_not_given',NULL,$4,'TRUE','Fixture explanation')''',
             qid, passage_id, n, f'Controlled TFNG question {n}.')
        sql('''INSERT INTO reading_answers(attempt_id,question_id,user_answer,is_correct)
             VALUES($1,$2,$3,$4)''', attempt_id, qid, 'TRUE' if correct else 'FALSE', correct)

    def client_as(email):
        client = TestClient(application, base_url='http://preview.test')
        response = client.post('/api/auth/login', json={'email': email, 'password': password},
                               headers={'origin': 'http://preview.test'})
        assert response.status_code == 200, (email, response.status_code, response.text[:300])
        return client

    def data(client, kind, query=''):
        response = client.get('/api/frontend/staff/' + kind + query)
        assert response.status_code == 200, (kind, response.status_code, response.text[:400])
        return response.json()['data']

    teacher = client_as('teacher@browser.example.test')
    homework = data(teacher, 'teacher-homework')
    assert homework['scope'] == 'assigned'
    assert [r['id'] for r in homework['students']] == [learner_id]
    row = homework['students'][0]
    assert (row['assigned'], row['completed'], row['inProgress'], row['notStarted'], row['overdue']) == (10, 7, 1, 1, 1)
    assert row['completionPercent'] == 70.0
    assert homework['summary']['assigned'] == 10 and homework['completionPercent'] == 70.0
    assert homework['totalAssignments'] == 10 and len(homework['assignments']) == 10
    checks += 1

    overdue = data(teacher, 'teacher-homework', '?status=overdue')
    assert overdue['summary']['assigned'] == 1 and overdue['summary']['overdue'] == 1
    assert overdue['totalAssignments'] == 1 and overdue['assignments'][0]['id'] == assignment_ids[7]
    assert overdue['students'][0]['assigned'] == 1 and overdue['students'][0]['overdue'] == 1
    detail = data(teacher, 'teacher-assignment', '?student=' + learner_id + '&id=' + assignment_ids[7])
    assert detail['assignment']['status'] == 'overdue' and detail['student']['id'] == learner_id
    checks += 2

    actions = data(teacher, 'teacher-actions')
    assert actions['pendingReviews'] == 1 and actions['overdueAssignments'] == 1
    assert actions['recentWritingSubmissions'] == 1
    assert any(r['id'] == submission_id and r['studentId'] == learner_id for r in actions['reviewItems'])
    assert any(r['id'] == assignment_ids[7] for r in actions['overdueItems'])
    checks += 1

    # Reading weakness accuracy is based only on the 20 persisted graded answers.
    student_detail = data(teacher, 'teacher-student', '?id=' + learner_id + '&submission=' + submission_id)
    assert student_detail['submissionsPage'] == 1 and student_detail['submissionsPages'] == 2
    assert len(student_detail['submissions']) == 25 and student_detail['submissions'][0]['id'] == submission_id
    tfng = next(r for r in student_detail['weaknesses']['questionTypes']['reading'] if r['type'] == 'true_false_not_given')
    assert (tfng['attempts'], tfng['correct'], tfng['accuracy']) == (20, 11, 55.0)
    page_two = data(teacher, 'teacher-student', '?id=' + learner_id + '&writingPage=2')
    assert page_two['submissionsPage'] == 2 and len(page_two['submissions']) == submission_total-25
    review = data(teacher, 'teacher-assessment', '?student=' + learner_id + '&module=reading&id=' + attempt_id)
    assert review['answerKeyAvailable'] is True and len(review['questions']) == 20
    assert sum(q['isCorrect'] is True for q in review['questions']) == 11
    speaking_review=data(teacher,'teacher-assessment','?student='+learner_id+'&module=speaking&id='+speaking_attempt_id)
    assert speaking_review['speaking']['prompt']=='Describe a teacher who helped you.'
    assert speaking_review['speaking']['transcript']=='My manual transcript from the saved recording.'
    assert speaking_review['speaking']['transcriptOrigin']=='manual'
    assert speaking_review['speaking']['recordingUrl']=='/api/resources/'+speaking_key
    assert speaking_review['speaking']['evaluation']['overallEstimate']==7.0
    mock_review=data(teacher,'teacher-assessment','?student='+learner_id+'&module=mocks&id='+mock_attempt_id)
    assert mock_review['questions']==[] and mock_review['answerKeyAvailable'] is False
    assert len(mock_review['sectionResults'])==2 and mock_review['sectionResults'][0]['raw']==28
    checks += 5

    # The other teacher receives only their explicit roster and cannot inspect/review this learner.
    other_teacher = client_as('other-teacher@browser.example.test')
    other_hw = data(other_teacher, 'teacher-homework')
    assert [r['id'] for r in other_hw['students']] == [other_student_id]
    assert other_hw['totalAssignments'] == 1
    own_speaking=teacher.get('/api/speaking/attempts')
    other_speaking=other_teacher.get('/api/speaking/attempts')
    assert own_speaking.status_code==200 and [a['id'] for a in own_speaking.json()['attempts']]==[speaking_attempt_id]
    assert own_speaking.json()['attempts'][0]['recordingObjectKey'] is None
    assert other_speaking.status_code==200 and other_speaking.json()['attempts']==[]
    assert teacher.get('/api/speaking/attempts/'+speaking_attempt_id).status_code==200
    assert other_teacher.get('/api/speaking/attempts/'+speaking_attempt_id).status_code==404
    from app.step20_media_port import allow_resource
    assert asyncio.run(allow_resource(con,{'id':teacher_id,'role':'teacher'},speaking_key))=='allowed'
    assert asyncio.run(allow_resource(con,{'id':other_teacher_id,'role':'teacher'},speaking_key))=='forbidden'
    assert asyncio.run(allow_resource(con,{'id':id('admin'),'role':'admin'},speaking_key))=='forbidden'
    assert asyncio.run(allow_resource(con,{'id':id('owner'),'role':'owner'},speaking_key))=='allowed'
    checks += 9
    teacher_assignments=teacher.get('/api/assignments').json()['assignments']
    other_assignments=other_teacher.get('/api/assignments').json()['assignments']
    assert {x['id'] for x in teacher_assignments} == set(assignment_ids)
    assert all(x['id'] != foreign_assignment for x in teacher_assignments)
    assert [x['id'] for x in other_assignments] == [foreign_assignment]
    checks += 1
    for kind, query in (('teacher-student', '?id=' + learner_id),
                        ('teacher-assignment', '?student=' + learner_id + '&id=' + assignment_ids[0]),
                        ('teacher-assessment', '?student=' + learner_id + '&module=reading&id=' + attempt_id),
                        ('teacher-assessment', '?student=' + learner_id + '&module=speaking&id=' + speaking_attempt_id),
                        ('teacher-assessment', '?student=' + learner_id + '&module=mocks&id=' + mock_attempt_id)):
        response = other_teacher.get('/api/frontend/staff/' + kind + query)
        assert response.status_code == 404, (kind, response.status_code, response.text[:300])
        checks += 1
    denied_feedback = other_teacher.post('/api/teacher/feedback', json={'submissionId': submission_id, 'comment': 'Out of roster'})
    assert denied_feedback.status_code == 404
    checks += 1

    # Teacher feedback is saved to the existing table, updates idempotently, and clears pending review.
    saved = teacher.post('/api/teacher/feedback', json={'submissionId': submission_id, 'comment': 'Reviewed from assigned roster.', 'overallBand': 7})
    assert saved.status_code == 200, saved.text[:300]
    saved_again = teacher.post('/api/teacher/feedback', json={'submissionId': submission_id, 'comment': 'Updated review.', 'overallBand': 7.5})
    assert saved_again.status_code == 200, saved_again.text[:300]
    feedback_count = fetchval("SELECT count(*)::int FROM writing_feedback WHERE submission_id=$1 AND source='teacher' AND teacher_id=$2", submission_id, teacher_id)
    assert feedback_count == 1
    after_queue = data(teacher, 'teacher-actions')
    assert after_queue['pendingReviews'] == 0
    saved_detail = data(teacher, 'teacher-student', '?id=' + learner_id + '&submission=' + submission_id)
    selected = next(s for s in saved_detail['submissions'] if s['id'] == submission_id)
    assert any(f['source'] == 'teacher' and f['comment'] == 'Updated review.' for f in selected['feedback'])
    checks += 3

    # Existing heartbeat presence is visible only to the explicitly assigned Teacher,
    # with website time labelled separately from academic activity.
    learner = client_as('browser@example.test')
    heartbeat=learner.post('/api/presence',headers={'origin':'http://preview.test'})
    assert heartbeat.status_code==204
    sql("""UPDATE activity_events SET payload=jsonb_build_object('since',now(),'visitStartedAt',now(),
         'visitSeconds',65,'totalSeconds',3665) WHERE id=md5('site-presence:'||$1::text)::uuid AND user_id=$1::uuid""",learner_id)
    online_roster=data(teacher,'teacher-students')['students']
    assert len(online_roster)==1 and online_roster[0]['id']==learner_id and online_roster[0]['online'] is True
    assert online_roster[0]['lastSeenAt'] is not None and online_roster[0]['currentVisitSeconds']==65 and online_roster[0]['totalWebsiteSeconds']==3665
    sql("UPDATE activity_events SET created_at=now()-interval '91 seconds' WHERE id=md5('site-presence:'||$1::text)::uuid AND user_id=$1::uuid",learner_id)
    offline_roster=data(teacher,'teacher-students')['students']
    offline_seen=datetime.fromisoformat(offline_roster[0]['lastSeenAt'].replace('Z','+00:00'))
    assert offline_roster[0]['online'] is False and offline_seen<now-timedelta(seconds=90)
    assert offline_roster[0]['totalWebsiteSeconds']==3665
    checks += 6
    own_attempt = learner.get('/api/frontend/view?' + urlencode({'route': '/app/reading/attempts/' + attempt_id}))
    assert own_attempt.status_code == 200
    other_student = client_as('other-student@browser.example.test')
    foreign_attempt = other_student.get('/api/frontend/view?' + urlencode({'route': '/app/reading/attempts/' + attempt_id}))
    assert foreign_attempt.status_code == 404
    own_writing = learner.get('/api/frontend/view?' + urlencode({'route': '/app/writing/submissions/' + submission_id}))
    assert own_writing.status_code == 200
    assert own_writing.json()['data']['feedback']['comment'] == 'Updated review.'
    checks += 3

    # Owner aggregates are checked against controlled PostgreSQL records, not mocked UI values.
    owner = client_as('owner@browser.example.test')
    overview = data(owner, 'owner-overview')
    academic = overview['academic']
    expected_reading = fetchval("SELECT count(*)::int FROM reading_attempts a JOIN users u ON u.id=a.user_id WHERE u.role='student'")
    reading_summary = next(x for x in academic['moduleSummary'] if x['module'] == 'reading')
    assert reading_summary['started'] == expected_reading and reading_summary['completed'] >= 1
    assert (academic['homework']['assigned'], academic['homework']['completed'], academic['homework']['overdue']) == (11, 7, 1)
    assert academic['pendingReviews'] == 0 and academic['writingSubmissions'] == 1
    assert len(academic['daily']) == 7 and academic['daily'][-1]['count'] >= 1
    expected_active_students=fetchval("SELECT count(*)::int FROM users WHERE role='student' AND account_status='active'")
    expected_online_students=fetchval("SELECT count(*)::int FROM users u JOIN activity_events p ON p.id=md5('site-presence:'||u.id::text)::uuid WHERE u.role='student' AND u.account_status='active' AND p.type='SITE_PRESENCE' AND p.created_at>now()-interval '90 seconds'")
    assert academic['activeStudents']==expected_active_students and academic['onlineStudents']==expected_online_students==0
    assert academic['activity']['students']>=1
    assert any(item['id']==learner_id and item['overdue']>=1 for item in academic['attention'])
    today=datetime.now(ZoneInfo('Asia/Tashkent')).date().isoformat()
    filtered=data(owner,'owner-overview','?'+urlencode({'from':today,'to':today,'student':'Browser learner','teacher':'teacher','module':'reading'}))['academic']
    assert filtered['filters']=={'from':today,'to':today,'student':'Browser learner','teacher':'teacher','module':'reading'}
    assert filtered['homework']['assigned']==10 and filtered['homework']['completed']==7
    expected_reading_today=fetchval("SELECT count(*)::int FROM reading_attempts WHERE user_id=$1 AND (started_at AT TIME ZONE 'Asia/Tashkent')::date=$2::date",learner_id,today)
    assert filtered['activity']['students']==1 and filtered['activity']['records']==expected_reading_today
    assert len(filtered['daily'])==1 and filtered['daily'][0]=={'day':today,'count':expected_reading_today}
    selected_reading=next(x for x in filtered['moduleSummary'] if x['module']=='reading')
    assert selected_reading['started']==expected_reading_today and selected_reading['started']>=1
    assert all(x['started']==0 for x in filtered['moduleSummary'] if x['module']!='reading')
    assert filtered['pendingReviews']==0 and filtered['writingSubmissions']==0
    checks += 2

    # Assignment creation and the existing Writing lifecycle send through the
    # existing inbox; a retried assignment event is deduplicated by eventId.
    teacher_notifications = teacher.get('/api/notifications')
    assert teacher_notifications.status_code == 200
    review_notice = next((n for n in teacher_notifications.json()['notifications']
                          if n['type'] == 'WRITING_REVIEW_REQUIRED' and n['payload'].get('studentId') == learner_id), None)
    assert review_notice and review_notice['href'].startswith(f'/app/teacher/students/{learner_id}?submission=')
    feedback_event_id = f'teacher-feedback:{submission_id}:{teacher_id}'
    assert fetchval("SELECT count(*)::int FROM notifications WHERE user_id=$1 AND payload->>'eventId'=$2",
                    learner_id, feedback_event_id) == 1
    checks += 2

    created_assignment = teacher.post('/api/assignments', json={
        'title': 'Notification fixture homework', 'targetUserId': learner_id,
        'relatedWritingPromptId': prompt_id,
    })
    assert created_assignment.status_code == 200, created_assignment.text[:300]
    new_assignment_id = created_assignment.json()['assignment']['id']
    from app.notification_events import notify_assignment_assigned
    for _ in range(2):
        asyncio.run(notify_assignment_assigned(con, assignment_id=new_assignment_id,
            student_id=learner_id, title='Notification fixture homework', module=None))
    event_id = f'assignment:{new_assignment_id}:assigned:{learner_id}'
    assert fetchval("SELECT count(*)::int FROM notifications WHERE user_id=$1 AND payload->>'eventId'=$2",
                    learner_id, event_id) == 1
    deadline_assignment=id('monitor-deadline-soon');deadline_at=now+timedelta(hours=12)
    sql('''INSERT INTO assignments(id,title,description,created_by_user_id,target_user_id,module,due_at,updated_at)
         VALUES($1,'Approaching deadline fixture','Due soon',$2,$3,'writing',$4,now())''',deadline_assignment,teacher_id,learner_id,deadline_at)
    sql("INSERT INTO assignment_targets(assignment_id,student_user_id,status,due_at) VALUES($1,$2,'not_started',$3)",deadline_assignment,learner_id,deadline_at)
    first_count=learner.get('/api/notifications?count=1')
    second_count=learner.get('/api/notifications?count=1')
    assert first_count.status_code==200 and second_count.status_code==200
    overdue_event=f'assignment:{assignment_ids[7]}:overdue:{learner_id}'
    approaching_event=f"assignment:{deadline_assignment}:deadline:{learner_id}:{deadline_at.strftime('%Y%m%d%H%M%S')}"
    for delivered_event in (overdue_event,approaching_event):
        assert fetchval("SELECT count(*)::int FROM notifications WHERE user_id=$1 AND payload->>'eventId'=$2",learner_id,delivered_event)==1
    learner_notifications = learner.get('/api/notifications')
    assert learner_notifications.status_code == 200
    notices=learner_notifications.json()['notifications']
    assignment_notice = next((n for n in notices if n['payload'].get('eventId') == event_id), None)
    assert assignment_notice and assignment_notice['type'] == 'ASSIGNMENT_ASSIGNED' and assignment_notice['href'] == '/app/assignments'
    assert any(n['type']=='ASSIGNMENT_OVERDUE' and n['payload'].get('eventId')==overdue_event for n in notices)
    assert any(n['type']=='ASSIGNMENT_DEADLINE_APPROACHING' and n['payload'].get('eventId')==approaching_event for n in notices)
    checks += 8

    # Student actors cannot use staff projections, while the Admin has no private academic path.
    student_staff = learner.get('/api/frontend/staff/student-learning?id=' + other_student_id)
    assert student_staff.status_code == 403
    admin = client_as('admin@browser.example.test')
    for kind, query in (('teacher-homework', ''), ('teacher-actions', ''), ('teacher-student', '?id=' + learner_id),
                        ('student-learning', '?id=' + learner_id), ('student-results', '?id=' + learner_id),
                        ('centre-statistics', ''), ('owner-overview', '?student=Browser')):
        response = admin.get('/api/frontend/staff/' + kind + query)
        assert response.status_code == 403, (kind, response.status_code, response.text[:300])
        checks += 1
    assert admin.get('/api/assignments').status_code == 403
    assert admin.get('/api/speaking/attempts').status_code == 403
    assert admin.get('/api/speaking/attempts/'+speaking_attempt_id).status_code == 403
    assert admin.get('/api/frontend/staff/teacher-assessment?student='+learner_id+'&module=speaking&id='+speaking_attempt_id).status_code==403
    assert admin.get('/api/frontend/staff/teacher-assessment?student='+learner_id+'&module=mocks&id='+mock_attempt_id).status_code==403
    assert admin.post('/api/teacher/feedback', json={'submissionId':submission_id,'comment':'No admin access'}).status_code == 403
    admin_people=data(admin,'people')
    assert admin_people['onlineCount'] is None
    assert all(p.get('online') is None and p.get('seenAt') is None and p.get('visitSeconds') is None and p.get('totalSeconds') is None for p in admin_people['people'])
    checks += 5
    return checks
