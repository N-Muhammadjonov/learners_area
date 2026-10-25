"""Writing reference metadata uses live readiness and the owned paper deadline."""
import asyncio
from datetime import datetime, timedelta, timezone
import pytest
from app import browser_writing as writing


@pytest.mark.parametrize('ready', [False, True])
def test_grade_readiness_is_read_before_holding_the_page_connection(monkeypatch, ready):
    held = False
    class Conn:
        async def __aenter__(self):
            nonlocal held
            assert not held
            held = True
            return self
        async def __aexit__(self, *args):
            nonlocal held
            held = False
        async def fetch(self, sql, *args):
            if 'writing_grade_requests' in sql:
                assert args == ('authorised-user',)
            else:
                assert 'writing_prompts' in sql
            return []
    class Pool:
        def acquire(self): return Conn()
    async def pool(): return Pool()
    async def readiness():
        assert not held, 'Readiness can acquire its own connection'
        return ready
    monkeypatch.setattr(writing.core, 'pool', pool)
    monkeypatch.setattr(writing, 'ai_ready', readiness)
    result = asyncio.run(writing.read(None, {'id': 'authorised-user'}, '/app/writing', {'tab': 'grade'}, None))
    assert result == {'aiReady': ready, 'essays': [], 'task1Prompts': []}
    assert not held


def test_exam_resume_uses_owned_server_deadline_and_ignores_expired_papers(monkeypatch):
    now = datetime.now(timezone.utc)
    class Conn:
        async def __aenter__(self): return self
        async def __aexit__(self, *args): pass
        async def fetch(self, sql, *args):
            if 'count(*)' in sql:
                return [{'task_type': 'task1', 'n': 2}, {'task_type': 'task2', 'n': 3}]
            assert args == ('authorised-user',)
            return [{'id': 'expired', 'mode': 'task1', 'started_at': now, 'expires_at': now-timedelta(seconds=1), 'finalized_at': None, 'finalize_reason': None},
                    {'id': 'owned-paper', 'mode': 'full', 'started_at': now, 'expires_at': now+timedelta(seconds=500), 'finalized_at': None, 'finalize_reason': None}]
    class Pool:
        def acquire(self): return Conn()
    async def pool(): return Pool()
    monkeypatch.setattr(writing.core, 'pool', pool)
    result = asyncio.run(writing.read(None, {'id': 'authorised-user'}, '/app/writing', {'tab': 'exam'}, None))['exam']
    assert result['open']['id'] == 'owned-paper'
    assert 490 <= result['open']['remainingSeconds'] <= 500
    assert result['availability'] == {'task1': 2, 'task2': 3}
