"""Exercise the link-only flow with the migrated schema and native ASGI entry point."""
import asyncio
import hashlib
import json
import os
from pathlib import Path

from fastapi.testclient import TestClient

from app import main as core
from app.asgi import application
from app.second_owner_port import INSPECTION_VIEWS
from app.security import SESSION_COOKIE, issue_token, verify_token
from stdio_postgres import Connection

os.environ['AUTH_SECRET'] = 'isolated-second-owner-postgres-probe-key'
os.environ['NODE_ENV'] = 'development'
os.environ['RATE_LIMIT_BACKEND'] = 'memory'
connection = Connection()
origin = 'https://example.test'


async def pool() -> Connection:
    return connection


def profile(role: str, name: str) -> dict:
    return asyncio.run(connection.fetchrow("""
        INSERT INTO users (name, role, account_status, onboarding_completed_at)
        VALUES ($1, $2, 'active', now()) RETURNING *
    """, name, role))


def cookie(client: TestClient, user: dict) -> None:
    client.cookies.set(SESSION_COOKIE, issue_token(user), domain='example.test', path='/')


def invite(client: TestClient) -> str:
    response = client.post('/api/owner/second-owner')
    assert response.status_code == 201, response.text
    assert response.headers['cache-control'] == 'private, no-store'
    path = response.json()['invitePath']
    assert path.startswith('/login#second-owner=')
    return path.split('=', 1)[1]


core.pool = pool
primary = profile('owner', 'Primary owner')
other_learner = profile('student', 'Another learner')
owner = TestClient(application, base_url=origin)
learner = TestClient(application, base_url=origin)
visitor = TestClient(application, base_url=origin)
recipient = TestClient(application, base_url=origin)
cookie(owner, primary)
cookie(learner, other_learner)

assert visitor.post('/api/owner/second-owner').status_code == 401
assert learner.post('/api/owner/second-owner').status_code == 403
assert learner.get('/api/second-owner/inspection').status_code == 403
assert owner.get('/api/owner/second-owner').json()['inviteExpiresAt'] is None

superseded = invite(owner)
token = invite(owner)
assert visitor.post('/api/auth/second-owner/redeem', json={'token': superseded}).status_code == 400
stored = asyncio.run(connection.fetchval('SELECT invite_hash FROM second_owner_access'))
assert stored == hashlib.sha256(token.encode('ascii')).hexdigest()
assert token not in owner.get('/api/owner/second-owner').text
assert visitor.post('/api/auth/second-owner/redeem', json={'token': token},
                    headers={'Origin': 'https://elsewhere.test'}).status_code == 403

response = recipient.post('/api/auth/second-owner/redeem', json={'token': token})
assert response.status_code == 200, response.text
assert 'HttpOnly' in response.headers['set-cookie'] and 'Secure' in response.headers['set-cookie']
signed = verify_token(recipient.cookies.get(SESSION_COOKIE))
assert signed['secondOwner'] is True and signed['exp'] - signed['iat'] == 24 * 60 * 60
assert visitor.post('/api/auth/second-owner/redeem', json={'token': token}).status_code == 400
session = recipient.get('/api/frontend/session').json()['session']
account = session['user']
assert session['secondOwner'] is True
assert account['role'] == 'student' and account['email'] is None and account['id'] != str(primary['id'])
assert owner.get('/api/owner/second-owner').json()['sessionExpiresAt']
assert recipient.get('/api/owner/second-owner').status_code == 403
if Path('../../frontend/vanilla/build/asset-manifest.json').is_file():
    assert recipient.get('/app/observer', follow_redirects=False).status_code == 200
    assert learner.get('/app/observer', follow_redirects=False).headers['location'] == '/app'
    assert owner.get('/app/owner/second-owner', follow_redirects=False).status_code == 200

for section in INSPECTION_VIEWS:
    response = recipient.get('/api/second-owner/inspection', params={'section': section})
    assert response.status_code == 200, (section, response.text)
rows = recipient.get('/api/second-owner/inspection', params={'q': 'Another learner'}).json()['rows']
assert rows == [{'title': 'Another learner', 'detail': 'student · active'}]
for method, path in [
    ('DELETE', '/api/admin/users/' + account['id']),
    ('DELETE', '/api/owner/second-owner'),
    ('POST', '/api/speaking/materials'),
    ('PATCH', '/api/frontend/profile'),
]:
    response = recipient.request(method, path, json={})
    assert (response.status_code, response.json()['error']) == (403, 'second_owner_read_only')
response = recipient.post('/api/uploads/intent', json={
    'purpose': 'material_primary', 'filename': 'test.pdf', 'contentType': 'application/pdf', 'size': 1,
})
assert response.status_code == 403, response.text

response = recipient.post('/api/speaking/attempts', json={'part': 'part1'})
assert response.status_code == 200, response.text
attempt_id = response.json()['attempt']['id']
assert str(asyncio.run(connection.fetchval('SELECT user_id FROM speaking_attempts WHERE id=$1', attempt_id))) == account['id']

expired = invite(owner)
asyncio.run(connection.execute("UPDATE second_owner_access SET invite_expires_at = now() - interval '1 minute'"))
assert visitor.post('/api/auth/second-owner/redeem', json={'token': expired}).status_code == 400
replacement = invite(owner)
assert owner.delete('/api/owner/second-owner').status_code == 200
assert recipient.get('/api/frontend/session').status_code == 401
assert recipient.get('/api/second-owner/inspection').status_code == 401
assert visitor.post('/api/auth/second-owner/redeem', json={'token': replacement}).status_code == 400

response = recipient.post('/api/auth/second-owner/redeem', json={'token': invite(owner)})
assert response.status_code == 200, response.text
assert recipient.get('/api/frontend/session').json()['session']['user']['id'] == account['id']
asyncio.run(connection.execute('UPDATE users SET auth_version = auth_version + 1 WHERE id=$1', primary['id']))
assert recipient.get('/api/second-owner/inspection').status_code == 401

print(json.dumps({'event': 'done', 'checks': 32 + len(INSPECTION_VIEWS)}))
