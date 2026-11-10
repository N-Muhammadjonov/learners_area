"""Public discovery, private indexing and preserved native API boundaries."""
import importlib.util
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

import pytest
from fastapi.testclient import TestClient
from app import main as core
from app.asgi import application

ROOT = Path(__file__).resolve().parents[3]
client = TestClient(application)


@pytest.fixture(autouse=True)
def isolated_origin(monkeypatch):
    for key in ('PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL', 'APP_ENV', 'VERCEL_ENV', 'RAILWAY_ENVIRONMENT_NAME'):
        monkeypatch.delenv(key, raising=False)


@pytest.fixture(scope='module', autouse=True)
def native_build():
    spec = importlib.util.spec_from_file_location('seo_assets', ROOT/'scripts/build_native_assets.py')
    builder = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(builder)
    assert builder.build()['nodeRequired'] is False


def test_home_is_indexable_without_javascript_or_session_queries(monkeypatch):
    async def forbidden(*args, **kwargs):
        raise AssertionError('public SEO must not read session authority or the database')
    monkeypatch.setattr(core, 'current_user', forbidden)
    monkeypatch.setattr(core, 'pool', forbidden)
    for cookie in ('', 'la_session=existing-session'):
        response = client.get('/', headers={'cookie': cookie, 'host': 'untrusted.example'})
        assert response.status_code == 200
        assert response.headers['x-robots-tag'] == 'index, follow'
        html = response.text
        assert '<meta name="robots" content="index,follow">' in html
        assert 'noindex' not in html
        assert '<title>Learners Area | IELTS platformasi — Uzbekistan</title>' in html
        assert '<link rel="canonical" href="https://learnersarea.uz/">' in html
        assert '<meta name="description" content="Learners Area' in html
        assert '<meta property="og:url" content="https://learnersarea.uz/">' in html
        data = json.loads(re.search(r'<script[^>]+type="application/ld\+json">(.*?)</script>', html, re.S)[1])
        assert data['@type'] == 'WebSite' and data['name'] == 'Learners Area'
        assert data['url'] == 'https://learnersarea.uz/'
        body = html.split('<body>', 1)[1]
        assert re.search(r'<h1\b[^>]*>\s*Xush kelibsiz\s*</h1>', body)
        assert '<a href="/login"' in body and '<a href="/landing"' in body
        assert 'Telegram orqali davom etish' in body
        assert 'nonce=' in html and 'Content-Security-Policy' in response.headers


def test_discovery_documents_only_list_the_public_canonical_home():
    robots = client.get('/robots.txt')
    assert robots.status_code == 200 and robots.headers['content-type'].startswith('text/plain')
    for path in ('app', 'api', 'owner', 'admin', 'profile', 'onboarding', 'pending'):
        assert f'Disallow: /{path}\n' in robots.text
    assert 'Disallow: /\n' not in robots.text
    assert 'Sitemap: https://learnersarea.uz/sitemap.xml' in robots.text
    sitemap = client.get('/sitemap.xml')
    assert sitemap.status_code == 200 and sitemap.headers['content-type'].startswith('application/xml')
    document = ET.fromstring(sitemap.text)
    assert [node.text for node in document.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')] == ['https://learnersarea.uz/']
    assert not client.head('/robots.txt').content and not client.head('/sitemap.xml').content


def test_private_routes_keep_authorization_and_noindex(monkeypatch):
    async def anonymous(*args, **kwargs):
        return None
    monkeypatch.setattr(core, 'current_user', anonymous)
    for path in ('/app', '/app/profile', '/app/owner', '/app/admin/people'):
        response = client.get(path, follow_redirects=False)
        assert response.status_code == 303 and response.headers['location'].startswith('/login?next=')
        assert response.headers['x-robots-tag'].startswith('noindex')
    for path in ('/login', '/register', '/reset-password'):
        response = client.get(path)
        assert response.status_code == 200 and 'noindex,nofollow,noarchive' in response.text
        assert 'application/ld+json' not in response.text
        assert 'rel="canonical"' not in response.text and 'public-content-start' not in response.text
    for path in ('/api/auth/state', '/api/frontend/session', '/api/frontend/view?route=/app'):
        response = client.get(path)
        assert response.status_code == 401 and response.headers['x-robots-tag'].startswith('noindex')
    for method, path in (('GET', '/_frontend/session'), ('POST', '/_frontend/query'), ('POST', '/_frontend/action')):
        response = client.request(method, path, headers={'x-backend-service-token': 'old-renderer-token'})
        assert response.status_code in (404, 405)
        assert response.headers['x-robots-tag'].startswith('noindex')


def test_authenticated_private_document_does_not_reuse_public_seo(monkeypatch):
    async def active(*args, **kwargs):
        return {'role': 'student', 'account_status': 'active'}
    monkeypatch.setattr(core, 'current_user', active)
    response = client.get('/app')
    assert response.status_code == 200 and response.headers['x-robots-tag'].startswith('noindex')
    assert 'noindex,nofollow,noarchive' in response.text
    assert 'public-content-start' not in response.text and 'application/ld+json' not in response.text
    denied = client.get('/app/owner', follow_redirects=False)
    assert denied.status_code == 303 and denied.headers['location'] == '/app'


def test_existing_api_inventory_is_preserved_and_python_entrypoint_is_ready():
    status = json.loads((ROOT/'services/backend/PORT_STATUS.json').read_text())
    expected = {(row['method'], row['path']) for row in status['endpoints']}
    actual = {(method, route.path) for route in core.app.routes for method in getattr(route, 'methods', ())}
    assert len(expected) == status['total_methods'] and expected <= actual
    assert client.get('/api/version').status_code == 200
    assert client.get('/api/frontend/public').status_code == 200
    assert client.get('/healthz').json()['service'] == 'learners-area-fastapi'


def test_explicit_origin_is_shared_by_metadata_robots_and_sitemap_without_host_poisoning(monkeypatch):
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://Study.Example:443/')
    monkeypatch.setenv('NEXT_PUBLIC_APP_URL', 'https://old.example')
    monkeypatch.setenv('VERCEL_URL', 'generated-preview.example')
    for host in ('localhost', 'attacker.example'):
        html = client.get('/', headers={'host': host, 'x-forwarded-host': 'forged.example'}).text
        assert '<link rel="canonical" href="https://study.example/">' in html
        assert 'content="https://study.example/brand/learners-area-la-glass.svg"' in html
        data = json.loads(re.search(r'<script[^>]+type="application/ld\+json">(.*?)</script>', html, re.S)[1])
        assert data['url'] == 'https://study.example/'
        assert 'forged.example' not in html and 'generated-preview.example' not in html
        assert 'Sitemap: https://study.example/sitemap.xml' in client.get('/robots.txt', headers={'host': host}).text
        document = ET.fromstring(client.get('/sitemap.xml', headers={'host': host}).text)
        assert [node.text for node in document.iter('{http://www.sitemaps.org/schemas/sitemap/0.9}loc')] == ['https://study.example/']


@pytest.mark.parametrize('settings', [
    {'APP_ENV': 'preview'}, {'VERCEL_ENV': 'preview'}, {'RAILWAY_ENVIRONMENT_NAME': 'staging'},
])
def test_preview_is_not_indexed_on_any_host(monkeypatch, settings):
    for key, value in settings.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://study.example')
    home = client.get('/')
    assert home.status_code == 200 and home.headers['x-robots-tag'].startswith('noindex')
    assert '<meta name="robots" content="noindex,nofollow,noarchive">' in home.text
    assert 'Xush kelibsiz' in home.text and 'Telegram orqali davom etish' in home.text
    robots = client.get('/robots.txt')
    assert robots.text == 'User-agent: *\nDisallow: /\n' and robots.headers['x-robots-tag'].startswith('noindex')
    sitemap = client.get('/sitemap.xml')
    assert sitemap.headers['x-robots-tag'].startswith('noindex')
    assert not list(ET.fromstring(sitemap.text))


@pytest.mark.parametrize('origin', [
    'https://user:secret@example.com', 'https://@example.com', 'https://example.com/path',
    'https://example.com?query=1', 'https://example.com#fragment', ' https://example.com',
    'https://exam\tple.com', 'https://example.com:bad', 'https://example.com\"',
    'https://[broken', 'javascript:alert(1)', 'https://[fe80::1%25eth0]',
])
def test_invalid_explicit_origin_fails_closed_without_leaking_configuration(monkeypatch, origin):
    monkeypatch.setenv('PUBLIC_BASE_URL', origin)
    monkeypatch.setenv('NEXT_PUBLIC_APP_URL', 'https://fallback.example')
    for path in ('/', '/robots.txt', '/sitemap.xml'):
        response = client.get(path)
        assert response.status_code == 503
        assert response.json() == {'error': 'configuration_unavailable'}
        assert 'no-store' in response.headers['cache-control']
        assert response.headers['x-robots-tag'].startswith('noindex')
    assert client.get('/healthz').status_code == 200
    assert client.get('/login').status_code == 200


def test_legacy_origin_alias_remains_supported_at_runtime(monkeypatch):
    monkeypatch.setenv('NEXT_PUBLIC_APP_URL', 'http://localhost:8080')
    assert '<loc>http://localhost:8080/</loc>' in client.get('/sitemap.xml').text
    monkeypatch.setenv('PUBLIC_BASE_URL', 'https://new.example')
    assert '<loc>https://new.example/</loc>' in client.get('/sitemap.xml').text
