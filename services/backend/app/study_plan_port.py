"""Student-only study planning, progress, virtual rewards and sharing API."""
from __future__ import annotations

import hashlib
import re
import secrets
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse

from . import main as core
from .coin_policy import public_policy
from .coin_rewards import wallet as coin_wallet
from .study_plan_rules import SKILLS, band_value
from .browser_coach import coach
from .study_plan_evidence import assessed_history, reading_weaknesses, vocabulary
from .study_plan_store import PREFERENCES, current_plan, goal_payload

router = APIRouter(prefix="/api/study-plan")
PRIVATE = {**core.PRIVATE, "X-Robots-Tag": "noindex, nofollow"}
MARKET = {
    "blue-frame": {"cost": 20, "kind": "frame", "label": "Blue frame", "labelUz": "Ko‘k ramka"},
    "violet-theme": {"cost": 35, "kind": "theme", "label": "Violet theme", "labelUz": "Binafsha mavzu"},
    "focus-badge": {"cost": 50, "kind": "badge", "label": "Focus badge", "labelUz": "Diqqat nishoni"},
}
PERIODS = ("week", "month", "all")


def response(data: dict, status: int = 200) -> JSONResponse:
    return core.j(jsonable_encoder(data), status, PRIVATE)


def failure(code: str, status: int) -> JSONResponse:
    return response({"error": code}, status)


async def student(req: Request) -> tuple[dict | None, JSONResponse | None]:
    user = await core.current_user(req, active=True)
    if not user:
        return None, failure("unauthenticated", 401)
    if user["role"] != "student":
        return None, failure("forbidden", 403)
    return user, None


async def plan_participant(req: Request) -> tuple[dict | None, JSONResponse | None]:
    """Allow the account owner to exercise the learner plan without widening staff APIs."""
    user = await core.current_user(req, active=True)
    if not user:
        return None, failure("unauthenticated", 401)
    if user["role"] not in ("student", "owner"):
        return None, failure("forbidden", 403)
    return user, None


async def body_object(req: Request, allowed: set[str]) -> dict | None:
    if not req.headers.get("content-type", "").startswith("application/json"):
        return None
    body = bytearray()
    async for chunk in req.stream():
        if len(body) + len(chunk) > 4096:
            return None
        body.extend(chunk)
    import json
    try:
        value = json.loads(body)
    except (ValueError, UnicodeDecodeError):
        return None
    return value if isinstance(value, dict) and value.keys() <= allowed else None


def goal_inputs(data: dict | None, now: datetime) -> tuple | None:
    if data is None or not band_value(data.get("target")):
        return None
    minutes = data.get("minutes")
    days = data.get("weekdays")
    focus = data.get("focusSkills", [])
    targets = data.get("skillTargets", {})
    zone = data.get("timezone")
    if (type(minutes) is not int or not 10 <= minutes <= 300
        or not isinstance(days, list) or not 1 <= len(days) <= 7
        or any(type(day) is not int or not 0 <= day <= 6 for day in days) or len(set(days)) != len(days)
        or not isinstance(focus, list) or len(focus) > 4 or any(skill not in SKILLS for skill in focus)
        or len(set(focus)) != len(focus) or not isinstance(targets, dict)
        or any(skill not in SKILLS or not band_value(value) for skill,value in targets.items())
        or not isinstance(zone, str) or not 1 <= len(zone) <= 64):
        return None
    try:
        local = ZoneInfo(zone)
        exam = data.get("examDate")
        exam_date = date.fromisoformat(exam) if exam else None
        if exam_date and exam_date < now.astimezone(local).date():
            return None
        clock = data.get("preferredTime")
        if clock is not None and (not isinstance(clock, str) or not re.fullmatch(r"\d{2}:\d{2}", clock)):
            return None
        preferred = time.fromisoformat(clock) if clock else None
    except (ValueError, TypeError, ZoneInfoNotFoundError):
        return None
    return (float(data["target"]),minutes,datetime.combine(exam_date,time.min,timezone.utc) if exam_date else None,
            sorted(days),zone,preferred,focus,targets)


@router.get("")
async def read_plan(req: Request, view: str = "week") -> JSONResponse:
    user, error = await student(req)
    if error is not None:
        return error
    if view not in ("today","week","progress"):
        return failure("invalid_view", 400)
    db = await core.pool()
    now = datetime.now(timezone.utc)
    async with db.acquire() as con, con.transaction():
        if view == "progress":
            uid = user["id"]
            row = await con.fetchrow(PREFERENCES,uid)
            initial = row or await con.fetchrow("SELECT * FROM onboarding_profiles WHERE user_id=$1",uid)
            goals = goal_payload(dict(initial or {}),bool(row))
            zone = ZoneInfo(goals["timezone"])
            latest,history = await assessed_history(con,uid,now,zone,180)
            weaknesses = await reading_weaknesses(con,uid,now)
            weaknesses.extend((await coach(con,uid))["weaknesses"])
            return response({"goals":goals,"today":now.astimezone(zone).date(),"latest":latest,"history":history,
                             "weaknesses":weaknesses,"vocabulary":await vocabulary(con,uid,now,zone)})
        return response(await current_plan(con,user,now,mode=view))


@router.put("/preferences")
async def save_preferences(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    now = datetime.now(timezone.utc)
    parsed = goal_inputs(await body_object(req,{"target","minutes","examDate","weekdays","timezone",
                                               "preferredTime","focusSkills","skillTargets"}),now)
    if parsed is None:
        return failure("invalid_preferences",400)
    uid = user["id"]
    target,minutes,exam,days,zone,clock,focus,targets = parsed
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        await con.execute("""INSERT INTO onboarding_profiles(user_id,target_band,daily_study_minutes,exam_date)
          VALUES($1,$2,$3,$4) ON CONFLICT(user_id) DO UPDATE
          SET target_band=EXCLUDED.target_band,daily_study_minutes=EXCLUDED.daily_study_minutes,exam_date=EXCLUDED.exam_date""",
          uid,target,minutes,exam)
        await con.execute("""INSERT INTO study_plan_preferences(user_id,weekdays,timezone,preferred_time,focus_skills,skill_targets)
          VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET
          weekdays=EXCLUDED.weekdays,timezone=EXCLUDED.timezone,preferred_time=EXCLUDED.preferred_time,
          focus_skills=EXCLUDED.focus_skills,skill_targets=EXCLUDED.skill_targets,updated_at=now()""",
          uid,days,zone,clock,focus,targets)
        data = await current_plan(con,user,now,reason="preferences")
    return response(data)


@router.put("/reschedule")
async def reschedule(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    data = await body_object(req,{"key","date"})
    try:
        key = data["key"]
        day = date.fromisoformat(data["date"])
        if not isinstance(key,str) or not 1 <= len(key) <= 100:
            return failure("invalid_reschedule",400)
    except (KeyError,TypeError,ValueError):
        return failure("invalid_reschedule",400)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        result = await current_plan(con,user,datetime.now(timezone.utc),move=(key,day))
    if not result.get("goals",{}).get("configured"):
        return failure(result.get("error","invalid_reschedule"),409)
    return response(result)


async def reward_state(con, uid) -> dict:
    rows = await con.fetch("""SELECT item_key,points,purchased_at FROM study_reward_purchases
        WHERE user_id=$1 ORDER BY purchased_at DESC,item_key""",uid)
    earned = await con.fetchval("SELECT coalesce(sum(points),0)::int FROM study_reward_ledger WHERE user_id=$1",uid)
    ledger = await con.fetch("""SELECT split_part(event_key,':',1) kind,points,earned_at
        FROM study_reward_ledger WHERE user_id=$1 ORDER BY earned_at DESC,event_key LIMIT 30""",uid)
    return {"balance":earned-sum(row["points"] for row in rows), "totalEarned":earned,
            "purchases":[dict(row) for row in rows],"earning":[dict(row) for row in ledger],
            "items":[{"key":key,**value} for key,value in MARKET.items()],
            "coins":await coin_wallet(con, uid)}


@router.get("/rewards")
async def rewards(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        await current_plan(con,user,datetime.now(timezone.utc),mode="today")
        return response(await reward_state(con,user["id"]))


@router.put("/rewards/{item_key}")
async def redeem(req: Request,item_key: str) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    item = MARKET.get(item_key)
    if not item:
        return failure("not_found",404)
    uid = user["id"]
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        if not await con.fetchval("SELECT user_id FROM study_plan_preferences WHERE user_id=$1 FOR UPDATE",uid):
            return failure("configure_first",409)
        state = await reward_state(con,uid)
        if any(row["item_key"] == item_key for row in state["purchases"]):
            return response(state)
        if state["balance"] < item["cost"]:
            return failure("insufficient_points",409)
        await con.execute("INSERT INTO study_reward_purchases(user_id,item_key,points) VALUES($1,$2,$3)",uid,item_key,item["cost"])
        return response(await reward_state(con,uid))


RANKING = """
WITH participants AS (
  SELECT p.user_id,p.alias,coalesce(sum(l.points),0)::int points
  FROM study_leaderboard_participants p JOIN users u ON u.id=p.user_id
  LEFT JOIN study_reward_ledger l ON l.user_id=p.user_id AND l.earned_at >= $2
  WHERE u.role='student' AND u.account_status='active' AND (
      NOT $3 OR EXISTS(SELECT 1 FROM teacher_student_links mine JOIN teacher_student_links other
        ON other.teacher_user_id=mine.teacher_user_id WHERE mine.student_user_id=$1 AND other.student_user_id=p.user_id))
  GROUP BY p.user_id,p.alias
), ranked AS (
  SELECT *,row_number() OVER(ORDER BY points DESC,lower(alias),user_id)::int rank FROM participants
)
"""
COIN_RANKING = """
WITH participants AS (
  SELECT p.user_id,p.alias,coalesce(sum(l.points),0)::int points,
         coalesce((SELECT sum(c.coins)::int FROM coin_ledger c
                   WHERE c.user_id=p.user_id AND c.earned_at >= $2),0) coins,
         coalesce((SELECT sum(t.active_ms)::bigint FROM coin_practice_time t
                   WHERE t.user_id=p.user_id AND t.earned_at >= $2),0) practice_ms,
         EXISTS(SELECT 1 FROM subscriptions s WHERE s.user_id=p.user_id AND s.status='active'
                AND (s.current_period_end IS NULL OR s.current_period_end > now())) premium
  FROM study_leaderboard_participants p JOIN users u ON u.id=p.user_id
  LEFT JOIN study_reward_ledger l ON l.user_id=p.user_id AND l.earned_at >= $2
  WHERE u.role='student' AND u.account_status='active' AND (
      NOT $3 OR EXISTS(SELECT 1 FROM teacher_student_links mine JOIN teacher_student_links other
        ON other.teacher_user_id=mine.teacher_user_id WHERE mine.student_user_id=$1 AND other.student_user_id=p.user_id))
  GROUP BY p.user_id,p.alias
), ranked AS (
  SELECT *,row_number() OVER(ORDER BY coins DESC, points DESC, lower(alias), user_id)::int rank FROM participants
)
"""


@router.get("/leaderboard")
async def leaderboard(req: Request, period: str = "week", scope: str = "all", page: int = 1) -> JSONResponse:
    user = await core.current_user(req, active=True)
    if not user:
        return failure("unauthenticated", 401)
    if user["role"] not in ("student", "owner"):
        return failure("forbidden", 403)
    if user["role"] == "owner" and scope != "all":
        return failure("invalid_filter", 400)
    if period not in PERIODS or scope not in ("all","class") or not 1 <= page <= 500:
        return failure("invalid_filter",400)
    now = datetime.now(timezone.utc)
    zone = ZoneInfo("Asia/Tashkent")
    local = now.astimezone(zone).date()
    since = {"week":datetime.combine(local-timedelta(days=local.weekday()),time.min,zone),
             "month":now-timedelta(days=30),"all":datetime(2000,1,1,tzinfo=timezone.utc)}[period]
    uid = user["id"]
    db = await core.pool()
    async with db.acquire() as con:
        mine = await con.fetchval("SELECT alias FROM study_leaderboard_participants WHERE user_id=$1",uid)
        cohort = await con.fetchval("SELECT EXISTS(SELECT 1 FROM teacher_student_links WHERE student_user_id=$1)",uid)
        rich = True
        try:
            async with con.transaction():
                rows = await con.fetch(COIN_RANKING+"""SELECT alias,points,coins,practice_ms,premium,rank,user_id=$1 AS mine,
                   (SELECT rank FROM ranked WHERE user_id=$1) own_rank
                   FROM ranked WHERE rank BETWEEN $4 AND $5 ORDER BY rank""",
                   uid,since,scope=="class",(page-1)*25+1,page*25+1)
        except Exception:
            rich = False
            rows = await con.fetch(RANKING+"""SELECT alias,points,rank,user_id=$1 AS mine,
               (SELECT rank FROM ranked WHERE user_id=$1) own_rank
               FROM ranked WHERE rank BETWEEN $4 AND $5 ORDER BY rank""",
               uid,since,scope=="class",(page-1)*25+1,page*25+1)
        own = await con.fetchval((COIN_RANKING if rich else RANKING)+"SELECT rank FROM ranked WHERE user_id=$1",uid,since,scope=="class") if mine and not rows else rows[0]["own_rank"] if rows else None
        practising = []
        if rich:
            try:
                async with con.transaction():
                    live = await con.fetch("""SELECT p.alias FROM study_leaderboard_participants p
                        JOIN users u ON u.id=p.user_id
                        WHERE u.role='student' AND u.account_status='active'
                          AND u.last_meaningful_activity_at > now() - interval '3 minutes'
                        ORDER BY u.last_meaningful_activity_at DESC LIMIT 8""")
                    practising = [row["alias"] for row in live]
            except Exception:
                practising = []
    entries = [{key:row[key] for key in ("alias","points","rank","mine")} for row in rows[:25]]
    standings = [{
        "alias": row["alias"], "rank": row["rank"], "mine": row["mine"],
        "stars": row["points"], "coins": row["coins"] if rich else 0,
        "practiceMs": int(row["practice_ms"]) if rich else 0,
        "premium": bool(row["premium"]) if rich else False,
    } for row in rows[:20]]
    return response({"alias":mine,"classAvailable":cohort,"position":own,"hasMore":len(rows)>25,
                     "entries":entries,"standings":standings,"practising":practising,
                     "policy":public_policy()})


@router.put("/leaderboard/participation")
async def participation(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    data = await body_object(req,{"enabled"})
    if data is None or type(data.get("enabled")) is not bool:
        return failure("invalid_participation",400)
    uid = user["id"]
    db = await core.pool()
    async with db.acquire() as con:
        if not data["enabled"]:
            await con.execute("DELETE FROM study_leaderboard_participants WHERE user_id=$1",uid)
            return response({"alias":None})
        if not await con.fetchval("SELECT user_id FROM study_plan_preferences WHERE user_id=$1",uid):
            return failure("configure_first",409)
        alias = await con.fetchval("""INSERT INTO study_leaderboard_participants(user_id,alias) VALUES($1,$2)
          ON CONFLICT(user_id) DO UPDATE SET alias=study_leaderboard_participants.alias RETURNING alias""",
          uid,"Learner-"+secrets.token_hex(6))
        return response({"alias":alias})


def share_snapshot(plan: dict) -> dict:
    return {"days":[{"date":day["date"].isoformat(), "planned":len(day["tasks"]),
                     "completed":sum(task["status"]=="completed" for task in day["tasks"]),
                     "minutes":sum(task["minutes"] for task in day["tasks"])}
                    for day in plan["days"]]}


@router.get("/share")
async def list_shares(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch("""SELECT id,created_at,expires_at FROM study_plan_shares WHERE user_id=$1
           AND revoked_at IS NULL AND expires_at>now() ORDER BY created_at DESC LIMIT 10""",user["id"])
    return response({"links":[dict(row) for row in rows]})


@router.post("/share")
async def publish_share(req: Request) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    data = await body_object(req,{"consent"})
    if data is None or data.get("consent") is not True:
        return failure("consent_required",400)
    now = datetime.now(timezone.utc)
    db = await core.pool()
    async with db.acquire() as con, con.transaction():
        plan = await current_plan(con,user,now)
        if not plan["goals"]["configured"]:
            return failure("configure_first",409)
        count = await con.fetchval("""SELECT count(*) FROM study_plan_shares WHERE user_id=$1
          AND revoked_at IS NULL AND expires_at>now()""",user["id"])
        if count >= 10:
            return failure("share_limit",409)
        token = secrets.token_urlsafe(32)
        snapshot = share_snapshot(plan)
        row = await con.fetchrow("""INSERT INTO study_plan_shares(user_id,token_hash,snapshot,expires_at)
          VALUES($1,$2,$3,$4) RETURNING id,expires_at""",
          user["id"],hashlib.sha256(token.encode()).hexdigest(),snapshot,now+timedelta(days=7))
    return response({**dict(row),"url":"/study-plan/shared#"+token,"snapshot":snapshot},201)


@router.delete("/share/{share_id}")
async def revoke_share(req: Request,share_id: str) -> JSONResponse:
    user,error = await student(req)
    if error is not None:
        return error
    key = core.uuid_value(share_id)
    if key is None:
        return failure("not_found",404)
    db = await core.pool()
    async with db.acquire() as con:
        result = await con.fetchval("""UPDATE study_plan_shares SET revoked_at=coalesce(revoked_at,now())
           WHERE user_id=$1 AND id=$2 RETURNING id""",user["id"],key)
    return response({"ok":True}) if result else failure("not_found",404)


@router.post("/shared")
async def shared_plan(req: Request) -> JSONResponse:
    data = await body_object(req,{"token"})
    token = data and data.get("token")
    if not isinstance(token,str) or not re.fullmatch(r"[A-Za-z0-9_-]{43}",token):
        return failure("not_found",404)
    db = await core.pool()
    async with db.acquire() as con:
        snapshot = await con.fetchval("""SELECT s.snapshot FROM study_plan_shares s JOIN users u ON u.id=s.user_id
          WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now()
            AND u.role='student' AND u.account_status='active'""",hashlib.sha256(token.encode()).hexdigest())
    return response(snapshot) if snapshot else failure("not_found",404)
