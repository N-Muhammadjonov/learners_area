"""Bot-to-site handoff security and eligibility regression tests."""
from datetime import datetime, timezone
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app import telegram_handoff_port as handoff
from app.rate_limit import BUCKETS
from test_migration_phase2 import FakePool


TOKEN_HEADERS = {"Authorization": "Bearer demo_bot_token"}
ROUTE = "/api/internal/telegram/auth/handoff"
INTENT_ID = UUID("11111111-1111-4111-8111-111111111111")


class FakeConnection:
    def __init__(self, *, contact=None, account=None):
        self.contact = contact
        self.account = account
        self.queries = []
        self.insert_args = None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False

    def transaction(self):
        return self

    async def fetchrow(self, query, *args):
        self.queries.append((query, args))
        if "FROM telegram_contacts WHERE" in query:
            return self.contact
        if "FROM users WHERE telegram_id" in query:
            return self.account
        raise AssertionError("Unexpected handoff query")

    async def fetchval(self, query, *args):
        self.queries.append((query, args))
        assert "INSERT INTO telegram_login_intents" in query
        self.insert_args = args
        return INTENT_ID


@pytest.fixture(autouse=True)
def configure(monkeypatch):
    BUCKETS.clear()
    monkeypatch.setenv("BOT_SERVICE_SECRET", "demo_bot_token")
    yield
    BUCKETS.clear()


def setup(monkeypatch, *, contact=None, account=None, gate=None):
    conn = FakeConnection(contact=contact, account=account)
    monkeypatch.setattr(core, "pool", AsyncMock(return_value=FakePool(conn)))
    checker = AsyncMock(return_value=gate)
    monkeypatch.setattr(handoff, "gates", checker)
    return conn, checker


def verified_contact():
    return {
        "phone_verified_at": datetime.now(timezone.utc),
        "bot_blocked_at": None,
        "removed_at": None,
    }


def test_handoff_requires_internal_bot_authority(monkeypatch):
    conn, gates = setup(monkeypatch)
    client = TestClient(core.app)
    response = client.post(ROUTE, json={"telegramUserId": "12345"})
    assert response.status_code == 401
    assert conn.queries == []
    gates.assert_not_awaited()


@pytest.mark.parametrize("actor", ["", "not-a-telegram-id", "../123", 12345])
def test_handoff_rejects_invalid_actor(monkeypatch, actor):
    conn, gates = setup(monkeypatch)
    response = TestClient(core.app).post(
        ROUTE, headers=TOKEN_HEADERS, json={"telegramUserId": actor}
    )
    assert response.status_code == 400
    assert conn.queries == []
    gates.assert_not_awaited()


@pytest.mark.parametrize("reason,status", [
    ("phone_required", 403),
    ("not_subscribed", 403),
    ("membership_unavailable", 503),
])
def test_handoff_enforces_subscription_and_phone(monkeypatch, reason, status):
    conn, _ = setup(monkeypatch, gate={"error": reason})
    response = TestClient(core.app).post(
        ROUTE, headers=TOKEN_HEADERS, json={"telegramUserId": "12345"}
    )
    assert response.status_code == status
    assert response.json()["error"] == reason
    assert conn.queries == []


@pytest.mark.parametrize("status", ["rejected", "suspended"])
def test_handoff_never_issues_intent_for_blocked_account(monkeypatch, status):
    conn, _ = setup(
        monkeypatch,
        contact=verified_contact(),
        account={"id": INTENT_ID, "account_status": status},
    )
    response = TestClient(core.app).post(
        ROUTE, headers=TOKEN_HEADERS, json={"telegramUserId": "12345"}
    )
    assert response.status_code == 403
    assert conn.insert_args is None


@pytest.mark.parametrize("purpose,account", [
    ("login", {"id": INTENT_ID, "account_status": "active"}),
    ("register", None),
])
def test_handoff_generates_scoped_five_minute_confirmed_intent(monkeypatch, purpose, account):
    conn, _ = setup(monkeypatch, contact=verified_contact(), account=account)
    response = TestClient(core.app).post(
        ROUTE, headers=TOKEN_HEADERS, json={"telegramUserId": "12345"}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["purpose"] == purpose
    assert body["intentId"] == str(INTENT_ID)
    assert len(body["browserNonce"]) == 64
    assert conn.insert_args[2:4] == ("12345", purpose)
    assert conn.insert_args[4] > datetime.now(timezone.utc)
    assert "token" not in body


def test_handoff_blocks_removed_contact(monkeypatch):
    contact = verified_contact()
    contact["removed_at"] = datetime.now(timezone.utc)
    conn, _ = setup(monkeypatch, contact=contact)
    response = TestClient(core.app).post(
        ROUTE, headers=TOKEN_HEADERS, json={"telegramUserId": "12345"}
    )
    assert response.status_code == 403
    assert conn.insert_args is None
