"""Regression coverage for atomic website admission decisions."""
from __future__ import annotations

from uuid import UUID
from unittest.mock import AsyncMock

import pytest
from starlette.requests import Request

from app import admission_decision_port as admission
from app import main as core


REQUEST_ID = UUID("fc760d18-31b6-4947-81eb-281a215abc40")
USER_ID = UUID("dc5fa817-df2c-4b43-a0fe-b23c72630101")
ACTOR_ID = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")


class Transaction:
    def __init__(self, conn: "Connection") -> None:
        self.conn = conn

    async def __aenter__(self) -> "Transaction":
        self.conn.transactions_started += 1
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        if exc_type is not None:
            self.conn.rollbacks += 1
        else:
            self.conn.commits += 1
        return False


class Connection:
    def __init__(self, *, fail_audit: bool = False) -> None:
        self.fail_audit = fail_audit
        self.calls: list[tuple[str, tuple[object, ...]]] = []
        self.transactions_started = 0
        self.rollbacks = 0
        self.commits = 0

    def transaction(self) -> Transaction:
        return Transaction(self)

    async def fetchrow(self, sql: str, *args: object) -> dict[str, object] | None:
        self.calls.append((sql, args))
        if "SELECT id,user_id,status FROM access_requests" in sql:
            return {"id": REQUEST_ID, "user_id": USER_ID, "status": "pending"}
        if "UPDATE access_requests SET status=" in sql:
            return {"id": REQUEST_ID}
        raise AssertionError(f"Unexpected query: {sql}")

    async def execute(self, sql: str, *args: object) -> str:
        self.calls.append((sql, args))
        if "INSERT INTO audit_log" in sql:
            assert args[3] == str(USER_ID)
            assert isinstance(args[3], str)
            if self.fail_audit:
                raise RuntimeError("audit write failed")
        return "OK"


class Pool:
    def __init__(self, conn: Connection) -> None:
        self.conn = conn

    def acquire(self) -> Pool:
        return self

    async def __aenter__(self) -> Connection:
        return self.conn

    async def __aexit__(self, exc_type, exc, traceback) -> bool:
        return False


def request() -> Request:
    return Request({"type": "http", "method": "POST", "path": f"/api/admin/admission/{REQUEST_ID}/decide", "headers": []})


def setup(monkeypatch: pytest.MonkeyPatch, conn: Connection) -> None:
    monkeypatch.setattr(core, "current_user", AsyncMock(return_value={"id": ACTOR_ID, "role": "owner"}))
    monkeypatch.setattr(core, "payload", AsyncMock(return_value={"decision": "approve"}))
    monkeypatch.setattr(core, "pool", AsyncMock(return_value=Pool(conn)))


@pytest.mark.asyncio
async def test_approval_uses_string_audit_target_and_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = Connection()
    setup(monkeypatch, conn)

    response = await admission.decide(request(), str(REQUEST_ID))

    assert response.status_code == 200
    assert conn.transactions_started == 1
    assert conn.commits == 1
    assert conn.rollbacks == 0
    queries = [sql for sql, _ in conn.calls]
    assert any("UPDATE access_requests SET status=" in sql for sql in queries)
    assert any("UPDATE users SET account_status=" in sql for sql in queries)
    assert any("INSERT INTO audit_log" in sql for sql in queries)
    assert any("INSERT INTO notifications" in sql for sql in queries)


@pytest.mark.asyncio
async def test_approval_audit_failure_rolls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    conn = Connection(fail_audit=True)
    setup(monkeypatch, conn)

    with pytest.raises(RuntimeError, match="audit write failed"):
        await admission.decide(request(), str(REQUEST_ID))

    assert conn.transactions_started == 1
    assert conn.commits == 0
    assert conn.rollbacks == 1
