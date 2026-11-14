"""Provider money over HTTP, end to end: sandbox adapter signature → ledger settlement.

FIN-02/FIN-03 are proved here at the boundary a real merchant integration will use, not only
against the ledger function. The app is the real `app.main` application driven over ASGI; the
database is a disposable local PostgreSQL schema. Nothing is mocked as "paid": either the
signed callback settles the intent, or no money moves.

Status of the adapter itself is VERIFIED_LOCALLY. `app/payments_sandbox.py` is a sandbox, not
a Click or Payme integration, and is disabled unless `TUITION_PROVIDER_SANDBOX=1`.
"""
from __future__ import annotations

import asyncio
import json
import os
from datetime import datetime, timezone
from uuid import uuid4

import httpx
import pytest
import pytest_asyncio

from _finance_schema import http  # noqa: F401  (shared finance ASGI + Postgres fixture)
from _finance_schema import staff
from app import payments_sandbox as sandbox
from app import tuition_ledger as ledger

CALLBACK = '/api/internal/payments/sandbox/callback'
SECRET = 'sandbox-hmac-key-for-tests-only'
TODAY = datetime.now(timezone.utc).date()


@pytest.fixture(autouse=True)
def sandbox_adapter_enabled(monkeypatch):
    """The sandbox provider is switched on for these tests and off everywhere else."""
    monkeypatch.setenv('TUITION_SANDBOX_SECRET', SECRET)
    monkeypatch.setenv('TUITION_PROVIDER_SANDBOX', '1')



async def open_receivable(client, *, gross=800_000, discount=200_000):
    """Contract → discount → posted charge, so a settlement has something to allocate to."""
    con, people = client.con, client.people
    contract = await ledger.create_contract(con, actor_user_id=people['owner'],
                                            student_user_id=people['student'],
                                            monthly_amount_minor=gross, starts_on=TODAY)
    contract = await ledger.approve_contract(con, actor_user_id=people['owner'],
                                             contract_id=contract['id'])
    await ledger.activate_contract(con, actor_user_id=people['owner'], contract_id=contract['id'])
    await ledger.add_discount(con, actor_user_id=people['owner'], contract_id=contract['id'],
                              period=ledger.period_key(TODAY), amount_minor=discount,
                              reason='Sibling discount')
    charge = await ledger.create_charge(con, actor_user_id=people['admin'],
                                        student_user_id=people['student'],
                                        period=ledger.period_key(TODAY), due_date=TODAY,
                                        gross_amount_minor=gross, contract_id=contract['id'])
    await ledger.post_charge(con, actor_user_id=people['admin'], charge_id=charge['id'])
    return contract


async def intent(client, *, txn='PAYME-E2E-1', order='order-e2e-1', amount=600_000):
    """A staff member starts a provider payment: this creates an intent, not money."""
    payment, _, _ = await ledger.record_payment(
        client.con, actor_user_id=client.people['admin'],
        student_user_id=client.people['student'], amount_minor=amount, method='provider',
        provider='payme', provider_transaction_id=txn, idempotency_key=order)
    return payment


def post_callback(client, payload, *, secret=SECRET, tamper_body=None, drop_signature=False):
    body = json.dumps(tamper_body or payload).encode()
    headers = {'content-type': 'application/json'}
    if not drop_signature:
        headers[sandbox.SIGNATURE_HEADER] = sandbox.sign(payload, secret)
    return client.post(CALLBACK, content=body, headers=headers)


# ───────────────────────────── the happy path, once ─────────────────────────────
@pytest.mark.asyncio
async def test_signed_provider_callback_settles_the_debt_exactly_once(http):
    await open_receivable(http)
    await intent(http)
    payload = {'provider': 'payme', 'transactionId': 'PAYME-E2E-1', 'status': 'paid',
               'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-e2e-1',
               'studentUserId': str(http.people['student'])}

    first = await post_callback(http, payload)
    assert first.status_code == 200, first.text
    assert first.json() == {'ok': True, 'duplicate': False, 'status': 'confirmed'}

    position = await ledger.student_position(http.con, http.people['student'])
    assert position['balanceDueMinor'] == 0
    assert position['collectedMinor'] == 600_000

    # The provider retries. The student must not be credited twice.
    for _ in range(5):
        repeat = await post_callback(http, payload)
        assert repeat.status_code == 200 and repeat.json()['duplicate'] is True
    position = await ledger.student_position(http.con, http.people['student'])
    assert position['collectedMinor'] == 600_000 and position['balanceDueMinor'] == 0
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1
    assert (await ledger.journal_is_balanced(http.con))['balanced'] is True


@pytest.mark.asyncio
async def test_concurrent_provider_callbacks_over_http_settle_once(http):
    """20 simultaneous webhooks — the real duplicate-delivery shape — settle one payment."""
    await open_receivable(http)
    await intent(http)
    payload = {'provider': 'payme', 'transactionId': 'PAYME-E2E-1', 'status': 'paid',
               'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-e2e-1',
               'studentUserId': str(http.people['student'])}
    results = await asyncio.gather(*(post_callback(http, payload) for _ in range(20)),
                                   return_exceptions=True)
    settled = sum(1 for r in results
                  if isinstance(r, httpx.Response) and r.status_code == 200
                  and r.json()['duplicate'] is False)
    assert settled == 1, f'{settled} settlements for one provider transaction'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 1
    position = await ledger.student_position(http.con, http.people['student'])
    assert position['collectedMinor'] == 600_000


# ───────────────────────────── forgery is refused ─────────────────────────────
@pytest.mark.asyncio
async def test_unsigned_and_forged_callbacks_are_refused_without_settling(http):
    await open_receivable(http)
    await intent(http)
    payload = {'provider': 'payme', 'transactionId': 'PAYME-E2E-1', 'status': 'paid',
               'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-e2e-1',
               'studentUserId': str(http.people['student'])}

    unsigned = await post_callback(http, payload, drop_signature=True)
    assert unsigned.status_code == 401
    assert unsigned.json()['reason'] == 'missing_signature'

    # Signature computed with another key, body unchanged.
    forged = await post_callback(http, payload, secret='another-key')
    assert forged.status_code == 401 and forged.json()['reason'] == 'invalid_signature'

    # Correct signature over the original body, but a body that says "paid 999".
    smuggled = await post_callback(
        http, payload, tamper_body={**payload, 'amountMinor': 999_999_999})
    assert smuggled.status_code == 401 and smuggled.json()['reason'] == 'invalid_signature'

    assert await http.con.fetchval("SELECT count(*) FROM tuition_payments WHERE status='confirmed'") == 0
    position = await ledger.student_position(http.con, http.people['student'])
    assert position['balanceDueMinor'] == 600_000


@pytest.mark.asyncio
async def test_valid_signature_for_a_different_order_still_settles_nothing(http):
    """FIN-02: authentication is not authorization. The ledger re-checks the intent."""
    await open_receivable(http)
    await intent(http, txn='PAYME-ORDER-A', order='order-a')
    payload = {'provider': 'payme', 'transactionId': 'PAYME-ORDER-A', 'status': 'paid',
               'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-B',
               'studentUserId': str(http.people['student'])}
    response = await post_callback(http, payload)
    assert response.status_code == 409, response.text
    assert response.json()['error'] == 'proof_order_mismatch'
    assert await http.con.fetchval("SELECT count(*) FROM tuition_payments WHERE status='confirmed'") == 0
    assert (await ledger.student_position(http.con, http.people['student']))['balanceDueMinor'] == 600_000


@pytest.mark.asyncio
async def test_provider_rejecting_or_expiring_an_intent_never_moves_money(http):
    await open_receivable(http)
    await intent(http)
    entries_before = await http.con.fetchval('SELECT count(*) FROM finance_journal_entries')
    lines_before = await http.con.fetchval('SELECT count(*) FROM finance_journal_lines')
    for status in ('rejected', 'expired', 'cancelled'):
        await intent(http, txn=f'PAYME-{status}', order=f'order-{status}')
        response = await post_callback(http, {
            'provider': 'payme', 'transactionId': f'PAYME-{status}', 'status': status,
            'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': f'order-{status}',
            'studentUserId': str(http.people['student'])})
        assert response.status_code == 200, response.text
        assert response.json()['status'] == status
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payment_allocations') == 0
    # The charge posting from open_receivable() is the only journal activity: a closed
    # provider intent adds no entries and no lines at all.
    assert await http.con.fetchval('SELECT count(*) FROM finance_journal_entries') == entries_before
    assert await http.con.fetchval('SELECT count(*) FROM finance_journal_lines') == lines_before
    assert await http.con.fetchval(
        "SELECT count(*) FROM finance_journal_entries WHERE source_type='provider_payment'") == 0
    assert (await ledger.student_position(http.con, http.people['student']))['balanceDueMinor'] == 600_000
    # A rejected intent can no longer be settled by a late "paid" webhook.
    late = await post_callback(http, {
        'provider': 'payme', 'transactionId': 'PAYME-rejected', 'status': 'paid',
        'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-rejected',
        'studentUserId': str(http.people['student'])})
    assert late.status_code == 409 and late.json()['error'] == 'intent_not_settleable'


# ───────────────── the sandbox must not exist when it is not switched on ─────────────────
@pytest.mark.asyncio
async def test_callback_route_is_absent_unless_the_sandbox_is_enabled(http, monkeypatch):
    await open_receivable(http)
    await intent(http)
    payload = {'provider': 'payme', 'transactionId': 'PAYME-E2E-1', 'status': 'paid',
               'amountMinor': 600_000, 'currency': 'UZS', 'orderRef': 'order-e2e-1',
               'studentUserId': str(http.people['student'])}

    monkeypatch.delenv('TUITION_PROVIDER_SANDBOX', raising=False)
    response = await post_callback(http, payload)
    assert response.status_code == 404, 'sandbox callback reachable on a normal deployment'
    assert await http.con.fetchval("SELECT count(*) FROM tuition_payments WHERE status='confirmed'") == 0

    monkeypatch.setenv('TUITION_PROVIDER_SANDBOX', '1')
    monkeypatch.delenv('TUITION_SANDBOX_SECRET', raising=False)
    unconfigured = await post_callback(http, payload)
    assert unconfigured.status_code == 401 and unconfigured.json()['reason'] == 'not_configured'


@pytest.mark.asyncio
async def test_staff_cannot_confirm_provider_money_from_the_payments_api(http):
    """FIN-03 over HTTP: `confirm: true` on provider money is refused, not honoured."""
    await open_receivable(http)
    response = await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 600_000,
        'method': 'provider', 'provider': 'payme', 'providerTransactionId': 'PAYME-ATTACK',
        'confirm': True})
    assert response.status_code == 409, response.text
    assert response.json()['error'] == 'provider_confirmation_requires_provider_proof'
    assert await http.con.fetchval("SELECT count(*) FROM tuition_payments WHERE status='confirmed'") == 0
    assert (await ledger.student_position(http.con, http.people['student']))['balanceDueMinor'] == 600_000
