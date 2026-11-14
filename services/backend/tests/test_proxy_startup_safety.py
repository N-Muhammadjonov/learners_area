import asyncio
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from starlette.requests import Request
from app import main as core
from app import security, browser_video, step18_telegram_auth_port as telegram


def request(headers=(), scheme='http'):
    return Request({'type': 'http', 'method': 'GET', 'path': '/', 'scheme': scheme,
                    'server': ('local.example', 80), 'query_string': b'',
                    'headers': [(b'host', b'local.example'), *headers]})


@pytest.mark.parametrize('trusted,expected', [(False, 'http://local.example'), (True, 'https://proxy.example')])
def test_both_origin_consumers_share_explicit_proxy_trust(monkeypatch, trusted, expected):
    monkeypatch.setenv('TRUST_PROXY_HEADERS', 'true' if trusted else 'false')
    req = request([(b'x-forwarded-proto', b'https'), (b'x-forwarded-host', b'proxy.example')])
    redirect = asyncio.run(telegram.telegram_callback(req))
    assert redirect.headers['location'] == expected + '/login?error=telegram'
    con = AsyncMock()
    con.fetch.return_value = []
    con.fetchrow.return_value = None
    view = asyncio.run(browser_video.studio(con, {'id': UUID(int=1)}, {'id': UUID(int=2), 'provider': 'youtube'}, req))
    assert view['embedOrigin'] == expected



def test_peer_identity_warns_once(monkeypatch, caplog):
    monkeypatch.setenv('APP_ENV', 'production')
    monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET', raising=False)
    monkeypatch.setattr(security, '_startup_warnings', set())
    security.warn_deployment_settings()
    security.warn_deployment_settings()
    assert sum('unverified peer IP' in message for message in caplog.messages) == 1
