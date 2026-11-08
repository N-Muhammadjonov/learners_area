"""Security regression tests for Telegram People actions and academic results."""
import asyncio
from uuid import UUID
from unittest.mock import AsyncMock

from app import telegram_directory_port as directory


ID = UUID("11111111-1111-4111-8111-111111111111")
TEACHER = UUID("22222222-2222-4222-8222-222222222222")
ACTOR = {"telegramUserId": "12345", "auditUserId": TEACHER, "isPrimaryOwner": False}


class FakeConnection:
    def __init__(self, role, assigned=False):
        self.role = role
        self.assigned = assigned
        self.queries = []

    async def fetchrow(self, sql, *args):
        self.queries.append(("fetchrow", sql, args))
        if "FROM users WHERE id=$1" in sql:
            return {"id": ID, "name": "Student", "role": "student"}
        if "FROM users WHERE telegram_id=$1" in sql:
            return {"id": TEACHER, "role": self.role, "account_status": "active"}
        return None

    async def fetchval(self, sql, *args):
        self.queries.append(("fetchval", sql, args))
        if "teacher_student_links" in sql:
            return 1 if self.assigned else None
        return None


def test_academic_results_denied_to_admin_and_unassigned_teacher(monkeypatch):
    async def actor_for(*_args, **_kwargs):
        return ACTOR, None

    monkeypatch.setattr(directory, "actor_for", actor_for)

    async def run():
        for role in ("student", "admin", "teacher"):
            conn = FakeConnection(role, assigned=False)
            _actor, _target, failure = await directory._authorized_results(conn, "12345", str(ID))
            assert failure is not None and failure.status_code == 403
        conn = FakeConnection("teacher", assigned=True)
        _actor, target, failure = await directory._authorized_results(conn, "12345", str(ID))
        assert failure is None and target["id"] == ID
        assert any("teacher_student_links" in q for _, q, _ in conn.queries)
    asyncio.run(run())


def test_academic_results_require_actual_linked_owner(monkeypatch):
    async def actor_for(*_args, **_kwargs):
        return {"telegramUserId": "12345", "auditUserId": TEACHER, "isPrimaryOwner": True}, None

    monkeypatch.setattr(directory, "actor_for", actor_for)

    async def run():
        conn = FakeConnection("owner")
        _actor, target, error = await directory._authorized_results(conn, "12345", str(ID))
        assert error is None and target["id"] == ID
        conn = FakeConnection("admin")
        _actor, _target, error = await directory._authorized_results(conn, "12345", str(ID))
        assert error is not None and error.status_code == 403
    asyncio.run(run())


def test_student_results_queries_are_per_subject():
    class Reads:
        def __init__(self):
            self.calls = []

        async def fetch(self, sql, *args):
            self.calls.append((sql, args))
            return []

    async def run():
        connection = Reads()
        counts, lines = await directory._student_result_lines(connection, {"id": ID})
        assert set(counts) == {"Listening", "Reading", "Writing", "Speaking", "Mock", "Evaluation"}
        assert all(count == 0 for count in counts.values())
        assert len(connection.calls) == 6
        assert all(args == (ID,) and "WHERE user_id=$1" in sql
                   for sql, args in connection.calls)
        assert len(lines) == 6
    asyncio.run(run())


def test_bot_owner_is_not_the_same_as_website_owner(monkeypatch):
    async def actor_for(*_args, **_kwargs):
        return {"telegramUserId": "12345", "auditUserId": TEACHER, "isPrimaryOwner": True}, None

    monkeypatch.setattr(directory, "actor_for", actor_for)

    async def run():
        conn = FakeConnection("teacher", assigned=False)
        _actor, _target, error = await directory._authorized_results(conn, "12345", str(ID))
        assert error.status_code == 403
    asyncio.run(run())
