"""Regression checks for owner/admin notification reconciliation and report alerts."""
from __future__ import annotations

from contextlib import asynccontextmanager
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app import support_reports_port
from app.notification_events import reconcile_staff_notifications


class Recorder:
    def __init__(self):
        self.queries: list[tuple[str, tuple]] = []

    async def execute(self, query: str, *args):
        self.queries.append((query, args))
        return "INSERT 0 1"


@pytest.mark.asyncio
async def test_pending_accounts_and_reports_reconcile_for_owner_only():
    owner = uuid4()
    conn = Recorder()
    await reconcile_staff_notifications(conn, user_id=owner, role="owner")
    assert len(conn.queries) == 5
    assert all(args == (owner,) for _, args in conn.queries)
    assert sum("ON CONFLICT DO NOTHING" in sql for sql, _ in conn.queries) == 3
    assert any("UPDATE notifications" in sql and "ACCESS_REQUESTED" in sql
               for sql, _ in conn.queries)
    assert any("UPDATE notifications" in sql and "SUPPORT_REPORT_RECEIVED" in sql
               for sql, _ in conn.queries)
    assert any("access_requests" in sql and "ACCESS_REQUESTED" in sql
               and "payload->>'requestId'" in sql for sql, _ in conn.queries)
    assert any("pending_accounts" in sql and "applicantId" in sql
               for sql, _ in conn.queries)
    assert any("problem_reports" in sql and "SUPPORT_REPORT_RECEIVED" in sql
               and "r.message" in sql for sql, _ in conn.queries)


@pytest.mark.asyncio
async def test_admin_only_receives_admissions_and_student_never_reconciles():
    conn = Recorder()
    await reconcile_staff_notifications(conn, user_id=uuid4(), role="admin")
    assert len(conn.queries) == 3
    assert not any("problem_reports" in query for query, _ in conn.queries)
    conn.queries.clear()
    await reconcile_staff_notifications(conn, user_id=uuid4(), role="student")
    assert not conn.queries


def test_report_submission_notifies_owner_in_transaction(monkeypatch):
    student_id = uuid4()
    owner_id = uuid4()
    report_id = uuid4()

    class Connection:
        def __init__(self):
            self.writes = []
            self.committed = False

        async def fetchrow(self, query, *args):
            self.writes.append(("report", query, args))
            return {"id": report_id, "route": "/app/reading",
                    "module": "reading"}

        async def fetch(self, query, *args):
            assert "role='owner'" in query and "account_status='active'" in query
            return [{"id": owner_id}]

        async def execute(self, query, *args):
            self.writes.append(("sql", query, args))
            return "INSERT 0 1"

        @asynccontextmanager
        async def transaction(self):
            yield
            self.committed = True

    conn = Connection()

    class Pool:
        @asynccontextmanager
        async def acquire(self):
            yield conn

    async def get_user(*args, **kwargs):
        return {"id": student_id, "role": "student"}

    async def get_body(*args, **kwargs):
        return {"route": "/app/reading", "module": "reading",
                "message": "The exercise does not show the correct answer."}

    async def get_pool():
        return Pool()

    monkeypatch.setattr(core, "current_user", get_user)
    monkeypatch.setattr(core, "payload", get_body)
    monkeypatch.setattr(core, "pool", get_pool)

    with TestClient(core.app) as client:
        response = client.post("/api/support/reports")
    assert response.status_code == 200
    assert response.json()["ok"] is True
    assert conn.committed
    notice = next(args for kind, query, args in conn.writes if kind == "sql"
                  and "INSERT INTO notifications" in query)
    assert notice[0] == owner_id
    assert notice[1] == "SUPPORT_REPORT_RECEIVED"
    assert notice[4] == "/app/notifications"
    assert "support-report:" + str(report_id) in notice[5]


def test_reports_do_not_allow_anonymous_submissions(monkeypatch):
    async def anonymous(*args, **kwargs):
        return None

    monkeypatch.setattr(core, "current_user", anonymous)
    with TestClient(core.app) as client:
        result = client.post("/api/support/reports", json={
            "route": "/app", "module": "dashboard", "message": "Test report"
        })
    assert result.status_code == 401
