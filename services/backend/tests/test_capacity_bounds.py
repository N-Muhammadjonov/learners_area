import asyncio
from unittest.mock import AsyncMock

import bcrypt
import pytest
from app import main as core
from app import request_lifecycle as lifecycle
from app.db import BoundedPool
from app import live_classes_port as live


def test_capacity_settings_are_bounded_even_for_blank_invalid_and_large_cpu(monkeypatch):
    monkeypatch.setattr(lifecycle.os, 'cpu_count', lambda: 128)
    for value, expected in [('', 8), ('nan', 8), ('999', 8), ('-3', 1), ('2', 2)]:
        monkeypatch.setenv('AUTH_HASH_CONCURRENCY', value)
        assert lifecycle.hash_concurrency() == expected
    monkeypatch.setenv('REQUEST_BUDGET_ORDINARY', '2048')
    assert lifecycle.RequestBudget(None).ordinary == 1024
    monkeypatch.setenv('REQUEST_BUDGET_ORDINARY', 'invalid')
    assert lifecycle.RequestBudget(None).ordinary == 64


def test_bcrypt_has_its_own_slots_and_wait_but_regular_work_keeps_existing_defaults(monkeypatch):
    async def run():
        controller = lifecycle.WorkerControl()
        state = controller.start()
        mocked = AsyncMock(return_value=True)
        monkeypatch.setattr(controller, '_run', mocked)
        monkeypatch.setenv('AUTH_HASH_WAIT_SECONDS', '999')
        assert await controller.run_blocking(bcrypt.checkpw, b'password', b'hash') is True
        call = mocked.call_args
        assert call.args[1] is state.hash_slots
        assert call.kwargs == {'wait': 10, 'busy': 'auth_hash_busy'}
        await controller.run_blocking(lambda: None)
        assert mocked.call_args.args[1] is state.work_slots
        assert mocked.call_args.kwargs == {}
    asyncio.run(run())


def test_saturated_ordinary_slots_do_not_block_hash_work_and_cancellation_keeps_hash_slot(monkeypatch):
    import threading
    async def run():
        monkeypatch.setenv('AUTH_HASH_CONCURRENCY', '1')
        controller = lifecycle.WorkerControl()
        state = controller.start()
        await state.work_slots.acquire()
        await state.work_slots.acquire()
        entered, release = threading.Event(), threading.Event()
        def password_work():
            entered.set()
            release.wait(timeout=2)
            return True
        password_work.__module__ = 'bcrypt._bcrypt'
        password_work.__name__ = 'checkpw'
        task = asyncio.create_task(controller.run_blocking(password_work))
        try:
            assert await asyncio.to_thread(entered.wait, 1)
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            assert state.hash_slots.locked()
            release.set()
            await controller.drain(timeout=2, state=state)
            assert not state.hash_slots.locked()
        finally:
            release.set()
            state.work_slots.release()
            state.work_slots.release()
    asyncio.run(run())


def test_pool_acquire_preserves_both_interfaces_and_logs_only_waits(monkeypatch, caplog):
    clock = [0.0]
    monkeypatch.setattr('app.db.time.monotonic', lambda: clock[0])
    class Lease:
        async def get(self): clock[0] += .3; return 'connection'
        def __await__(self): return self.get().__await__()
        async def __aenter__(self): return await self.get()
        async def __aexit__(self, *_): return False
    class Raw:
        def acquire(self, *, timeout):
            assert timeout == 5
            return Lease()
    async def run():
        pool = BoundedPool(Raw(), 5)
        async with pool.acquire() as value: assert value == 'connection'
        assert await pool.acquire() == 'connection'
    asyncio.run(run())
    assert sum('exceeded 250ms' in message for message in caplog.messages) == 1


def test_busy_logs_are_rate_limited_and_youtube_cache_expires_and_evicts(monkeypatch, caplog):
    monkeypatch.setattr(lifecycle, '_busy_log_at', {})
    for _ in range(10):
        response = lifecycle.unavailable('busy')
        assert response.status_code == 503 and response.headers['retry-after'] == '1'
    assert sum('admission returned 503' in message for message in caplog.messages) == 1
    monkeypatch.setattr(live, '_youtube_status_cache', {})
    monkeypatch.setattr(live, 'YOUTUBE_API_CACHE_TTL_SECONDS', 10000)
    for index in range(513): live._store_youtube_status(str(index), {'verified': True}, float(index))
    assert len(live._youtube_status_cache) == 512 and '0' not in live._youtube_status_cache
    live._prune_youtube_status_cache(20000)
    assert live._youtube_status_cache == {}
