"""End-to-end classroom-to-Writing proof using an isolated native PostgreSQL database."""
from __future__ import annotations

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
from app import main
from app.academy_groups import today
from app.db import initialize_connection
from app.security import SESSION_COOKIE, issue_token

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parents[1]
API = '/api/staff/academy'


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


@pytest.mark.asyncio
async def test_classroom_writing_teacher_feedback_and_guardian_progress(journey):
    conn,client=journey
    owner=await create_actor(conn,'Centre Owner','owner')
    teacher=await create_actor(conn,'Assigned Teacher','teacher')
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
    await request(client,owner,'POST',path+'/memberships',201,json={'studentId':str(learner['id'])})
    # This deliberate opt-in is the site's existing independent teaching authority.
    await request(client,owner,'POST','/api/admin/roster',303,
                  data={'action':'assign','teacherId':str(teacher['id']),'studentId':str(learner['id'])})
    today_date=today()
    now_tashkent=datetime.now(ZoneInfo('Asia/Tashkent'))
    lesson_day=today_date if now_tashkent.hour>=2 else today_date-timedelta(days=1)
    if lesson_day!=today_date:
        await conn.execute('UPDATE academy_group_memberships SET starts_on=$1,activated_on=$1',lesson_day)
    book={'seriesId':str(uuid4()),'room':'101','localDate':str(lesson_day),
          'localStart':'00:00','durationMinutes':15}
    lessons=await request(client,owner,'POST',path+'/sessions',201,json=book)
    lesson=path+'/sessions/'+lessons['sessions'][0]['id']
    await request(client,owner,'PUT',lesson,json={'status':'held','revision':1})
    await request(client,outsider,'GET',lesson+'/attendance',403)
    await request(client,teacher,'PUT',lesson+'/attendance',json={
        'id':str(uuid4()),'marks':[{'studentId':str(learner['id']),'revision':1,'status':'present'}]})

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
    await request(client,learner,'POST',f'/api/guardians/links/{link}/revoke')
    await request(client,parent,'GET',child+'/progress',403,params={'region':'progressSummary'})
    await request(client,parent,'GET',child+'/journey',403)


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
