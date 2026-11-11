"""Cloudflare credential boundaries and the hosted, signed signalling protocol."""
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app import live_partner_signaling as signaling, live_partner_turn as turn
from app.asgi import application
from app import step24_live_partner as partner

ORIGIN = 'https://partner.example.test'
SECRET = 'isolated-signaling-test-secret-that-is-long-enough'
KEY = 'a' * 32
TOKEN = 'test-token-' * 8
ALICE = '11111111-1111-4111-8111-111111111111'
BOB = '22222222-2222-4222-8222-222222222222'
SESSION = '33333333-3333-4333-8333-333333333333'


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv('LIVE_PARTNER_TURN_KEY_ID', KEY)
    monkeypatch.setenv('LIVE_PARTNER_TURN_API_TOKEN', TOKEN)
    monkeypatch.setenv('LIVE_PARTNER_SIGNAL_SECRET', SECRET)
    monkeypatch.setenv('PUBLIC_BASE_URL', ORIGIN)
    monkeypatch.setenv('LIVE_PARTNER_SIGNAL_URL', 'wss://partner.example.test' + signaling.PREFIX + '/signal')
    monkeypatch.delenv('CLOUDFLARE_ORIGIN_SECRET', raising=False)
    signaling.relay.cache_clear()
    yield
    signaling.relay.cache_clear()


def mock_turn(monkeypatch, handler):
    client = httpx.AsyncClient
    monkeypatch.setattr(turn.httpx, 'AsyncClient', lambda **kwargs:
                        client(transport=httpx.MockTransport(handler), **kwargs))


@pytest.mark.asyncio
async def test_cloudflare_api_uses_server_secret_and_returns_only_authenticated_relays(configured, monkeypatch):
    def handler(request):
        assert str(request.url) == f'https://rtc.live.cloudflare.com/v1/turn/keys/{KEY}/credentials/generate-ice-servers'
        assert request.headers['Authorization'] == 'Bearer ' + TOKEN
        assert json.loads(request.content) == {'ttl': turn.TTL_SECONDS}
        return httpx.Response(201, json={'iceServers': [
            {'urls': ['stun:stun.cloudflare.com:3478']},
            {'urls': ['turn:turn.cloudflare.com:3478?transport=udp',
                      'turns:turn.cloudflare.com:443?transport=tcp',
                      'turn:turn.cloudflare.com:53?transport=udp',
                      'turn:untrusted.test:3478?transport=udp'],
             'username': 'short-lived-user', 'credential': 'short-lived-password'},
        ]})
    mock_turn(monkeypatch, handler)
    result = await turn.credentials()
    assert result['iceTransportPolicy'] == 'relay'
    assert result['expiresInSeconds'] == turn.TTL_SECONDS
    assert result['iceServers'][0]['urls'] == ['turn:turn.cloudflare.com:3478?transport=udp',
                                             'turns:turn.cloudflare.com:443?transport=tcp']
    assert TOKEN not in json.dumps(result)
    assert SECRET not in json.dumps(result)


@pytest.mark.parametrize('payload', [None, {}, {'iceServers': []}, {'iceServers': [None]},
    {'iceServers': [{'urls': 'turn:turn.cloudflare.com:3478?transport=udp'}]}])
@pytest.mark.asyncio
async def test_malformed_cloudflare_responses_fail_closed(configured, monkeypatch, payload):
    mock_turn(monkeypatch, lambda request: httpx.Response(201, json=payload))
    assert await turn.credentials() is None


@pytest.mark.asyncio
async def test_provider_failure_and_unconfigured_credentials_fail_closed(configured, monkeypatch):
    mock_turn(monkeypatch, lambda request: httpx.Response(401, json={'error': 'invalid'}))
    assert await turn.credentials() is None
    monkeypatch.setenv('LIVE_PARTNER_TURN_KEY_ID', '../invalid')
    assert not turn.configured()
    assert await turn.credentials() is None


@pytest.mark.asyncio
async def test_hosted_readiness_uses_the_local_route_without_an_external_health_roundtrip(configured, monkeypatch):
    mock_turn(monkeypatch, lambda request: pytest.fail('Hosted readiness must not call an external health URL'))
    assert await partner.readiness() == {'ready': True}


def test_hosted_signaling_relays_two_signed_participants_and_cleans_the_room(configured):
    client = TestClient(application)
    path = signaling.PREFIX + '/signal'
    with client.websocket_connect(path, headers={'origin': ORIGIN}) as alice:
        alice.send_json({'type': 'auth', 'token': partner.signal_token(ALICE, BOB, SESSION, 'offerer')})
        assert alice.receive_json() == {'type': 'ready', 'role': 'offerer', 'peerPresent': False}
        with client.websocket_connect(path, headers={'origin': ORIGIN}) as bob:
            bob.send_json({'type': 'auth', 'token': partner.signal_token(BOB, ALICE, SESSION, 'answerer')})
            assert bob.receive_json()['peerPresent']
            assert alice.receive_json()['type'] == 'peer-joined'
            alice.send_json({'type': 'signal', 'kind': 'offer', 'data': {'sdp': 'test-offer'}})
            assert bob.receive_json()['data']['sdp'] == 'test-offer'
            bob.send_json({'type': 'signal', 'kind': 'restart', 'data': {}})
            assert alice.receive_json()['kind'] == 'restart'
        assert alice.receive_json()['type'] == 'peer-left'
    assert client.get(signaling.PREFIX + '/healthz').json()['rooms'] == 0


def test_wrong_origin_and_forged_token_are_rejected(configured):
    client = TestClient(application)
    path = signaling.PREFIX + '/signal'
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(path, headers={'origin': 'https://other.test'}):
            pass
    with client.websocket_connect(path, headers={'origin': ORIGIN}) as socket:
        socket.send_json({'type': 'auth', 'token': 'forged'})
        assert socket.receive_json()['reason'] == 'token_invalid'
        with pytest.raises(WebSocketDisconnect):
            socket.receive_json()


def test_origin_boundary_still_protects_the_hosted_upgrade(configured, monkeypatch):
    monkeypatch.setenv('CLOUDFLARE_ORIGIN_SECRET', 'edge-only-origin-secret-for-this-test')
    client = TestClient(application)
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(signaling.PREFIX + '/signal', headers={'origin': ORIGIN}):
            pass


def test_anonymous_users_cannot_request_turn_credentials(configured, monkeypatch):
    issued = AsyncMock()
    monkeypatch.setattr(turn, 'credentials', issued)
    response = TestClient(application).post('/api/live-partner', json={
        'action': 'signal_token', 'sessionId': SESSION,
    }, headers={'origin': ORIGIN})
    assert response.status_code == 401
    issued.assert_not_awaited()
