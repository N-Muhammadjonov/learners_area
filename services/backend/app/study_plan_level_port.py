"""Authenticated level-check and voluntary profile level selection for 30-day plans."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import main as core
from .study_plan_level import (
    LEVELS, PASS_SCORE, interpretation, new_attempt, public_questions,
    read_bank, score_attempt,
)
from .study_plan_port import body_object, failure, response, student
from .study_plan_thirty import normalize_level

router = APIRouter(prefix="/api/study-plan/monthly/sequence/level")
WINDOW = timedelta(minutes=30)


def _public(row: dict, bank: dict) -> dict:
    return {
        "state": "quiz", "attemptId": row["attempt_id"],
        "level": row["selected_level"],
        "questions": public_questions(row["question_order"], bank),
        "total": 15,
    }


async def _save_level(con, user_id, level: str) -> None:
    await con.execute(
        """INSERT INTO onboarding_profiles(user_id,current_level)
           VALUES($1,$2)
           ON CONFLICT(user_id) DO UPDATE SET current_level=EXCLUDED.current_level""",
        user_id, level)


@router.get("")
async def read_level_check(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    db = await core.pool()
    now = datetime.now(timezone.utc)
    async with db.acquire() as con:
        level = normalize_level(await con.fetchval(
            "SELECT current_level FROM onboarding_profiles WHERE user_id=$1", user["id"]))
        row = await con.fetchrow(
            "SELECT * FROM study_plan_30_level_checks WHERE user_id=$1", user["id"])
        if row and not row["submitted_at"] and row["started_at"] + WINDOW > now:
            return response(_public(dict(row), read_bank()))
        return response({
            "state": "select", "levels": list(LEVELS),
            "currentLevel": level,
            "total": 15, "skills": 5, "estimatedMinutes": 15,
        })


@router.post("/start")
async def start_level_check(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    data = await body_object(req, {"level"})
    if data is None or set(data) != {"level"} or data["level"] not in LEVELS:
        return failure("invalid_level", 400)
    selected = data["level"]
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        bank = read_bank()
        rows = new_attempt(selected, bank)
        row = await con.fetchrow(
            """INSERT INTO study_plan_30_level_checks
                 (user_id, selected_level, question_order)
               VALUES($1,$2,$3)
               ON CONFLICT(user_id) DO UPDATE SET
                 attempt_id=gen_random_uuid(),selected_level=EXCLUDED.selected_level,
                 question_order=EXCLUDED.question_order,started_at=now(),
                 submitted_at=NULL,correct=NULL,approved_level=NULL
               RETURNING *""",
            user["id"], selected, rows)
        return response(_public(dict(row), bank), 201)


@router.post("/submit")
async def submit_level_check(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    data = await body_object(req, {"attemptId", "answers"})
    if data is None or set(data) != {"attemptId", "answers"}:
        return failure("invalid_answers", 400)
    db = await core.pool()
    now = datetime.now(timezone.utc)
    async with db.acquire() as con, con.transaction():
        row = await con.fetchrow(
            "SELECT * FROM study_plan_30_level_checks WHERE user_id=$1 FOR UPDATE", user["id"])
        if (row is None or str(row["attempt_id"]) != data["attemptId"] or
                row["submitted_at"] is not None or row["started_at"] + WINDOW <= now):
            return failure("assessment_expired", 409)
        bank = read_bank()
        grade = score_attempt(row["question_order"], data["answers"], bank)
        if grade is None:
            return failure("invalid_answers", 400)
        level = row["selected_level"]
        approved = level if grade["passed"] else None
        await con.execute(
            """UPDATE study_plan_30_level_checks
               SET submitted_at=$2,correct=$3,approved_level=$4
               WHERE user_id=$1""",
            user["id"], now, grade["correct"], approved)
        if approved is not None:
            await _save_level(con, user["id"], approved)
        details = interpretation(level, grade["correct"])
        return response({
            "state": "result", "level": level, "correct": grade["correct"],
            "total": grade["total"], "passed": grade["passed"],
            "savedLevel": approved, "label": details["label"],
            "suggestedLevel": details["suggestedLevel"],
            "nextLevel": details["nextLevel"],
            "skills": grade["skills"], "review": grade["review"],
            "qualification": "study_guidance_not_cefr_certificate",
        })


@router.post("/manual")
async def set_profile_level(req: Request) -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    data = await body_object(req, {"level"})
    if data is None or set(data) != {"level"} or data["level"] not in LEVELS:
        return failure("invalid_level", 400)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        await _save_level(con, user["id"], data["level"])
    return response({"state": "saved", "level": data["level"], "source": "self_reported"})


def install() -> None:
    core.app.include_router(router)
