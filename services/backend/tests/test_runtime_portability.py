"""The same security boundaries on ASGI, Vercel, Railway and preview hosts."""
import pytest
from fastapi.testclient import TestClient
from starlette.requests import Request
from starlette.responses import Response
from app import runtime_config,rate_limit,security,browser,step19_storage
from app.asgi import application


@pytest.fixture(autouse=True)
def isolated_environment(monkeypatch):
    for key in ('APP_ENV','VERCEL_ENV','RAILWAY_ENVIRONMENT_NAME','RATE_LIMIT_BACKEND','DATABASE_URL','STORAGE_PROVIDER','CLOUDFLARE_ORIGIN_SECRET'):
        monkeypatch.delenv(key,raising=False)


@pytest.mark.parametrize('settings,expected',[
 ({},'development'),({'APP_ENV':'test'},'test'),({'APP_ENV':'production'},'production'),
 ({'VERCEL_ENV':'production'},'production'),({'VERCEL_ENV':'preview'},'preview'),
 ({'RAILWAY_ENVIRONMENT_NAME':'production'},'production'),({'RAILWAY_ENVIRONMENT_NAME':'staging'},'preview'),
 ({'APP_ENV':'development','VERCEL_ENV':'production'},'production'),
 ({'APP_ENV':'development','VERCEL_ENV':'preview'},'preview'),
 ({'APP_ENV':'development','RAILWAY_ENVIRONMENT_NAME':'production'},'production'),
])
def test_environment_identity(monkeypatch,settings,expected):
    for key,value in settings.items():monkeypatch.setenv(key,value)
    assert runtime_config.environment()==expected
    assert TestClient(application).get('/api/version').json()['environment']==('development' if expected=='test' else expected)


@pytest.mark.parametrize('settings',[
 {'APP_ENV':'production'},{'APP_ENV':'preview'},{'VERCEL_ENV':'production'},
 {'VERCEL_ENV':'preview'},{'RAILWAY_ENVIRONMENT_NAME':'production'},
 {'RAILWAY_ENVIRONMENT_NAME':'staging'},
])
def test_deployed_context_fails_closed_without_shared_limits_or_storage(monkeypatch,settings):
    for key,value in settings.items():monkeypatch.setenv(key,value)
    monkeypatch.setenv('RATE_LIMIT_BACKEND','memory')
    with pytest.raises(rate_limit.RateLimitUnavailable):rate_limit.backend()
    with pytest.raises(RuntimeError):step19_storage.provider()
    monkeypatch.setenv('PERFORMANCE_DIAGNOSTICS','true')
    assert browser.diagnostics_enabled() is False
    req=Request({'type':'http','method':'GET','path':'/','scheme':'https','headers':[(b'host',b'portable.example')],'server':('portable.example',443)})
    csp=security.build_csp(req,'isolated-nonce')
    assert "'unsafe-eval'" not in csp and "frame-ancestors 'self'" in csp
    connections=next(part.strip().split()[1:] for part in csp.split(';') if part.strip().startswith('connect-src '))
    assert 'wss://portable.example' in connections and 'wss:' not in connections and 'ws:' not in connections
    monkeypatch.setenv('RATE_LIMIT_BACKEND','postgres');monkeypatch.setenv('STORAGE_PROVIDER','r2')
    assert rate_limit.backend()=='postgres' and step19_storage.provider()=='r2'
    if runtime_config.environment()=='production':
        response=Response();security.add_security_headers(response,req)
        assert response.headers['strict-transport-security'].startswith('max-age=')


def test_invalid_mode_never_silently_opens_development(monkeypatch):
    monkeypatch.setenv('APP_ENV','prodution')
    with pytest.raises(RuntimeError):runtime_config.environment()


def test_explicit_development_remains_database_free(monkeypatch):
    monkeypatch.setenv('APP_ENV','development')
    assert rate_limit.backend()=='memory' and step19_storage.provider()=='local'
