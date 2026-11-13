"""Access control and production routing for authorized learner plan monitoring."""
import asyncio
from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app import main as core
from app.asgi import application, browser
from app.study_plan_staff_port import authorized_staff, summary, VISIBLE_STUDENTS


@pytest.mark.parametrize("role,permitted", [
    ("teacher", True), ("admin", True), ("owner", True),
    ("student", False),
])
def test_staff_access_requires_server_role(monkeypatch, role, permitted):
    async def current_user(req, active=True):
        return {"id": uuid4(), "role": role}
    monkeypatch.setattr(core, "current_user", current_user)
    person, error = asyncio.run(authorized_staff(object()))
    assert (error is None) is permitted
    if not permitted:
        assert error.status_code == 403


def test_production_dispatch_registers_monitor_endpoints_and_guards_anonymous(monkeypatch):
    paths = {r.path for r in browser.routes}
    for path in ("/api/study-plan/monthly/sequence/staff",
                 "/api/study-plan/monthly/sequence/staff/{student_id}"):
        assert path in paths

    async def anonymous(req, active=True):
        return None
    async def no_database():
        raise AssertionError("Anonymous requests must not acquire database connections")
    monkeypatch.setattr(core, "current_user", anonymous)
    monkeypatch.setattr(core, "pool", no_database)
    with TestClient(application, raise_server_exceptions=False) as client:
        assert client.get("/api/study-plan/monthly/sequence/staff").status_code == 401
        assert client.get(
            "/api/study-plan/monthly/sequence/staff/" + str(uuid4())).status_code == 401


def test_monitor_query_enforces_teacher_student_links_and_never_exposes_proof():
    assert "teacher_student_links" in VISIBLE_STUDENTS
    assert "teacher_user_id=$1" in VISIBLE_STUDENTS
    assert "student_user_id=u.id" in VISIBLE_STUDENTS
    assert "u.account_status='active'" in VISIBLE_STUDENTS
    row = {"id": uuid4(), "name": "Existing Person", "status": "active",
           "cycle_id": uuid4(), "duration_days": 7, "current_day": 2,
           "cefr_level": "B2", "completed_tasks": 9, "current_completed": 3}
    public = summary(row)
    assert public["name"] == "Existing Person"
    assert public["totalTasks"] == 42
    assert public["currentCompleted"] == 3
    assert "proof" not in public
    assert "email" not in public


def test_teacher_uses_scoped_queries_and_cannot_read_unlinked_student(monkeypatch):
    person = uuid4()
    class FakeConnection:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def fetch(self, query, *args):
            assert "teacher_student_links" in query
            assert args[0] == person
            assert args[1] is True
            return []
        async def fetchrow(self, query, *args):
            assert "teacher_student_links" in query
            assert args[1] is True
            return None
        def transaction(self):
            return self
    class FakePool:
        def acquire(self):
            return FakeConnection()
    async def current_user(req, active=True):
        return {"id": person, "role": "teacher"}
    async def pool():
        return FakePool()
    monkeypatch.setattr(core, "current_user", current_user)
    monkeypatch.setattr(core, "pool", pool)
    with TestClient(core.app, raise_server_exceptions=False) as client:
        listed = client.get("/api/study-plan/monthly/sequence/staff")
        assert listed.status_code == 200, listed.text
        assert listed.json()["students"] == []
        denied = client.get(
            "/api/study-plan/monthly/sequence/staff/" + str(uuid4()))
        assert denied.status_code == 404
        assert denied.json()["error"] == "not_found"


@pytest.mark.parametrize("role", ["owner", "admin"])
def test_owner_and_admin_can_read_school_wide_plan_list(monkeypatch, role):
    person = uuid4()
    class FakeConnection:
        async def __aenter__(self):
            return self
        async def __aexit__(self, *args):
            return False
        async def fetch(self, query, *args):
            assert "teacher_student_links" in query
            assert args[0] == person
            assert args[1] is False
            return [{
                "id": uuid4(), "name": "Saved Learner", "cycle_id": None,
                "status": None, "cefr_level": None, "duration_days": None,
                "current_day": None, "completed_tasks": 0,
                "current_completed": 0,
            }]
    class FakePool:
        def acquire(self):
            return FakeConnection()
    async def current_user(req, active=True):
        return {"id": person, "role": role}
    async def pool():
        return FakePool()
    monkeypatch.setattr(core, "current_user", current_user)
    monkeypatch.setattr(core, "pool", pool)
    with TestClient(core.app, raise_server_exceptions=False) as client:
        result = client.get("/api/study-plan/monthly/sequence/staff")
        assert result.status_code == 200, result.text
        assert result.json()["students"][0]["name"] == "Saved Learner"
        assert result.json()["students"][0]["state"] == "uncreated"

@pytest.mark.parametrize("role", ["owner", "teacher", "admin"])
@pytest.mark.asyncio
async def test_student_plan_detail_adds_only_server_recorded_study_time(monkeypatch, role):
    import json
    from datetime import date
    from contextlib import asynccontextmanager
    from starlette.requests import Request
    from app import study_plan_staff_port as staff

    actor, ident = uuid4(), uuid4()
    cycle = {"id": uuid4(), "started_on": date(2026, 11, 1),
             "timezone": "Asia/Tashkent"}
    calls = []

    class FakeConnection:
        @asynccontextmanager
        async def transaction(self):
            yield self

        async def fetchrow(self, sql, *args):
            calls.append(("fetchrow", sql, args))
            if "FROM users u" in sql:
                assert "teacher_student_links" in sql
                assert args == (actor, role == "teacher", ident)
                return {"id": ident, "name": "Test Learner"}
            return cycle

        async def fetchval(self, sql, *args):
            calls.append(("fetchval", sql, args))
            assert "study_intervals" in sql
            assert args == (ident, cycle["started_on"], cycle["timezone"])
            assert "SUM(i.seconds)" in sql
            return 7260.4

    class FakePool:
        @asynccontextmanager
        async def acquire(self):
            yield FakeConnection()

    async def current_user(req, active=True):
        assert active
        return {"id": actor, "role": role}

    async def pool():
        return FakePool()

    async def sync(con, saved, now):
        assert saved == cycle
        return saved

    async def present(con, saved, now):
        return {"state": "active", "totalDays": 7, "currentDay": 2,
                "days": [{"day": 1, "tasks": [{"status": "completed"}]}]}

    monkeypatch.setattr(core, "current_user", current_user)
    monkeypatch.setattr(core, "pool", pool)
    monkeypatch.setattr(staff, "_sync", sync)
    monkeypatch.setattr(staff, "_present", present)

    req = Request({"type": "http", "method": "GET",
                   "path": "/api/study-plan/monthly/sequence/staff/" + str(ident),
                   "query_string": b"", "headers": []})
    response = await staff.detail_progress(req, str(ident))
    assert response.status_code == 200
    data = json.loads(response.body)
    assert data["trackedStudySeconds"] == 7260
    assert data["studentId"] == str(ident)
    assert "proof" not in str(data)
    assert any(kind == "fetchval" for kind, *_ in calls)
