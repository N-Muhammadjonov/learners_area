"""Charge creation and monthly installment generation over real HTTP + real PostgreSQL.

FIN-04: two schedulers (or one admin clicking twice) must not be able to bill a family twice
for the same contract and month. The guard is a partial unique index in the database, so the
proof is a concurrent request, not a unit test of a Python `if`.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from _finance_schema import http  # noqa: F401  (shared finance ASGI + Postgres fixture)
from _finance_schema import staff
from app import tuition_ledger as ledger

TODAY = datetime.now(timezone.utc).date()
PERIOD = ledger.period_key(TODAY)


async def approved_contract(client, *, monthly=800_000):
    contract = await ledger.create_contract(
        client.con, actor_user_id=client.people['owner'],
        student_user_id=client.people['student'], monthly_amount_minor=monthly,
        starts_on=TODAY)
    contract = await ledger.approve_contract(client.con, actor_user_id=client.people['owner'],
                                             contract_id=contract['id'])
    return await ledger.activate_contract(client.con, actor_user_id=client.people['owner'],
                                          contract_id=contract['id'])


def charge_payload(contract, *, period=PERIOD, gross=800_000):
    return {'studentUserId': str(contract['student_user_id']), 'periodKey': period,
            'dueDate': TODAY.isoformat(), 'grossAmountMinor': gross,
            'contractId': str(contract['id'])}


@pytest.mark.asyncio
async def test_second_charge_for_the_same_contract_and_period_is_refused_over_http(http):
    contract = await approved_contract(http)
    first = await staff(http, 'admin', 'POST', '/api/staff/finance/charges',
                        json_body=charge_payload(contract))
    assert first.status_code == 200, first.text

    second = await staff(http, 'admin', 'POST', '/api/staff/finance/charges',
                         json_body=charge_payload(contract))
    assert second.status_code == 409, second.text
    assert second.json()['error'] == 'charge_already_exists_for_period'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 1


@pytest.mark.asyncio
async def test_concurrent_charge_requests_produce_one_receivable(http):
    """8 simultaneous POSTs: the database, not the application, decides the winner."""
    contract = await approved_contract(http)
    responses = await asyncio.gather(
        *(staff(http, 'admin', 'POST', '/api/staff/finance/charges',
                json_body=charge_payload(contract)) for _ in range(8)))
    accepted = [r for r in responses if r.status_code == 200]
    refused = [r for r in responses if r.status_code == 409]
    assert len(accepted) == 1, f'{len(accepted)} charges accepted for one contract/period'
    assert len(refused) == 7
    assert {r.json()['error'] for r in refused} == {'charge_already_exists_for_period'}
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 1
    assert await http.con.fetchval(
        'SELECT count(*) FROM (SELECT contract_id, period_key FROM tuition_charges'
        " WHERE contract_id IS NOT NULL AND is_reversal=false"
        " GROUP BY 1,2 HAVING count(*) > 1) d") == 0


@pytest.mark.asyncio
async def test_retrying_the_monthly_job_does_not_bill_twice(http):
    contract = await approved_contract(http)
    route = f"/api/staff/finance/contracts/{contract['id']}/installment"
    first = await staff(http, 'admin', 'POST', route,
                        json_body={'dueDate': TODAY.isoformat()})
    assert first.status_code == 200, first.text
    assert first.json()['created'] is True
    assert first.json()['charge']['gross_amount_minor'] == 800_000

    retry = await staff(http, 'admin', 'POST', route,
                        json_body={'dueDate': TODAY.isoformat()})
    assert retry.status_code == 200, retry.text
    assert retry.json()['created'] is False
    assert retry.json()['charge']['id'] == first.json()['charge']['id']
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 1


# ─────────── FIN-05: relief after posting is a credit note, not an edit ───────────
@pytest.mark.asyncio
async def test_discount_after_posting_is_refused_over_http_and_points_to_a_credit_note(http):
    contract = await approved_contract(http)
    created = await staff(http, 'admin', 'POST', '/api/staff/finance/charges',
                          json_body=charge_payload(contract))
    assert created.status_code == 200, created.text
    charge_id = created.json()['charge']['id']
    await staff(http, 'owner', 'POST', f'/api/staff/finance/charges/{charge_id}/approve',
                json_body={})
    assert (await staff(http, 'admin', 'POST', f'/api/staff/finance/charges/{charge_id}/post',
                        json_body={})).status_code == 200

    late = await staff(http, 'owner', 'POST', f'/api/staff/finance/contracts/{contract["id"]}/discounts',
                       json_body={'periodKey': PERIOD, 'amountMinor': 100_000,
                                  'reason': 'Late goodwill'})
    assert late.status_code == 409, late.text
    assert late.json()['error'] == 'charge_already_posted'
    assert late.json()['remedy'] == 'credit_note'


@pytest.mark.asyncio
async def test_credit_note_flow_over_http_reduces_the_debt_once(http):
    contract = await approved_contract(http)
    created = await staff(http, 'admin', 'POST', '/api/staff/finance/charges',
                          json_body=charge_payload(contract))
    charge_id = created.json()['charge']['id']
    await staff(http, 'owner', 'POST', f'/api/staff/finance/charges/{charge_id}/approve',
                json_body={})
    await staff(http, 'admin', 'POST', f'/api/staff/finance/charges/{charge_id}/post',
                json_body={})

    drafted = await staff(http, 'admin', 'POST', '/api/staff/finance/credit-notes',
                          json_body={'chargeId': charge_id, 'amountMinor': 200_000,
                                     'reason': 'Scholarship agreed after billing'})
    assert drafted.status_code == 200, drafted.text
    note_id = drafted.json()['creditNote']['id']
    assert (await ledger.student_position(http.con,
                                          http.people['student']))['balanceDueMinor'] == 800_000

    # Two independent layers: the route only accepts an owner (so an admin is refused before
    # the ledger is reached), and the ledger separately refuses self-approval. A client that
    # somehow reaches the ledger as a non-owner still cannot approve relief.
    self_approve = await staff(http, 'admin', 'POST',
                               f'/api/staff/finance/credit-notes/{note_id}/approve', json_body={})
    assert self_approve.status_code == 403
    assert self_approve.json()['error'] == 'forbidden'
    assert await http.con.fetchval(
        "SELECT count(*) FROM tuition_credit_notes WHERE status != 'draft'") == 0

    approved = await staff(http, 'owner', 'POST',
                           f'/api/staff/finance/credit-notes/{note_id}/approve', json_body={})
    assert approved.status_code == 200, approved.text
    posted = await staff(http, 'admin', 'POST',
                         f'/api/staff/finance/credit-notes/{note_id}/post', json_body={})
    assert posted.status_code == 200, posted.text

    position = await ledger.student_position(http.con, http.people['student'])
    assert position['balanceDueMinor'] == 600_000
    assert position['creditedMinor'] == 200_000
    # Posting twice must not relieve twice.
    again = await staff(http, 'admin', 'POST',
                        f'/api/staff/finance/credit-notes/{note_id}/post', json_body={})
    assert again.status_code == 409
    assert (await ledger.student_position(http.con,
                                          http.people['student']))['balanceDueMinor'] == 600_000
    assert (await ledger.journal_is_balanced(http.con))['balanced'] is True


# ─────────── FIN-07: a contract belongs to a student record, not any user ───────────
@pytest.mark.asyncio
@pytest.mark.parametrize('role', ['owner', 'admin', 'teacher'])
async def test_staff_account_cannot_be_enrolled_over_http(http, role):
    response = await staff(http, 'owner', 'POST', '/api/staff/finance/contracts', json_body={
        'studentUserId': str(http.people[role]), 'monthlyAmountMinor': 800_000,
        'startsOn': TODAY.isoformat()})
    assert response.status_code == 404, response.text
    assert response.json()['error'] == 'student_not_found'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_contracts') == 0


@pytest.mark.asyncio
async def test_an_unknown_user_id_is_indistinguishable_from_a_staff_account(http):
    unknown = await staff(http, 'owner', 'POST', '/api/staff/finance/contracts', json_body={
        'studentUserId': str(uuid4()), 'monthlyAmountMinor': 800_000,
        'startsOn': TODAY.isoformat()})
    teacher = await staff(http, 'owner', 'POST', '/api/staff/finance/contracts', json_body={
        'studentUserId': str(http.people['teacher']), 'monthlyAmountMinor': 800_000,
        'startsOn': TODAY.isoformat()})
    assert unknown.status_code == teacher.status_code == 404
    assert unknown.json() == teacher.json()


# ──── FIN-09: a replayed reference that is not the same event is refused and audited ────
@pytest.mark.asyncio
async def test_reusing_a_payment_key_for_a_different_amount_is_refused_and_audited(http):
    first = await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 600_000, 'method': 'cash',
        'idempotencyKey': 'KEY-REUSE'})
    assert first.status_code == 200, first.text

    # Same key, different money: a genuine retry, or an attempt to hide a smaller payment.
    replay = await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 100_000, 'method': 'cash',
        'idempotencyKey': 'KEY-REUSE'})
    assert replay.status_code == 409, replay.text
    assert replay.json()['error'] == 'idempotency_conflict'
    assert replay.json()['mismatched'] == ['amountMinor']
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1

    # The refusal itself is on the permanent record even though its transaction rolled back.
    audit = await http.con.fetchrow(
        "SELECT action, subject_type, detail FROM finance_audit_events"
        " WHERE action='idempotency_conflict' ORDER BY occurred_at DESC LIMIT 1")
    assert audit is not None, 'a refused replay left no audit trail'
    assert audit['subject_type'] == 'tuition_payment'
    detail = json.loads(audit['detail']) if isinstance(audit['detail'], str) else audit['detail']
    assert detail['mismatched'] == ['amountMinor']
    assert detail['idempotencyKey'] == 'KEY-REUSE'

    # An exact retry is still a duplicate, not a conflict.
    exact = await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 600_000, 'method': 'cash',
        'idempotencyKey': 'KEY-REUSE'})
    assert exact.status_code == 200 and exact.json()['duplicate'] is True
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 1


# ────────── FIN-10: the dashboard reconciles to the ledger, and says which figures ──────────
@pytest.mark.asyncio
async def test_owner_dashboard_splits_collection_by_method_over_http(http):
    await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 250_000, 'method': 'cash'})
    await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 150_000, 'method': 'bank'})

    summary = await staff(http, 'owner', 'GET', '/api/staff/finance/summary',
                          params={'start': (TODAY - timedelta(days=60)).isoformat(),
                                  'end': (TODAY + timedelta(days=60)).isoformat()})
    assert summary.status_code == 200, summary.text
    body = summary.json()
    assert body['collectedCashMinor'] == 250_000, 'collectedCashMinor must mean cash only'
    assert body['collectedBankMinor'] == 150_000
    assert body['collectedTotalMinor'] == 400_000
    assert body['calendar'] == 'Asia/Tashkent'
    assert body['semantics']['collectedCashMinor']

    recon = await staff(http, 'owner', 'GET', '/api/staff/finance/reconciliation',
                        params={'start': (TODAY - timedelta(days=60)).isoformat(),
                                'end': (TODAY + timedelta(days=60)).isoformat()})
    assert recon.status_code == 200, recon.text
    payload = recon.json()
    assert payload['journal']['balanced'] is True
    assert payload['summary']['ok'] is True, payload['summary']['checks']
    broken = [c for c in payload['summary']['checks'] if not c['matches']]
    assert broken == []


# ──────────── FIN-11: typed input, no silent coercion, controlled backdating ────────────
@pytest.mark.asyncio
@pytest.mark.parametrize('amount', [True, 1.5, '800000', None, [], 800_000.0])
async def test_money_must_be_a_non_boolean_integer_over_http(http, amount):
    """A boolean is an int in Python and a float rounds silently: both are refused."""
    response = await staff(http, 'admin', 'POST', '/api/staff/finance/charges', json_body={
        'studentUserId': str(http.people['student']), 'periodKey': PERIOD,
        'dueDate': TODAY.isoformat(), 'grossAmountMinor': amount})
    assert response.status_code == 422, response.text
    body = response.json()
    assert body['error'] == 'invalid_payload'
    assert any('grossAmountMinor' in str(item) for item in body.get('fields', [])), body
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 0


@pytest.mark.asyncio
@pytest.mark.parametrize('period', ['2026-13', '2026-1', '2026/11', '11-2026', '2026-00', ''])
async def test_period_key_must_be_yyyy_mm(http, period):
    contract = await approved_contract(http)
    response = await staff(http, 'admin', 'POST', '/api/staff/finance/charges', json_body={
        'studentUserId': str(http.people['student']), 'periodKey': period,
        'dueDate': TODAY.isoformat(), 'grossAmountMinor': 800_000,
        'contractId': str(contract['id'])})
    assert response.status_code == 422, response.text
    assert response.json()['error'] == 'invalid_payload'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 0


@pytest.mark.asyncio
async def test_a_client_cannot_backdate_a_payment_without_permission(http):
    old = (TODAY - timedelta(days=45)).isoformat()
    refused = await staff(http, 'admin', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 100_000, 'method': 'cash',
        'occurredAt': old})
    assert refused.status_code == 403, refused.text
    assert refused.json()['error'] == 'backdating_requires_owner'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 0

    allowed = await staff(http, 'owner', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 100_000, 'method': 'cash',
        'occurredAt': old})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()['payment']['occurred_at'].startswith(old)
    # The backdated entry is on the audit trail with the actor who authorized it.
    audit = await http.con.fetchrow(
        "SELECT actor_user_id, action FROM finance_audit_events WHERE action='backdated_payment'")
    assert audit is not None, 'a backdated entry left no audit trail'
    assert str(audit['actor_user_id']) == str(http.people['owner'])


@pytest.mark.asyncio
async def test_a_future_dated_receipt_is_refused(http):
    response = await staff(http, 'owner', 'POST', '/api/staff/finance/payments', json_body={
        'studentUserId': str(http.people['student']), 'amountMinor': 100_000, 'method': 'cash',
        'occurredAt': (TODAY + timedelta(days=3)).isoformat()})
    assert response.status_code == 422
    assert response.json()['error'] == 'invalid_payload'
    assert await http.con.fetchval('SELECT count(*) FROM tuition_payments') == 0


# ─────── FIN-11: an off-contract price needs an authorized, audited adjustment ───────
@pytest.mark.asyncio
async def test_billing_above_the_contract_price_needs_a_recorded_adjustment(http):
    contract = await approved_contract(http, monthly=800_000)
    silent = await staff(http, 'admin', 'POST', '/api/staff/finance/charges', json_body={
        'studentUserId': str(http.people['student']), 'periodKey': PERIOD,
        'dueDate': TODAY.isoformat(), 'grossAmountMinor': 900_000,
        'contractId': str(contract['id'])})
    assert silent.status_code == 409, silent.text
    assert silent.json()['error'] == 'charge_amount_conflicts_with_contract'
    assert silent.json()['contractMinor'] == 800_000
    assert await http.con.fetchval('SELECT count(*) FROM tuition_charges') == 0

    explained = await staff(http, 'admin', 'POST', '/api/staff/finance/charges', json_body={
        'studentUserId': str(http.people['student']), 'periodKey': PERIOD,
        'dueDate': TODAY.isoformat(), 'grossAmountMinor': 900_000,
        'contractId': str(contract['id']),
        'adjustmentReason': 'Extra intensive module agreed with the parent'})
    assert explained.status_code == 200, explained.text
    assert explained.json()['charge']['gross_amount_minor'] == 900_000
    audit = await http.con.fetchrow(
        "SELECT actor_user_id, reason FROM finance_audit_events"
        " WHERE action='contract_price_adjustment'")
    assert audit is not None, 'an off-contract price left no audit trail'
    assert 'Extra intensive module' in audit['reason']


@pytest.mark.asyncio
async def test_approved_contract_terms_cannot_be_changed_through_the_api(http):
    contract = await approved_contract(http, monthly=800_000)
    # There is no route that edits commercial terms at all - the only mutations are the
    # lifecycle ones. Assert the absence rather than trusting the route list by eye.
    from app.main import app
    editable = [(method, route.path)
                for route in app.routes if route.path.startswith('/api/staff/finance/contracts')
                for method in (getattr(route, 'methods', None) or ())
                if method in ('PATCH', 'PUT', 'DELETE')]
    assert editable == [], f'these routes would bypass the frozen terms: {editable}'
    with pytest.raises(Exception):
        await http.con.execute(
            'UPDATE tuition_contracts SET monthly_amount_minor=$2 WHERE id=$1',
            contract['id'], 1_000_000)
    assert await http.con.fetchval(
        'SELECT monthly_amount_minor FROM tuition_contracts WHERE id=$1',
        contract['id']) == 800_000
