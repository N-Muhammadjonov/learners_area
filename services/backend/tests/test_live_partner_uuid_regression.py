"""Speaking Partner regression tests for UUID boundaries and history SQL."""
from __future__ import annotations

from uuid import UUID
from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request

from app import live_partner_features as features
from app import live_partner_turn
from app import rate_limit
from app import main as core
from app import step24_live_partner as partner


ALICE = UUID("11111111-1111-4111-8111-111111111111")
BOB = UUID("22222222-2222-4222-8222-222222222222")
SESSION = UUID("33333333-3333-4333-8333-333333333333")


class Transaction:
    async def __aenter__(self) -> None:
        return None

    async def __aexit__(self, *args: object) -> bool:
        return False


class Pool:
    def __init__(self, connection: object) -> None:
        self.connection = connection

    def acquire(self) -> "Pool":
        return self

    async def __aenter__(self) -> object:
        return self.connection

    async def __aexit__(self, *args: object) -> bool:
        return False


def request() -> Request:
    return Request({
        "type": "http",
        "method": "POST",
        "path": "/api/live-partner",
        "headers": [],
    })


@pytest.mark.asyncio
async def test_signal_token_accepts_authenticated_uuid_user_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    current_user = AsyncMock(return_value={"id": ALICE, "role": "student"})
    read_session = AsyncMock(return_value={
        "id": SESSION,
        "user_a": ALICE,
        "user_b": BOB,
        "ended_at": None,
    })

    class Connection:
        def transaction(self) -> Transaction:
            return Transaction()

    db_connection = Connection()
    monkeypatch.setattr(rate_limit, "async_counter", AsyncMock(return_value=None))
    monkeypatch.setattr(core, "current_user", current_user)
    monkeypatch.setattr(core, "payload", AsyncMock(return_value={
        "action": "signal_token",
        "sessionId": str(SESSION),
    }))
    monkeypatch.setattr(core, "pool", AsyncMock(return_value=Pool(db_connection)))
    monkeypatch.setattr(partner, "session", read_session)
    monkeypatch.setattr(partner, "signal_token", lambda uid, peer, sid, role: (
        "test-signed-token" if (uid, peer, sid, role) == (
            str(ALICE), str(BOB), str(SESSION), "offerer"
        ) else None
    ))
    monkeypatch.setattr(live_partner_turn, "configured", lambda: True)
    monkeypatch.setattr(live_partner_turn, "credentials", AsyncMock(return_value={
        "iceServers": [{"urls": ["turn:turn.cloudflare.com:3478?transport=udp"],
                        "username": "short-lived", "credential": "test-value"}],
        "iceTransportPolicy": "relay",
    }))
    monkeypatch.setenv("LIVE_PARTNER_SIGNAL_URL", "wss://partner.example.test/signal")

    response = await partner.post_partner(request())

    assert response.status_code == 200
    read_session.assert_awaited_once_with(db_connection, str(ALICE), str(SESSION))
    assert b"test-signed-token" in response.body


@pytest.mark.asyncio
async def test_history_owner_comparison_uses_uuid_parameter_type() -> None:
    class HistoryConnection:
        def __init__(self) -> None:
            self.calls: list[tuple[str, tuple[object, ...]]] = []

        async def fetchrow(self, query: str, *args: object) -> dict:
            self.calls.append((query, args))
            if "AS average_band" in query:
                assert "f.user_id<>$1" in query
                assert "(s.user_a=$1 OR s.user_b=$1)" in query
                return {"average_band": 7.5, "rating_count": 2}
            return {"calls": 0, "seconds": 0}

        async def fetch(self, query: str, *args: object) -> list:
            self.calls.append((query, args))
            return []

    connection = HistoryConnection()
    result = await features.history(connection, ALICE)
    assert result["stats"] == {
        "calls": 0,
        "seconds": 0,
        "averageBand": 7.5,
        "ratingCount": 2,
    }
    assert len(connection.calls) == 4


def test_peer_ielts_rating_accepts_only_half_bands() -> None:
    for rating in range(2, 19):
        assert features.valid({"action": "rating", "sessionId": str(SESSION), "rating": rating})
    for rating in (0, 1, 19, -2, 7.5, None, True, "7.5"):
        assert not features.valid({"action": "rating", "sessionId": str(SESSION), "rating": rating})
