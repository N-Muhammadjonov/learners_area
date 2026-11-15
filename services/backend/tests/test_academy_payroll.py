"""Payroll contracts and balanced journals over the real PostgreSQL and HTTP routes."""
from __future__ import annotations

import asyncio
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4

import pytest
import pytest_asyncio

from _finance_schema import http, staff  # noqa: F401
from test_academy_groups import BASE
from app import main, tuition_port
from app import academy_payroll as payroll
from app import tuition_ledger as ledger

MIGRATIONS = Path(__file__).resolve().parents[1] / 'migrations'
API = '/api/staff/finance/payroll'


@pytest_asyncio.fixture
async def payroll_http(http, monkeypatch):
    await http.con.execute(BASE)
    for number in (1122, 1123, 1124, 1126):
        await http.con.execute(next(MIGRATIONS.glob(f'{number}_*.sql')).read_text())
    async def signed_in(req, active=False):
        return {'id': http.people['owner'], 'role': 'owner'}

    async def no_limit(*args, **kwargs):
        return None

    monkeypatch.setattr(main, 'current_user', signed_in)
    monkeypatch.setattr(tuition_port, '_write_gate', no_limit)
    return http


def prior_period() -> tuple[date, str]:
    today = ledger.business_date(datetime.now(timezone.utc))
    previous = today.replace(day=1) - timedelta(days=1)
    return previous.replace(day=1), str(previous)[:7]


async def post(http, suffix, payload, role='owner'):
    return await staff(http, role, 'POST', API+suffix, json_body=payload)


async def make_class(http, day, *, status='held', attendance='present', hour=9, minutes=90):
    conn, users = http.con, http.people
    course = await conn.fetchval("INSERT INTO courses(title) VALUES ('IELTS') RETURNING id")
    group = await conn.fetchval(
        """INSERT INTO academy_groups(course_id,name,branch,room,capacity,starts_on,status)
           VALUES($1,'Morning','Tashkent','203',10,$2,'active') RETURNING id""", course, day)
    membership = await conn.fetchval(
        """INSERT INTO academy_group_memberships(group_id,course_id,student_user_id,status,
                  starts_on,activated_on) VALUES($1,$2,$3,'active',$4,$4) RETURNING id""",
        group, course, users['student'], day)
    start = datetime(day.year, day.month, day.day, hour, tzinfo=timezone.utc)
    session = await conn.fetchval(
        """INSERT INTO academy_sessions(group_id,series_id,branch,room,starts_at,ends_at,status)
           VALUES($1,$2,'Tashkent','203',$3,$4,$5) RETURNING id""",
        group, uuid4(), start, start+timedelta(minutes=minutes), status)
    await conn.execute('INSERT INTO academy_session_teachers VALUES($1,$2)', session, users['teacher'])
    if status == 'held':
        await conn.execute(
            """INSERT INTO academy_attendance(session_id,membership_id,student_user_id,status,marked_at)
               VALUES($1,$2,$3,$4::varchar,CASE WHEN $4::varchar='not_marked' THEN NULL ELSE now() END)""",
            session, membership, users['student'], attendance)
    return session


@pytest.mark.asyncio
async def test_payroll_hybrid_attendance_revenue_accrual_adjustment_and_payout(payroll_http):
    http = payroll_http
    start, period = prior_period()
    teacher = http.people['teacher']
    command = {'commandId': str(uuid4()), 'teacherUserId': str(teacher), 'startsOn': str(start),
               'monthlyMinor': 1_200_000, 'hourlyMinor': 100_000, 'revenueBps': 1250}
    assert (await post(http, '/rules', command, 'admin')).status_code == 403
    rule = await post(http, '/rules', command)
    assert rule.status_code == 200, rule.text
    assert (await post(http, '/rules', command)).json()['id'] == rule.json()['id']
    assert (await post(http, '/rules', {**command, 'commandId': str(uuid4())})).status_code == 409
    session = await make_class(http, start)
    await make_class(http, start+timedelta(days=1), status='cancelled')
    incomplete = await make_class(http, start+timedelta(days=2), attendance='not_marked')
    # Existing revenue recognition remains the only revenue input.
    async with http.con.transaction():
        txn = await ledger._post_journal(
            http.con, source_type='revenue_recognition', source_id=uuid4(),
            student_user_id=http.people['student'], actor_user_id=http.people['owner'], period=period,
            lines=[('deferred_tuition_revenue','debit', 400_000), ('tuition_revenue','credit', 400_000)])
    source = {'teacherUserId': str(teacher),'sessionId': str(session),'journalTransactionId':str(txn)}
    assert (await post(http, '/revenue', source)).json()['amountMinor'] == 400_000
    assert (await post(http, '/revenue', source)).status_code == 200
    assert (await post(http, '/revenue', {**source, 'sessionId': str(incomplete)})).status_code == 409
    assert (await post(http, '/revenue', {**source, 'journalTransactionId': str(uuid4())})).status_code == 422
    query = {'teacherUserId': str(teacher), 'periodKey': period}
    forbidden = await staff(http, 'teacher', 'GET', API, params=query)
    assert forbidden.status_code == 403
    read = await staff(http, 'admin', 'GET', API, params=query)
    assert read.status_code == 200, read.text
    data = read.json()
    assert data['estimate']['amountMinor'] == 1_400_000
    assert data['estimate']['pendingSessionIds'] == [str(incomplete)]
    finalize = {**query, 'expectedAmountMinor': 1_400_000, 'expectedCalculation': data['calculationHash']}
    assert (await post(http, '/finalize', finalize)).json()['error'] == 'payroll_attendance_incomplete'
    await http.con.execute("UPDATE academy_attendance SET status='absent',marked_at=now() WHERE session_id=$1",
                           incomplete)
    assert (await post(http, '/finalize', finalize)).json()['error'] == 'payroll_estimate_changed'
    data = (await staff(http, 'owner', 'GET', API, params=query)).json()
    finalize.update(expectedAmountMinor=1_550_000, expectedCalculation=data['calculationHash'])
    first, duplicate = await asyncio.gather(
        *(http.post(API+'/finalize', json=finalize) for _ in range(2)))
    assert first.status_code == duplicate.status_code == 200, (first.text, duplicate.text)
    run = first.json()
    assert run['id'] == duplicate.json()['id'] and run['accruedMinor'] == 1_550_000
    assert run['paidMinor'] == 0 and run['balanceMinor'] == 1_550_000
    assert await http.con.fetchval("SELECT count(*) FROM finance_journal_entries WHERE source_type='payroll_accrual'") == 1
    path = '/'+run['id']+'/events'
    adjust = {'commandId': str(uuid4()), 'kind': 'adjustment', 'amountMinor': -50_000, 'reference': 'Review correction'}
    assert (await post(http, path, adjust)).json()['balanceMinor'] == 1_500_000
    payout = {'commandId': str(uuid4()), 'kind': 'payout', 'amountMinor': 1_000_000, 'reference': 'Bank-A'}
    assert (await post(http, path, payout)).json()['paidMinor'] == 1_000_000
    assert (await post(http, path, payout)).json()['paidMinor'] == 1_000_000
    overdraft = await post(http, path, {**payout,'commandId':str(uuid4()), 'reference':'Bank-B'})
    assert overdraft.json()['error'] == 'payout_exceeds_payable'
    repeated_bank = await post(http, path,{**payout,'commandId':str(uuid4()),'amountMinor':100_000,
                                            'reference':'bank-a'})
    assert repeated_bank.json()['error'] == 'payroll_reference_exists'
    assert (await post(http, path, {**adjust, 'commandId': str(uuid4()), 'amountMinor': -600_000})).json()[
        'error'] == 'adjustment_below_paid'
    assert await http.con.fetchval('SELECT count(*) FROM academy_payroll_events') == 2
    assert (await ledger.journal_is_balanced(http.con))['balanced']
    actual = await http.con.fetchval(
        """SELECT sum(CASE WHEN l.direction='credit' THEN amount_minor ELSE -amount_minor END)
             FROM finance_journal_lines l JOIN finance_accounts a ON a.id=l.account_id
            WHERE a.code='salary_payable'""")
    assert actual == 500_000
    for relation in ('academy_payroll_rules','academy_payroll_runs','academy_payroll_revenue','academy_payroll_events'):
        assert await http.con.fetchval('SELECT relrowsecurity FROM pg_class WHERE oid=$1::regclass',relation)
        assert not await http.con.fetchval("SELECT has_table_privilege('authenticated',$1,'SELECT')",relation)


@pytest.mark.asyncio
async def test_payroll_effective_dates_and_accounting_close_serialize(payroll_http):
    http = payroll_http
    start, period = prior_period()
    month_length = payroll.month(period)[1].day
    teacher = http.people['teacher']
    command = {'commandId':str(uuid4()), 'teacherUserId':str(teacher), 'startsOn':str(start),
               'monthlyMinor':month_length*1000}
    first = (await post(http, '/rules', command)).json()
    ends = {'endsOn':str(start+timedelta(days=9))}
    assert (await post(http, '/rules/'+first['id']+'/end',ends)).status_code == 200
    assert (await post(http, '/rules',command)).json()['ends_on'] == ends['endsOn']
    second = {**command,'commandId':str(uuid4()),'startsOn':str(start+timedelta(days=10)),
              'monthlyMinor':0,'sessionMinor':25_000}
    assert (await post(http, '/rules',second)).status_code == 200
    await make_class(http,start+timedelta(days=11))
    request = {'teacherUserId':str(teacher),'periodKey':period}
    estimate = (await staff(http,'admin','GET',API,params=request)).json()
    assert estimate['estimate']['amountMinor'] == 35_000
    finalize = {**request,'expectedAmountMinor':35_000,'expectedCalculation':estimate['calculationHash']}
    async with http.con.transaction():
        await ledger.close_period(http.con,actor_user_id=http.people['owner'],period=period)
        waiting = asyncio.create_task(http.post(API+'/finalize',json=finalize))
        lock_waiting=False
        for _ in range(100):
            lock_waiting = await http.con.fetchval(
                """SELECT EXISTS(SELECT 1 FROM pg_locks
                                  WHERE locktype='advisory' AND mode='ShareLock'
                                    AND NOT granted AND pid<>pg_backend_pid())""")
            if lock_waiting:
                break
            await asyncio.sleep(.01)
        assert lock_waiting and not waiting.done(), waiting.result().text if waiting.done() else ''
    blocked = await waiting
    assert blocked.status_code == 409 and blocked.json()['error'] == 'period_closed'
    assert not await http.con.fetchval('SELECT 1 FROM academy_payroll_runs')


@pytest.mark.asyncio
async def test_payroll_keeps_exact_minor_units_in_browser_transport(payroll_http):
    http = payroll_http
    start, period = prior_period()
    amount = 2**53+1
    request = {'teacherUserId': str(http.people['teacher']), 'periodKey': period}
    command = {'commandId': str(uuid4()), 'teacherUserId': request['teacherUserId'],
               'startsOn': str(start), 'monthlyMinor': str(amount)}
    invalid = await post(http, '/rules', {**command,'monthlyMinor': True})
    assert invalid.status_code == 422
    rule = await post(http, '/rules', command)
    assert rule.status_code == 200 and rule.json()['monthly_minor'] == str(amount)
    data = (await staff(http, 'admin', 'GET', API, params=request)).json()
    assert data['estimate']['amountMinor'] == str(amount)
    booked = await post(http, '/finalize', {**request, 'expectedAmountMinor': str(amount),
                                           'expectedCalculation': data['calculationHash']})
    assert booked.status_code == 200 and booked.json()['accruedMinor'] == str(amount)
    assert await http.con.fetchval('SELECT accrued_minor FROM academy_payroll_runs') == amount
