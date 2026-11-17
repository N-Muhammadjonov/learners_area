"""Owner statistics and landing-to-profile checks on disposable PostgreSQL."""
from datetime import datetime, timezone

import pytest
import pytest_asyncio
import httpx

from app.asgi import application
from test_academy_learning_journey import journey, create_actor, request
from test_public_level_hint import payload


@pytest_asyncio.fixture
async def browser_journey(journey):
    conn, _ = journey
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application),
                                 base_url='https://journey.test') as client:
        yield conn, client


@pytest.mark.asyncio
async def test_owner_module_history_is_paged_student_only_and_role_scoped(browser_journey):
    conn, client = browser_journey
    owner = await create_actor(conn, 'QA statistics owner', 'owner')
    student = await create_actor(conn, 'QA statistics learner', 'student')
    teacher = await create_actor(conn, 'QA statistics teacher', 'teacher')
    passage = await conn.fetchval("""INSERT INTO reading_passages(title,body_text,publication_state)
        VALUES('QA statistics passage','Synthetic text.','published') RETURNING id""")
    for actor, count in ((student, 26), (owner, 2)):
        await conn.execute("""INSERT INTO reading_attempts(user_id,passage_id,status,score,total_questions)
            SELECT $1,$2,'completed',3,4 FROM generate_series(1,$3::int)""", actor['id'], passage, count)
    route = '/api/frontend/staff/centre-statistics'
    first = (await request(client, owner, 'GET', route, params={'module':'reading'}))['data']
    assert (first['selected'], first['history']['total'], first['history']['pages']) == ('reading',26,2)
    assert len(first['history']['rows']) == 25
    assert all(row['studentId'] == str(student['id']) for row in first['history']['rows'])
    assert sum(row['count'] for row in first['daily']) == 26
    second = (await request(client, owner, 'GET', route, params={'module':'reading','page':2}))['data']
    assert len(second['history']['rows']) == 1
    assert second['history']['rows'][0]['id'] not in {r['id'] for r in first['history']['rows']}
    empty = (await request(client, owner, 'GET', route, params={'module':'listening'}))['data']
    assert empty['history']['total'] == 0 and empty['history']['rows'] == []
    for actor in (student, teacher):
        await request(client, actor, 'GET', route, expected=403)


@pytest.mark.asyncio
async def test_landing_answers_fill_profile_once_and_preserve_manual_level(journey):
    conn, client = journey
    student = await create_actor(conn, 'QA landing learner', 'student')
    route = '/api/study-plan/monthly/sequence/level'
    data = payload()
    data['created_at'] = datetime.now(timezone.utc).isoformat()
    data['level'] = 'A1'
    result = await request(client, student, 'POST', route+'/landing/import', json=data)
    assert result == {'state':'saved'}
    assert (await request(client, student, 'GET', route))['currentLevel'] == 'C2'
    assert await conn.fetchval('SELECT current_level FROM onboarding_profiles WHERE user_id=$1',student['id']) == 'C2'
    await request(client, student, 'POST', route+'/manual', json={'level':'B1'})
    assert (await request(client, student, 'POST', route+'/landing/import', json=data)) == {'state':'ignored'}
    assert (await request(client, student, 'GET', route))['currentLevel'] == 'B1'
    await request(client, student, 'POST', route+'/start', json={'level':'B2'},expected=201)
    resumed = await request(client, student, 'GET', route)
    assert resumed['state'] == 'quiz' and resumed['currentLevel'] == 'B1'
