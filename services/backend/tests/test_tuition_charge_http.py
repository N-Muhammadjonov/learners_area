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
