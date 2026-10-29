"""Targeted trusted-identity and operational failure contracts; no live calls."""
import asyncio
from unittest.mock import AsyncMock
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import JSONResponse
from app import rate_limit as limits,main as core
from app.origin_boundary import OriginBoundary
from app.asgi import application

@pytest.mark.parametrize('value,expected',[('203.0.113.8:443','203.0.113.8'),('[2001:db8::1]:443','2001:db8::1'),('::ffff:192.0.2.1','192.0.2.1'),('junk',None),('2001:::ff',None),('[2001:db8::1]junk',None),('192.0.2.1:65536',None),('fe80::1%en0',None)])
def test_transport_ip_syntax(value,expected):assert limits._as_ip(value)==expected

@pytest.mark.parametrize('headers',[
 [('x-real-ip','203.0.113.9')],[('x-forwarded-for','203.0.113.9')],
 [('cf-connecting-ip','203.0.113.9')],[('x-vercel-forwarded-for','203.0.113.9')]])
def test_forged_headers_cannot_change_peer_identity(headers):
    req=Request({'type':'http','path':'/','client':('192.0.2.1',8000),'headers':[(k.encode(),v.encode()) for k,v in headers]})
    assert limits.client_key(req)=='192.0.2.1'


def test_only_verified_cloudflare_request_supplies_client_identity(monkeypatch):
    secret='isolated-origin-verifier-for-proxy-12345';monkeypatch.setenv('CLOUDFLARE_ORIGIN_SECRET',secret)
    async def endpoint(scope,receive,send):await JSONResponse({'key':limits.client_key(Request(scope))})(scope,receive,send)
    c=TestClient(OriginBoundary(endpoint),client=('192.0.2.1',7000))
    assert c.get('/',headers={'cf-connecting-ip':'203.0.113.8'}).status_code==403
    r=c.get('/',headers={'x-la-origin-verify':secret,'cf-connecting-ip':'203.0.113.8','x-forwarded-for':'1.2.3.4'})
    assert r.json()=={'key':'203.0.113.8'}
    assert c.get('/',headers=[('x-la-origin-verify',secret),('cf-connecting-ip','1.2.3.4'),('cf-connecting-ip','2.3.4.5')]).json()=={'key':'192.0.2.1'}


def test_bot_credential_does_not_attest_forwarded_ip(monkeypatch):
    monkeypatch.setenv('CLOUDFLARE_ORIGIN_SECRET','isolated-origin-verifier-for-proxy-12345');monkeypatch.setenv('BOT_SERVICE_SECRET','existing-bot-key')
    async def endpoint(scope,receive,send):await JSONResponse({'key':limits.client_key(Request(scope))})(scope,receive,send)
    c=TestClient(OriginBoundary(endpoint),client=('192.0.2.1',7000))
    assert c.get('/api/internal/telegram/ready',headers={'Authorization':'Bearer existing-bot-key','cf-connecting-ip':'1.2.3.4'}).json()=={'key':'192.0.2.1'}


def test_database_config_selects_shared_store_and_memory_is_forbidden_in_production(monkeypatch):
    monkeypatch.delenv('RATE_LIMIT_BACKEND',raising=False);monkeypatch.setenv('DATABASE_URL','postgres://unused-test-dsn')
    assert limits.backend()=='postgres'
    monkeypatch.setenv('APP_ENV','production');monkeypatch.setenv('RATE_LIMIT_BACKEND','memory')
    with pytest.raises(limits.RateLimitUnavailable):limits.backend()


def test_store_failure_is_closed_but_unlimited_routes_do_not_query_it(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_BACKEND','postgres');monkeypatch.setenv('AUTH_SECRET','isolated-rate-key-with-enough-characters');monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET',raising=False)
    monkeypatch.setenv('PUBLIC_AUTH_MODE','password')
    monkeypatch.setattr(core,'pool',AsyncMock(side_effect=ConnectionError('isolated unavailable')))
    c=TestClient(application)
    assert c.get('/api/version').status_code==200
    r=c.post('/api/auth/login',json={'email':'test@example.test','password':'Password123!'})
    assert r.status_code==503
    assert 'la_session' not in r.cookies


def test_existing_connection_is_reused_without_nested_pool_acquisition(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_BACKEND','postgres');monkeypatch.setenv('AUTH_SECRET','isolated-rate-key-with-enough-characters')
    monkeypatch.setattr(core,'pool',AsyncMock(side_effect=AssertionError('nested acquisition')))
    con=type('Con',(),{'fetchrow':AsyncMock(return_value={'reset_at':'fixture','used':1})})()
    assert asyncio.run(limits.async_counter('upload_intent','learner',True,connection=con)) is None
    assert core.pool.await_count==0


def test_server_failure_releases_only_its_login_reservations(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory');monkeypatch.setenv('APP_ENV','development')
    monkeypatch.delenv('RAILWAY_ENVIRONMENT_NAME',raising=False);monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET',raising=False)
    monkeypatch.setenv('PUBLIC_AUTH_MODE','password');monkeypatch.setattr(limits,'BUCKETS',{})
    monkeypatch.setattr(core,'pool',AsyncMock(side_effect=ConnectionError('isolated user store outage')))
    r=TestClient(application).post('/api/auth/login',json={'email':'test@example.test','password':'Password123!'})
    assert r.status_code==503 and 'la_session' not in r.cookies
    assert len(limits.BUCKETS)==2 and all(count==0 for count,_ in limits.BUCKETS.values())


def test_ai_overflow_cannot_reach_provider_and_is_scoped_to_learner(monkeypatch):
    from app import step23_grade as grade
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory');monkeypatch.setenv('APP_ENV','development')
    monkeypatch.delenv('RAILWAY_ENVIRONMENT_NAME',raising=False);monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET',raising=False)
    monkeypatch.setenv('RATE_LIMIT_AI_EVALUATION','1');monkeypatch.setattr(limits,'BUCKETS',{})
    actor={'id':'learner-one'}
    monkeypatch.setattr(core,'current_user',AsyncMock(side_effect=lambda *a,**kw:dict(actor)))
    provider=AsyncMock(side_effect=AssertionError('quota overflow reached provider'))
    monkeypatch.setattr(grade,'run_grade',provider)
    c=TestClient(application)
    assert c.post('/api/writing/grade',json={}).status_code==400
    r=c.post('/api/writing/grade',json={})
    assert r.status_code==429 and 1<=int(r.headers['Retry-After'])<=900
    actor['id']='learner-two'
    assert c.post('/api/writing/grade',json={}).status_code==400
    provider.assert_not_awaited()


def test_readiness_rejects_missing_counter_schema(monkeypatch):
    class MissingTable(Exception):sqlstate='42P01'
    class Con:
        def acquire(self):return self
        async def __aenter__(self):return self
        async def __aexit__(self,*args):return False
        async def fetchval(self,query):
            if 'api_rate_buckets' in query:raise MissingTable('isolated missing schema')
            return 1
    monkeypatch.setenv('RATE_LIMIT_BACKEND','postgres');monkeypatch.setenv('AUTH_SECRET','isolated-rate-key-with-enough-characters')
    monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET',raising=False)
    monkeypatch.setattr(core,'pool',AsyncMock(return_value=Con()))
    c=TestClient(application)
    r=c.get('/readyz')
    assert r.status_code==503 and r.json()['reason']=='schema_missing'
    assert c.get('/healthz').status_code==200


def test_readiness_rejects_missing_counter_signing_key(monkeypatch):
    monkeypatch.setenv('RATE_LIMIT_BACKEND','postgres');monkeypatch.delenv('AUTH_SECRET',raising=False)
    con=type('Con',(),{'fetchval':AsyncMock()})()
    with pytest.raises(limits.RateLimitUnavailable):asyncio.run(limits.ready(con))
    con.fetchval.assert_not_awaited()


def test_signed_telegram_callback_has_a_shared_identity_limit(monkeypatch):
    from app import step18_telegram_auth_port as telegram
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory');monkeypatch.setenv('APP_ENV','development')
    monkeypatch.delenv('RAILWAY_ENVIRONMENT_NAME',raising=False);monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET',raising=False)
    monkeypatch.setenv('RATE_LIMIT_TELEGRAM_CALLBACK','1');monkeypatch.setattr(limits,'BUCKETS',{})
    monkeypatch.setattr(telegram,'telegram_verified',lambda p:True)
    no_db=AsyncMock(side_effect=AssertionError('limited callback reached database'))
    monkeypatch.setattr(core,'pool',no_db)
    asyncio.run(limits.async_counter('telegram_callback','tg:12345',True))
    r=TestClient(application).get('/api/auth/telegram/callback?id=12345',follow_redirects=False)
    assert r.status_code==429 and int(r.headers['Retry-After'])>0
    no_db.assert_not_awaited()
