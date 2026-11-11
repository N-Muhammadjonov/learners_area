"""Student-only 30-day sequenced plan API with server-verified completion."""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import main as core
from .study_plan_evidence import EVENTS
from .study_plan_port import failure, response, student
from .study_plan_thirty import DAYS, make_thirty_day_schedule, normalize_level
from .study_plan_materials import assign_materials, load_material_pools

router = APIRouter(prefix="/api/study-plan/monthly/sequence")
CYCLE = "SELECT * FROM study_plan_30_cycles WHERE user_id=$1 FOR UPDATE"
CURRENT = """SELECT day_number,slot,kind,title,href,source_key,minutes,
             stage_index,block_weights,completed_at FROM study_plan_30_tasks
             WHERE cycle_id=$1 AND day_number=$2 ORDER BY slot"""
INSERT_TASK = """INSERT INTO study_plan_30_tasks
    (cycle_id,day_number,slot,kind,title,href,source_key,minutes,stage_index,block_weights)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)"""
SKILL_ANSWER_FILE = Path(__file__).with_name("data") / "study_plan_30_skill_answers.json"
_SKILL_ANSWERS: dict[tuple[str, str, str], list[list[str]]] | None = None


def _timezone(name: str | None) -> ZoneInfo:
    try:
        return ZoneInfo(name or "Asia/Tashkent")
    except (KeyError, ValueError):
        return ZoneInfo("Asia/Tashkent")


async def _profile(con, user_id) -> tuple[str | None, ZoneInfo]:
    level = await con.fetchval(
        "SELECT current_level FROM onboarding_profiles WHERE user_id=$1", user_id)
    zone = await con.fetchval(
        "SELECT timezone FROM study_plan_preferences WHERE user_id=$1", user_id)
    return normalize_level(level), _timezone(zone)


def _records(cycle_id, days: list[dict], after_day: int = 0) -> list[tuple]:
    return [
        (cycle_id, day["day"], task.slot, task.kind, task.title, task.href,
         task.source_key, task.minutes, task.stage,
         list(task.blocks) if task.stage is not None else None)
        for day in days if day["day"] > after_day for task in day["tasks"]
    ]


def _event_kind(key: str) -> str | None:
    if key.startswith(("reading:", "reading-practice:")):
        return "reading"
    if key.startswith("listening:"):
        return "listening"
    if key.startswith("writing:"):
        return "writing"
    if key.startswith("speaking:"):
        return "speaking"
    if key == "vocab":
        return "vocabulary"
    return None


def _skill_answer_bank() -> dict[tuple[str, str, str], list[list[str]]]:
    global _SKILL_ANSWERS
    if _SKILL_ANSWERS is None:
        data = json.loads(SKILL_ANSWER_FILE.read_text(encoding="utf-8"))
        if data.get("version") != 1 or not isinstance(data.get("units"), list):
            raise ValueError("invalid_skill_answer_bank")
        _SKILL_ANSWERS = {
            (unit["track"], unit["group"], unit["id"]): unit["answers"]
            for unit in data["units"] if unit["stage"] == 0
        }
    return _SKILL_ANSWERS


def _score_skill_stage(source_key: str, answers: object) -> dict | None:
    """Grade actual first-stage choices using the backend's source-owned key."""
    parts = source_key.split(":")
    if len(parts) != 5 or parts[0] != "skill-grammar" or parts[4] != "0":
        return None
    expected = _skill_answer_bank().get((parts[1], parts[2], parts[3]))
    if not expected or not isinstance(answers, list) or len(answers) != 3:
        return None
    grades = []
    for supplied, correct in zip(answers, expected):
        if (not isinstance(supplied, list) or len(supplied) != len(correct)
                or not all(isinstance(item, str) and 0 < len(item) <= 500 for item in supplied)):
            return None
        grades.append(sum(actual == answer for actual, answer in zip(supplied, correct)))
    # Each exercise block must be submitted in full, with at least 75% accuracy.
    if any(correct * 4 < total * 3 for correct, total in zip(grades, map(len, expected))):
        return {"passed": False, "correct": grades,
                "total": [len(group) for group in expected]}
    return {"passed": True, "correct": grades,
            "total": [len(group) for group in expected]}


async def _sync(con, cycle: dict, now: datetime) -> dict:
    if cycle["status"] != "active":
        return cycle
    uid, cid, day = cycle["user_id"], cycle["id"], cycle["current_day"]
    tasks = await con.fetch(CURRENT, cid, day)
    if len(tasks) != 6 or sum(task["minutes"] for task in tasks) != 120:
        raise ValueError("invalid_current_day_tasks")
    pending = {task["kind"]: task for task in tasks
               if task["completed_at"] is None and task["kind"] != "grammar"}
    if pending:
        # Backend evidence is authoritative. Client-provided completion flags are ignored.
        events = await con.fetch(f"""SELECT source_key, MIN(happened_at) AS happened_at,
                 count(DISTINCT event_key)::int AS evidence_count
          FROM ({EVENTS}) e WHERE happened_at >= $2 AND happened_at <= $3
          GROUP BY source_key""", uid, cycle["opened_at"], now)
        verified = {}
        for item in events:
            kind = _event_kind(item["source_key"])
            if kind == "vocabulary" and item["evidence_count"] < 10:
                continue
            if kind in pending and (kind not in verified or item["happened_at"] < verified[kind][0]):
                verified[kind] = (item["happened_at"], item["source_key"])
        for kind, (completed_at, source) in verified.items():
            await con.execute("""UPDATE study_plan_30_tasks
              SET completed_at=$4,proof=$5 WHERE cycle_id=$1 AND day_number=$2
              AND kind=$3 AND completed_at IS NULL""",
              cid, day, kind, completed_at, {"source": source, "verified": True})

    grammar = next((task for task in tasks if task["kind"] == "grammar"
                    and task["completed_at"] is None), None)
    if grammar and grammar["source_key"].startswith("grammar-book:"):
        source = grammar["source_key"].split(":")
        if len(source) == 4:
            stage = int(source[3])
            grade = await con.fetchrow("""SELECT count(DISTINCT exercise)::int completed,
                max(created_at) AS at FROM grammar_book_evidence
                WHERE user_id=$1 AND level=$2 AND unit_id=$3 AND stage=$4
                AND created_at >= $5 AND exercise BETWEEN 0 AND 2""",
                uid, source[1], source[2], stage, cycle["opened_at"])
            if grade and grade["completed"] == 3:
                await con.execute("""UPDATE study_plan_30_tasks
                    SET completed_at=$3,proof=$4 WHERE cycle_id=$1
                    AND day_number=$2 AND kind='grammar' AND completed_at IS NULL""",
                    cid, day, grade["at"], {"source": "grammar_book_evidence",
                                             "level": source[1], "unitId": source[2], "stage": stage})

    pending_count = await con.fetchval("""SELECT count(*)::int FROM study_plan_30_tasks
        WHERE cycle_id=$1 AND day_number=$2 AND completed_at IS NULL""", cid, day)
    if pending_count:
        return cycle
    today = now.astimezone(_timezone(cycle["timezone"])).date()
    if day == DAYS:
        await con.execute("""UPDATE study_plan_30_cycles
            SET status='completed',updated_at=$2 WHERE id=$1""", cid, now)
        return {**cycle, "status": "completed"}
    # Calendar-day gate + verified previous-day completion: no skipping.
    if today >= cycle["started_on"] + timedelta(days=day):
        await con.execute("""UPDATE study_plan_30_cycles SET
            current_day=$2,opened_at=$3,updated_at=$3 WHERE id=$1""",
            cid, day + 1, now)
        return {**cycle, "current_day": day + 1, "opened_at": now}
    return cycle


async def _present(con, cycle: dict, now: datetime) -> dict:
    rows = await con.fetch("""SELECT day_number,slot,kind,title,href,source_key,
      minutes,stage_index,completed_at FROM study_plan_30_tasks
      WHERE cycle_id=$1 ORDER BY day_number,slot""", cycle["id"])
    groups = {day: [] for day in range(1, DAYS + 1)}
    for task in rows:
        number = task["day_number"]
        completed = task["completed_at"] is not None
        can_open = cycle["status"] == "active" and cycle["current_day"] == number
        groups[number].append({
            "slot": task["slot"], "kind": task["kind"], "title": task["title"],
            "minutes": task["minutes"], "stage": task["stage_index"],
            "href": task["href"] if can_open and not completed else None,
            "status": "completed" if completed else "ready" if can_open else "locked",
        })
    if any(len(tasks) != 6 or sum(task["minutes"] for task in tasks) != 120
           for tasks in groups.values()):
        raise ValueError("incomplete_30_day_schedule")
    today = now.astimezone(_timezone(cycle["timezone"])).date()
    result = []
    for day in range(1, DAYS + 1):
        tasks = groups[day]
        complete = all(task["status"] == "completed" for task in tasks)
        status = ("completed" if complete else "active"
                  if cycle["status"] == "active" and day == cycle["current_day"]
                  else "locked")
        result.append({
            "day": day, "date": cycle["started_on"] + timedelta(days=day - 1),
            "status": status, "minutes": 120, "tasks": tasks,
        })
    return {
        "state": cycle["status"], "cycleId": cycle["id"],
        "level": cycle["cefr_level"], "totalDays": DAYS, "currentDay": cycle["current_day"],
        "completedDays": sum(day["status"] == "completed" for day in result),
        "startedOn": cycle["started_on"], "today": today,
        "revision": cycle["revision"], "days": result,
    }


async def _current(con, uid, now: datetime) -> dict:
    cycle = await con.fetchrow(CYCLE, uid)
    if cycle:
        state = await _sync(con, dict(cycle), now)
        return await _present(con, state, now)
    level, _ = await _profile(con, uid)
    if level is None:
        return {"state": "level_required", "choices": ["placement_test", "profile"]}
    return {"state": "available", "level": level, "totalDays": DAYS, "dailyMinutes": 120}


@router.get("")
async def read_plan(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    now = datetime.now(timezone.utc)
    pool = await core.pool()
    async with pool.acquire() as con, con.transaction():
        return response(await _current(con, user["id"], now))


@router.post("/start")
async def start_plan(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    now = datetime.now(timezone.utc)
    pool = await core.pool()
    async with pool.acquire() as con, con.transaction():
        if await con.fetchrow(CYCLE, user["id"]):
            return response(await _current(con, user["id"], now))
        level, zone = await _profile(con, user["id"])
        if level is None:
            return failure("level_required", 409)
        today = now.astimezone(zone).date()
        plan = assign_materials(
            make_thirty_day_schedule(level, today),
            await load_material_pools(con, user))
        cid = await con.fetchval("""INSERT INTO study_plan_30_cycles
           (user_id,started_on,timezone,cefr_level,opened_at)
           VALUES($1,$2,$3,$4,$5)
           ON CONFLICT(user_id) DO NOTHING RETURNING id""",
           user["id"], today, zone.key, level, now)
        if cid is not None:
            await con.executemany(INSERT_TASK, _records(cid, plan))
        return response(await _current(con, user["id"], now), 201 if cid is not None else 200)


@router.post("/regenerate")
async def regenerate_plan(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    body = await core.payload(req)
    if not isinstance(body, dict) or body != {"confirmed": True}:
        return failure("confirmation_required", 400)
    now = datetime.now(timezone.utc)
    pool = await core.pool()
    async with pool.acquire() as con, con.transaction():
        row = await con.fetchrow(CYCLE, user["id"])
        if not row:
            return failure("plan_not_found", 404)
        if row["status"] != "active":
            return failure("cycle_completed", 409)
        level, _ = await _profile(con, user["id"])
        if level is None:
            return failure("level_required", 409)
        plan = assign_materials(
            make_thirty_day_schedule(level, row["started_on"],
                                     revision=row["revision"] + 1),
            await load_material_pools(con, user), revision=row["revision"] + 1)
        # Preserve today's attempts and all prior days. Only untouched future
        # days are replaced. No student earns completion by regeneration.
        await con.execute("""DELETE FROM study_plan_30_tasks
            WHERE cycle_id=$1 AND day_number>$2""", row["id"], row["current_day"])
        await con.executemany(INSERT_TASK, _records(row["id"], plan,
                                                  after_day=row["current_day"]))
        await con.execute("""UPDATE study_plan_30_cycles SET cefr_level=$2,
           revision=revision+1,updated_at=$3 WHERE id=$1""", row["id"], level, now)
        return response(await _current(con, user["id"], now))


@router.post("/grammar/verify")
async def verify_skill_grammar(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    body = await core.payload(req)
    if not isinstance(body, dict) or set(body) != {"day", "answers"}:
        return failure("invalid_evidence", 400)
    day, answers = body.get("day"), body.get("answers")
    if type(day) is not int or day < 1 or day > DAYS:
        return failure("invalid_evidence", 400)
    now = datetime.now(timezone.utc)
    pool = await core.pool()
    async with pool.acquire() as con, con.transaction():
        row = await con.fetchrow(CYCLE, user["id"])
        if not row or row["status"] != "active" or row["current_day"] != day:
            return failure("day_locked", 409)
        grammar = await con.fetchrow("""SELECT source_key,completed_at
          FROM study_plan_30_tasks WHERE cycle_id=$1 AND day_number=$2
            AND kind='grammar' FOR UPDATE""", row["id"], day)
        if not grammar or not grammar["source_key"].startswith("skill-grammar:"):
            return failure("invalid_evidence", 409)
        if grammar["completed_at"]:
            return response(await _current(con, user["id"], now))
        result = _score_skill_stage(grammar["source_key"], answers)
        if result is None:
            return failure("invalid_evidence", 400)
        if not result["passed"]:
            return response({"state": "retry", "correct": result["correct"],
                             "total": result["total"]}, 422)
        await con.execute("""UPDATE study_plan_30_tasks SET completed_at=$3,proof=$4
            WHERE cycle_id=$1 AND day_number=$2 AND kind='grammar'
            AND completed_at IS NULL""",
            row["id"], day, now, {"source": "server_scored_skill_grammar",
                                   "correct": result["correct"], "total": result["total"]})
        return response(await _current(con, user["id"], now))


def install() -> None:
    core.app.include_router(router)
