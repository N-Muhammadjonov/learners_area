"""Regression probes for the Gemini attendance advantages merged into Arena."""
from __future__ import annotations

from datetime import date, datetime, timezone
from uuid import uuid4

import pytest

from app import academy_attendance as attendance
from app import academy_groups as groups
from app import academy_groups_port as port


class FakeTransaction:
    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, tb):
        return False


class ReadOnlyConnection:
    def __init__(self, rows):
        self.rows = rows
        self.statements = []

    def transaction(self, **options):
        assert options.get("readonly") is True
        return FakeTransaction()

    async def fetch(self, sql, *args):
        self.statements.append((sql, args))
        return self.rows


@pytest.mark.asyncio
async def test_attendance_report_uses_held_roster_denominator_and_role_scope():
    row = {
        "group_id": uuid4(), "group_name": "Group A", "branch": "Namangan",
        "held_sessions": 3, "cancelled_sessions": 2, "scheduled_sessions": 1,
        "eligible_marks": 8, "attended_marks": 5, "absent_marks": 1,
        "excused_marks": 2, "not_marked": 0,
    }
    conn = ReadOnlyConnection([row])
    actor = uuid4()
    report = await attendance.attendance_aggregate_report(
        conn, actor, "teacher", branch="Namangan",
        start_date=date(2026, 11, 1), end_date=date(2026, 11, 15),
    )
    assert report["denominatorPolicy"] == "held_sessions_only_excluding_excused"
    assert report["groups"][0]["attendanceRate"] == 5 / 6
    assert report["branches"][0]["attendanceRate"] == 5 / 6
    assert report["branches"][0]["cancelledSessions"] == 2
    sql, params = conn.statements[0]
    assert "s.status='held'" in sql
    assert "academy_group_teachers" in sql
    assert params[0] is False
    assert params[1] == actor
    assert params[4] == "Namangan"


@pytest.mark.asyncio
async def test_invalid_attendance_window_rejected_before_read():
    conn = ReadOnlyConnection([])
    with pytest.raises(groups.GroupError) as exc:
        await attendance.attendance_aggregate_report(
            conn, uuid4(), "owner",
            start_date=date(2026, 11, 20), end_date=date(2026, 11, 1),
        )
    assert exc.value.code == "invalid_attendance_date_range"
    assert conn.statements == []


@pytest.mark.asyncio
async def test_calendar_matches_active_membership_dates_not_all_group_history():
    now = datetime(2026, 11, 15, 12, 30, tzinfo=timezone.utc)
    item = {
        "id": uuid4(), "group_id": uuid4(), "group_name": "Group A",
        "branch": "Namangan", "room": "3", "starts_at": now,
        "ends_at": now, "session_status": "scheduled",
        "attendance_status": None,
    }
    conn = ReadOnlyConnection([item])
    student = uuid4()
    result = await attendance.student_calendar(conn, student, page=2)
    assert result["sessions"][0]["starts_at"] == now.isoformat()
    assert result["page"] == 2 and result["hasNext"] is False
    sql, args = conn.statements[0]
    assert "a.student_user_id=$1" in sql
    assert "m.starts_on <=" in sql
    assert "m.ends_on IS NULL OR m.ends_on >=" in sql
    assert "s.status='scheduled'" in sql
    assert args == (student, 25)


@pytest.mark.asyncio
async def test_groups_branch_filter_does_not_remove_teacher_scope():
    conn = ReadOnlyConnection([])
    actor = uuid4()
    await groups.list_groups(
        conn, actor, "teacher", "", None, 1, None, "Namangan",
    )
    sql, args = conn.statements[0]
    assert "academy_group_teachers" in sql
    assert "lower(g.branch)=lower($8)" in sql
    assert args[0] is False
    assert args[1] == actor
    assert args[7] == "Namangan"


def test_new_endpoints_are_read_only_and_role_scoped():
    routes = {route.path: route for route in port.router.routes}
    summary = routes["/api/staff/academy/attendance/summary"]
    assert "GET" in summary.methods
    calendar = {route.path: route for route in port.learner_router.routes}[
        "/api/academy/calendar"
    ]
    assert calendar.methods == {"GET"}
