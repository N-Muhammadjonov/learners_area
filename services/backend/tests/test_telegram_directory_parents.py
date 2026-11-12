"""Bot directory regressions: role filtering, guardian isolation and parent links."""
from __future__ import annotations

from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app import telegram_directory_port as directory


USER = "11111111-1111-4111-8111-111111111111"
PROFILE = "22222222-2222-4222-8222-222222222222"
BOT_ROOT = "/api/internal/telegram"


class FakeConnection:
    def __init__(self):
        self.queries = []

    async def fetch(self, sql, *params):
        self.queries.append(("fetch", sql, params))
        return []

    async def fetchval(self, sql, *params):
        self.queries.append(("fetchval", sql, params))
        if "SELECT 1 FROM users WHERE id=$1 AND role='student'" in sql:
            return 1
        return 0

    async def fetchrow(self, sql, *params):
        self.queries.append(("fetchrow", sql, params))
        return None


class FakePool:
    def __init__(self, connection):
        self.connection = connection

    @asynccontextmanager
    async def acquire(self):
        yield self.connection


@pytest.fixture
def prepared(monkeypatch):
    conn = FakeConnection()
    monkeypatch.setattr(directory, "verify_bot", lambda request: None)
    monkeypatch.setattr(directory, "actor_for", AsyncMock(return_value=({"isPrimaryOwner": True}, None)))
    monkeypatch.setattr(core, "pool", AsyncMock(return_value=FakePool(conn)))
    return conn


def test_student_directory_filters_guardians_and_has_page_size_ten(prepared):
    response = TestClient(core.app).get(BOT_ROOT + "/directory",
                                         params={"actorTelegramId": "1234", "page": "2"})
    assert response.status_code == 200
    body = response.json()
    assert body["page"] == 2
    assert body["pageSize"] == 10
    assert "u.role <> 'guardian'" in next(sql for kind, sql, args in prepared.queries
                                         if "FROM users u" in sql)


def test_parent_directory_is_separate_and_supports_search(prepared):
    response = TestClient(core.app).get(BOT_ROOT + "/parents",
                                         params={"actorTelegramId": "1234", "q": "@parent_1", "page": "1"})
    assert response.status_code == 200
    assert response.json()["pageSize"] == 10
    texts = [sql for _, sql, args in prepared.queries]
    assert all("guardian_profiles p" in sql for sql in texts)
    assert any("p.display_name ILIKE $1" in sql for sql in texts)
    assert all("parent_1" not in sql for sql in texts)


def test_unlinked_parent_cannot_be_invented_from_callback(prepared):
    response = TestClient(core.app).get(BOT_ROOT + "/parents/" + PROFILE,
                                         params={"actorTelegramId": "1234"})
    assert response.status_code == 404


def test_student_parents_lookup_uses_student_id_and_active_link_filter(prepared):
    response = TestClient(core.app).get(BOT_ROOT + "/directory/" + USER + "/parents",
                                         params={"actorTelegramId": "1234"})
    assert response.status_code == 200
    assert response.json()["items"] == []
    sql = next(sql for kind, sql, args in prepared.queries
               if "guardian_links l" in sql)
    assert "l.student_id=$1" in sql and "l.status='linked'" in sql


def test_unauthorized_actor_never_reads_guardian_profiles(prepared, monkeypatch):
    monkeypatch.setattr(directory, "actor_for", AsyncMock(return_value=(None, "forbidden")))
    response = TestClient(core.app).get(BOT_ROOT + "/parents",
                                         params={"actorTelegramId": "1234"})
    assert response.status_code == 403
    assert prepared.queries == []
