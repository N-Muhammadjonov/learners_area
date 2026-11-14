"""Check cohort transactions and HTTP authorization against disposable PostgreSQL."""
from __future__ import annotations

import asyncio
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import pytest
import pytest_asyncio

from _finance_schema import DSN, create_disposable_schema
from app import academy_groups as groups
from app import main

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'
MIGRATION = '1122_academy_groups.sql'
BASE = """
ALTER TABLE courses ADD COLUMN is_active boolean NOT NULL DEFAULT true;
CREATE TABLE enrollments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    course_id uuid NOT NULL REFERENCES courses(id),
    enrolled_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE audit_log (
    actor_user_id uuid, action text, target_type text, target_id text, metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
"""


@pytest_asyncio.fixture
async def academy(monkeypatch):
    conn = await asyncpg.connect(DSN)
    schema = 'academy_test_' + uuid4().hex
    pool = None
    try:
        await create_disposable_schema(conn, schema)
        await conn.execute(BASE)
        for filename in ('0035_teacher_student_links.sql', MIGRATION, '1123_academy_sessions.sql'):
            await conn.execute((MIGRATIONS / filename).read_text())
        actors = {}
        for key, role in [('owner', 'owner'), ('admin', 'admin'), ('teacher', 'teacher'),
                          ('other_teacher', 'teacher'), ('student', 'student'),
                          ('second', 'student'), ('third', 'student'), ('guardian', 'guardian')]:
            actors[key] = await conn.fetchval(
                "INSERT INTO users(name,role) VALUES($1,$2) RETURNING id", key, role)
        course = await conn.fetchval("INSERT INTO courses(title) VALUES('IELTS') RETURNING id")
        pool = await asyncpg.create_pool(
            DSN, min_size=1, max_size=5, server_settings={'search_path': f'"{schema}", public'})

        async def test_pool():
            return pool

        async def signed_in(req, active=False):
            key = req.headers.get('x-test-user')
            if not key:
                return None
            role = 'teacher' if key == 'other_teacher' else key
            return {'id': actors[key], 'role': role}

        monkeypatch.setattr(main, 'pool', test_pool)
        monkeypatch.setattr(main, 'current_user', signed_in)
        monkeypatch.setenv('APP_ENV', 'test')
        monkeypatch.setenv('RATE_LIMIT_BACKEND', 'memory')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=main.app),
                                     base_url='https://academy.test') as client:
            yield conn, pool, actors, course, client
    finally:
        if pool:
            await pool.close()
        await conn.execute('SET search_path TO public')
        await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
        await conn.close()


def fields(course, teacher, *, capacity=1, name='IELTS morning'):
    return {'id': str(uuid4()), 'courseId': str(course), 'teacherIds': [str(teacher)], 'name': name,
            'branch': 'Tashkent', 'room': '203', 'feePlanLabel': 'Monthly', 'capacity': capacity,
            'startsOn': groups.today().isoformat(), 'status': 'active'}


async def send(client, method, path, role='owner', **kwargs):
    headers = {'origin': 'https://academy.test', **({'x-test-user': role} if role else {})}
    return await client.request(method, '/api/staff/academy' + path, headers=headers, **kwargs)


async def create(client, course, actors, **kwargs):
    data = fields(course, actors['teacher'], **kwargs)
    result = await send(client, 'POST', '/groups', json=data)
    assert result.status_code == 201, result.text
    return result.json(), data


@pytest.mark.asyncio
async def test_same_last_seat_concurrent_writes_have_one_winner(academy):
    conn, _, actors, course, client = academy
    group, _ = await create(client, course, actors)
    path = '/groups/' + group['id'] + '/memberships'
    responses = await asyncio.gather(*(send(client, 'POST', path, 'admin',
                                             json={'studentId': str(actors[key])})
                                       for key in ('student', 'second')))
    assert sorted(response.status_code for response in responses) == [201, 409]
    assert next(r for r in responses if r.status_code == 409).json() == {'error': 'group_full'}
    assert await conn.fetchval('SELECT count(*) FROM academy_group_memberships') == 1
    assert await conn.fetchval('SELECT count(*) FROM enrollments') == 1
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.group.enrolled'") == 1


@pytest.mark.asyncio
async def test_transfer_is_atomic_audited_idempotent_and_preserves_course_access(academy):
    conn, _, actors, course, client = academy
    source, _ = await create(client, course, actors)
    target, _ = await create(client, course, actors, name='IELTS afternoon')
    source_path = '/groups/' + source['id'] + '/memberships'
    target_path = '/groups/' + target['id'] + '/memberships'
    enrolled = await send(client, 'POST', source_path, json={'studentId': str(actors['student'])})
    blocker = await send(client, 'POST', target_path, json={'studentId': str(actors['second'])})
    assert enrolled.status_code == blocker.status_code == 201
    old = enrolled.json()
    command = {'revision': old['revision'], 'groupId': target['id']}
    transfer_path = source_path + '/' + old['id'] + '/transfer'
    refused = await send(client, 'POST', transfer_path, json=command)
    assert refused.json() == {'error': 'group_full'}
    assert await conn.fetchval("SELECT count(*) FROM academy_group_memberships WHERE status='active'") == 2
    stop = await send(client, 'PUT', target_path + '/' + blocker.json()['id'],
                      json={'revision': 1, 'status': 'withdrawn'})
    assert stop.status_code == 200, stop.text
    moved = await send(client, 'POST', transfer_path, json=command)
    assert moved.status_code == 201, moved.text
    assert moved.json()['transferred_from_id'] == old['id']
    replay = await send(client, 'POST', transfer_path, json=command)
    assert replay.json() == moved.json()
    assert await conn.fetchval('SELECT count(*) FROM enrollments WHERE user_id=$1', actors['student']) == 1
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.group.transferred'") == 1
    history = await send(client, 'GET', '/students/' + str(actors['student']) + '/groups')
    assert {item['status'] for item in history.json()['memberships']} == {'active', 'transferred'}


@pytest.mark.asyncio
async def test_permissions_revisions_duplicate_members_and_archive_preserve_history(academy):
    conn, _, actors, course, client = academy
    group, submitted = await create(client, course, actors, capacity=2)
    path = '/groups/' + group['id']
    repeated = await send(client, 'POST', '/groups', json=submitted)
    assert group == repeated.json()
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.group.created'") == 1
    assert (await send(client, 'GET', path, None)).status_code == 401
    assert (await send(client, 'GET', path, 'guardian')).status_code == 403
    assert (await send(client, 'GET', path, 'other_teacher')).status_code == 404
    teacher = await send(client, 'GET', path, 'teacher')
    assert teacher.status_code == 200 and 'fee_plan_label' not in teacher.json()['group']
    assert teacher.headers['cache-control'] == 'private, no-store'
    assert (await send(client, 'GET', '/groups', 'other_teacher')).json()['groups'] == []
    assert 'fee_plan_label' not in (await send(client, 'GET', '/groups', 'teacher')).json()['groups'][0]
    assert (await send(client, 'GET', '/lookups/student', 'teacher')).status_code == 403
    assert (await send(client, 'POST', path + '/memberships', 'teacher', json={})).status_code == 403
    assert (await client.post('/api/staff/academy/groups', json=submitted, headers={
        'x-test-user': 'owner', 'origin': 'https://foreign.test'})).status_code == 403
    data = {'studentId': str(actors['student']), 'status': 'pending'}
    enrolled = await send(client, 'POST', path + '/memberships', json=data)
    assert enrolled.status_code == 201 and (await send(client, 'POST', path + '/memberships', json=data)).json() == enrolled.json()
    assert await conn.fetchval('SELECT count(*) FROM enrollments') == 0
    other, _ = await create(client, course, actors, name='Other group')
    assert (await send(client, 'POST', '/groups/' + other['id'] + '/memberships', json=data)).status_code == 409
    membership_path = path + '/memberships/' + enrolled.json()['id']
    active = await send(client, 'PUT', membership_path, json={'revision': 1, 'status': 'active'})
    assert active.status_code == 200
    assert await conn.fetchval('SELECT count(*) FROM enrollments') == 1
    values = {key: val for key, val in submitted.items() if key not in ('id', 'courseId')}
    blocked = await send(client, 'PUT', path, json={**values, 'status': 'archived', 'revision': 1})
    assert blocked.json() == {'error': 'group_has_members'}
    stopped = await send(client, 'PUT', membership_path, json={'revision': 2, 'status': 'completed'})
    assert stopped.status_code == 200
    archived = await send(client, 'PUT', path, json={**values, 'status': 'archived', 'revision': 1})
    assert archived.status_code == 200 and archived.json()['revision'] == 2
    assert (await send(client, 'PUT', path, json={**values, 'revision': 1})).status_code == 409
    assert (await send(client, 'GET', path)).json()['memberships'][0]['status'] == 'completed'
    assert (await send(client, 'GET', path, 'teacher')).json()['memberships'] == []


@pytest.mark.asyncio
async def test_public_roles_have_no_direct_table_access(academy):
    conn, _, _, _, _ = academy
    for table in ('academy_groups', 'academy_group_teachers', 'academy_group_memberships'):
        assert await conn.fetchval(
            "SELECT relrowsecurity FROM pg_class WHERE oid=to_regclass($1)", table)
        for role in ('anon', 'authenticated', 'service_role'):
            for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                assert not await conn.fetchval(
                    'SELECT has_table_privilege($1,$2,$3)', role, table, privilege)


@pytest.mark.asyncio
async def test_concurrent_enrolments_for_one_student_cannot_claim_two_groups(academy):
    conn, _, actors, course, client = academy
    first, _ = await create(client, course, actors)
    second, _ = await create(client, course, actors, name='IELTS afternoon')
    responses = await asyncio.gather(*(send(client, 'POST', '/groups/' + g['id'] + '/memberships',
                                             json={'studentId': str(actors['student'])})
                                       for g in (first, second)))
    assert sorted(response.status_code for response in responses) == [201, 409]
    loser = next(response for response in responses if response.status_code == 409)
    assert loser.json() == {'error': 'student_has_current_group'}
    assert await conn.fetchval('SELECT count(*) FROM academy_group_memberships WHERE ends_on IS NULL') == 1


@pytest.mark.asyncio
async def test_future_group_accepts_pending_enrollment_but_cannot_activate_it(academy):
    from datetime import timedelta

    conn, _, actors, course, client = academy
    data = fields(course, actors['teacher'])
    data['startsOn'] = (groups.today() + timedelta(days=2)).isoformat()
    created = await send(client, 'POST', '/groups', json=data)
    assert created.status_code == 201
    path = '/groups/' + data['id'] + '/memberships'
    pending = await send(client, 'POST', path, json={
        'studentId': str(actors['student']), 'status': 'pending',
    })
    assert pending.status_code == 201
    denied = await send(client, 'PUT', path + '/' + pending.json()['id'],
                        json={'revision': 1, 'status': 'active'})
    assert denied.json() == {'error': 'group_not_accepting'}
    assert await conn.fetchval('SELECT count(*) FROM enrollments') == 0


def booking(**overrides):
    from datetime import timedelta
    return {'seriesId': str(uuid4()), 'room': '203',
            'localDate': (groups.today() + timedelta(days=1)).isoformat(),
            'localStart': '10:00', 'durationMinutes': 60, **overrides}


@pytest.mark.asyncio
@pytest.mark.parametrize('factor', ['room', 'teacher', 'group'])
async def test_concurrent_scheduling_prevents_overlapping_resources(academy, factor):
    conn, _, actors, course, client = academy
    first, _ = await create(client, course, actors)
    other, _ = await create(client, course, actors, name='Group B')
    target = first if factor == 'group' else other
    path_a = '/groups/' + first['id'] + '/sessions'
    path_b = '/groups/' + target['id'] + '/sessions'
    one, two = await asyncio.gather(
        send(client, 'POST', path_a, json=booking()),
        send(client, 'POST', path_b, json=booking(
            room=' 203 ' if factor == 'room' else '204',
            teacherIds=[str(actors['teacher' if factor == 'teacher' else 'other_teacher'])])),
    )
    assert sorted(r.status_code for r in (one, two)) == [201, 409]
    failed = next(r for r in (one, two) if r.status_code == 409)
    assert failed.json() == {'error': 'schedule_overlap'}
    assert await conn.fetchval('SELECT count(*) FROM academy_sessions') == 1
    assert await conn.fetchval('SELECT count(*) FROM academy_session_reservations') == 3


@pytest.mark.asyncio
async def test_recurrence_preserves_holiday_and_reschedule_releases_original_booking(academy):
    from datetime import date, datetime, timedelta

    conn, _, actors, course, client = academy
    group, _ = await create(client, course, actors)
    path = '/groups/' + group['id'] + '/sessions'
    data = booking(weeks=2)
    data['holidayDates'] = [(date.fromisoformat(data['localDate']) + timedelta(days=7)).isoformat()]
    scheduled = await send(client, 'POST', path, json=data)
    assert scheduled.status_code == 201, scheduled.text
    first, holiday = scheduled.json()['sessions']
    assert holiday['status'] == 'cancelled' and holiday['reason'] == 'holiday'
    assert datetime.fromisoformat(first['starts_at']).hour == 5  # 10:00 Asia/Tashkent
    assert (await send(client, 'POST', path, json=data)).json() == scheduled.json()
    assert (await send(client, 'POST', path, 'teacher', json=data)).status_code == 403
    assert (await send(client, 'GET', path, 'other_teacher')).status_code == 404
    command = {key: data[key] for key in ('room', 'localDate', 'durationMinutes')}
    command.update(localStart='11:00', replacementId=str(uuid4()), revision=1, reason='Room availability')
    change_path = path + '/' + first['id'] + '/reschedule'
    moved = await send(client, 'POST', change_path, json=command)
    assert moved.status_code == 201, moved.text
    assert moved.json()['replaces_id'] == first['id']
    assert (await send(client, 'POST', change_path, json=command)).json() == moved.json()
    held = await send(client, 'PUT', path + '/' + moved.json()['id'],
                      json={'status': 'held', 'revision': 1})
    assert held.json() == {'error': 'session_not_ended'}
    cancel = await send(client, 'PUT', path + '/' + moved.json()['id'],
                        json={'status': 'cancelled', 'revision': 1, 'reason': 'Weather'})
    assert cancel.status_code == 200, cancel.text
    assert await conn.fetchval('SELECT count(*) FROM academy_session_reservations') == 0
    roster = await send(client, 'GET', path, 'teacher')
    assert {row['status'] for row in roster.json()['sessions']} == {'rescheduled', 'cancelled'}
    assert await conn.fetchval("SELECT count(*) FROM audit_log WHERE action='academy.session.rescheduled'") == 1
