"""Regression tests for Telegram guardian handoff and read-only access."""
from __future__ import annotations

import hashlib
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app import guardian_port, main as core
from app import step19_telegram_exchange_port as exchange
from app.rate_limit import BUCKETS


USER_ID = UUID("11111111-1111-4111-8111-111111111111")
INTENT_ID = UUID("22222222-2222-4222-8222-222222222222")
NONCE = "a" * 64


class FakeConnection:
    def __init__(self):
        self.consumes = 0
        self.intent = {
            "id": INTENT_ID,
            "status": "confirmed",
            "telegram_user_id": "12345",
            "purpose": "login",
            "expires_at": datetime.now(timezone.utc) + timedelta(minutes=5),
            "user_id": None,
        }
        self.user = {
            "id": USER_ID,
            "name": "Parent",
            "email": None,
            "role": "guardian",
            "account_status": "active",
            "locale": "uz",
            "onboarding_completed_at": datetime.now(timezone.utc),
            "status_reason": None,
            "auth_version": 0,
        }

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    async def fetchrow(self, sql, *args):
        if "FROM telegram_login_intents" in sql:
            assert str(args[0]) == str(INTENT_ID)
            assert args[1] == hashlib.sha256(NONCE.encode()).hexdigest()
            return self.intent
        if "FROM users WHERE telegram_id=$1" in sql:
            assert args[0] == "12345"
            return self.user
        if "FROM users" in sql and "auth_version = $2" in sql:
            return self.user
        raise AssertionError(sql)

    async def fetchval(self, sql, *args):
        assert "UPDATE telegram_login_intents SET status='consumed'" in sql
        self.consumes += 1
        if self.consumes != 1:
            return None
        self.intent["status"] = "consumed"
        return INTENT_ID


class FakePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


@pytest.fixture(autouse=True)
def reset_limits():
    BUCKETS.clear()
    yield
    BUCKETS.clear()


@pytest.mark.parametrize("has_old_cookie", [False, True])
def test_guardian_handoff_sets_session_and_succeeds_with_existing_session(monkeypatch, has_old_cookie):
    conn = FakeConnection()
    monkeypatch.setattr(core, "pool", AsyncMock(return_value=FakePool(conn)))
    monkeypatch.setattr(exchange, "gates", AsyncMock(return_value=None))
    monkeypatch.setattr(core, "issue_token", lambda user: "signed-guardian-token")
    monkeypatch.setattr(core, "verify_token", lambda token: {
        "sub": str(USER_ID), "authVersion": 0, "sessionKey": "old",
        "expiresAt": 9999999999,
    } if token and has_old_cookie else None)
    client = TestClient(core.app)
    if has_old_cookie:
        client.cookies.set(core.SESSION_COOKIE, "previous-guardian-session")
    response = client.post(
        "/api/auth/telegram/intent/exchange",
        json={"intentId": str(INTENT_ID), "browserNonce": NONCE},
    )
    assert response.status_code == 200, response.text
    assert response.json()["role"] == "guardian"
    assert response.json()["accountStatus"] == "active"
    assert response.json()["onboarded"] is True
    assert conn.consumes == 1
    assert "httponly" in response.headers["set-cookie"].lower()
    # A consumed handoff cannot be replayed.
    replay = client.post("/api/auth/telegram/intent/exchange",
                         json={"intentId": str(INTENT_ID), "browserNonce": NONCE})
    assert replay.status_code in (400, 409)
    assert conn.consumes == 1


def test_guardian_login_apis_allowed_but_student_apis_denied():
    for path in ("/api/auth/state", "/api/auth/telegram/intent/exchange",
                 "/api/frontend/session", "/api/guardian/children"):
        assert guardian_port.guardian_path_allowed(path)
    for path in ("/api/frontend/view", "/api/study-plan/leaderboard",
                 "/api/guardians/links", "/api/staff/guardians",
                 "/api/auth/telegram/intent/exchange/forged"):
        assert not guardian_port.guardian_path_allowed(path)
