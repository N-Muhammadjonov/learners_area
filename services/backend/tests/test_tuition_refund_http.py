"""Refund lifecycle and cash-day close over real HTTP + real PostgreSQL (FIN-08).

The headline case is the one an owner will actually hit: a family asks for money back weeks
later, the cashier day that took the original receipt was closed long ago, and the refund
still has to happen - without reopening or rewriting that closed day.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from _finance_schema import http  # noqa: F401  (shared finance ASGI + Postgres fixture)
from _finance_schema import staff
from app import tuition_ledger as ledger

TODAY = datetime.now(timezone.utc).date()


async def old_advance(http, *, amount=700_000, days_ago=45):
    """A cash advance taken `days_ago` days ago, with that day's cash close already filed."""
    moment = datetime.now(timezone.utc) - timedelta(days=days_ago)
    payment, _, _ = await ledger.record_payment(
        http.con, actor_user_id=http.people['admin'], student_user_id=http.people['student'],
        amount_minor=amount, occurred_at=moment)
    old_day = payment['occurred_at'].date()
    close = await ledger.close_day(http.con, actor_user_id=http.people['owner'],
                                   business_date=old_day, counted_minor=amount)
    return payment, old_day, close


@pytest.mark.asyncio
async def test_a_45_day_old_receipt_is_refundable_after_its_cash_day_closed(http):
    payment, old_day, close = await old_advance(http)
    assert close['expected_minor'] == 700_000

    requested = await staff(http, 'admin', 'POST',
                            f'/api/staff/finance/payments/{payment["id"]}/refund',
                            json_body={'amountMinor': 200_000, 'reason': 'Family withdrew'})
    assert requested.status_code == 202, requested.text
    refund = requested.json()['refund']
    assert refund['status'] == 'requested'
    assert refund['effective_on'] == TODAY.isoformat()
    # Nothing has left the drawer yet.
    assert await http.con.fetchval("SELECT count(*) FROM finance_journal_entries"
                                   " WHERE source_type='refund'") == 0

    approved = await staff(http, 'owner', 'POST',
                           f'/api/staff/finance/refunds/{refund["id"]}/approve', json_body={})
    assert approved.status_code == 200, approved.text
    assert approved.json()['refund']['status'] == 'approved'

    settled = await staff(http, 'admin', 'POST',
                          f'/api/staff/finance/refunds/{refund["id"]}/settle', json_body={})
    assert settled.status_code == 200, settled.text
    assert settled.json()['refund']['status'] == 'settled'

    # The historical day is untouched: same expectation, still exactly one close row.
    row = await http.con.fetchrow(
        'SELECT expected_minor, counted_minor, variance_minor FROM cash_day_closes'
        ' WHERE business_date=$1', old_day)
    assert (row['expected_minor'], row['counted_minor'], row['variance_minor']) == (700_000, 700_000, 0)
    assert await http.con.fetchval('SELECT count(*) FROM cash_day_closes') == 1
    assert (await ledger.journal_is_balanced(http.con))['balanced'] is True

    # A double click on "settle" cannot pay the family twice.
    again = await staff(http, 'admin', 'POST',
                        f'/api/staff/finance/refunds/{refund["id"]}/settle', json_body={})
    assert again.status_code == 409
    assert again.json()['error'] == 'refund_already_settled'
    assert await http.con.fetchval(
        "SELECT count(*) FROM finance_journal_entries WHERE source_type='refund'") == 1


@pytest.mark.asyncio
async def test_an_admin_cannot_authorize_their_own_refund_request(http):
    payment, _, _ = await old_advance(http)
    requested = await staff(http, 'admin', 'POST',
                            f'/api/staff/finance/payments/{payment["id"]}/refund',
                            json_body={'amountMinor': 100_000, 'reason': 'Withdrawal'})
    refund_id = requested.json()['refund']['id']

    self_approve = await staff(http, 'admin', 'POST',
                               f'/api/staff/finance/refunds/{refund_id}/approve', json_body={})
    assert self_approve.status_code == 403
    settle_first = await staff(http, 'admin', 'POST',
                               f'/api/staff/finance/refunds/{refund_id}/settle', json_body={})
    assert settle_first.status_code == 409
    assert settle_first.json()['error'] == 'refund_not_approved'
    assert await http.con.fetchval(
        "SELECT count(*) FROM finance_journal_entries WHERE source_type='refund'") == 0


@pytest.mark.asyncio
async def test_a_rejected_refund_stays_on_the_record_and_moves_no_cash(http):
    payment, _, _ = await old_advance(http)
    requested = await staff(http, 'admin', 'POST',
                            f'/api/staff/finance/payments/{payment["id"]}/refund',
                            json_body={'amountMinor': 100_000, 'reason': 'Withdrawal'})
    refund_id = requested.json()['refund']['id']

    rejected = await staff(http, 'owner', 'POST',
                           f'/api/staff/finance/refunds/{refund_id}/reject',
                           json_body={'reason': 'Policy: fees are non-refundable after week 2'})
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()['refund']['status'] == 'rejected'
    assert await http.con.fetchval(
        "SELECT count(*) FROM finance_journal_entries WHERE source_type='refund'") == 0
    # The request is not deleted: the owner can see it was asked for and why it was refused.
    assert await http.con.fetchval('SELECT count(*) FROM tuition_refunds') == 1
    settle = await staff(http, 'admin', 'POST',
                         f'/api/staff/finance/refunds/{refund_id}/settle', json_body={})
    assert settle.status_code == 409


@pytest.mark.asyncio
async def test_day_close_over_http_reconciles_opening_receipts_refunds_and_adjustments(http):
    await staff(http, 'admin', 'POST', '/api/staff/finance/payments',
                json_body={'studentUserId': str(http.people['student']), 'amountMinor': 500_000,
                           'method': 'cash'})
    second = await staff(http, 'admin', 'POST', '/api/staff/finance/payments',
                         json_body={'studentUserId': str(http.people['student']),
                                    'amountMinor': 300_000, 'method': 'cash'})
    refund = await staff(http, 'admin', 'POST',
                         f'/api/staff/finance/payments/{second.json()["payment"]["id"]}/refund',
                         json_body={'amountMinor': 200_000, 'reason': 'Returned to family'})
    refund_id = refund.json()['refund']['id']
    await staff(http, 'owner', 'POST', f'/api/staff/finance/refunds/{refund_id}/approve',
                json_body={})
    await staff(http, 'admin', 'POST', f'/api/staff/finance/refunds/{refund_id}/settle',
                json_body={})

    adjustment = await staff(http, 'owner', 'POST',
                             f'/api/staff/finance/days/{TODAY.isoformat()}/adjustments',
                             json_body={'amountMinor': -50_000,
                                        'reason': 'Till correction, short count'})
    assert adjustment.status_code == 200, adjustment.text

    closed = await staff(http, 'owner', 'POST', '/api/staff/finance/days/close',
                         json_body={'businessDate': TODAY.isoformat(), 'countedMinor': 650_000,
                                    'openingMinor': 100_000})
    assert closed.status_code == 200, closed.text
    close = closed.json()['close']
    # opening 100000 + receipts 800000 - refunds 200000 + adjustments (-50000) = 650000
    assert close['opening_minor'] == 100_000
    assert close['receipts_minor'] == 800_000
    assert close['refunds_minor'] == 200_000
    assert close['adjustments_minor'] == -50_000
    assert close['expected_minor'] == 650_000
    assert close['variance_minor'] == 0

    # A closed day accepts no new cash movement.
    blocked = await staff(http, 'owner', 'POST',
                          f'/api/staff/finance/days/{TODAY.isoformat()}/adjustments',
                          json_body={'amountMinor': 10_000, 'reason': 'Too late'})
    assert blocked.status_code == 409
    assert blocked.json()['error'] == 'day_closed'
