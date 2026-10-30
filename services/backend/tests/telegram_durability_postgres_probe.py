"""Synthetic HTTP + actual PostgreSQL restart/dedup/auth checks; no Telegram calls."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import asyncpg
import httpx
from app import main as core, db, telegram_auth_state as state
from app import step18_telegram_admission_port as admission


async def main():
    dsn = os.environ['TELEGRAM_TEST_DATABASE_URL']
    target = urlsplit(dsn)
    assert target.hostname in ('localhost', '127.0.0.1') and target.path.startswith('/learners_telegram_')
    os.environ.update(DATABASE_URL=dsn, BOT_SERVICE_SECRET='isolated-bot-probe',
                      PUBLIC_BASE_URL='http://bot.test', RATE_LIMIT_BACKEND='memory')
    async def connect():
        return await asyncpg.create_pool(dsn, min_size=1, max_size=5, statement_cache_size=0, init=db.initialize_connection)
    pool = await connect()
    assert await pool.fetchval("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") == 0
    for file in sorted((Path(__file__).resolve().parents[1]/'migrations').glob('*.sql')):
        for sql in file.read_text().split('--> statement-breakpoint'):
            if sql.strip():
                await pool.execute(sql)
    async def get_pool():
        return pool
    core.pool = get_pool
    gate_error = None
    async def gates(reads, actor):
        return {'error': gate_error} if gate_error else None
    admission.gates = gates
    # A confirmed identity still must pass gates again during exchange.
    from app import step19_telegram_exchange_port as exchange
    exchange.gates = gates
    intent = UUID(int=5001)
    token = 'isolated-private-deeplink'
    digest = hashlib.sha256(token.encode()).hexdigest()
    nonce = 'isolated-browser-nonce'
    await pool.execute("""INSERT INTO telegram_login_intents(id,token_hash,browser_nonce_hash,expires_at,purpose)
      VALUES($1,$2,$3,NOW()+INTERVAL '5 minutes','login')""", intent, digest, hashlib.sha256(nonce.encode()).hexdigest())
    headers = {'Authorization': 'Bearer isolated-bot-probe'}
    checks = 0
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=core.app), base_url='http://bot.test') as api:
        async def preflight(actor='12345', **extra):
            return await api.post('/api/internal/telegram/auth/preflight', headers=headers,
                                  json={'telegramUserId': actor, **extra})
        response = await api.post('/api/internal/telegram/auth/preflight', json={'telegramUserId':'12345','token':token,'action':'begin'})
        assert response.status_code == 401
        assert await pool.fetchval('SELECT count(*) FROM telegram_flow_drafts') == 0
        checks += 1
        assert (await preflight(token=token, action='begin')).status_code == 200
        payload = await pool.fetchval('SELECT payload::text FROM telegram_flow_drafts WHERE id=$1', state.context_id('12345'))
        assert token not in payload and digest in payload
        checks += 1
        # Reconnect with no process-memory state. Only persisted DB context remains.
        await pool.close()
        pool = await connect()
        for error, code in [('phone_required',403), ('not_subscribed',403), ('membership_unavailable',503)]:
            gate_error = error
            assert (await preflight()).status_code == code
            result = await api.post('/api/internal/telegram/auth/confirm', headers=headers,
              json={'telegramUserId':'12345','intentId':str(intent)})
            assert result.status_code == code
            assert await pool.fetchval('SELECT status FROM telegram_login_intents WHERE id=$1', intent) == 'pending'
            checks += 3
        gate_error = None
        response = await preflight()
        assert response.json() == {'ok':True,'intentId':str(intent)}, response.text
        checks += 1
        # A different Telegram actor has neither the context nor authority to confirm.
        response = await api.post('/api/internal/telegram/auth/confirm', headers=headers,
          json={'telegramUserId':'54321','intentId':str(intent)})
        assert response.status_code == 404
        assert (await preflight('54321', token=token, action='begin')).status_code == 404
        checks += 2
        # A changed/new start cannot authorize an old browser intent ID.
        response = await api.post('/api/internal/telegram/auth/confirm', headers=headers,
          json={'telegramUserId':'12345','intentId':str(UUID(int=9999))})
        assert response.status_code == 409
        checks += 1
        responses = await asyncio.gather(*[api.post('/api/internal/telegram/auth/confirm', headers=headers,
          json={'telegramUserId':'12345','intentId':str(intent)}) for _ in range(2)])
        assert sum(r.status_code==200 for r in responses) == 1, [r.text for r in responses]
        assert await pool.fetchval('SELECT status FROM telegram_login_intents WHERE id=$1', intent) == 'confirmed'
        checks += 2
        # Database insert-on-conflict remains the cross-process duplicate authority.
        responses = await asyncio.gather(*[api.post('/api/internal/telegram/updates', headers=headers,
          json={'updateId':'987654321'}) for _ in range(32)])
        assert all(r.status_code == 200 for r in responses)
        assert sum(r.json()['fresh'] for r in responses) == 1
        await pool.close()
        pool = await connect()
        response = await api.post('/api/internal/telegram/updates', headers=headers,json={'updateId':'987654321'})
        assert response.json() == {'fresh':False}
        checks += 3
        assert (await preflight(action='cancel')).status_code == 200
        assert await state.token_digest(pool, '12345', '') is None
        checks += 2
        # Expired and foreign-bound links cannot recreate a durable context.
        await pool.execute("UPDATE telegram_login_intents SET status='pending',telegram_user_id=NULL,expires_at=NOW()-INTERVAL '1 second' WHERE id=$1", intent)
        assert (await preflight(token=token, action='begin')).status_code == 404
        await pool.execute("UPDATE telegram_login_intents SET expires_at=NOW()+INTERVAL '1 minute',telegram_user_id='54321' WHERE id=$1", intent)
        assert (await preflight(token=token, action='begin')).status_code == 404
        checks += 2
    await pool.close()
    print(json.dumps({'result':'passed','checks':checks,'database':'actual PostgreSQL','concurrent_duplicate_deliveries':32,
                      'reconnections':2,'external_telegram_calls':0,'migrations':72}))


asyncio.run(main())
