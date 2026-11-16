"""Concurrent money, scoped reads and AI outage on disposable PostgreSQL."""
from __future__ import annotations

import asyncio
from uuid import uuid4

import pytest

from app import academy_assistant as assistant, academy_attendance, tuition_ledger as ledger
from test_self_service_payments import (
    child_path, family, journey, new_intent, pay, payme_config, request, rpc,
)
from test_academy_learning_journey import create_actor


@pytest.mark.asyncio
async def test_ai_outage_during_cash_retries_and_provider_replays_preserves_both_children(family, payme_config, monkeypatch):
    conn, client, actors, _ = family
    for key, value in {
        'RIWI_EXTERNAL_AI_ENABLED': '1', 'AI_EXTERNAL_ENABLED': 'true',
        'ACADEMY_AI_EXTERNAL_ENABLED': '1', 'ACADEMY_AI_PROVIDER_VERIFIED': '1',
        'AI_GATEWAY_API_KEY': 'isolated-model-key', 'AI_GATEWAY_MODEL': 'fixture/model',
    }.items():
        monkeypatch.setenv(key, value)

    async def unavailable(*args, **kwargs):
        raise TimeoutError('isolated model outage')

    monkeypatch.setattr(assistant.gateway, 'completion', unavailable)
    intent = await new_intent(client, actors['guardian'], child_path(actors) + '/intents')
    await pay(client, payme_config, intent, tx='mixed-provider-event', perform=False)
    cash = {
        'studentUserId': str(actors['student']['id']), 'amountMinor': 50000,
        'idempotencyKey': 'mixed-cash-retry', 'method': 'cash', 'confirm': True,
    }

    async def cash_retry() -> dict:
        return await request(client, actors['admin'], 'POST', '/api/staff/finance/payments', json=cash)

    async def callback() -> dict:
        return await rpc(client, payme_config, 'PerformTransaction', {'id': 'mixed-provider-event'})

    async def scoped_reads() -> None:
        for _ in range(3):
            own = await request(client, actors['student'], 'GET', '/api/finance/me/payments')
            assert own['beneficiaryStudentId'] == str(actors['student']['id'])
            sibling = await request(client, actors['guardian'], 'GET', child_path(actors, 'second'))
            assert sibling['position']['balanceDueMinor'] == 300000
            await request(client, actors['student'], 'GET', '/api/academy/calendar')
            await request(client, actors['teacher'], 'GET', '/api/staff/academy/today')
            await request(client, actors['other_guardian'], 'GET', child_path(actors), 403)

    async def payment_help() -> dict:
        result = await request(client, actors['guardian'], 'POST',
            f"/api/guardian/children/{actors['student']['id']}/assistant", json={'action': 'payment_help'})
        assert result['mode'] == 'fallback' and result['canExecute'] is False
        return result

    cash_results, callbacks, _, _ = await asyncio.gather(
        asyncio.gather(*(cash_retry() for _ in range(5))),
        asyncio.gather(*(callback() for _ in range(20))),
        scoped_reads(), payment_help(),
    )
    assert sum(not row['duplicate'] for row in cash_results) == 1
    assert all(row['result']['state'] == 2 for row in callbacks)
    final = await request(client, actors['student'], 'GET', '/api/finance/me/payments')
    assert final['position']['balanceDueMinor'] == 700000
    assert final['position']['advanceMinor'] == 0
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments') == 2
    assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events') == 1
    assert (await ledger.journal_is_balanced(conn))['balanced']


@pytest.mark.asyncio
async def test_mass_attendance_and_acknowledged_exam_drafts_survive_payment_retries(family):
    conn, client, actors, _ = family
    course = await conn.fetchval("INSERT INTO courses(slug,title) VALUES('mixed-exam','Mixed exam QA') RETURNING id")
    group = await conn.fetchval('''INSERT INTO academy_groups(course_id,name,branch,room,capacity,starts_on)
        VALUES($1,'Exam class','QA','Exam room',40,current_date-1) RETURNING id''', course)
    session = await conn.fetchval('''INSERT INTO academy_sessions(group_id,series_id,branch,room,starts_at,ends_at,status)
        VALUES($1,$2,'QA','Exam room',now()-interval '1 hour',now()-interval '30 minutes','held') RETURNING id''', group, uuid4())
    await conn.execute('INSERT INTO academy_session_teachers(session_id,teacher_user_id) VALUES($1,$2)', session, actors['teacher']['id'])
    students, attempts = [], []
    for index in range(40):
        student = await create_actor(conn, 'Mixed examinee ' + str(index), 'student')
        students.append(student)
        await conn.execute('''INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,starts_on,activated_on,status)
            VALUES($1,$2,$3,current_date-1,current_date-1,'active')''', group, course, student['id'])
        attempt = await conn.fetchval('INSERT INTO mock_attempts(user_id,started_at) VALUES($1,now()) RETURNING id', student['id'])
        attempts.append(attempt)
        await conn.execute('''INSERT INTO mock_section_submissions(attempt_id,skill,status,deadline_at)
            VALUES($1,'reading','in_progress',now()+interval '1 hour')''', attempt)
    await academy_attendance.snapshot(conn, await conn.fetchrow('SELECT * FROM academy_sessions WHERE id=$1', session))
    attendance = f'/api/staff/academy/groups/{group}/sessions/{session}/attendance'
    await request(client, actors['teacher'], 'GET', attendance)
    # The held-session snapshot has forty eligible members at revision 1.
    command = {'id': str(uuid4()), 'marks': [
        {'studentId': str(student['id']), 'revision': 1, 'status': 'present'} for student in students]}

    async def save(index: int) -> None:
        path = f'/api/mocks/attempts/{attempts[index]}/sections/reading/draft'
        newest = {'revision': 8, 'answers': {'q1': 'acknowledged answer 8'}}
        acknowledged = await request(client, students[index], 'PUT', path, json=newest)
        assert acknowledged['revision'] == 8 and acknowledged['stale'] is False
        for revision in (1, 5):
            stale = await request(client, students[index], 'PUT', path,
                json={'revision': revision, 'answers': {'q1': 'late old answer'}})
            assert stale['revision'] == 8 and stale['stale'] is True

    async def cash() -> dict:
        return await request(client, actors['admin'], 'POST', '/api/staff/finance/payments', json={
            'studentUserId': str(actors['student']['id']), 'amountMinor': 1000,
            'idempotencyKey': 'mixed-attendance-cash', 'method': 'cash', 'confirm': True})

    _, _, cash_rows = await asyncio.gather(
        asyncio.gather(*(save(index) for index in range(40))),
        asyncio.gather(*(request(client, actors['teacher'], 'PUT', attendance, json=command) for _ in range(5))),
        asyncio.gather(*(cash() for _ in range(5))))
    assert sum(not row['duplicate'] for row in cash_rows) == 1
    assert await conn.fetchval("SELECT count(*) FROM academy_attendance WHERE session_id=$1 AND status='present'", session) == 40
    rows = await conn.fetch('SELECT draft_revision,answers_json FROM mock_section_submissions WHERE attempt_id=ANY($1::uuid[])', attempts)
    assert len(rows) == 40 and all(row['draft_revision'] == 8 and row['answers_json']['q1'] == 'acknowledged answer 8' for row in rows)
    await request(client, actors['outsider'], 'PUT', f'/api/mocks/attempts/{attempts[0]}/sections/reading/draft', 403,
        json={'revision': 9, 'answers': {'q1': 'unrelated user'}})
    assert await conn.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert (await ledger.student_position(conn, actors['student']['id']))['balanceDueMinor'] == 899000
    assert (await ledger.journal_is_balanced(conn))['balanced']
