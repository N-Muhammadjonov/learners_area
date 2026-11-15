"""Bounded dispatch for committed finance events with explicit topic handlers."""
from __future__ import annotations

import asyncio
import logging
import random
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from datetime import timedelta
from uuid import UUID, uuid4

import asyncpg

LOG = logging.getLogger(__name__)
BATCH_SIZE = 8
DELIVERY_TIMEOUT = 10
LEASE_SECONDS = 60
MAX_ATTEMPTS = 100
POLL_SECONDS = 2
SANDBOX_TOPIC = 'provider.settled'


@dataclass(frozen=True)
class Delivery:
    id: UUID
    topic: str
    attempts: int
    lease_token: UUID


Handler = Callable[[Delivery], Awaitable[None]]


async def claim(conn: asyncpg.Connection, topics: tuple[str, ...],
                *, limit: int = BATCH_SIZE) -> list[Delivery]:
    """Reserve only approved topics; expired leases become available to another worker."""
    if not topics:
        return []
    token = uuid4()
    rows = await conn.fetch(
        """WITH pending AS (
               SELECT id FROM finance_outbox_events
                WHERE topic=ANY($1::varchar[]) AND published_at IS NULL
                  AND dead_lettered_at IS NULL AND next_attempt_at<=now()
                  AND (lease_expires_at IS NULL OR lease_expires_at<=now())
                ORDER BY next_attempt_at, created_at, id
                FOR UPDATE SKIP LOCKED LIMIT $2
           )
           UPDATE finance_outbox_events AS event
              SET lease_token=$3, lease_expires_at=now()+$4::interval
             FROM pending WHERE event.id=pending.id
           RETURNING event.id, event.topic, event.attempts, event.lease_token""",
        list(topics), max(1, min(limit, BATCH_SIZE)), token, timedelta(seconds=LEASE_SECONDS))
    return [Delivery(**dict(row)) for row in rows]


async def acknowledge(conn: asyncpg.Connection, delivery: Delivery) -> bool:
    result = await conn.execute(
        """UPDATE finance_outbox_events
              SET published_at=now(), lease_token=NULL, lease_expires_at=NULL, last_error=NULL
            WHERE id=$1 AND lease_token=$2 AND published_at IS NULL""",
        delivery.id, delivery.lease_token)
    return result == 'UPDATE 1'


async def retry(conn: asyncpg.Connection, delivery: Delivery, *, timed_out: bool) -> bool:
    attempts = delivery.attempts + 1
    backoff = min(3600, 2 ** min(attempts, 12))
    delay = timedelta(seconds=backoff * random.uniform(0.75, 1))
    result = await conn.execute(
        """UPDATE finance_outbox_events
              SET attempts=$3::integer, next_attempt_at=now()+$4::interval,
                  dead_lettered_at=CASE WHEN $3::integer >= $5::integer THEN now() END,
                  last_error=$6, lease_token=NULL, lease_expires_at=NULL
            WHERE id=$1 AND lease_token=$2 AND published_at IS NULL""",
        delivery.id, delivery.lease_token, attempts, delay, MAX_ATTEMPTS,
        'delivery_timeout' if timed_out else 'delivery_failed')
    if result == 'UPDATE 1':
        LOG.warning('Finance outbox event %s topic=%s attempt=%s dead_letter=%s',
                    delivery.id, delivery.topic, attempts, attempts >= MAX_ATTEMPTS)
    return result == 'UPDATE 1'


async def dispatch_batch(pool: asyncpg.Pool, handlers: Mapping[str, Handler]) -> int:
    """Deliver concurrently with a fixed batch size and a timeout per event."""
    async with pool.acquire() as conn:
        deliveries = await claim(conn, tuple(handlers))

    async def deliver(event: Delivery) -> None:
        try:
            await asyncio.wait_for(handlers[event.topic](event), timeout=DELIVERY_TIMEOUT)
        except Exception as exc:
            async with pool.acquire() as conn:
                await retry(conn, event, timed_out=isinstance(exc, TimeoutError))
            return
        async with pool.acquire() as conn:
            await acknowledge(conn, event)

    results = await asyncio.gather(*(deliver(event) for event in deliveries), return_exceptions=True)
    for event, result in zip(deliveries, results):
        if isinstance(result, Exception):
            LOG.warning('Finance outbox state update failed event=%s topic=%s', event.id, event.topic)
    return len(deliveries)


async def record_sandbox_delivery(conn: asyncpg.Connection, delivery: Delivery) -> None:
    """A durable deterministic sink for sandbox events, deduplicated by event ID."""
    await conn.execute(
        """INSERT INTO finance_outbox_sandbox_receipts (event_id)
           VALUES ($1) ON CONFLICT (event_id) DO NOTHING""",
        delivery.id)


async def run_sandbox_worker(get_pool: Callable[[], Awaitable[asyncpg.Pool]]) -> None:
    """Poll explicitly enabled sandbox events and release owned resources on cancellation."""
    while True:
        try:
            pool = await get_pool()

            async def sink(delivery: Delivery) -> None:
                async with pool.acquire() as conn:
                    await record_sandbox_delivery(conn, delivery)

            count = await dispatch_batch(pool, {SANDBOX_TOPIC: sink})
        except Exception:
            LOG.warning('Finance sandbox outbox worker unavailable')
            count = 0
        await asyncio.sleep(0 if count == BATCH_SIZE else POLL_SECONDS)
