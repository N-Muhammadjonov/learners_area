"""Charge creation and monthly installment generation over real HTTP + real PostgreSQL.

FIN-04: two schedulers (or one admin clicking twice) must not be able to bill a family twice
for the same contract and month. The guard is a partial unique index in the database, so the
proof is a concurrent request, not a unit test of a Python `if`.
"""
from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
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
