"""Finance management commands, retries, statements and export on disposable PostgreSQL."""
from __future__ import annotations

import csv
import io
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from _finance_schema import http, staff  # noqa: F401
from app import main, tuition_ledger as ledger

BASE = '/api/staff/finance'


async def post(client, route, body, role='admin'):
    return await staff(client, role, 'POST', BASE + route, json_body=body)


@pytest.mark.asyncio
async def test_contract_credit_and_charge_commands_survive_retries_and_reload(http):
    day = ledger.business_date(datetime.now(timezone.utc))
    month = ledger.period_key(day)
    student = str(http.people['student'])
    body = {'commandId': str(uuid4()), 'studentUserId': student,
            'monthlyAmountMinor': 600_000, 'startsOn': str(day)}
    first = await post(http, '/contracts', body)
    assert first.status_code == 200, first.text
    contract = first.json()['contract']['id']
    repeated = await post(http, '/contracts', body)
    assert repeated.json()['contract']['id'] == contract
    changed = await post(http, '/contracts', {**body, 'monthlyAmountMinor': 700_000})
    assert changed.status_code == 409
    assert changed.json()['error'] == 'idempotency_conflict'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_contracts') == 1
    assert (await post(http, f'/contracts/{contract}/approve', {})).status_code == 403
    assert (await post(http, f'/contracts/{contract}/approve', {}, 'owner')).status_code == 200
    discount = await post(http, f'/contracts/{contract}/discounts',
                          {'periodKey': month, 'amountMinor': 100_000, 'reason': 'Scholarship'})
    assert discount.status_code == 200
    bill = await post(http, f'/contracts/{contract}/installment', {'dueDate': str(day), 'periodKey': month})
    charge = bill.json()['charge']['id']
    assert bill.json()['charge']['net_amount_minor'] == 500_000
    assert (await post(http, f'/charges/{charge}/approve', {}, 'owner')).status_code == 200
    assert (await post(http, f'/charges/{charge}/post', {})).status_code == 200
    note = await post(http, '/credit-notes',
                      {'chargeId': charge, 'amountMinor': 50_000, 'reason': 'Published adjustment'})
    assert note.status_code == 200, note.text
    note_id = note.json()['creditNote']['id']
    assert (await post(http, f'/credit-notes/{note_id}/approve', {}, 'owner')).status_code == 200
    assert (await post(http, f'/credit-notes/{note_id}/post', {})).status_code == 200
    read = await staff(http, 'owner', 'GET', BASE + '/students/' + student + '/statement')
    assert read.status_code == 200, read.text
    data = read.json()
    assert data['contracts'][0]['id'] == contract
    assert data['discounts'][0]['amount_minor'] == 100_000
    assert data['creditNotes'][0]['status'] == 'posted'
    assert data['position']['balanceDueMinor'] == 450_000
    assert data['sandboxProviderEnabled'] is False
    export = await staff(http, 'owner', 'GET', BASE + '/journal.csv', params={'period': month})
    assert export.status_code == 200 and export.headers['cache-control'] == 'private, no-store'
    assert export.headers['content-disposition'] == f'attachment; filename="finance-journal-{month}.csv"'
    rows = list(csv.DictReader(io.StringIO(export.text)))
    assert len(rows) == 4
    assert sum(int(row['amount_minor']) for row in rows if row['direction'] == 'debit') == 550_000
    assert sum(int(row['amount_minor']) for row in rows if row['direction'] == 'credit') == 550_000
    forbidden = await staff(http, 'teacher', 'GET', BASE + '/journal.csv', params={'period': month})
    assert forbidden.status_code == 403
    invalid = await staff(http, 'admin', 'GET', BASE + '/journal.csv', params={'period': '2026-99'})
    assert invalid.status_code == 422


@pytest.mark.asyncio
async def test_standalone_draft_and_refund_use_stable_request_identity(http):
    day = ledger.business_date(datetime.now(timezone.utc))
    student = str(http.people['student'])
    draft = {'commandId': str(uuid4()), 'studentUserId': student, 'periodKey': str(day)[:7],
             'dueDate': str(day), 'grossAmountMinor': 800_000}
    first = await post(http, '/charges', draft)
    assert first.status_code == 200, first.text
    again = await post(http, '/charges', draft)
    assert again.json()['charge']['id'] == first.json()['charge']['id']
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 1
    overflow = await post(http, '/charges', {**draft, 'commandId': str(uuid4()), 'grossAmountMinor': 2**63})
    assert overflow.status_code == 422
    wrong = await post(http, '/charges', {**draft, 'commandId': str(uuid4()),
                                         'studentUserId': str(http.people['teacher'])})
    assert wrong.status_code == 404
    payment = await post(http, '/payments', {'studentUserId': student, 'amountMinor': 700_000})
    payment_id = payment.json()['payment']['id']
    refund_path = f'/payments/{payment_id}/refund'
    command = {'commandId': str(uuid4()), 'amountMinor': 100_000, 'reason': 'Tuition refund'}
    requested = await post(http, refund_path, command)
    assert requested.status_code == 202, requested.text
    duplicate = await post(http, refund_path, command)
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json()['duplicate']
    refund_id = requested.json()['refund']['id']
    assert duplicate.json()['refund']['id'] == refund_id
    mismatched = await post(http, refund_path, {**command, 'amountMinor': 200_000})
    assert mismatched.status_code == 409
    status = await staff(http, 'admin', 'GET', BASE + '/students/' + student + '/statement')
    assert status.status_code == 200, status.text
    assert status.json()['refunds'][0]['payment_id'] == payment_id
    assert status.json()['position']['advanceMinor'] == 700_000
    assert (await post(http, f'/refunds/{refund_id}/settle', {})).status_code == 409
    assert (await post(http, f'/refunds/{refund_id}/approve', {}, 'owner')).status_code == 200
    assert (await post(http, f'/refunds/{refund_id}/settle', {})).status_code == 200
    assert await http.con.fetchval('SELECT count(*) FROM tuition_refunds') == 1
    closed = await post(http, '/days/close', {'businessDate': str(day), 'countedMinor': 600_000})
    assert closed.status_code == 200, closed.text


@pytest.mark.asyncio
async def test_conflicting_payment_retry_after_concurrent_insert_returns_conflict(http, monkeypatch):
    import asyncio
    from datetime import timedelta

    entered = asyncio.Event()
    release = asyncio.Event()
    original = ledger._assert_period_open

    async def wait_for_payment(conn, period):
        await original(conn, period)
        entered.set()
        await release.wait()

    key = 'race-' + str(uuid4())

    pool = await main.pool()
    competing_student=await http.con.fetchval("INSERT INTO users(name,role,account_status) VALUES('Other wallet','student','active') RETURNING id")

    async def record(amount, moment):
        async with pool.acquire() as conn, conn.transaction():
            return await ledger.record_payment(
                conn, actor_user_id=http.people['admin'], student_user_id=competing_student,
                amount_minor=amount, occurred_at=moment, idempotency_key=key)

    # Distinct wallets and dates use separate money/day locks. The conflicting
    # global idempotency key must still reach and be refused at the unique index.
    moment = datetime.now(timezone.utc)
    async with pool.acquire() as conn, conn.transaction():
        payment, _, _ = await ledger.record_payment(
            conn, actor_user_id=http.people['admin'], student_user_id=http.people['student'],
            amount_minor=700_000, occurred_at=moment, idempotency_key=key)
        monkeypatch.setattr(ledger, '_assert_period_open', wait_for_payment)
        competing = asyncio.create_task(record(500_000, moment - timedelta(days=1)))
        try:
            await asyncio.wait_for(entered.wait(), 5)
            release.set()
            for _ in range(100):
                waiting = await http.con.fetchval(
                    """SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE wait_event='transactionid'
                       AND query LIKE '%INSERT INTO tuition_payments%')""")
                if waiting:
                    break
                await asyncio.sleep(.01)
            assert waiting, 'the second payment must reach the contended INSERT'
        finally:
            release.set()
    with pytest.raises(ledger.LedgerError) as error:
        await asyncio.wait_for(competing, 5)
    assert error.value.code == 'idempotency_conflict'
    assert await http.con.fetchval('SELECT id FROM tuition_payments') == payment['id']
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1



@pytest.mark.asyncio
async def test_existing_payment_can_be_replayed_after_cash_close(http):
    day = ledger.business_date(datetime.now(timezone.utc))
    payload = {'studentUserId': str(http.people['student']), 'amountMinor': 400_000,
               'idempotencyKey': 'post-close-' + str(uuid4())}
    first = await post(http, '/payments', payload)
    assert first.status_code == 200, first.text
    closed = await post(http, '/days/close', {'businessDate': str(day), 'countedMinor': 400_000})
    assert closed.status_code == 200, closed.text
    retry = await post(http, '/payments', payload)
    assert retry.status_code == 200 and retry.json()['duplicate']
    assert retry.json()['payment']['id'] == first.json()['payment']['id']
    rejected = await post(http, '/payments', {**payload, 'idempotencyKey': str(uuid4())})
    assert rejected.status_code == 409 and rejected.json()['error'] == 'day_closed'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1


@pytest.mark.asyncio
async def test_receivables_age_by_due_date_after_partial_payment_and_credit(http):
    now = ledger.business_date(datetime.now(timezone.utc))
    period = ledger.period_key(now)
    student = http.people['student']
    for days, amount in ((10, 300_000), (35, 500_000), (-5, 200_000), (75, 150_000)):
        charge = await ledger.create_charge(
            http.con, actor_user_id=http.people['admin'], student_user_id=student,
            period=period, due_date=now-timedelta(days=days), gross_amount_minor=amount)
        await ledger.approve_charge(http.con, actor_user_id=http.people['owner'], charge_id=charge['id'])
        await ledger.post_charge(http.con, actor_user_id=http.people['admin'], charge_id=charge['id'])
        if days == 75:
            await ledger.reverse_charge(http.con, actor_user_id=http.people['admin'],
                                        charge_id=charge['id'], reason='Incorrect bill')
        if days == 35:
            note = await ledger.create_credit_note(http.con, actor_user_id=http.people['admin'],
                                                   charge_id=charge['id'], amount_minor=50_000, reason='Relief')
            await ledger.approve_credit_note(http.con, actor_user_id=http.people['owner'], credit_note_id=note['id'])
            await ledger.post_credit_note(http.con, actor_user_id=http.people['admin'], credit_note_id=note['id'])
    settled = await post(http, '/payments', {'studentUserId': str(student), 'amountMinor': 100_000})
    assert settled.status_code == 200
    response = await staff(http, 'admin', 'GET', BASE+'/aging')
    assert response.status_code == 200, response.text
    result = response.json()
    assert result['bucketsMinor'] == {'current': 200_000, 'days1To30': 300_000,
                                     'days31To60': 350_000, 'days61To90': 0, 'over90': 0}
    summary = await ledger.finance_summary(http.con, start=now, end=now)
    assert sum(result['bucketsMinor'].values()) == summary['outstandingReceivableMinor']
    denied = await staff(http, 'teacher', 'GET', BASE+'/aging')
    assert denied.status_code == 403
