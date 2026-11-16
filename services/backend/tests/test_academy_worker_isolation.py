"""Independent HTTP workers must share durable settlement and revocation truth."""
from __future__ import annotations

import asyncio
import base64
import json
import os
import socket
import subprocess
import sys
from pathlib import Path
from time import time
from uuid import uuid4

import httpx
import pytest

from app import tuition_ledger
from app.security import SESSION_COOKIE, issue_token
from test_self_service_payments import family, journey


def unused_tcp_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(('127.0.0.1', 0))
        return listener.getsockname()[1]


@pytest.mark.asyncio
async def test_two_worker_callback_cash_retry_and_immediate_link_revocation(family, tmp_path):
    conn, _, actors, links = family
    database = await conn.fetchval('SELECT current_database()')
    assert database.startswith('learners_journey_')
    environment = {**os.environ, 'APP_ENV': 'test',
        'DATABASE_URL': 'postgresql://coin_qa:coin_qa_local@127.0.0.1:55439/' + database,
        'AUTH_SECRET': 'isolated-academy-journey-signing-key-2026',
        'ACADEMY_FEATURES_ENABLED': '1', 'RATE_LIMIT_BACKEND': 'memory',
        'PAYME_ENVIRONMENT': 'sandbox', 'PAYME_SANDBOX_VERIFIED': '1', 'PAYME_LIVE_VERIFIED': '0',
        'PAYME_MERCHANT_ID': 'isolated-workers', 'PAYME_KEY': 'isolated-workers-key',
        'PAYME_LOGIN': 'Paycom', 'PAYMENTS_RETURN_ORIGIN': 'https://isolated.invalid'}
    processes, logs, clients = [], [], []
    auth = 'Basic ' + base64.b64encode(b'Paycom:isolated-workers-key').decode()
    try:
        for index in range(2):
            port = unused_tcp_port()
            log = (tmp_path / f'worker-{index}.log').open('w+')
            logs.append(log)
            process = subprocess.Popen([sys.executable, '-m', 'uvicorn', 'app.asgi:application',
                '--host', '127.0.0.1', '--port', str(port), '--no-access-log'],
                cwd=Path(__file__).resolve().parents[1], env=environment, stdout=log, stderr=log)
            processes.append(process)
            client = httpx.AsyncClient(base_url=f'http://127.0.0.1:{port}', trust_env=False, timeout=15)
            clients.append(client)
            for _ in range(100):
                assert process.poll() is None, f'isolated worker {index} exited; see {log.name}'
                try:
                    if (await client.get('/readyz')).status_code == 200:
                        break
                except httpx.ConnectError:
                    pass
                await asyncio.sleep(.1)
            else:
                raise AssertionError('isolated worker did not become ready')
        assert processes[0].pid != processes[1].pid

        async def user_call(index: int, role: str, method: str, path: str, body: dict | None = None, expected: int = 200) -> dict:
            client = clients[index]
            response = await client.request(method, path, json=body, headers={
                'origin': str(client.base_url).rstrip('/'),
                'cookie': SESSION_COOKIE + '=' + issue_token(actors[role])})
            assert response.status_code == expected, (path, response.status_code, response.text)
            return response.json()

        child = str(actors['student']['id'])
        path = f'/api/guardian/children/{child}/payments'
        order = await user_call(0, 'guardian', 'POST', path + '/intents', {
            'amountMinor': 150000, 'provider': 'payme', 'idempotencyKey': str(uuid4())})

        async def rpc(index: int, method: str, params: dict) -> dict:
            response = await clients[index].post('/api/payments/callbacks/payme',
                headers={'authorization': auth}, json={'id': 1, 'method': method, 'params': params})
            assert response.status_code == 200, response.text
            return response.json()

        prepared = await rpc(0, 'CreateTransaction', {'id': 'isolated-cross-worker', 'time': int(time() * 1000),
            'amount': 15000000, 'account': {'order_id': order['intentId']}})
        assert prepared['result']['state'] == 1
        cash = {'studentUserId': child, 'amountMinor': 50000, 'method': 'cash',
                'idempotencyKey': 'cross-worker-cash', 'confirm': True}
        replies, receipts = await asyncio.gather(
            asyncio.gather(*(rpc(n % 2, 'PerformTransaction', {'id': 'isolated-cross-worker'}) for n in range(20))),
            asyncio.gather(*(user_call(n % 2, 'admin', 'POST', '/api/staff/finance/payments', cash) for n in range(6))))
        assert all(reply['result']['state'] == 2 for reply in replies)
        assert sum(not receipt['duplicate'] for receipt in receipts) == 1
        for index in range(2):
            account = await user_call(index, 'guardian', 'GET', path)
            assert account['position']['balanceDueMinor'] == 700000
        await conn.execute("UPDATE guardian_links SET status='revoked',revoked_at=now() WHERE id=$1", links['student'])
        for index in range(2):
            await user_call(index, 'guardian', 'GET', path, expected=403)
        assert await conn.fetchval('SELECT count(*) FROM tuition_payments') == 2
        assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events') == 1
        assert (await tuition_ledger.journal_is_balanced(conn))['balanced']
        # Acknowledged money and revocations survive process-local state loss.
        first = processes[0]
        first.terminate()
        await asyncio.to_thread(first.wait, timeout=10)
        processes[0] = subprocess.Popen(first.args, cwd=Path(__file__).resolve().parents[1],
            env=environment, stdout=logs[0], stderr=logs[0])
        for _ in range(100):
            try:
                if (await clients[0].get('/readyz')).status_code == 200:
                    break
            except httpx.ConnectError:
                pass
            await asyncio.sleep(.1)
        else:
            raise AssertionError('restarted isolated worker did not become ready')
        await user_call(0, 'guardian', 'GET', path, expected=403)
        recovered = await user_call(0, 'student', 'GET', '/api/finance/me/payments')
        assert recovered['position']['balanceDueMinor'] == 700000
        replay = await rpc(0, 'PerformTransaction', {'id': 'isolated-cross-worker'})
        assert replay['result']['state'] == 2
        assert await conn.fetchval('SELECT count(*) FROM tuition_provider_events') == 1
        print(json.dumps({'workers': 2, 'callbackRequests': 20, 'cashRequests': 6,
            'payments': 2, 'providerEffects': 1, 'revocationDeniedByBoth': True,
            'restartPreservesSettlementAndRevocation': True, 'balanced': True}))
    finally:
        for client in clients:
            await client.aclose()
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                await asyncio.to_thread(process.wait, timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                await asyncio.to_thread(process.wait, timeout=5)
        for log in logs:
            log.close()
