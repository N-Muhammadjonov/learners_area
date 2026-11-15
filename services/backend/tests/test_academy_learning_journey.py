"""End-to-end classroom-to-Writing proof using an isolated native PostgreSQL database."""
from __future__ import annotations

import asyncio
import csv
import json
import os
from datetime import datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4
from zoneinfo import ZoneInfo

import asyncpg
import httpx
import pytest
import pytest_asyncio

from _finance_schema import DSN
from app import academy_payroll, academy_sessions, main
from app.academy_groups import today
from app.db import initialize_connection
from app.security import SESSION_COOKIE, issue_token

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
API = '/api/staff/academy'
BOT_API = '/api/internal/telegram/guardians'
BOT_SECRET = 'isolated-guardian-worker-test'


@pytest_asyncio.fixture
async def journey(monkeypatch):
    name = 'learners_journey_'+uuid4().hex
    liveness = urlsplit(DSN)
    assert liveness.hostname=='127.0.0.1' and liveness.path=='/coin_qa'
    try:
        admin = await asyncpg.connect(DSN)
    except OSError:
        if os.getenv('CI'):
            raise
        pytest.xfail('Disposable PostgreSQL at 127.0.0.1:55439 is unavailable')
    conn = pool = None
    created = False
    try:
        await admin.execute(f'CREATE DATABASE "{name}"')
        created = True
        url = DSN.rsplit('/',1)[0]+'/'+name
        conn = await asyncpg.connect(url)
        await initialize_connection(conn)
        deferred = set(json.loads((BACKEND/'tests/migration-contract.json').read_text())['contentMigrations'])
        for file in sorted((BACKEND/'migrations').glob('*.sql')):
            if file.name not in deferred:
                for sql in file.read_text().split('--> statement-breakpoint'):
                    statement = '\n'.join(line for line in sql.splitlines() if not line.lstrip().startswith('--'))
                    if statement.strip():
                        try:
                            await conn.execute(statement)
                        except Exception as exc:
                            raise RuntimeError(f'Fresh journey migration failed: {file.name}') from exc
        for file in json.loads((BACKEND/'tests/platform-migrations.json').read_text()):
            async with conn.transaction():
                await conn.execute((ROOT/file).read_text())
        pool = await asyncpg.create_pool(url, min_size=1,max_size=5,init=initialize_connection)
        async def get_pool():
            return pool
        monkeypatch.setattr(main,'pool',get_pool)
        monkeypatch.setenv('AUTH_SECRET','isolated-academy-journey-signing-key-2026')
        monkeypatch.setenv('RATE_LIMIT_BACKEND','memory')
        monkeypatch.setenv('RIWI_EVALUATION_MODE','independent-v1')
        monkeypatch.setenv('AI_EXTERNAL_ENABLED','false')
        monkeypatch.setenv('STT_PRIMARY_PROVIDER','none')
        monkeypatch.setenv('BOT_SERVICE_SECRET',BOT_SECRET)

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url='https://journey.test') as client:
            yield conn,client
    finally:
        if pool:
            await pool.close()
        if conn:
            await conn.close()
        if created:
            await admin.execute(f'DROP DATABASE "{name}"')
        await admin.close()


async def create_actor(conn, key, role, telegram=None):
    record = await conn.fetchrow(
        """INSERT INTO users(name,role,account_status,telegram_id)
           VALUES($1,$2,'active',$3) RETURNING *""",key,role,telegram)
    return dict(record)


async def request(client, actor, method, path, expected=200, **options):
    response=await client.request(method,path,headers={
        'origin':'https://journey.test','cookie':SESSION_COOKIE+'='+issue_token(actor)},**options)
    assert response.status_code==expected, (method,path,response.status_code,response.text)
    return response.json() if response.headers.get('content-type','').startswith('application/json') else response


async def bot_post(client, path, payload, expected=200):
    response=await client.post(BOT_API+path,headers={'Authorization':'Bearer '+BOT_SECRET},json=payload)
    assert response.status_code==expected,(path,response.status_code,response.text)
    return response.json()


@pytest.mark.asyncio
async def test_classroom_writing_teacher_feedback_and_guardian_progress(journey, monkeypatch):
    conn,client=journey
    owner=await create_actor(conn,'Centre Owner','owner')
    admin=await create_actor(conn,'Finance Admin','admin')
    teacher=await create_actor(conn,'Assigned Teacher','teacher','800002')
    outsider=await create_actor(conn,'Unassigned Teacher','teacher')
    learner=await create_actor(conn,'Writing Learner','student')
    peer=await create_actor(conn,'Other Learner','student')
    parent=await create_actor(conn,'Writing Learner Parent','guardian','800001')
    course=await conn.fetchval("INSERT INTO courses(slug,title) VALUES('journey','Journey IELTS') RETURNING id")
    body={'id':str(uuid4()),'courseId':str(course),'teacherIds':[str(teacher['id'])],
          'name':'Journey IELTS','branch':'Tashkent','room':'101','capacity':4,
          'startsOn':str(today()-timedelta(days=3)),'status':'active'}
    group=await request(client,owner,'POST',API+'/groups',201,json=body)
    path=API+'/groups/'+group['id']
    lead_id = str(uuid4())
    lead_route = API+'/leads/'+lead_id
    fields = {'name':'Synthetic IELTS applicant', 'email':'applicant@example.test', 'source':'Website',
              'courseId':str(course), 'assignedTo':str(admin['id'])}
    created = await request(client,admin,'POST',API+'/leads',201,json={**fields,'id':lead_id})
    assert created['stage'] == 'new'
    trial_at = (datetime.now(ZoneInfo('Asia/Tashkent'))-timedelta(minutes=10)).isoformat()
    for revision, stage in enumerate(('contacted','trial_scheduled','trial_completed'), 1):
        await request(client, admin, 'PUT', lead_route, json={
            **fields, 'stage':stage, 'revision':revision,
            **({'trialAt':trial_at} if stage != 'contacted' else {}),
        })
    enrolled = await request(client,admin,'POST',lead_route+'/convert',json={
        'revision':4,'groupId':group['id'],'studentId':str(learner['id']),
    })
    assert enrolled['stage'] == 'enrolled' and enrolled['student_user_id'] == str(learner['id'])
    # This deliberate opt-in is the site's existing independent teaching authority.
    await request(client,owner,'POST','/api/admin/roster',303,
                  data={'action':'assign','teacherId':str(teacher['id']),'studentId':str(learner['id'])})
    today_date = today()
    lesson_day = today_date
    book = {'seriesId':str(uuid4()), 'room':'101', 'localDate':str(lesson_day),
            'localStart':'00:00', 'durationMinutes':15}
    lessons = await request(client,owner,'POST',path+'/sessions',201,json=book)
    lesson = path+'/sessions/'+lessons['sessions'][0]['id']

    class HeldLessonClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(lesson_day.year, lesson_day.month, lesson_day.day, 0, 16, tzinfo=tz)

    with monkeypatch.context() as clock:
        clock.setattr(academy_sessions,'datetime',HeldLessonClock)
        await request(client,owner,'PUT',lesson,json={'status':'held','revision':1})
    await request(client,outsider,'GET',lesson+'/attendance',403)
    await request(client,teacher,'PUT',lesson+'/attendance',json={
        'id':str(uuid4()),'marks':[{'studentId':str(learner['id']),'revision':1,'status':'present'}]})

    finance = '/api/staff/finance'
    learner_id = str(learner['id'])
    period = today_date.strftime('%Y-%m')
    contract = (await request(client,admin,'POST',finance+'/contracts',json={
        'studentUserId':learner_id,'courseId':str(course),
        'monthlyAmountMinor':800000,'startsOn':str(today_date),
    }))['contract']
    contract_path = finance+'/contracts/'+contract['id']
    await request(client,owner,'POST',contract_path+'/approve')
    await request(client,admin,'POST',contract_path+'/activate')
    await request(client,owner,'POST',contract_path+'/discounts',json={
        'periodKey':period,'amountMinor':200000,'reason':'Approved pilot discount',
    })
    created_charge = (await request(client,admin,'POST',contract_path+'/installment',json={
        'periodKey':period,'dueDate':str(today_date),
    }))['charge']
    charge_path = finance+'/charges/'+created_charge['id']
    await request(client,owner,'POST',charge_path+'/approve')
    await request(client,admin,'POST',charge_path+'/post')
    receipt_body = {'studentUserId':learner_id,'amountMinor':250000,'method':'cash',
                    'idempotencyKey':str(uuid4())}
    receipt = await request(client,admin,'POST',finance+'/payments',json=receipt_body)
    repeated_receipt = await request(client,admin,'POST',finance+'/payments',json=receipt_body)
    assert receipt['payment']['id'] == repeated_receipt['payment']['id']
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments WHERE student_user_id=$1',learner['id']) == 1
    summary = await request(client,owner,'GET',finance+'/summary')
    assert summary['outstandingReceivableMinor'] == 350000 and summary['collectedCashMinor'] == 250000
    await request(client,teacher,'GET',finance+'/summary',403)

    prompt=await conn.fetchval("""INSERT INTO writing_prompts(task_type,category,prompt,target_word_count,publication_state)
        VALUES('task2','Opinion','Should cities invest in public transportation?',250,'published') RETURNING id""")
    assigned=await request(client,teacher,'POST','/api/assignments',json={
        'title':'Public transport essay','targetUserId':str(learner['id']),'relatedWritingPromptId':str(prompt)})
    aid=assigned['assignment']['id']
    assert [x['id'] for x in (await request(client,learner,'GET','/api/assignments'))['assignments']]==[aid]
    assert (await request(client,peer,'GET','/api/assignments'))['assignments']==[]
    draft=await request(client,learner,'POST','/api/writing/submissions',json={'promptId':str(prompt)})
    sid=draft['id']
    essay=('Public transportation can make cities easier to live in. Reliable buses reduce traffic '
           'and help more people reach their jobs. For example, better weekend service is important '
           'for workers who cannot choose their hours. Cities should therefore improve public transport.')
    await request(client,peer,'PATCH','/api/writing/submissions/'+sid,404,json={'content':essay})
    await request(client,learner,'PATCH','/api/writing/submissions/'+sid,json={'content':essay})
    await request(client,learner,'POST','/api/writing/submissions/'+sid+'/submit')
    await request(client,learner,'POST','/api/assignments/'+aid+'/evaluate',json={})
    assert [row['status'] for row in (await request(client,teacher,'GET','/api/assignments'))['assignments'][0]['targets']]==['completed']
    assert await conn.fetchval('SELECT count(*) FROM evaluations WHERE source_id=$1',sid)==1
    feedback={'submissionId':sid,'overallBand':6.5,'comment':'Develop your second example.'}
    await request(client,outsider,'POST','/api/teacher/feedback',404,json=feedback)
    for _ in range(2):
        await request(client,teacher,'POST','/api/teacher/feedback',json=feedback)
    assert await conn.fetchval("SELECT count(*) FROM writing_feedback WHERE submission_id=$1 AND source='teacher'",sid)==1
    assert await conn.fetchval("""SELECT count(*) FROM notifications
        WHERE user_id=$1 AND type='TEACHER_FEEDBACK_RECEIVED'""",learner['id'])==1
    await conn.execute("INSERT INTO onboarding_profiles(user_id,target_band,exam_date) VALUES($1,7.5,now())",
                       learner['id'])
    self_journey=await request(client,learner,'GET','/api/academy/journey',params={'studentId':str(peer['id'])})
    assert self_journey['goal']['targetBand']==7.5
    assert {item['kind'] for item in self_journey['items']}=={
        'group_joined','attendance','writing_submitted','teacher_feedback','assignment_completed'}
    assert all(item['href'].startswith('/app/') for item in self_journey['items'])
    staff_url=API+'/students/'+str(learner['id'])+'/journey'
    await request(client,outsider,'GET',staff_url,404)
    staff_journey=await request(client,teacher,'GET',staff_url)
    assert any(item.get('href','').endswith('#submission-'+sid) for item in staff_journey['items'])

    invitation=await request(client,learner,'POST','/api/guardians/invitations',201,json={'relationship':'mother'})
    profile=await conn.fetchval("""INSERT INTO guardian_profiles(telegram_user_id,user_id,channel_verified_at)
       VALUES($1,$2,now()) RETURNING id""",parent['telegram_id'],parent['id'])
    await conn.execute("""INSERT INTO telegram_contacts(telegram_user_id,chat_id,phone_verified_at)
       VALUES($1,$1,now())""",parent['telegram_id'])
    link=await conn.fetchval("""INSERT INTO guardian_links(guardian_profile_id,student_id,invitation_id,relationship,status)
       VALUES($1,$2,$3,'mother','awaiting_student') RETURNING id""",profile,learner['id'],invitation['invitationId'])
    child='/api/guardian/children/'+str(learner['id'])
    await request(client,parent,'GET',child+'/attendance',403)
    await request(client,parent,'GET',child+'/journey',403)
    await request(client,learner,'POST',f'/api/guardians/links/{link}/approve')
    assert (await request(client,parent,'GET',child+'/attendance'))['counts']['attended']==1
    progress=await request(client,parent,'GET',child+'/progress',params={'region':'progressSummary'})
    summary=progress['data']['progressSummary']
    assert summary['writing']['submissions']==1 and summary['assignments']['completed']==1
    assert essay not in json.dumps(progress) and feedback['comment'] not in json.dumps(progress)
    parent_journey=await request(client,parent,'GET',child+'/journey')
    assert parent_journey['goal'] is None
    assert all('href' not in item for item in parent_journey['items'])
    assert essay not in json.dumps(parent_journey) and feedback['comment'] not in json.dumps(parent_journey)
    await request(client,parent,'GET','/api/guardian/children/'+str(peer['id'])+'/journey',403)
    await request(client,parent,'GET','/api/guardian/children/'+str(peer['id'])+'/progress',403,
                  params={'region':'progressSummary'})
    await request(client,parent,'GET','/api/staff/finance/students/'+str(learner['id'])+'/statement',403)
    await conn.execute("INSERT INTO telegram_contacts(telegram_user_id,chat_id) VALUES($1,'teacher-fixture-chat')",
                       teacher['telegram_id'])
    message={'body':'Your child completed the lesson.','linkIds':[str(link)],
             'idempotencyKey':str(uuid4()),'confirm':True}
    await request(client,outsider,'POST','/api/staff/guardian-messages/send',409,json=message)
    queued=await request(client,teacher,'POST','/api/staff/guardian-messages/send',201,json=message)
    assert (await request(client,teacher,'POST','/api/staff/guardian-messages/send',
                          json=message))['batchId']==queued['batchId']
    delivery=(await bot_post(client,'/deliveries/claim',{}))['deliveries'][0]
    assert delivery['chatId']==parent['telegram_id']
    await bot_post(client,'/deliveries/claim',{'results':[{'deliveryId':delivery['deliveryId'],
                   'status':'failed','retryAfterSeconds':1}]})
    await conn.execute("UPDATE guardian_message_deliveries SET next_attempt_at=now() WHERE id=$1",
                       delivery['deliveryId'])
    claimed=(await bot_post(client,'/deliveries/claim',{}))['deliveries']
    assert [item['deliveryId'] for item in claimed]==[delivery['deliveryId']]
    await bot_post(client,'/deliveries/claim',{'results':[{'deliveryId':delivery['deliveryId'],
                   'status':'sent','telegramMessageId':'9100'}]})
    answer={'actorTelegramId':parent['telegram_id'],'deliveryId':delivery['deliveryId'],
            'incomingMessageId':'9101','text':'Thank you for the update.'}
    assert (await bot_post(client,'/replies',answer))['duplicate'] is False
    assert (await bot_post(client,'/replies',answer))['duplicate'] is True
    reply=(await bot_post(client,'/replies/claim',{}))['replies']
    assert len(reply)==1 and reply[0]['chatId']=='teacher-fixture-chat'
    await request(client,learner,'POST',f'/api/guardians/links/{link}/revoke')
    await request(client,parent,'GET',child+'/progress',403,params={'region':'progressSummary'})
    await request(client,parent,'GET',child+'/journey',403)
    await bot_post(client,'/replies',{**answer,'incomingMessageId':'9102'},409)

    payroll = finance+'/payroll'
    payroll_period = lesson_day.strftime('%Y-%m')
    await request(client,owner,'POST',payroll+'/rules',json={
        'commandId':str(uuid4()),'teacherUserId':str(teacher['id']),
        'startsOn':str(lesson_day),'sessionMinor':100000,
    })
    parameters = {'teacherUserId':str(teacher['id']),'periodKey':payroll_period}
    estimate = await request(client,owner,'GET',payroll,params=parameters)
    assert estimate['estimate']['amountMinor'] == 100000
    finalization = {
        **parameters,'expectedAmountMinor':100000,'expectedCalculation':estimate['calculationHash'],
    }
    await request(client,owner,'POST',payroll+'/finalize',409,json=finalization)
    next_period = (lesson_day.replace(day=28)+timedelta(days=4)).replace(day=1)

    class ClosedPeriodClock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(next_period.year,next_period.month,1,12,tzinfo=tz)

    with monkeypatch.context() as clock:
        clock.setattr(academy_payroll,'datetime',ClosedPeriodClock)
        finalized = await request(client,owner,'POST',payroll+'/finalize',json=finalization)
    assert finalized['accruedMinor'] == 100000
    exported = await request(client,owner,'GET',finance+'/journal.csv',params={'period':period})
    assert exported.headers['content-type'].startswith('text/csv')
    lines = list(csv.DictReader(exported.text.splitlines()))
    assert sum(int(line['amount_minor']) for line in lines if line['direction']=='debit') == sum(
        int(line['amount_minor']) for line in lines if line['direction']=='credit'
    )
    assert any(line['source_id']==receipt['payment']['id'] for line in lines)
    checks = await request(client,owner,'GET',finance+'/reconciliation')
    assert checks['journal']['balanced'] and checks['summary']['ok']


@pytest.mark.asyncio
async def test_journey_projects_exact_practice_results_without_private_material(journey):
    conn,client=journey
    owner=await create_actor(conn,'Centre Owner','owner')
    learner=await create_actor(conn,'Practice Learner','student')
    peer=await create_actor(conn,'Practice Peer','student')
    passage=await conn.fetchval("""INSERT INTO reading_passages(title,body_text,publication_state)
       VALUES('Fixture passage','The evidence names a lighthouse.','published') RETURNING id""")
    reading_question=await conn.fetchval("""INSERT INTO reading_questions(passage_id,"order",type,type_code,
       question_text,correct_answer,explanation)
       VALUES($1,1,'short_answer','short_answer','Name the building.','lighthouse','Private reading key')
       RETURNING id""",passage)
    reading=await request(client,learner,'POST','/api/reading/attempts',json={'passageId':str(passage)})
    assert (await request(client,learner,'POST','/api/reading/attempts/'+reading['id']+'/submit',
                          json={'answers':[{'questionId':str(reading_question),'answer':'lighthouse'}]}))['score']==1
    listening=await conn.fetchval("""INSERT INTO listening_tests(created_by_user_id,title,audio_type,audio_url,publication_state)
       VALUES($1,'Fixture listening','audio','/api/resources/listening/fixture.mp3','published') RETURNING id""",owner['id'])
    listening_question=await conn.fetchval("""INSERT INTO listening_questions(test_id,"order",type,type_code,
       question_text,correct_answer,explanation)
       VALUES($1,1,'short_answer','short_answer','Write the place.','station','Private listening key')
       RETURNING id""",listening)
    attempt=await request(client,learner,'POST','/api/listening/attempts',json={'testId':str(listening)})
    assert (await request(client,learner,'POST','/api/listening/attempts/'+attempt['id']+'/submit',
                          json={'answers':[{'questionId':str(listening_question),'answer':'station'}]}))['score']==1
    speaking=await request(client,learner,'POST','/api/speaking/attempts',json={'part':'general'})
    sid=speaking['attempt']['id']
    # Exercise submission with an isolated storage reference and the configured no-STT path.
    await conn.execute("""UPDATE speaking_attempts SET recording_object_key='speaking/test-only.webm',
         recording_mime_type='audio/webm',recording_size=500 WHERE id=$1""",sid)
    result=await request(client,learner,'POST','/api/speaking/attempts/'+sid+'/submit',json={'durationMs':4000})
    assert result['recordingSaved'] is True and result['evaluated'] is False
    events=(await request(client,learner,'GET','/api/academy/journey'))['items']
    by_kind={item['kind']:item for item in events}
    assert set(by_kind)=={'reading_completed','listening_completed','speaking_submitted'}
    assert by_kind['reading_completed']['score']==by_kind['listening_completed']['score']==1
    assert all(value not in json.dumps(events) for value in
               ('lighthouse','Private reading key','Private listening key','test-only.webm'))
    assert (await request(client,peer,'GET','/api/academy/journey'))['items']==[]


@pytest.mark.asyncio
async def test_rescue_evidence_and_thresholds_respect_the_live_teacher_roster(journey):
    conn, client = journey
    owner = await create_actor(conn, 'Rescue Owner', 'owner')
    admin = await create_actor(conn, 'Rescue Admin', 'admin')
    teacher = await create_actor(conn, 'Rescue Teacher', 'teacher')
    outsider = await create_actor(conn, 'Rescue Outsider', 'teacher')
    guardian = await create_actor(conn, 'Rescue Guardian', 'guardian')
    learner = await create_actor(conn, 'Rescue Learner', 'student')
    peer = await create_actor(conn, 'Rescue Peer', 'student')
    course = await conn.fetchval("INSERT INTO courses(slug,title) VALUES('rescue','Rescue IELTS') RETURNING id")
    body = {'id':str(uuid4()),'courseId':str(course),'teacherIds':[str(teacher['id'])],
            'name':'Rescue IELTS','branch':'Tashkent','room':'101','capacity':4,
            'startsOn':str(today()-timedelta(days=10)),'status':'active'}
    group = await request(client, owner, 'POST', API+'/groups', 201, json=body)
    group_path = API+'/groups/'+group['id']
    for person in (learner, peer):
        await request(client, owner, 'POST', group_path+'/memberships', 201,
                      json={'studentId':str(person['id'])})
    await request(client, owner, 'POST', '/api/admin/roster', 303, data={
        'action':'assign','teacherId':str(teacher['id']),'studentId':str(learner['id']),
    })
    route = API+'/rescue'
    await request(client, guardian, 'GET', route, 403)
    await request(client, learner, 'GET', route, 403)
    await request(client, teacher, 'PUT', route+'/thresholds', 403, json={})
    await request(client, admin, 'PUT', route+'/thresholds', 403, json={})
    original = await request(client, owner, 'GET', route)
    assert {item['status'] for item in original['items']} == {'insufficient_data'}
    assert (await request(client, outsider, 'GET', route))['items'] == []
    settings = {**original['thresholds'], 'minimumMarkedSessions':2}
    saved = await request(client, owner, 'PUT', route+'/thresholds', json=settings)
    assert saved['revision'] == 2
    assert await request(client, owner, 'PUT', route+'/thresholds', json=settings) == saved
    await request(client, owner, 'PUT', route+'/thresholds', 409,
                  json={**settings,'minimumMarkedSessions':3})
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.rescue.thresholds_updated'") == 1

    await conn.execute("""UPDATE academy_group_memberships
                           SET starts_on=current_date-10,activated_on=current_date-10""")
    for offset, status in [(1,'absent'),(2,'absent'),(3,'excused'),(4,'not_marked')]:
        occurred = datetime.now(ZoneInfo('Asia/Tashkent'))-timedelta(days=offset)
        session = await conn.fetchval("""INSERT INTO academy_sessions(group_id,series_id,branch,room,starts_at,ends_at,status)
            VALUES($1,$2,'Tashkent','101',$3,$3::timestamptz+interval '1 hour','held') RETURNING id""",
            group['id'], uuid4(), occurred)
        await conn.execute("""INSERT INTO academy_attendance(session_id,membership_id,student_user_id,status,marked_at)
            SELECT $1,id,student_user_id,$2::varchar,CASE WHEN $2::varchar='not_marked' THEN NULL ELSE now() END
              FROM academy_group_memberships WHERE student_user_id=$3""", session, status, learner['id'])
    assigned=[]
    for offset in (1,2):
        task = await conn.fetchval("""INSERT INTO assignments(title,created_by_user_id,target_user_id,due_at)
            VALUES('Overdue evidence',$1,$2,now()-$3::int*interval '1 day') RETURNING id""",
            teacher['id'],learner['id'],offset)
        assigned.append(str(await conn.fetchval("""INSERT INTO assignment_targets(assignment_id,student_user_id,due_at)
            VALUES($1,$2,now()-$3::int*interval '1 day') RETURNING id""",task,learner['id'],offset)))
    reading = await conn.fetchval("""INSERT INTO reading_passages(title,body_text,publication_state)
        VALUES('Comparable passage','Synthetic text.','published') RETURNING id""")
    score_ids=[]
    for offset, score in [(3,30),(1,20)]:
        score_ids.append(str(await conn.fetchval("""INSERT INTO reading_attempts(
            user_id,passage_id,status,score,total_questions,submitted_at)
            VALUES($1,$2,'completed',$3,40,now()-$4::int*interval '1 day') RETURNING id""",
            learner['id'],reading,score,offset)))
    queue = await request(client, teacher, 'GET', route, params={'status':'needs_support'})
    assert len(queue['items'])==1
    item = queue['items'][0]
    assert (item['studentId'],item['groupId'],item['thresholdVersion']) == (str(learner['id']),group['id'],2)
    signals = {reason['ruleId']:reason for reason in item['reasons']}
    assert signals['attendance']['sampleSize']==2
    assert signals['attendance']['value']==0
    assert set(signals['overdue_assignments']['evidenceIds'])==set(assigned)
    assert signals['ielts_practice_drop']['value']==25
    assert signals['ielts_practice_drop']['evidenceIds']==score_ids
    assert item['priority']==3
    assert (await request(client, teacher, 'GET', route, params={'group_id':str(uuid4())}))['items']==[]
    assert (await request(client, owner, 'GET', route, params={'status':'insufficient_data'}))['items'][0]['studentId']==str(peer['id'])
    linked_second = await create_actor(conn,'Second assigned teacher','teacher')
    await conn.execute("INSERT INTO academy_group_teachers VALUES($1,$2)",group['id'],linked_second['id'])
    await request(client, owner, 'POST', '/api/admin/roster', 303, data={
        'action':'assign','teacherId':str(linked_second['id']),'studentId':str(learner['id']),
    })
    actions = route+'/'+group['id']+'/'+str(learner['id'])+'/actions'
    await request(client, outsider, 'GET', actions, 404)
    await request(client, teacher, 'GET', actions+'/assignees',403)
    choices = await request(client, owner, 'GET', actions+'/assignees')
    assert {entry['id'] for entry in choices['teachers']} == {str(teacher['id']),str(linked_second['id'])}
    await request(client, guardian, 'GET', actions, 403)
    await request(client, teacher, 'GET', route+'/'+group['id']+'/'+str(peer['id'])+'/actions', 404)

    def command(revision, action, **fields):
        return {'id':str(uuid4()),'revision':revision,'action':action,'reason':'Support check',**fields}

    first, second = command(0,'claim'), command(0,'claim')
    async def claim(actor, body):
        result = await client.post(actions,headers={'origin':'https://journey.test',
            'cookie':SESSION_COOKIE+'='+issue_token(actor)},json=body)
        return actor,body,result
    attempts = await asyncio.gather(claim(teacher,first),claim(linked_second,second))
    assert sorted(result.status_code for _,_,result in attempts)==[200,409]
    winner,won,claim_response = next(attempt for attempt in attempts if attempt[-1].status_code==200)
    loser = next(attempt[0] for attempt in attempts if attempt[-1].status_code==409)
    assert claim_response.json()['assignedTo']==str(winner['id'])
    assert await request(client,winner,'POST',actions,json=won)==claim_response.json()
    await request(client,winner,'POST',actions,409,json={**won,'reason':'Different payload'})
    await request(client,loser,'POST',actions,403,json=command(1,'note'))
    await request(client,winner,'POST',actions,json=command(1,'note'))
    await request(client,winner,'POST',actions,json=command(2,'plan',followUpOn=str(today()+timedelta(days=1))))
    await request(client,winner,'POST',actions,json=command(3,'follow_up'))
    await request(client,winner,'POST',actions,json=command(4,'resolve'))
    resolved = await request(client,owner,'GET',route,params={'workflow':'resolved'})
    assert len(resolved['items'])==1 and resolved['items'][0]['studentId']==item['studentId']
    await request(client,owner,'POST',actions,json=command(5,'reopen'))
    await request(client,owner,'POST',actions,409,json=command(6,'assign',assignee=str(outsider['id'])))
    await request(client,owner,'POST',actions,json=command(6,'assign',assignee=str(teacher['id'])))
    await request(client,teacher,'POST',actions,json=command(7,'dismiss'))
    history = await request(client,teacher,'GET',actions)
    assert [action['action'] for action in history['items']]==[
        'dismiss','assign','reopen','resolve','follow_up','plan','note','claim']
    assert all(action['createdAt'] and action['actorId'] and action['reason'] for action in history['items'])
    assert history['items'][5]['followUpOn']==str(today()+timedelta(days=1))
    assert await conn.fetchval("SELECT count(*) FROM academy_rescue_actions")==8
    await conn.execute('DELETE FROM teacher_student_links WHERE teacher_user_id=$1',teacher['id'])
    assert (await request(client, teacher, 'GET', route))['items']==[]
    admin_items = (await request(client, admin, 'GET', route, params={'status':'needs_support'}))['items']
    assert len(admin_items)==1 and admin_items[0]['studentId']==item['studentId']
    assert admin_items[0]['reasons']==item['reasons']

    await conn.execute("UPDATE users SET account_status='suspended' WHERE id=$1",learner['id'])
    await request(client,owner,'DELETE','/api/admin/users/'+str(learner['id']))
    assert await conn.fetchval("SELECT count(*) FROM academy_rescue_cases")==0
    assert await conn.fetchval("SELECT count(*) FROM academy_rescue_actions")==0
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='account.deleted'")==1

    # A learner with real journal history remains protected.
    statement = await conn.fetchval("""INSERT INTO finance_journal_entries(
        transaction_id, source_type, source_id, student_user_id)
        VALUES($1,'fixture',$2,$3) RETURNING id""",uuid4(),uuid4(),peer['id'])
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='finance_journal_is_append_only'):
        await conn.execute('UPDATE finance_journal_entries SET memo=$2 WHERE id=$1',statement,'Changed')
    with pytest.raises(asyncpg.ObjectNotInPrerequisiteStateError,match='finance_journal_is_append_only'):
        await conn.execute('DELETE FROM users WHERE id=$1',peer['id'])
    assert await conn.fetchval('SELECT student_user_id FROM finance_journal_entries WHERE id=$1',statement)==peer['id']


@pytest.mark.asyncio
async def test_coin_daily_claim_with_migrated_user_roles(journey):
    conn, client = journey
    owner = await create_actor(conn, 'Coin Owner', 'owner')
    guardian = await create_actor(conn, 'Coin Guardian', 'guardian')
    endpoint = '/api/coins/daily/claim'
    await request(client, guardian, 'POST', endpoint, 403)
    first = await request(client, owner, 'POST', endpoint)
    retry = await request(client, owner, 'POST', endpoint)
    assert first['awarded'] == 1 and retry['awarded'] == 0
    assert await conn.fetchval('SELECT count(*) FROM coin_ledger WHERE user_id=$1', owner['id']) == 1
