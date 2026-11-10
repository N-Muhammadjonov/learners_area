"""Student-only assessment and 30-day study-plan endpoints."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from . import main as core
from .study_plan_diagnostic import FALLBACK_LISTENING, FORM_VERSION, diagnose, listening_section, public_form
from .study_plan_month import MONTH_DAYS, make_schedule, verified_practice, view_schedule
from .study_plan_port import body_object, failure, response, student
from .study_plan_store import PREFERENCES, goal_payload

router = APIRouter(prefix="/api/study-plan/monthly")
MONTH = "SELECT * FROM study_plan_months WHERE user_id=$1 FOR UPDATE"


def calendar(goal: dict, now: datetime):
    zone = ZoneInfo(goal["timezone"])
    return zone,now.astimezone(zone).date()


def is_active(row, today) -> bool:
    return bool(row and row["assessed_at"] and today < row["started_on"]+timedelta(days=MONTH_DAYS))


async def month_payload(con, row, goal: dict, now: datetime) -> dict:
    zone,today = calendar(goal,now)
    start = row["started_on"]
    schedule = row["schedule"]
    practiced = await verified_practice(con,row["user_id"],start,zone,now,row["assessed_at"])
    if today > row["revised_on"] and is_active(row,today):
        schedule = make_schedule(start,today,goal,row["diagnosis"],schedule,practiced)
        await con.execute("UPDATE study_plan_months SET schedule=$2,revised_on=$3 WHERE user_id=$1",
                          row["user_id"],schedule,today)
    return {"state":"active" if is_active(row,today) else "finished","today":today,
            "from":start,"through":start+timedelta(days=MONTH_DAYS-1),
            "diagnosis":row["diagnosis"],"days":view_schedule(schedule,practiced,today)}


@router.get("")
async def get_month(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    uid = user["id"]
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        prefs = await con.fetchrow(PREFERENCES,uid)
        if not prefs:
            return response({"state":"setup"})
        row = await con.fetchrow(MONTH,uid)
        if not row:
            return response({"state":"available"})
        if row["assessed_at"] is None:
            return response({"state":"assessment","form":public_form(row["attempt_id"],row["listening"])})
        return response(await month_payload(con,row,goal_payload(dict(prefs),True),now))


@router.post("/start")
async def start_assessment(req: Request, fallback: bool = False) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    uid = user["id"]
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        prefs = await con.fetchrow(PREFERENCES+" FOR UPDATE OF p",uid)
        if not prefs:
            return failure("configure_first",409)
        goal = goal_payload(dict(prefs),True)
        _,today = calendar(goal,now)
        row = await con.fetchrow(MONTH,uid)
        if is_active(row,today):
            return response(await month_payload(con,row,goal,now))
        if row and row["assessed_at"] is None and not (fallback and row["listening"].get("sourceId")):
            return response({"state":"assessment","form":public_form(row["attempt_id"],row["listening"])})
        listening = FALLBACK_LISTENING if fallback else await listening_section(con,user)
        attempt = await con.fetchval("""INSERT INTO study_plan_months(user_id,listening,started_at)
            VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET attempt_id=gen_random_uuid(),
            listening=EXCLUDED.listening,started_at=EXCLUDED.started_at,assessed_at=NULL,started_on=NULL,
            revised_on=NULL,diagnosis=NULL,schedule=NULL RETURNING attempt_id""",uid,listening,now)
        return response({"state":"assessment","form":public_form(attempt,listening)})


@router.post("/assessment")
async def submit_assessment(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    body = await body_object(req,{"id","version","answers","sample"})
    attempt = core.uuid_value(body.get("id")) if body and isinstance(body.get("id"),str) else None
    if attempt is None or body.get("version") != FORM_VERSION:
        return failure("invalid_assessment",400)
    uid = user["id"]
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        prefs = await con.fetchrow(PREFERENCES+" FOR UPDATE OF p",uid)
        if not prefs:
            return failure("configure_first",409)
        row = await con.fetchrow(MONTH,uid)
        if not row or row["attempt_id"] != attempt:
            return failure("assessment_not_found",404)
        goal = goal_payload(dict(prefs),True)
        if row["assessed_at"]:
            return response(await month_payload(con,row,goal,now))
        result = diagnose(row["listening"],body.get("answers"),body.get("sample"))
        if result is None:
            return failure("invalid_assessment",400)
        _,today = calendar(goal,now)
        schedule = make_schedule(today,today,goal,result,[],{})
        await con.execute("""UPDATE study_plan_months SET assessed_at=$2,started_on=$3,revised_on=$3,
            diagnosis=$4,schedule=$5 WHERE user_id=$1""",uid,now,today,result,schedule)
        return response({"state":"active","today":today,"from":today,
                         "through":today+timedelta(days=MONTH_DAYS-1),"diagnosis":result,
                         "days":view_schedule(schedule,{},today)})
