"""Concurrent money, scoped reads and AI outage on disposable PostgreSQL."""
from __future__ import annotations

import asyncio

import pytest

from app import academy_assistant as assistant, tuition_ledger as ledger
from test_self_service_payments import (
    child_path, family, journey, new_intent, pay, payme_config, request, rpc,
)


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
