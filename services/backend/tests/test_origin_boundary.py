"""Isolated edge/origin compatibility; no Cloudflare configuration or live data."""
import asyncio
import pytest
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse
from app.origin_boundary import OriginBoundary, ENV
from app.asgi import application

SECRET = 'isolated-origin-boundary-test-value-123456'

async def echo(scope, receive, send):
    if scope['type'] == 'websocket':
        await send({'type': 'websocket.accept'})
        await send({'type': 'websocket.close', 'code': 1000})
        return
    await JSONResponse({'path':scope['path'],'range':dict(scope['headers']).get(b'range',b'').decode()})(scope,receive,send)

@pytest.fixture
def boundary(monkeypatch):
    monkeypatch.setenv(ENV, SECRET)
    return TestClient(OriginBoundary(echo))

@pytest.mark.parametrize('path',['/','/assets/build/modules/player.js','/api/frontend/session'])
def test_disabled_is_backwards_compatible(monkeypatch,path):
    monkeypatch.delenv(ENV,raising=False)
    assert TestClient(OriginBoundary(echo)).get(path).status_code==200

@pytest.mark.parametrize('headers',[{}, {'cf-ray':'forged','cf-connecting-ip':'1.2.3.4'},
    {'x-forwarded-for':'127.0.0.1','host':'learnersarea.railway.internal'},
    {'x-la-origin-verify':'wrong'}, {'origin':'https://learnersarea.uz'}])
def test_direct_origin_and_forged_proxy_headers_are_denied(boundary,headers):
    r=boundary.get('/api/frontend/session',headers=headers)
    assert r.status_code==403
    assert r.json()=={'error':'origin_forbidden'}
    assert r.headers['cache-control']=='private, no-store'
    assert SECRET not in r.text

@pytest.mark.parametrize('path',['/','/robots.txt','/sitemap.xml','/api/frontend/session','/api/uploads/intent','/api/resources/private/audio.mp3'])
def test_verified_edge_keeps_paths_and_range_headers(boundary,path):
    r=boundary.get(path,headers={'x-la-origin-verify':SECRET,'Range':'bytes=12-40'})
    assert r.status_code==200
    assert r.json()=={'path':path,'range':'bytes=12-40'}


def test_duplicate_origin_headers_fail_closed(boundary):
    assert boundary.get('/',headers=[('x-la-origin-verify',SECRET),('x-la-origin-verify',SECRET)]).status_code==403

@pytest.mark.parametrize('bad',['short','x'*31+' ','é'*40,'x'*257])
def test_invalid_config_does_not_open_origin_and_fails_readiness(monkeypatch,bad):
    monkeypatch.setenv(ENV,bad);c=TestClient(OriginBoundary(echo))
    assert c.get('/api/version').status_code==503
    assert c.get('/readyz').status_code==503
    assert c.get('/healthz').status_code==200

@pytest.mark.parametrize('path',['/healthz','/readyz'])
def test_railway_probes_still_work_without_edge_header(boundary,path):
    assert boundary.get(path).status_code==200
    assert boundary.get(path+'/extra').status_code==403


def test_origin_validation_does_not_grant_user_authority(monkeypatch,boundary):
    monkeypatch.setenv('PUBLIC_BASE_URL','http://testserver')
    c=TestClient(application)
    assert c.get('/api/frontend/session',headers={'x-la-origin-verify':SECRET}).status_code==401
    r=c.post('/api/theme',json={'theme':'day'},headers={'x-la-origin-verify':SECRET,'origin':'https://attacker.invalid'})
    assert r.status_code==403 and r.json()['error']=='invalid_origin'
    assert r.headers['x-robots-tag']=='noindex, nofollow, noarchive'


def test_existing_internal_bot_auth_remains_narrow(monkeypatch,boundary):
    monkeypatch.setenv('BOT_SERVICE_SECRET','isolated-bot-existing-credential')
    headers={'Authorization':'Bearer isolated-bot-existing-credential'}
    assert boundary.get('/api/internal/telegram/ready',headers=headers).status_code==200
    assert boundary.get('/api/frontend/session',headers=headers).status_code==403
    assert boundary.get('/api/internal/telegram/ready',headers={'Authorization':'Bearer wrong'}).status_code==403
    assert boundary.get('/api/internal/telegram/ready').status_code==403
    assert boundary.get('/api/internal/telegram/ready',headers=[('Authorization',headers['Authorization'])]*2).status_code==403


def test_unauthorized_upload_is_rejected_before_body_read(monkeypatch):
    monkeypatch.setenv(ENV,SECRET);sent=[]
    async def unread():raise AssertionError('denied upload body must not be read')
    async def send(message):sent.append(message)
    asyncio.run(OriginBoundary(echo)({'type':'http','method':'POST','path':'/api/uploads/intent','headers':[]},unread,send))
    assert sent[0]['status']==403


def test_websocket_handshake_requires_origin_proof(monkeypatch):
    monkeypatch.setenv(ENV,SECRET)
    async def probe(headers):
        sent=[]
        async def receive():return {'type':'websocket.connect'}
        async def send(message):sent.append(message)
        await OriginBoundary(echo)({'type':'websocket','path':'/api/live','headers':headers},receive,send)
        return sent
    assert asyncio.run(probe([]))==[{'type':'websocket.close','code':1008}]
    assert asyncio.run(probe([(b'x-la-origin-verify',SECRET.encode())]))[0]['type']=='websocket.accept'

def test_real_internal_bot_ready_keeps_existing_service_auth(monkeypatch):
    from app import main as core
    monkeypatch.setenv(ENV,SECRET)
    monkeypatch.setenv('BOT_SERVICE_SECRET','isolated-existing-bot-secret')
    monkeypatch.setenv('AUTH_SECRET','isolated-auth-secret-long-enough')
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN','isolated-token')
    monkeypatch.setenv('TELEGRAM_BOT_USERNAME','isolated_bot')
    reached=[]
    async def unavailable():
        reached.append(True)
        raise ConnectionError('isolated no database')
    monkeypatch.setattr(core,'pool',unavailable)
    c=TestClient(application)
    assert c.get('/api/internal/telegram/ready',headers={'Authorization':'Bearer isolated-existing-bot-secret'}).status_code==503
    assert reached==[True]
    assert c.get('/api/internal/telegram/ready',headers={'x-la-origin-verify':SECRET,'Authorization':'Bearer wrong'}).status_code==401
    assert reached==[True]
