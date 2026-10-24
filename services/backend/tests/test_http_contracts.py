import os
from fastapi.testclient import TestClient
from app.main import app
from app.security import issue_token, verify_token, normalize_origin, check_origin

client = TestClient(app)


def test_version_defaults():
    r = client.get('/api/version')
    assert r.status_code == 200
    assert set(r.json()) == {'commit', 'shortCommit', 'region', 'environment'}
    assert r.headers['cache-control'] == 'no-store'
    assert r.headers['x-content-type-options'] == 'nosniff'
    assert 'content-security-policy' in r.headers


def test_version_env(monkeypatch):
    monkeypatch.setenv('APP_COMMIT_SHA', 'cb6b3cdfdab8909c8d172df4714dba2bfe1a7b2e')
    monkeypatch.setenv('APP_ENV', 'preview')
    r = client.get('/api/version')
    assert r.json()['shortCommit'] == 'cb6b3cd'
    assert r.json()['environment'] == 'preview'


def test_theme_cookie():
    r = client.post('/api/theme', json={'theme': 'night'})
    assert r.status_code == 200 and r.json() == {'ok': True, 'theme': 'night'}
    assert 'la_theme=night' in r.headers['set-cookie']
    assert 'Max-Age=31536000' in r.headers['set-cookie']
    assert 'SameSite=Lax' in r.headers['set-cookie']
    assert client.post('/api/theme', json={'theme':'dark'}).json() == {'error': 'invalid_theme'}


def test_https_partitioned_cookie():
    r = client.post('/api/locale', json={'locale': 'en'}, headers={'x-forwarded-proto': 'https'})
    assert r.status_code == 200
    assert 'Secure' in r.headers['set-cookie']
    assert 'SameSite=None' in r.headers['set-cookie']
    assert 'Partitioned' in r.headers['set-cookie']


def test_locale_invalid():
    for value in ('ru', '', None):
        r = client.post('/api/locale', json={'locale': value})
        assert r.status_code == 400 and r.json() == {'error': 'invalid_locale'}


def test_origin_protection():
    r = client.post('/api/theme', json={'theme':'day'}, headers={'Origin':'https://attacker.example'})
    assert r.status_code == 403 and r.json() == {'error': 'invalid_origin', 'reason': 'cross_origin'}
    r = client.post('/api/theme', json={'theme':'day'}, headers={'Origin':'null'})
    assert r.status_code == 403 and r.json()['reason'] == 'opaque_origin'
    r = client.post('/api/locale', json={'locale': 'uz'}, headers={'Sec-Fetch-Site':'cross-site'})
    assert r.status_code == 403 and r.json()['reason'] == 'cross_site_without_origin'
    r = client.post('/api/theme', json={'theme':'day'}, headers={'Origin':'http://testserver'})
    assert r.status_code == 200


def test_public_auth_gate(monkeypatch):
    monkeypatch.setenv('PUBLIC_AUTH_MODE', 'telegram-only')
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://learners.example')
    monkeypatch.setenv('TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN', 'https://learners.example')
    monkeypatch.setenv('TELEGRAM_BOT_TOKEN', 'bot-token')
    monkeypatch.setenv('TELEGRAM_BOT_USERNAME', 'test_bot')
    r = client.post('/api/auth/login', json={'email':'a@example.org','password':'secret'})
    assert r.status_code == 403 and r.json() == {'error': 'authentication_method_disabled'}


def test_unauthed_protected():
    for method, path in [('get','/api/auth/state'),('patch','/api/profile'),
                         ('post','/api/admission/request'),('get','/api/notifications'),
                         ('post','/api/presence'),('get','/api/profile/photo/00000000-0000-0000-0000-000000000000')]:
        r = getattr(client, method)(path)
        assert r.status_code == 401, (method,path,r.text)


def test_logout_unauthenticated():
    r = client.post('/api/auth/logout')
    assert r.status_code == 200 and r.json() == {'ok': True}
    assert 'la_session=' in r.headers.get('set-cookie', '')
    assert 'Max-Age=0' in r.headers.get('set-cookie', '')


def test_jwt_interoperable_shape(monkeypatch):
    monkeypatch.setenv('AUTH_SECRET', 'unit-test-secret-that-is-long-enough')
    tok = issue_token({'id':'1d10c7f7-7420-4e12-a73c-fd4f6dd8607d','auth_version': 3,
                       'role':'student','name':'Test Student','locale':'uz','onboarding_completed_at':None})
    s = verify_token(tok)
    assert s is not None and s['authVersion'] == 3 and s['role'] == 'student'
    assert s['onboarded'] is False and s['sessionKey'] and len(s['sessionKey']) == 64
    assert verify_token(tok + 'x') is None
    monkeypatch.setenv('AUTH_SECRET', 'wrong-secret-that-is-long-enough')
    assert verify_token(tok) is None


def test_normalize_origin():
    assert normalize_origin('https://Example.com:443/') == 'https://example.com'
    assert normalize_origin('https://example.com/path') is None
    assert normalize_origin('https://a:secret@example.com') is None
