"""Behavioral tests for Parent Connect staff authorization and manual messaging.

Every teacher-scoped read or send must include a bound assignment check.
An admin may message any linked guardian but may not impersonate a student.
No test sends a real Telegram message or uses the production database.
"""
from __future__ import annotations

from contextlib import asynccontextmanager
from types import SimpleNamespace
from uuid import UUID

import pytest
from starlette.requests import Request

from app import main as core
from app import guardian_port as g

ACTOR = UUID("11111111-1111-4111-8111-111111111111")
LINK = "22222222-2222-4222-8222-222222222222"


def request(path="/api/staff/guardians", query=""):
    return Request({
        "type": "http", "method": "GET", "path": path,
        "query_string": query.encode(), "headers": [],
        "server": ("example.test", 443), "scheme": "https",
    })


class Conn:
    def __init__(self, *, eligible=None):
        self.calls = []
        self.eligible = eligible if eligible is not None else []

    async def fetch(self, sql, *args):
        self.calls.append(("fetch", sql, args))
        if "SELECT d.id,d.status" in sql:
            return []
        return self.eligible

    async def fetchrow(self, sql, *args):
        self.calls.append(("fetchrow", sql, args))
        if "count(*) FILTER" in sql:
            return {"linked": 0, "awaiting": 0, "channel_required": 0}
        return None

    async def fetchval(self, sql, *args):
        self.calls.append(("fetchval", sql, args))
        return 0

    async def execute(self, sql, *args):
        self.calls.append(("execute", sql, args))
        return "INSERT 0 1"

    def transaction(self):
        return self

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_):
        return False


class Pool:
    def __init__(self, conn):
        self.conn = conn

    @asynccontextmanager
    async def acquire(self):
        yield self.conn


def install(monkeypatch, role, conn):
    async def current_user(_req, active=True):
        assert active is True
        return {"id": ACTOR, "role": role}
    async def pool():
        return Pool(conn)
    monkeypatch.setattr(core, "current_user", current_user)
    monkeypatch.setattr(core, "pool", pool)


@pytest.mark.parametrize("role,scoped", [("teacher", True), ("admin", False), ("owner", False)])
@pytest.mark.asyncio
async def test_directory_scoped_consistently_in_counts_rows_and_metrics(monkeypatch, role, scoped):
    conn = Conn()
    install(monkeypatch, role, conn)
    response = await g.staff_guardians(request())
    assert response.status_code == 200
    for kind, sql, args in conn.calls:
        if "guardian_links" not in sql and "guardian_message_deliveries" not in sql:
            continue
        if scoped:
            assert "teacher_student_links assigned" in sql, (kind, sql)
            assert ACTOR in args
        else:
            assert "teacher_student_links assigned" not in sql


@pytest.mark.parametrize("role,scoped", [("teacher", True), ("admin", False), ("owner", False)])
@pytest.mark.asyncio
async def test_directory_filters_use_bound_params(monkeypatch, role, scoped):
    conn = Conn()
    install(monkeypatch, role, conn)
    response = await g.staff_guardians(request(query="q=%25%27%20OR%201%3D1&status=linked"))
    assert response.status_code == 200
    for _, sql, args in conn.calls:
        if "SELECT count(*)::int" in sql:
            assert "ILIKE" in sql
            assert "OR 1=1" not in sql
            assert any(isinstance(x, str) and "OR 1=1" in x for x in args)
            if scoped:
                assert args[0] == ACTOR
            break
    else:
        raise AssertionError("no directory count query")


@pytest.mark.parametrize("role,scoped", [("teacher", True), ("admin", False), ("owner", False)])
@pytest.mark.asyncio
async def test_preview_scopes_actual_query(monkeypatch, role, scoped):
    conn = Conn()
    install(monkeypatch, role, conn)

    async def payload(_req):
        return {"body": "Hello {student_name}", "linkIds": [LINK]}
    monkeypatch.setattr(core, "payload", payload)
    response = await g.staff_preview(request("/api/staff/guardian-messages/preview"))
    assert response.status_code == 200
    assert len(conn.calls) == 1
    sql, args = conn.calls[0][1:]
    assert "guardian_links" in sql
    assert ("teacher_student_links assigned" in sql) is scoped
    assert len(args) == (2 if scoped else 1)


@pytest.mark.asyncio
async def test_teacher_send_cannot_insert_batch_for_unassigned_guardian(monkeypatch):
    conn = Conn(eligible=[])
    install(monkeypatch, "teacher", conn)

    async def payload(_req):
        return {
            "body": "Hello", "linkIds": [LINK],
            "confirm": True, "idempotencyKey": "abcdef1234567890",
        }

    async def no_limit(*_args, **_kwargs):
        return None

    monkeypatch.setattr(core, "payload", payload)
    monkeypatch.setattr(g, "counter", no_limit)
    response = await g.staff_send(request("/api/staff/guardian-messages/send"))
    assert response.status_code == 409
    assert any("teacher_student_links assigned" in sql for _, sql, _ in conn.calls)
    assert not any("INSERT INTO guardian_message_batches" in sql for _, sql, _ in conn.calls)


@pytest.mark.asyncio
async def test_manual_send_requires_explicit_confirmation(monkeypatch):
    conn = Conn()
    install(monkeypatch, "admin", conn)

    async def payload(_req):
        return {
            "body": "Hello", "linkIds": [LINK],
            "confirm": False, "idempotencyKey": "abcdef1234567890",
        }
    monkeypatch.setattr(core, "payload", payload)
    response = await g.staff_send(request("/api/staff/guardian-messages/send"))
    assert response.status_code == 400
    assert conn.calls == []


@pytest.mark.parametrize("role", ["admin", "teacher"])
@pytest.mark.asyncio
async def test_staff_cannot_read_another_sender_batch(monkeypatch, role):
    conn = Conn()
    install(monkeypatch, role, conn)
    response = await g.staff_batch(request("/api/staff/guardian-messages/"+LINK), LINK)
    assert response.status_code == 404
    _, sql, args = conn.calls[0]
    assert "sender_user_id=$2" in sql
    assert args == (LINK, ACTOR)


@pytest.mark.asyncio
async def test_teacher_cannot_open_unassigned_guardian_detail(monkeypatch):
    conn = Conn()
    install(monkeypatch, "teacher", conn)
    response = await g.staff_guardian_detail(request("/api/staff/guardians/"+LINK), LINK)
    assert response.status_code == 404
    _, sql, args = conn.calls[0]
    assert "teacher_student_links assigned" in sql
    assert args == (LINK, ACTOR)


@pytest.mark.asyncio
async def test_guardian_and_student_cannot_view_staff_templates(monkeypatch):
    conn = Conn()
    for role in ("guardian", "student"):
        install(monkeypatch, role, conn)
        response = await g.staff_templates(request("/api/staff/guardian-message-templates"))
        assert response.status_code == 403
    assert conn.calls == []
