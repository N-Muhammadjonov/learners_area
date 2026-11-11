"""Student-owned 60-day plan API with verified progression and serial day locks."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import main as core
from .study_plan_evidence import EVENTS
from .study_plan_port import failure, response, student
from .study_plan_sixty import (
    DAYS, PlanTask, eligible_to_open, make_sixty_day_schedule, normalize_level,
)

router = APIRouter(prefix="/api/study-plan/sixty")
CYCLE = "SELECT * FROM study_plan_60_cycles WHERE user_id=$1 FOR UPDATE"
CURRENT = """
SELECT day_number,slot,kind,title,href,source_key,minutes,stage_index,
       block_weights,completed_at
FROM study_plan_60_tasks WHERE cycle_id=$1 AND day_number=$2
ORDER BY slot
"""
INSERT_TASK = """
INSERT INTO study_plan_60_tasks(cycle_id,day_number,slot,kind,title,href,
 source_key,minutes,stage_index,block_weights)
VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
"""


def _zone(value: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(value or "Asia/Tashkent")
    except (KeyError, ValueError):
        return ZoneInfo("Asia/Tashkent")


async def _profile(con, uid) -> tuple[str | None, ZoneInfo]:
    level = await con.fetchval("SELECT current_level FROM onboarding_profiles WHERE user_id=$1", uid)
    zone = await con.fetchval("SELECT timezone FROM study_plan_preferences WHERE user_id=$1", uid)
    return normalize_level(level), _zone(zone)


def _task_values(cycle_id, schedule: list[dict], *, after_day: int = 0) -> list[tuple]:
    return [
        (cycle_id, day["day"], task.slot, task.kind, task.title, task.href,
         task.source_key, task.minutes, task.stage, list(task.blocks) if task.stage is not None else None)
        for day in schedule if day["day"] > after_day for task in day["tasks"]
    ]


def _event_kind(source: str) -> str | None:
    if source.startswith("reading:") or source.startswith("reading-practice:"):
        return "reading"
    if source.startswith("listening:"):
        return "listening"
    if source.startswith("writing:"):
        return "writing"
    if source.startswith("speaking:"):
        return "speaking"
    if source == "vocab":
        return "vocabulary"
    return None


async def _sync(con, row: dict, now: datetime) -> dict:
    if row["status"] == "completed":
        return row
    uid, cycle_id, day = row["user_id"], row["id"], row["current_day"]
    tasks = await con.fetch(CURRENT, cycle_id, day)
    # Timestamp-bound and server-owned evidence: an old attempt cannot complete a later day.
    pending = {task["kind"]: task for task in tasks
               if task["completed_at"] is None and task["kind"] != "grammar"}
    if pending:
        events = await con.fetch(f"""SELECT source_key,MIN(happened_at) AS at
            FROM ({EVENTS}) evidence WHERE happened_at >= $3 AND happened_at <= $4
            GROUP BY source_key""", uid, row["opened_at"], row["opened_at"], now)
        first = {}
        for event in events:
            kind = _event_kind(event["source_key"])
            if kind in pending and (kind not in first or event["at"] < first[kind]):
                first[kind] = event["at"]
        for kind, at in first.items():
            await con.execute("""UPDATE study_plan_60_tasks SET completed_at=$4
              WHERE cycle_id=$1 AND day_number=$2 AND kind=$3 AND completed_at IS NULL""",
              cycle_id, day, kind, at)

    remaining = await con.fetchval("""SELECT count(*)::int FROM study_plan_60_tasks
        WHERE cycle_id=$1 AND day_number=$2 AND completed_at IS NULL""", cycle_id, day)
    if remaining:
        return row
    today = now.astimezone(_zone(row["timezone"])).date()
    if day == DAYS:
        await con.execute("""UPDATE study_plan_60_cycles SET status='completed',
            updated_at=$2 WHERE id=$1""", cycle_id, now)
        return {**row, "status": "completed"}
    if eligible_to_open(day + 1, row["started_on"], today, True):
        await con.execute("""UPDATE study_plan_60_cycles SET current_day=$2,
            opened_at=$3,updated_at=$3 WHERE id=$1""", cycle_id, day + 1, now)
        return {**row, "current_day": day + 1, "opened_at": now}
    return row


async def _payload(con, row: dict, now: datetime) -> dict:
    tasks = await con.fetch("""SELECT day_number,slot,kind,title,href,source_key,
        minutes,stage_index,block_weights,completed_at FROM study_plan_60_tasks
        WHERE cycle_id=$1 ORDER BY day_number,slot""", row["id"])
    grouped = {index: [] for index in range(1, DAYS + 1)}
    for task in tasks:
        index = task["day_number"]
        completed = task["completed_at"] is not None
        unlocked = index == row["current_day"] and row["status"] == "active"
        grouped[index].append({
            "slot": task["slot"], "kind": task["kind"], "title": task["title"],
            "href": task["href"] if unlocked and not completed else None,
            "minutes": task["minutes"], "stage": task["stage_index"],
            "status": "completed" if completed else "ready" if unlocked else "locked",
        })
    if any(len(items) != 6 or sum(item["minutes"] for item in items) != 120
           for items in grouped.values()):
        raise ValueError("corrupt_sixty_day_schedule")
    days = []
    for index in range(1, DAYS + 1):
        items = grouped[index]
        status = ("completed" if all(item["status"] == "completed" for item in items)
                  else "active" if index == row["current_day"] and row["status"] == "active"
                  else "locked")
        days.append({"day": index,
                     "date": row["started_on"] + timedelta(days=index - 1),
                     "status": status, "tasks": items,
                     "minutes": sum(task["minutes"] for task in items)})
    return {
        "state": row["status"], "cycleId": row["id"], "level": row["cefr_level"],
        "revision": row["revision"], "startedOn": row["started_on"],
        "today": now.astimezone(_zone(row["timezone"])).date(),
        "currentDay": row["current_day"], "totalDays": DAYS,
        "completedDays": sum(day["status"] == "completed" for day in days),
        "days": days,
    }


async def _current(con, uid, now: datetime) -> dict:
    row = await con.fetchrow(CYCLE, uid)
    if row:
        state = await _sync(con, dict(row), now)
        return await _payload(con, state, now)
    level, _ = await _profile(con, uid)
    if not level:
        return {"state": "level_required", "choices": ["placement_test", "profile"]}
    return {"state": "available", "level": level, "totalDays": DAYS, "dailyMinutes": 120}


@router.get("")
async def read_sixty(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        return response(await _current(con, user["id"], now))


@router.post("/start")
async def start_sixty(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        existing = await con.fetchrow(CYCLE, user["id"])
        if existing:
            return response(await _current(con, user["id"], now))
        level, zone = await _profile(con, user["id"])
        if level is None:
            return failure("level_required", 409)
        start = now.astimezone(zone).date()
        plan = make_sixty_day_schedule(level, start)
        cycle_id = await con.fetchval("""INSERT INTO study_plan_60_cycles
            (user_id,started_on,timezone,cefr_level,opened_at)
            VALUES($1,$2,$3,$4,$5) RETURNING id""",
            user["id"], start, zone.key, level, now)
        await con.executemany(INSERT_TASK, _task_values(cycle_id, plan))
        return response(await _current(con, user["id"], now), 201)


@router.post("/regenerate")
async def regenerate_sixty(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    body = await core.payload(req)
    if not isinstance(body, dict) or body != {"confirmed": True}:
        return failure("confirmation_required", 400)
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        row = await con.fetchrow(CYCLE, user["id"])
        if not row:
            return failure("plan_not_found", 404)
        if row["status"] != "active":
            return failure("cycle_completed", 409)
        level, _ = await _profile(con, user["id"])
        if not level:
            return failure("level_required", 409)
        schedule = make_sixty_day_schedule(
            level, row["started_on"], revision=row["revision"] + 1)
        # Preserve all finished days, the active day and the rest of its
        # four-stage Grammar unit, so regeneration never cuts a lesson in half.
        preserve_through = min(DAYS, ((row["current_day"] + 3) // 4) * 4)
        await con.execute("""DELETE FROM study_plan_60_tasks
            WHERE cycle_id=$1 AND day_number>$2""", row["id"], preserve_through)
        await con.executemany(INSERT_TASK, _task_values(
            row["id"], schedule, after_day=preserve_through))
        await con.execute("""UPDATE study_plan_60_cycles
            SET cefr_level=$2,revision=revision+1,updated_at=$3 WHERE id=$1""",
            row["id"], level, now)
        return response(await _current(con, user["id"], now))


@router.post("/grammar/complete")
async def submit_grammar_stage(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    body = await core.payload(req)
    if not isinstance(body, dict) or set(body) != {"day", "scores"}:
        return failure("invalid_evidence", 400)
    day, scores = body.get("day"), body.get("scores")
    if type(day) is not int or not isinstance(scores, list) or len(scores) != 3:
        return failure("invalid_evidence", 400)
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        row = await con.fetchrow(CYCLE, user["id"])
        if not row or row["status"] != "active" or row["current_day"] != day:
            return failure("day_locked", 409)
        task = await con.fetchrow("""SELECT block_weights,completed_at FROM study_plan_60_tasks
          WHERE cycle_id=$1 AND day_number=$2 AND kind='grammar' FOR UPDATE""", row["id"], day)
        if not task:
            return failure("invalid_evidence", 404)
        weights = task["block_weights"]
        if (not isinstance(weights, list) or len(weights) != 3 or
            any(type(value) is not int or value < 0 or value > maximum
                for value, maximum in zip(scores, weights))):
            return failure("invalid_evidence", 400)
        # The caller is the Grammar exercise completion bridge; the submitted
        # per-block scores must come from checked practice, not a manual tick.
        if task["completed_at"] is None:
            await con.execute("""UPDATE study_plan_60_tasks
               SET completed_at=$3,proof=$4 WHERE cycle_id=$1
               AND day_number=$2 AND kind='grammar' AND completed_at IS NULL""",
               row["id"], day, now, {"source": "grammar_runtime", "scores": scores})
        return response(await _current(con, user["id"], now))


def install() -> None:
    core.app.include_router(router)
