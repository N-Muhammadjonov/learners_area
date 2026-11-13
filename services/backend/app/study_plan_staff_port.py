"""Read-only sequenced learning-plan progress for authorized school staff.

Owner/admin may view active learners in their school. Teachers see only their
linked students. Students cannot query staff endpoints or other accounts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Request

from . import main as core
from .study_plan_port import failure, response
from .study_plan_thirty_port import CYCLE, _present, _sync

router = APIRouter(prefix="/api/study-plan/monthly/sequence/staff")
STAFF = frozenset(("teacher", "admin", "owner"))
PAGE_SIZE = 25
VISIBLE_STUDENTS = """u.role='student' AND u.account_status='active'
    AND ($2::boolean = FALSE OR EXISTS (
        SELECT 1 FROM teacher_student_links link
        WHERE link.teacher_user_id=$1 AND link.student_user_id=u.id))"""


async def authorized_staff(req: Request):
    """Check staff role against the authenticated server session, never query args."""
    user = await core.current_user(req, active=True)
    if user is None:
        return None, failure("unauthenticated", 401)
    if user["role"] not in STAFF:
        return None, failure("forbidden", 403)
    return user, None


def summary(row: dict) -> dict:
    """Expose only work status; never return answers, evidence or student email."""
    duration = row["duration_days"]
    current = row["current_day"]
    total = (duration or 0) * 6
    completed = int(row["completed_tasks"] or 0)
    return {
        "studentId": row["id"], "name": row["name"] or "O‘quvchi",
        "state": row["status"] if row["cycle_id"] else "uncreated",
        "level": row["cefr_level"],
        "totalDays": duration, "currentDay": current,
        "completedTasks": completed, "totalTasks": total,
        "currentCompleted": int(row["current_completed"] or 0),
        "currentTotal": 6 if row["cycle_id"] else 0,
    }


@router.get("")
async def list_progress(req: Request, page: int = 1):
    user, error = await authorized_staff(req)
    if error is not None:
        return error
    if not 1 <= page <= 1000:
        return failure("invalid_page", 400)
    pool = await core.pool()
    async with pool.acquire() as con:
        rows = await con.fetch(f"""SELECT u.id,u.name,c.id cycle_id,
                c.status,c.cefr_level,c.duration_days,c.current_day,
                (SELECT count(*)::int FROM study_plan_30_tasks t
                 WHERE t.cycle_id=c.id AND t.completed_at IS NOT NULL) completed_tasks,
                (SELECT count(*)::int FROM study_plan_30_tasks t
                 WHERE t.cycle_id=c.id AND t.day_number=c.current_day
                   AND t.completed_at IS NOT NULL) current_completed
            FROM users u LEFT JOIN study_plan_30_cycles c ON c.user_id=u.id
            WHERE {VISIBLE_STUDENTS}
            ORDER BY lower(u.name),u.id LIMIT $3 OFFSET $4""",
            user["id"], user["role"] == "teacher", PAGE_SIZE + 1,
            (page - 1) * PAGE_SIZE)
    return response({
        "page": page, "pageSize": PAGE_SIZE, "hasMore": len(rows) > PAGE_SIZE,
        "students": [summary(dict(row)) for row in rows[:PAGE_SIZE]],
    })


@router.get("/{student_id}")
async def detail_progress(req: Request, student_id: str):
    user, error = await authorized_staff(req)
    if error is not None:
        return error
    try:
        ident = UUID(student_id)
    except (ValueError, AttributeError):
        return failure("not_found", 404)
    pool = await core.pool()
    now = datetime.now(timezone.utc)
    async with pool.acquire() as con, con.transaction():
        student = await con.fetchrow(f"""SELECT u.id,u.name FROM users u
            WHERE u.id=$3 AND {VISIBLE_STUDENTS}""",
            user["id"], user["role"] == "teacher", ident)
        if not student:
            return failure("not_found", 404)
        cycle = await con.fetchrow(CYCLE, ident)
        if not cycle:
            return response({"studentId": ident, "name": student["name"] or "O‘quvchi",
                             "state": "uncreated", "plan": None})
        updated = await _sync(con, dict(cycle), now)
        plan = await _present(con, updated, now)
        # Credited study time is produced exclusively by server-clock study_intervals.
        # It covers all recorded site learning since this plan began, not just plan tasks.
        # It does not expose evidence, answers, scores or learner credentials.
        tracked_seconds = await con.fetchval("""SELECT COALESCE(SUM(i.seconds),0)::float8
            FROM study_intervals i WHERE i.user_id=$1
              AND i.ended_at > ($2::date::timestamp AT TIME ZONE $3)""",
            ident, updated["started_on"], updated["timezone"])
        return response({"studentId": ident, "name": student["name"] or "O‘quvchi",
                         "state": plan["state"], "plan": plan,
                         "trackedStudySeconds": max(0, int(tracked_seconds or 0))})


def install() -> None:
    core.app.include_router(router)
