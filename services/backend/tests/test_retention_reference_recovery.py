"""One failed read must not take down Retention; expiry uses persisted scoring."""
import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from app import browser_reading as reading
from app import step21_retention_reads as reads
from app import step35_retention_attempts as attempts

@pytest.mark.parametrize('failed', ['summary', 'history', 'attempts'])
def test_retention_regions_fail_independently(monkeypatch, failed):
    async def existing(req, url):
        if url.endswith('/'+failed): raise HTTPException(500, 'retention_unavailable')
        return {'active': None} if url.endswith('/attempts') else {'real': True}
    monkeypatch.setattr(reading, 'existing', existing)
    result = asyncio.run(reading.read(None, {'id': 'owned'}, '/app/reading/retention', {}))
    assert result['initial'] is None
    assert result['sessionFailed'] is (failed == 'attempts')
    assert result['summary'] == (None if failed == 'summary' else {'real': True})
    assert result['history'] == (None if failed == 'history' else {'real': True})

@pytest.mark.parametrize('status', [401, 403])
def test_retention_does_not_hide_authority_failures(monkeypatch, status):
    async def existing(req, url): raise HTTPException(status, 'forbidden')
    monkeypatch.setattr(reading, 'existing', existing)
    with pytest.raises(HTTPException) as error:
        asyncio.run(reading.read(None, {'id': 'owned'}, '/app/reading/retention', {}))
    assert error.value.status_code == status

def test_expired_attempt_is_locked_and_finalized_before_returning_its_real_result(monkeypatch):
    now = datetime.now(timezone.utc)
    row = {'id':'owned-attempt','user_id':'owned-user','status':'reading',
           'read_ends_at':now-timedelta(minutes=5),'write_ends_at':now-timedelta(minutes=2)}
    events = []
    class Conn:
        def transaction(self): return self
        async def __aenter__(self): events.append('lock transaction'); return self
        async def __aexit__(self, *args): events.append('commit')
        async def fetchrow(self, sql, *args):
            assert 'FOR UPDATE' in sql and 'user_id=$2' in sql
            assert args == ('owned-attempt','owned-user')
            events.append('owner row locked')
            return row
    async def finalize(con, locked, timestamp, status):
        assert locked is row and status == 'timed_out'
        events.append('deterministic score persisted')
        return {**row,'status':'timed_out','score':37}
    async def payload(con, result, timestamp):
        assert result['status']=='timed_out' and result['score']==37
        events.append('result projection')
        return {'phase':'timed_out','score':37}
    monkeypatch.setattr(attempts,'finalize',finalize)
    monkeypatch.setattr(reads,'learner_payload',payload)
    assert asyncio.run(reads.projection(Conn(),row)) == {'phase':'timed_out','score':37}
    assert events == ['lock transaction','owner row locked','deterministic score persisted','commit','result projection']


@pytest.mark.asyncio
async def test_new_attempt_starts_with_two_minutes_to_read_and_five_to_write(monkeypatch):
    recorded = []

    class Connection:
        def acquire(self):
            return self

        def transaction(self):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def fetchrow(self, sql, *args):
            if 'INSERT INTO retention_attempts' in sql:
                recorded.append(args[-3:])
                return {'id': 'synthetic-attempt'}
            return None

        async def execute(self, sql, *args):
            return None

    monkeypatch.setattr(attempts.core, 'current_user', AsyncMock(return_value={'id': 'learner'}))
    monkeypatch.setattr(attempts.core, 'pool', AsyncMock(return_value=Connection()))
    monkeypatch.setattr(attempts.core, 'payload', AsyncMock(return_value={'level': 'A2'}))
    monkeypatch.setattr(attempts, 'locked_rotation', AsyncMock(return_value=(1, set(), None)))
    monkeypatch.setattr(attempts, 'choose', AsyncMock(return_value=('passage', 'version', 1, 'fixture')))
    monkeypatch.setattr(attempts, 'learner_payload', AsyncMock(return_value={'phase': 'reading'}))
    response = await attempts.start(None)
    assert response.status_code == 200
    assert len(recorded) == 1
    reading_starts, writing_starts, writing_ends = recorded[0]
    assert writing_starts - reading_starts == timedelta(minutes=2)
    assert writing_ends - writing_starts == timedelta(minutes=5)


@pytest.mark.asyncio
async def test_plan_level_filters_active_recall_without_filtering_history(monkeypatch):
    calls = []

    async def existing(req, url):
        calls.append(url)
        return {'active': None} if '/attempts' in url else {'visible': True}

    monkeypatch.setattr(reading, 'existing', existing)
    result = await reading.read(None, {'id': 'learner'}, '/app/reading/retention', {'level': 'A2'})
    assert result['initial'] is None
    assert calls == ['/api/retention/attempts?level=A2', '/api/retention/summary', '/api/retention/history']
