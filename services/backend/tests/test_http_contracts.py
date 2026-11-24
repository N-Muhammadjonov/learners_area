import base64
from contextlib import asynccontextmanager
from io import BytesIO
import os
from random import Random

from fastapi.testclient import TestClient
from PIL import Image

from app import main
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


def test_https_first_party_cookie_persists_without_chips():
    r = client.post('/api/locale', json={'locale': 'en'}, headers={'x-forwarded-proto': 'https'})
    assert r.status_code == 200
    assert 'Secure' in r.headers['set-cookie']
    assert 'SameSite=Lax' in r.headers['set-cookie']
    assert 'Partitioned' not in r.headers['set-cookie']


def test_https_embedded_cookie_keeps_partitioned_policy():
    headers = {'x-forwarded-proto': 'https', 'x-learners-embedded': '1'}
    r = client.post('/api/locale', json={'locale': 'en'}, headers=headers)
    assert 'SameSite=None; Secure; Partitioned' in r.headers['set-cookie']
    r = client.post('/api/locale', json={'locale': 'en'}, headers={
        'x-forwarded-proto': 'https', 'sec-fetch-dest': 'iframe'
    })
    assert 'SameSite=None; Secure; Partitioned' in r.headers['set-cookie']


def test_logout_clears_both_cookie_variants_on_https():
    r = client.post('/api/auth/logout', headers={'x-forwarded-proto': 'https'})
    cookies = r.headers.get_list('set-cookie')
    assert any('la_session=; Path=/; Max-Age=0; SameSite=Lax; Secure' in c for c in cookies)
    assert any('la_session=; Path=/; Max-Age=0; SameSite=None; Secure; Partitioned' in c for c in cookies)


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


def test_profile_avatar_uses_small_private_webp_and_preserves_original(monkeypatch):
    photo_id = '1d10c7f7-7420-4e12-a73c-fd4f6dd8607d'
    path = '/api/profile/photo/' + photo_id
    with Image.frombytes('RGB', (256, 256), Random(41).randbytes(256 * 256 * 3)) as photo:
        source = BytesIO()
        photo.save(source, 'PNG')
    original = source.getvalue()

    class PhotoPool:
        @asynccontextmanager
        async def acquire(self):
            yield self

        async def fetchval(self, query: str) -> str:
            assert "to_regclass('public.user_profile_photos')" in query
            return 'user_profile_photos'

        async def fetchrow(self, query: str, photo_user_id) -> dict[str, str]:
            assert str(photo_user_id) == photo_id and "u.account_status='active'" in query
            return {'image_base64': base64.b64encode(original).decode('ascii'), 'content_type': 'image/png'}

    async def authenticate(request, *, active: bool):
        assert active
        return {'id': photo_id} if request.headers.get('X-Test-Signed-In') == 'yes' else None

    async def pool() -> PhotoPool:
        return PhotoPool()

    monkeypatch.setattr(main, 'current_user', authenticate)
    monkeypatch.setattr(main, 'pool', pool)
    assert client.get(path, params={'variant': 'avatar'}).status_code == 401
    headers = {'X-Test-Signed-In': 'yes'}
    thumbnail = client.get(path, params={'variant': 'avatar'}, headers=headers)
    assert thumbnail.status_code == 200
    assert thumbnail.headers['content-type'] == 'image/webp'
    assert thumbnail.headers['cache-control'] == 'private, no-store'
    assert len(thumbnail.content) < len(original) / 10
    with Image.open(BytesIO(thumbnail.content)) as avatar:
        assert avatar.size == (96, 96)
    full = client.get(path, headers=headers)
    assert full.headers['content-type'] == 'image/png'
    assert full.content == original

    with Image.new('RGB', (1025, 1025)) as oversized:
        source = BytesIO()
        oversized.save(source, 'PNG')
    original = source.getvalue()
    fallback = client.get(path, params={'variant': 'avatar'}, headers=headers)
    assert fallback.headers['content-type'] == 'image/png'
    assert fallback.content == original


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
