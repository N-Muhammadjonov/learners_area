"""Owner-only presence analytics: role gate and truthful server-sampled values."""
from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException

from app import browser_staff_people


OWNER = {"id": UUID("00000000-0000-4000-8000-000000000001"), "role": "owner"}
STUDENT = {"id": UUID("00000000-0000-4000-8000-000000000002"), "role": "student"}
STAMP = datetime(2026, 11, 24, 8, 35, tzinfo=timezone.utc)


class Connection:
    async def fetchval(self, query: str, *args: object) -> object:
        if "count(DISTINCT user_id)" in query:
            return 3
        if "min(bucket_start)" in query:
            return STAMP
        if "count(*)::int" in query:
            return 2
        raise AssertionError(f"unexpected query: {query}")

    async def fetch(self, query: str, *args: object) -> list[dict]:
        if "GROUP BY bucket_start" in query:
            return [{"bucket_start": STAMP, "active_users": 2}]
        if "JOIN users u ON u.id=a.user_id" in query:
            return [{
                "id": STUDENT["id"],
                "name": "Learner",
                "role": "student",
                "seen_at": STAMP,
                "path": "/app/reading",
                "visit_seconds": 100,
            }]
        raise AssertionError(f"unexpected query: {query}")


class ConnectionPool:
    def acquire(self) -> "ConnectionPool":
        return self

    async def __aenter__(self) -> Connection:
        return Connection()

    async def __aexit__(self, *args: object) -> None:
        return None


async def fake_pool() -> ConnectionPool:
    return ConnectionPool()


def test_owner_online_dashboard_returns_real_counts_and_progress_identity(monkeypatch):
    monkeypatch.setattr(browser_staff_people.core, "pool", fake_pool)
    result = asyncio.run(browser_staff_people.read(None, OWNER, "owner-presence", {}))
    assert result["onlineNow"] == 2
    assert result["todayVisitors"] == 3
    assert result["peakFiveMinute"] == 2
    assert result["sampleWindowMinutes"] == 5
    assert result["onlineThresholdSeconds"] == 90
    assert result["historyStartedAt"] == STAMP.isoformat()
    assert len(result["people"]) == 1
    assert result["people"][0]["path"] == "/app/reading"
    assert result["buckets"][0]["activeUsers"] == 2


def test_non_owner_cannot_fetch_all_users_presence(monkeypatch):
    monkeypatch.setattr(browser_staff_people.core, "pool", fake_pool)
    with pytest.raises(HTTPException) as error:
        asyncio.run(browser_staff_people.read(None, STUDENT, "owner-presence", {}))
    assert error.value.status_code == 403
