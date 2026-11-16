"""Test-only mixed operations; never imported by the production application."""
from __future__ import annotations

import asyncio
import os
from time import perf_counter, time
from uuid import uuid4

from measurements import Measurements
from app import academy_assistant, db, tuition_ledger


class MixedPulse:
    def __init__(self, api, actors: dict, cookies: dict, auth: str, dsn: str) -> None:
        self.api, self.actors, self.cookies, self.auth, self.dsn = api, actors, cookies, auth, dsn
        self.samples = Measurements()
        self.pulses = self.fallbacks = self.denials = 0
        self.original_completion = academy_assistant.gateway.completion
        self.environment: dict[str, str | None] = {}

    async def call(self, name: str, method: str, path: str, *, who: str | None = None, body: dict | None = None) -> dict:
        headers = {'origin': 'http://127.0.0.1:4197'}
        if who:
            headers['cookie'] = self.cookies[who]
        else:
            headers['authorization'] = self.auth
        started = perf_counter()
        response = await self.api.request(method, path, headers=headers, json=body)
        self.samples.add(name, response.status_code, (perf_counter() - started) * 1000,
                         None if response.status_code == 200 else 'unexpected_status')
        assert response.status_code == 200, (name, response.status_code, response.text)
        return response.json()

    async def rpc(self, method: str, params: dict) -> dict:
        return await self.call('callback', 'POST', '/api/payments/callbacks/payme',
                               body={'id': 1, 'method': method, 'params': params})

    async def prepare(self) -> None:
        self.order = await self.call('intent', 'POST', '/api/finance/me/intents', who='student2',
            body={'amountMinor': 137531, 'provider': 'payme', 'idempotencyKey': str(uuid4())})
        created = await self.rpc('CreateTransaction', {'id': 'isolated-soak-provider', 'time': int(time() * 1000),
            'amount': 13753100, 'account': {'order_id': self.order['intentId']}})
        assert created['result']['state'] == 1
        for key, value in {
            'ACADEMY_ASSISTANT_ENABLED': '1', 'RIWI_ENABLED': '1', 'RIWI_EXTERNAL_AI_ENABLED': '1',
            'AI_EXTERNAL_ENABLED': 'true', 'ACADEMY_AI_EXTERNAL_ENABLED': '1',
            'ACADEMY_AI_PROVIDER_VERIFIED': '1', 'AI_GATEWAY_API_KEY': 'isolated-outage',
            'AI_GATEWAY_MODEL': 'fixture/outage',
        }.items():
            self.environment[key] = os.environ.get(key)
            os.environ[key] = value

        async def unavailable(*args, **kwargs):
            raise TimeoutError('isolated soak model outage; no network request')

        academy_assistant.gateway.completion = unavailable

    async def run(self, deadline: float) -> None:
        while perf_counter() < deadline:
            async def cash() -> dict:
                return await self.call('cash', 'POST', '/api/staff/finance/payments', who='owner1', body={
                    'studentUserId': str(self.actors['student2']['id']), 'amountMinor': 1000,
                    'idempotencyKey': 'isolated-soak-cash', 'method': 'cash', 'confirm': True})

            async def callback() -> dict:
                result = await self.rpc('PerformTransaction', {'id': 'isolated-soak-provider'})
                assert result['result']['state'] == 2
                return result

            async def assistant() -> None:
                who = 'student' + str(3000 + self.pulses % 3000)
                result = await self.call('ai_fallback', 'POST', '/api/finance/me/assistant', who=who,
                                         body={'action': 'payment_help'})
                assert result['mode'] == 'fallback' and result['canExecute'] is False
                self.fallbacks += 1

            await asyncio.gather(*(cash() for _ in range(5)), *(callback() for _ in range(10)), assistant(),
                self.call('calendar', 'GET', '/api/academy/calendar', who='student2'))
            denied = await self.api.get(f"/api/guardian/children/{self.actors['student1001']['id']}/payments",
                                       headers={'cookie': self.cookies['guardian2']})
            assert denied.status_code == 403
            self.denials += 1
            self.pulses += 1
            remaining = deadline - perf_counter()
            if remaining > 0:
                await asyncio.sleep(min(30, remaining))

    async def verify(self) -> dict:
        import asyncpg
        connection = await asyncpg.connect(self.dsn)
        await db.initialize_connection(connection)
        try:
            position = await tuition_ledger.student_position(connection, self.actors['student2']['id'])
            assert position['balanceDueMinor'] == 461469 and position['advanceMinor'] == 0
            assert await connection.fetchval("SELECT count(*) FROM tuition_payments WHERE idempotency_key='isolated-soak-cash'") == 1
            assert await connection.fetchval("SELECT count(*) FROM tuition_provider_events WHERE intent_id=$1",
                                             self.order['intentId']) == 1
            assert (await tuition_ledger.journal_is_balanced(connection))['balanced']
            summary = self.samples.summary()
            cash = summary['endpoints']['cash']
            return {'pulses': self.pulses, 'modelOutageFallbacks': self.fallbacks, 'crossScopeDenials': self.denials,
                    'cashEffects': 1, 'providerEffects': 1, 'balanceDueMinor': position['balanceDueMinor'],
                    'journalBalanced': True, 'measurements': summary,
                    'cashWriteObjectiveMet': cash['p95Ms'] is not None and cash['p95Ms'] <= 500}
        finally:
            await connection.close()

    def close(self) -> None:
        academy_assistant.gateway.completion = self.original_completion
        for key, value in self.environment.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
