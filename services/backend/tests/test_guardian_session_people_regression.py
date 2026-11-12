"""Regressions for production guardian sessions, People reads, and study-time UUID bindings."""
from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import UUID

import pytest

from app import main as core
from app import browser_staff_people
from app import security
from app import study_time


def test_guardian_session_token_is_valid_and_tampering_fails(monkeypatch):
    monkeypatch.setenv("AUTH_SECRET", "guardian-session-regression-test-key")
    token = security.issue_token({
        "id": UUID("11111111-1111-4111-8111-111111111111"),
        "auth_version": 2,
        "role": "guardian",
        "name": "Guardian",
        "locale": "uz",
        "onboarding_completed_at": None,
    })
    claims = security.verify_token(token)
    assert claims is not None
    assert claims["role"] == "guardian"
    assert claims["authVersion"] == 2
    assert claims["expiresAt"] > 0
    assert security.verify_token(token[:-1] + ("A" if token[-1] != "A" else "B")) is None


class StudyConnection:
    def __init__(self):
        self.calls = []

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, query, *args):
        self.calls.append((query, args))
        assert "hashtextextended" in query
        assert type(args[0]) is str
        return "SELECT 1"

    async def fetchval(self, query, *args):
        if query == "SELECT clock_timestamp()":
            from datetime import datetime, timezone
            return datetime.now(timezone.utc)
        return UUID("22222222-2222-4222-8222-222222222222")


@pytest.mark.asyncio
async def test_study_time_lock_casts_uuid_to_string_for_text_parameter():
    user = {"id": UUID("11111111-1111-4111-8111-111111111111"), "role": "student"}
    conn = StudyConnection()
    result = await study_time.heartbeat(conn, user, {"action": "start", "module": "reading", "active": True})
    assert result["sequence"] == 0
    assert len(conn.calls) == 1
    assert conn.calls[0][1] == (str(user["id"]),)


class PeopleConnection:
    def __init__(self):
        self.calls = []

    async def fetchval(self, sql, *args):
        self.calls.append((sql, args))
        return 0

    async def fetch(self, sql, *args):
        self.calls.append((sql, args))
        return []


class PeoplePool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


@pytest.mark.asyncio
async def test_people_guardian_filter_is_recognized(monkeypatch):
    conn = PeopleConnection()

    async def pool():
        return PeoplePool(conn)

    monkeypatch.setattr(core, "pool", pool)
    actor = {"id": UUID("11111111-1111-4111-8111-111111111111"), "role": "owner"}
    result = await browser_staff_people.read(None, actor, "people", {"role": "guardian"})
    assert result["filters"]["role"] == "guardian"
    assert result["total"] == 0
    assert any("u.role=$1" in sql and args == ("guardian",) for sql, args in conn.calls)
