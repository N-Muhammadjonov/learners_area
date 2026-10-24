"""Actual ASGI requests against embedded PostgreSQL via a stdio driver adapter.

No TCP port, production database, external service or user account is used.
The adapter returns PostgreSQL metadata/records in asyncpg's documented shapes.
"""
import asyncio
import json
import os
import sys
import threading
from datetime import datetime, date
from decimal import Decimal
from types import SimpleNamespace
from uuid import UUID

import bcrypt
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application

LOCK = threading.Lock()


class DatabaseError(Exception):
    def __init__(self, message, code):super().__init__(message);self.sqlstate = code


def encode(value):
    if isinstance(value, (UUID, Decimal)):return str(value)
    if isinstance(value, (datetime, date)):return value.isoformat()
    raise TypeError(type(value).__name__)


def exchange(mode, sql, values):
    with LOCK:
        print(json.dumps({'mode': mode, 'sql': sql, 'values': values}, default=encode), flush=True)
        response = json.loads(sys.stdin.readline())
    if 'error' in response:raise DatabaseError(response['error'], response.get('code'))
    return response


def decode(value, oid):
    if value is None:return None
    if oid == 2950:return UUID(value)
    if oid in (1114, 1184):return datetime.fromisoformat(value.replace('Z', '+00:00'))
    if oid == 1082:return date.fromisoformat(value[:10])
    if oid == 1700:return Decimal(str(value))
    return value


class Transaction:
    def __init__(self, con, readonly=False):self.con = con;self.readonly = readonly
    async def __aenter__(self):
        self.depth = self.con.depth;self.con.depth += 1
        await self.con.execute(('BEGIN READ ONLY' if self.readonly else 'BEGIN') if self.depth == 0 else f'SAVEPOINT probe_{self.depth}')
        return self.con
    async def __aexit__(self, kind, value, trace):
        self.con.depth -= 1
        await self.con.execute(('ROLLBACK' if kind else 'COMMIT') if self.depth == 0 else (f'ROLLBACK TO SAVEPOINT probe_{self.depth}' if kind else f'RELEASE SAVEPOINT probe_{self.depth}'))
        return False


class Connection:
    depth = 0
    async def __aenter__(self):return self
    async def __aexit__(self, *args):return False
    def acquire(self):return self
    def transaction(self, readonly=False):return Transaction(self, readonly)
    async def fetch(self, sql, *values):
        result = await asyncio.to_thread(exchange, 'query', sql, values)
        return [{field['name']: decode(row[field['name']], field['dataTypeID']) for field in result['fields']} for row in result['rows']]
    async def fetchrow(self, sql, *values):
        rows = await self.fetch(sql, *values);return rows[0] if rows else None
    async def fetchval(self, sql, *values):
        row = await self.fetchrow(sql, *values);return next(iter(row.values())) if row else None
    async def execute(self, sql, *values):
        result = await asyncio.to_thread(exchange, 'query' if values else 'exec', sql, values)
        return result.get('command', '')
    async def prepare(self, sql, *, name):
        assert name == ''
        description = await asyncio.to_thread(exchange, 'describe', sql, [])
        con = self
        class Statement:
            def get_parameters(self):return [SimpleNamespace(name=p['name']) for p in description['params']]
            def get_attributes(self):return [SimpleNamespace(name=f['name'], type=SimpleNamespace(name=f['typeName'], oid=f['dataTypeID'])) for f in description['fields']]
            async def fetch(self, *values):
                rows = await con.fetch(sql, *values)
                return [tuple(row[f['name']] for f in description['fields']) for row in rows]
        return Statement()


con = Connection()
async def pool():return con
core.pool = pool
os.environ['AUTH_SECRET'] = 'unit-test-only-signing-secret-for-embedded-postgres'
os.environ['BACKEND_SERVICE_TOKEN'] = 'unit-test-only-renderer-key-for-embedded-postgres'
os.environ['NODE_ENV'] = 'development'
UID = '11111111-1111-4111-8111-111111111111'
TEST = 'e44e3d4b-3af6-41a9-b465-7d4bc21e1019'
PASSWORD = 'EmbeddedTest123!'
digest = bcrypt.hashpw(PASSWORD.encode(), bcrypt.gensalt(rounds=4)).decode()
asyncio.run(con.execute("INSERT INTO users(id,name,email,password_hash,role,account_status,locale) VALUES($1,'Probe learner','probe@example.test',$2,'owner','active','uz')", UID, digest))
client = TestClient(application, base_url='http://preview.test')
headers = {'x-backend-service-token': os.environ['BACKEND_SERVICE_TOKEN']}
checks = 0

response = client.post('/api/auth/login', json={'email': 'probe@example.test', 'password': PASSWORD}, headers={'origin': 'http://preview.test'})
assert response.status_code == 200, response.text
assert response.json()['accountStatus'] == 'active'
checks += 1
response = client.get('/_frontend/session', headers=headers)
assert response.status_code == 200 and response.json()['user']['id'] == UID, response.text
checks += 1
asyncio.run(con.execute("UPDATE users SET name='Updated learner' WHERE id=$1", UID))
assert client.get('/_frontend/session', headers=headers).json()['user']['name'] == 'Updated learner'
checks += 1

sql = 'SELECT $1::uuid AS id,$2::timestamptz AS at,$3::jsonb AS payload,$4::text[] AS tags,$5::numeric AS number'
response = client.post('/_frontend/query', headers=headers, json={'sql': sql, 'params': [UID, '2026-10-24T00:00:00.000Z', {'text': 'o‘rganish', 'nested': [1, None, True]}, '{"a,b",NULL,"NULL"}', '6.50']})
assert response.status_code == 200, response.text
wire = response.json()
assert wire['rows'][0][0] == UID
assert json.loads(wire['rows'][0][2])['nested'] == [1, None, True]
checks += 1
response = client.post('/_frontend/query', headers=headers, json={'sql': 'WITH removed AS (DELETE FROM users RETURNING id) SELECT * FROM removed', 'params': []})
assert response.status_code == 503 and response.json()['code'] == '25006', response.text
assert asyncio.run(con.fetchval('SELECT count(*)::int FROM users')) == 1
checks += 1

payload = {'authoredRuntime': '<main>Original inline lesson</main>', 'audio': {'path': 'audio.mp3'}, 'vocabulary': []}
asyncio.run(con.execute("INSERT INTO listening_tests(id,created_by_user_id,title,audio_type,publication_state,is_active) VALUES($1,$2,'Original lesson','file','published',true)", TEST, UID))
asyncio.run(con.execute('INSERT INTO listening_packages(test_id,source_id,payload,audio_object_key,source_hash) VALUES($1,$2,$3::jsonb,$4,$5)', TEST, 'listening-test-1', payload, 'audio/probe.mp3', 'a'*64))
response = client.get('/api/listening/full/'+TEST+'/authored')
assert response.status_code == 200 and response.json()['runtime'] == payload['authoredRuntime'], response.text
checks += 1
response = client.get('/api/listening/full/preview/sandbox')
assert response.status_code == 200 and 'sandbox allow-scripts' in response.headers['content-security-policy']
checks += 1
response = client.delete('/api/admin/listening/tests/'+TEST)
assert response.status_code == 200 and response.json() == {'ok': True}, response.text
assert asyncio.run(con.fetchval('SELECT publication_state FROM listening_tests WHERE id=$1', TEST)) == 'archived'
assert asyncio.run(con.fetchval('SELECT count(*)::int FROM listening_tests WHERE id=$1', TEST)) == 1
checks += 1

response = client.post('/api/auth/logout')
assert response.status_code == 200, response.text
assert asyncio.run(con.fetchval('SELECT count(*)::int FROM auth_session_revocations')) == 1
assert client.get('/_frontend/session', headers=headers).json()['user'] is None
checks += 1
print(json.dumps({'event': 'done', 'checks': checks, 'wire': wire}), flush=True)
