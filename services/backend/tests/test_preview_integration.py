import asyncio
import json
from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application
from app import db as database

TOKEN = 'unit-test-renderer-token-with-more-than-32-characters'
UID = UUID('11111111-1111-4111-8111-111111111111')
USER = {'id': UID, 'name': 'Learner', 'email': 'learner@example.test', 'role': 'student',
        'account_status': 'active', 'locale': 'uz', 'onboarding_completed_at': None,
        'status_reason': None, 'auth_version': 0}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv('BACKEND_SERVICE_TOKEN', TOKEN)
    monkeypatch.setenv('AUTH_SECRET', 'unit-test-only-signing-secret-with-more-than-32-characters')
    return TestClient(application)


@pytest.mark.parametrize('method,path,body', [
    ('GET', '/_frontend/session', None),
    ('POST', '/_frontend/query', {'sql': 'select 1', 'params': []}),
    ('POST', '/_frontend/action', {'action': 'retention.live'}),
])
def test_private_renderer_cannot_be_called_without_the_service_key(client, monkeypatch, method, path, body):
    async def forbidden_pool():
        raise AssertionError('private route reached the database')
    monkeypatch.setattr(core, 'pool', forbidden_pool)
    response = client.request(method, path, json=body)
    assert response.status_code in (404,405)






class Connection:
    def __init__(self):self.calls = [];self.readonly = None
    async def __aenter__(self):return self
    async def __aexit__(self, *args):return False
    def acquire(self):return self
    def transaction(self, **kwargs):self.readonly = kwargs.get('readonly');return self
    async def fetchrow(self, sql, *args):
        self.calls.append((sql, args))
        return {'id': args[0]}
    async def fetch(self, sql, *args):
        self.calls.append((sql, args));return []
    async def fetchval(self, sql, *args):
        self.calls.append((sql, args));return None
    async def execute(self, sql, *args):self.calls.append((sql, args))


async def learner(req, active=False):return dict(USER)






def test_completed_main_listening_uses_the_exact_native_runtime_and_media_contract(client, monkeypatch):
    from app import step21_listening_authored_reads as authored
    connection = Connection()
    async def completed(sql,*args):return {'id':UID,'status':'completed'}
    connection.fetchrow=completed
    async def pool():return connection
    async def context(*args):
        return {'source_id': 'listening-test-1', 'payload': {'authoredRuntime': '<main>existing course</main>',
                'audio': {'path': 'audio.mp3'}, 'vocabulary': []}, 'audio_object_key': 'audio/lesson.mp3'}, None
    monkeypatch.setattr(core, 'pool', pool)
    monkeypatch.setattr(core, 'current_user', learner)
    monkeypatch.setattr(authored, 'get_context', context)
    response = client.get('/api/listening/full/e44e3d4b-3af6-41a9-b465-7d4bc21e1019/authored')
    assert response.status_code == 200
    from app.listening_runtime import runtime
    assert response.json()['runtime'] == runtime(1)
    assert response.json()['nativePersistence'] is True
    assert response.json()['storageKey'] == 'la_listening_test_1_v2'
    assert response.json()['vocabulary'] == []
    assert response.json()['audioUrl'] == '/api/resources/audio/lesson.mp3?download=1'


def test_sandbox_csp_keeps_the_inline_launcher_and_opaque_origin(client, monkeypatch):
    async def admin(req, active=False):return {**USER, 'role': 'owner'}
    monkeypatch.setattr(core, 'current_user', admin)
    response = client.get('/api/listening/full/preview/sandbox')
    assert response.status_code == 200
    csp = response.headers['content-security-policy']
    assert "script-src 'unsafe-inline'" in csp
    assert 'sandbox allow-scripts' in csp
    assert "connect-src 'none'" in csp


def test_main_listening_delete_preserves_results_and_hides_the_material(client, monkeypatch):
    async def admin(req, active=False):return {**USER, 'role': 'admin'}
    connection = Connection()
    async def pool():return connection
    monkeypatch.setattr(core, 'current_user', admin)
    monkeypatch.setattr(core, 'pool', pool)
    response = client.delete('/api/admin/listening/tests/' + str(UID))
    assert response.status_code == 200 and response.json() == {'ok': True, 'action': 'deleted', 'resultsPreserved': True}
    assert any("publication_state='draft'" in sql for sql, _ in connection.calls)
    assert any('CONTENT_DELETED' in sql for sql, _ in connection.calls)
    assert not any(sql.startswith('DELETE') for sql, _ in connection.calls)






@pytest.mark.asyncio
async def test_concurrent_initial_requests_share_one_pool(monkeypatch):
    marker = object();calls = 0
    async def create():
        nonlocal calls
        calls += 1
        await asyncio.sleep(0)
        return marker
    monkeypatch.setattr(database, '_pool', None)
    monkeypatch.setattr(database, '_pool_lock', None)
    monkeypatch.setattr(database, '_create_pool', create)
    values = await asyncio.gather(*(database.pool() for _ in range(8)))
    assert calls == 1 and all(value is marker for value in values)


VOCABULARY_REGIONS = ('', '/summary', '/folders', '/due', '/sentences', '/leaderboard')


@pytest.mark.parametrize('region', VOCABULARY_REGIONS)
def test_vocabulary_regions_authorize_before_database_access(client, monkeypatch, region):
    async def anonymous(req, active=False):return None
    async def forbidden_pool():raise AssertionError('anonymous request reached the database')
    monkeypatch.setattr(core, 'current_user', anonymous)
    monkeypatch.setattr(core, 'pool', forbidden_pool)
    response = client.get('/api/vocabulary' + region)
    assert response.status_code == 401
    assert response.headers['cache-control'] == 'private, no-store'


@pytest.mark.parametrize('region', VOCABULARY_REGIONS)
def test_vocabulary_region_database_outages_are_local_retryable_responses(client, monkeypatch, region):
    async def unavailable_pool():raise RuntimeError('private connection details must not escape')
    monkeypatch.setattr(core, 'current_user', learner)
    monkeypatch.setattr(core, 'pool', unavailable_pool)
    response = client.get('/api/vocabulary' + region)
    assert response.status_code == 503
    assert response.json()['error'] == 'temporarily_unavailable'
    assert response.headers['cache-control'] == 'private, no-store'
    assert 'private connection' not in response.text


def test_vocabulary_library_keeps_user_scope_and_pagination(client, monkeypatch):
    connection = Connection()
    async def fetch(sql, *values):
        connection.calls.append((sql, values))
        return []
    connection.fetch = fetch
    async def pool():return connection
    monkeypatch.setattr(core, 'current_user', learner)
    monkeypatch.setattr(core, 'pool', pool)
    response = client.get('/api/vocabulary?limit=50&offset=100')
    assert response.status_code == 200
    assert response.json() == {'ok': True, 'words': [], 'hasMore': False, 'nextOffset': None, 'offset': 100, 'limit': 50}
    assert connection.calls[0][1] == (UID, 51, 100)
    assert 'WHERE uv.user_id=$1' in connection.calls[0][0]
