"""Finance dispatch delivery, crash recovery and retries on real PostgreSQL."""
from __future__ import annotations

import asyncio
from uuid import UUID, uuid4

import asyncpg
import pytest
import pytest_asyncio

from _finance_schema import DSN, apply_finance_migrations, create_disposable_schema
from app import finance_outbox as outbox


@pytest_asyncio.fixture
async def database():
    conn = await asyncpg.connect(DSN)
    schema = 'outbox_test_' + uuid4().hex
    await create_disposable_schema(conn, schema)
    await apply_finance_migrations(conn)
    pool = await asyncpg.create_pool(
        DSN, min_size=1, max_size=4,
        server_settings={'search_path': f'"{schema}", public'})
    try:
        yield conn, pool
    finally:
        await pool.close()
        await conn.execute('SET search_path TO public')
        await conn.execute(f'DROP SCHEMA "{schema}" CASCADE')
        await conn.close()


async def enqueue(conn: asyncpg.Connection, topic: str = outbox.SANDBOX_TOPIC) -> UUID:
    return await conn.fetchval(
        """INSERT INTO finance_outbox_events (topic, aggregate_type, aggregate_id)
           VALUES ($1,'tuition_payment',$2) RETURNING id""", topic, uuid4())


@pytest.mark.asyncio
async def test_workers_claim_each_event_once_and_leave_other_topics_pending(database):
    conn, pool = database
    approved = await enqueue(conn)
    unapproved = await enqueue(conn, 'guardian.message')
    delivered = []

    async def sink(event: outbox.Delivery) -> None:
        await asyncio.sleep(0)
        delivered.append(event.id)

    counts = await asyncio.gather(
        outbox.dispatch_batch(pool, {outbox.SANDBOX_TOPIC: sink}),
        outbox.dispatch_batch(pool, {outbox.SANDBOX_TOPIC: sink}))
    assert sum(counts) == 1
    assert delivered == [approved]
    assert await conn.fetchval(
        'SELECT published_at IS NOT NULL FROM finance_outbox_events WHERE id=$1', approved)
    assert await conn.fetchval(
        'SELECT published_at IS NULL FROM finance_outbox_events WHERE id=$1', unapproved)


@pytest.mark.asyncio
async def test_expired_lease_replays_with_same_id_and_deduplicates_consumer(database):
    conn, pool = database
    event_id = await enqueue(conn)
    first, = await outbox.claim(conn, (outbox.SANDBOX_TOPIC,))
    assert first.id == event_id
    await outbox.record_sandbox_delivery(conn, first)
    # Simulate a process crash after delivery but before the queue was acknowledged.
    await conn.execute(
        "UPDATE finance_outbox_events SET lease_expires_at=now()-interval '1 second' WHERE id=$1",
        event_id)
    replay, = await outbox.claim(conn, (outbox.SANDBOX_TOPIC,))
    assert replay.id == event_id
    assert replay.lease_token != first.lease_token
    assert not await outbox.acknowledge(conn, first)
    await outbox.record_sandbox_delivery(conn, replay)
    assert await outbox.acknowledge(conn, replay)
    assert await conn.fetchval(
        'SELECT count(*) FROM finance_outbox_sandbox_receipts WHERE event_id=$1', event_id) == 1


@pytest.mark.asyncio
async def test_poison_event_uses_bounded_retry_and_quarantine(database):
    conn, pool = database
    event_id = await enqueue(conn)

    async def failed(event: outbox.Delivery) -> None:
        raise RuntimeError('secret provider payload must never appear in error state')

    for attempt in range(1, outbox.MAX_ATTEMPTS + 1):
        assert await outbox.dispatch_batch(pool, {outbox.SANDBOX_TOPIC: failed}) == 1
        state = await conn.fetchrow(
            'SELECT * FROM finance_outbox_events WHERE id=$1', event_id)
        assert state['attempts'] == attempt
        assert state['last_error'] == 'delivery_failed'
        assert state['lease_token'] is None
        assert state['published_at'] is None
        assert state['next_attempt_at'] > state['created_at']
        assert await outbox.claim(conn, (outbox.SANDBOX_TOPIC,)) == []
        await conn.execute(
            'UPDATE finance_outbox_events SET next_attempt_at=now() WHERE id=$1', event_id)
    assert state['dead_lettered_at'] is not None
    assert await outbox.dispatch_batch(pool, {outbox.SANDBOX_TOPIC: failed}) == 0
    assert await conn.fetchval('SELECT count(*) FROM finance_outbox_sandbox_receipts') == 0
