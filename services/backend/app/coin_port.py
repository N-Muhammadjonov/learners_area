"""Coin policy, verified media heartbeats and grammar-book completion."""
from __future__ import annotations

from fastapi import APIRouter, Request

from . import main as core
from .coin_policy import public_policy
from .coin_rewards import award_grammar_book, media_heartbeat, wallet

router = APIRouter()
PRIVATE = {"Cache-Control": "private, no-store"}


@router.get("/api/coins/policy")
async def policy(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({"error": "unauthenticated"}, 401, PRIVATE)
    return core.j(public_policy(), headers=PRIVATE)


@router.get("/api/coins/wallet")
async def coin_wallet(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({"error": "unauthenticated"}, 401, PRIVATE)
    db = await core.pool()
    async with db.acquire() as con:
        state = await wallet(con, user["id"])
    return core.j(state, headers=PRIVATE)


@router.post("/api/coins/media/heartbeat")
async def heartbeat(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({"error": "unauthenticated"}, 401, PRIVATE)
    body = await core.payload(req)
    if not isinstance(body, dict):
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    module = body.get("module")
    media_id = body.get("mediaId")
    position = body.get("positionMs")
    rate = body.get("playbackRate", 1)
    playing = body.get("playing")
    duration = body.get("durationMs")
    session = body.get("sessionId")
    if module not in ("ted", "podcast", "speaking") or not isinstance(media_id, str) or not media_id.strip():
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if type(position) is not int or position < 0 or position > 24 * 60 * 60 * 1000:
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if type(playing) is not bool or type(rate) not in (int, float) or isinstance(rate, bool):
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if duration is not None and (type(duration) is not int or duration < 0 or duration > 24 * 60 * 60 * 1000):
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if session is not None and core.uuid_value(session) is None:
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    db = await core.pool()
    async with db.acquire() as con:
        result = await media_heartbeat(
            con, user["id"], session_id=core.uuid_value(session) if session else None,
            media_id=media_id.strip(), module=module, position_ms=position,
            playback_rate=float(rate), playing=playing, duration_ms=duration)
    if result.get("error"):
        return core.j(result, 400, PRIVATE)
    return core.j(result, headers=PRIVATE)


@router.post("/api/coins/grammar-book/complete")
async def grammar_book(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return core.j({"error": "unauthenticated"}, 401, PRIVATE)
    body = await core.payload(req)
    if not isinstance(body, dict):
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    level = body.get("level")
    unit_id = body.get("unitId")
    stage = body.get("stage")
    exercise = body.get("exercise")
    answers = body.get("answers")
    if level not in ("b1", "b2", "c1", "c2") or not isinstance(unit_id, str) or len(unit_id) > 40:
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if type(stage) is not int or type(exercise) is not int or stage < 0 or exercise < 0 or stage > 6 or exercise > 40:
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    if not isinstance(answers, list) or len(answers) > 80 or any(not isinstance(item, str) or len(item) > 4000 for item in answers):
        return core.j({"error": "invalid_input"}, 400, PRIVATE)
    db = await core.pool()
    async with db.acquire() as con:
        result = await award_grammar_book(con, user["id"], level=level, unit_id=unit_id,
                                          stage=stage, exercise=exercise, answers=answers)
    status = 404 if result.get("error") == "not_found" else 200
    return core.j(result, status, PRIVATE)


def install():
    core.app.include_router(router)
