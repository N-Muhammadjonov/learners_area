import asyncio
import json
from unittest.mock import AsyncMock
from uuid import UUID

from starlette.requests import Request

from app import main as core
from app import article_progress_port as progress
from test_migration_phase2 import FakePool

USER = UUID(int=1)
OTHER = UUID(int=2)
REQUEST = Request({'type': 'http', 'method': 'GET', 'path': '/', 'headers': []})


class Connection:
    def __init__(self):
        self.calls = []
        self.value = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return self.value

    async def execute(self, sql, *args):
        self.calls.append((sql, args))


def test_completion_is_account_scoped_validated_and_idempotently_merged(monkeypatch):
    con = Connection()
    monkeypatch.setattr(core, 'current_user', AsyncMock(return_value={'id': USER}))
    monkeypatch.setattr(core, 'pool', AsyncMock(return_value=FakePool(con)))
    monkeypatch.setattr(progress, 'article_ids', lambda: {'plastic-bags', 'dreams'})
    result = asyncio.run(progress.complete_article(REQUEST, 'dreams'))
    assert result.status_code == 200
    sql, args = con.calls[-1]
    assert 'ON CONFLICT(id) DO UPDATE' in sql and 'activity_events.user_id=excluded.user_id' in sql
    assert args == (progress.progress_id(USER), USER, progress.EVENT_TYPE, 'dreams')
    assert progress.progress_id(USER) != progress.progress_id(OTHER)
    assert asyncio.run(progress.complete_article(REQUEST, 'unknown')).status_code == 404
    assert len(con.calls) == 1
    con.value = json.dumps({'dreams': True, 'unknown': True, 'plastic-bags': False})
    response = asyncio.run(progress.get_progress(REQUEST))
    assert json.loads(response.body) == {'completed': ['dreams']}
    assert con.calls[-1][1] == (progress.progress_id(USER), USER, progress.EVENT_TYPE)
    assert response.headers['cache-control'] == 'private, no-store'


def test_progress_requires_an_active_user(monkeypatch):
    monkeypatch.setattr(core, 'current_user', AsyncMock(return_value=None))
    pool = AsyncMock(side_effect=AssertionError('anonymous database access'))
    monkeypatch.setattr(core, 'pool', pool)
    assert asyncio.run(progress.get_progress(REQUEST)).status_code == 401
    assert asyncio.run(progress.complete_article(REQUEST, 'dreams')).status_code == 401
    pool.assert_not_awaited()
