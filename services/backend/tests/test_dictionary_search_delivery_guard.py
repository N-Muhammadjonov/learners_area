import asyncio
from uuid import UUID
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app import main as core
from app import step17_dictionary_read_port as read
from app import step26_dictionary_owner_read as owner

class Connection:
    def __init__(self, registry, index=None):
        self.registry, self.index, self.legacy_reads, self.registry_reads = registry, index, 0, 0

    async def fetchrow(self, sql, *args):
        if 'dictionary_search_indexes' in sql:
            return self.index
        if 'dictionary_releases' in sql:
            self.registry_reads += 1
            return self.registry
        raise AssertionError('Unexpected query')

    async def fetch(self, sql, *args):
        assert 'dictionary_search_terms' in sql
        self.legacy_reads += 1
        return []

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass


class Pool:
    def __init__(self, con):
        self.con = con

    def acquire(self):
        return self.con


def client(monkeypatch, con):
    async def user(*args, **kwargs):
        return {'id': UUID('11111111-1111-4111-8111-111111111111')}
    async def pool():
        return Pool(con)
    async def pinned(*args):
        return 'rel-v1-977bce7f8dab7e773955238e'
    monkeypatch.setattr(read.core, 'current_user', user)
    monkeypatch.setattr(read.core, 'pool', pool)
    monkeypatch.setattr(read, 'pinned', pinned)
    monkeypatch.setattr(read, 'counter', lambda *a, **k: 0)
    app = FastAPI()
    app.include_router(read.router)
    return TestClient(app)


@pytest.mark.parametrize('registry', [None,
    {'state': 'validated', 'delivery': 'r2-worker-v1'},
    {'state': 'building', 'delivery': 'r2-worker-v1'},
    {'state': 'retired', 'delivery': 'legacy'}])
@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_missing_index_fails_closed_without_reading_legacy(monkeypatch, registry, direction):
    con = Connection(registry)
    response = client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction})
    assert response.status_code == 503 and response.json() == {'error': 'temporarily_unavailable'}
    assert response.headers['cache-control'] == 'private, no-store'
    assert con.legacy_reads == 0
    with pytest.raises(ValueError, match='dictionary_worker_unavailable'):
        asyncio.run(owner.search(con, 'quality', direction, 'release'))
    assert con.legacy_reads == 0


@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_validated_legacy_fallback_remains_compatible(monkeypatch, direction):
    con = Connection({'state': 'validated', 'delivery': 'legacy'})
    assert client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction}).status_code == 200
    assert asyncio.run(owner.search(con, 'quality', direction, 'release')) == []
    assert con.legacy_reads == 2


@pytest.mark.parametrize('direction', ['EN', 'UZ'])
def test_worker_happy_path_does_not_add_a_database_query(monkeypatch, direction):
    con = Connection(None, {'directory': {'name': 'directory'}})
    async def worker(body):
        return {'release_id': body['release'], 'results': []}
    monkeypatch.setattr(read, 'worker', worker)
    monkeypatch.setattr(owner, 'worker', worker)
    assert client(monkeypatch, con).get('/api/dictionary/search', params={'q': 'quality', 'direction': direction}).status_code == 200
    assert asyncio.run(owner.search(con, 'quality', direction, 'release')) == []
    assert con.registry_reads == con.legacy_reads == 0


def test_worker_release_mismatch_is_not_hidden_by_sql_fallback(monkeypatch):
    con = Connection(None, {'directory': {'name': 'directory'}})
    async def worker(body):
        return {'release_id': 'wrong', 'results': []}
    monkeypatch.setattr(read, 'worker', worker)
    response = client(monkeypatch, con).get('/api/dictionary/search?q=quality')
    assert response.status_code == 503 and con.legacy_reads == 0
