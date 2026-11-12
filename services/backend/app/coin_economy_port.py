"""Account-scoped daily coins, verified bot referrals and virtual gift redemptions.

All reward decisions use server time, authenticated users and database locks.
No client-supplied balance, activity count, streak or reward amount is accepted.
"""
from __future__ import annotations

import base64
import binascii
import json
import logging
import os
import re
import secrets
from datetime import date, timedelta
from uuid import UUID

from fastapi import APIRouter, Request

from . import main as core
from .coin_rewards import award_coin, wallet
from .internal_bot_ready_port import verify_bot

router = APIRouter()
PRIVATE = {"Cache-Control": "private, no-store"}
log = logging.getLogger(__name__)
BOT_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
REFERRAL_CODE = re.compile(r"^[A-Za-z0-9_-]{24}$")
TG_ID = re.compile(r"^[0-9]{4,20}$")
GIFT_KEY = re.compile(r"^[a-z0-9][a-z0-9-]{2,63}$")
CATEGORIES = {"badge", "frame", "theme", "study_tool"}
PARTICIPANT_ROLES = ("student", "teacher", "admin", "owner")
MAX_ARTWORK_BYTES = 160000


def error(code: str, status: int = 400):
    return core.j({"error": code}, status, PRIVATE)


async def participant(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return None, error("unauthenticated", 401)
    if user["role"] not in PARTICIPANT_ROLES:
        return None, error("forbidden", 403)
    return user, None


async def active_owner(req: Request):
    user = await core.current_user(req, active=True)
    if not user:
        return None, error("unauthenticated", 401)
    if user["role"] != "owner":
        return None, error("forbidden", 403)
    return user, None


def gift_view(row: dict) -> dict:
    return {
        "id": str(row["id"]),
        "key": row["item_key"],
        "titleUz": row["title_uz"],
        "titleEn": row["title_en"],
        "descriptionUz": row["description_uz"],
        "descriptionEn": row["description_en"],
        "category": row["category"],
        "coins": row["cost_coins"],
        "stock": row["stock_remaining"],
        "active": row["is_active"],
        "imageData": row["image_data"],
    }


async def daily_status(con, user_id) -> dict:
    today = await con.fetchval("SELECT (clock_timestamp() AT TIME ZONE 'Asia/Tashkent')::date")
    prior = await con.fetchrow(
        "SELECT claim_date,streak_day,coins FROM coin_daily_claims WHERE user_id=$1 "
        "ORDER BY claim_date DESC LIMIT 1", user_id)
    claimed = bool(prior and prior["claim_date"] == today)
    consecutive = bool(prior and prior["claim_date"] == today - timedelta(days=1))
    streak = int(prior["streak_day"]) if claimed else (
        int(prior["streak_day"]) if consecutive else 0)
    next_reward = 0 if claimed else ((streak % 7) + 1)
    return {
        "date": today.isoformat(),
        "claimed": claimed,
        "streak": streak,
        "todayCoins": int(prior["coins"]) if claimed else 0,
        "nextCoins": next_reward,
        "cycle": 7,
    }


async def claim_daily(con, user_id) -> dict:
    async with con.transaction():
        # Serialize daily and purchase operations for a single learner.
        row = await con.fetchrow(
            "SELECT id FROM users WHERE id=$1 AND role=ANY($2::text[]) AND account_status='active' FOR UPDATE",
            user_id, list(PARTICIPANT_ROLES))
        if not row:
            raise ValueError("inactive_participant")
        state = await daily_status(con, user_id)
        if state["claimed"]:
            return {**state, "awarded": 0}
        day = state["nextCoins"]
        today = date.fromisoformat(state["date"])
        awarded = await award_coin(
            con, user_id, f"daily:{today.isoformat()}",
            module="daily", activity_type="login",
            coins=day, exercise_id=today.isoformat(), evidence_id=today.isoformat())
        if not awarded:
            raise RuntimeError("daily_ledger_unavailable")
        await con.execute(
            """INSERT INTO coin_daily_claims(user_id,claim_date,streak_day,coins)
               VALUES($1,$2::date,$3,$3)""", user_id, today, day)
        return {**await daily_status(con, user_id), "awarded": day}


async def finalize_referral(con, new_student: dict) -> bool:
    """One paid, genuinely new Telegram identity; never on relinks or self-invites."""
    # Authenticated user snapshots deliberately omit telegram_id. Always obtain
    # the identity from the owned server row, not from a client or cookie claim.
    if not new_student.get("id"):
        return False
    async with con.transaction():
        current = await con.fetchrow(
            "SELECT id,telegram_id FROM users WHERE id=$1 AND role='student' "
            "AND account_status='active'", new_student["id"])
        telegram_id = current["telegram_id"] if current else None
        if not isinstance(telegram_id, str) or not TG_ID.fullmatch(telegram_id):
            return False
        row = await con.fetchrow(
            "SELECT inviter_id,invitee_telegram_id,invited_at FROM coin_referrals "
            "WHERE invitee_telegram_id=$1 AND awarded_at IS NULL FOR UPDATE", telegram_id)
        if not row:
            return False
        # No older account or link receives a referral bonus.
        inviter = await con.fetchrow(
            "SELECT id,telegram_id,role,account_status FROM users WHERE id=$1",
            row["inviter_id"])
        invitee = await con.fetchrow(
            "SELECT id,telegram_id,role,account_status,created_at FROM users WHERE id=$1",
            new_student["id"])
        if (not inviter or not invitee or inviter["id"] == invitee["id"]
                or inviter["telegram_id"] == telegram_id
                or inviter["role"] not in PARTICIPANT_ROLES or inviter["account_status"] != "active"
                or invitee["role"] != "student" or invitee["account_status"] != "active"
                or invitee["telegram_id"] != telegram_id
                or invitee["created_at"] < row["invited_at"]):
            return False
        awarded = await award_coin(
            con, inviter["id"], f"referral:{invitee['id']}",
            module="referral", activity_type="verified_friend", coins=10,
            parent_content_id=str(invitee["id"]), evidence_id=str(invitee["id"]))
        if not awarded:
            raise RuntimeError("referral_ledger_unavailable")
        await con.execute(
            "UPDATE coin_referrals SET invitee_user_id=$2,awarded_at=now() "
            "WHERE invitee_telegram_id=$1 AND awarded_at IS NULL",
            telegram_id, invitee["id"])
        return True


@router.get("/api/coins/daily")
async def daily_read(req: Request):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        return core.j(await daily_status(con, user["id"]), headers=PRIVATE)


@router.post("/api/coins/daily/claim")
async def daily_claim(req: Request):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        try:
            result = await claim_daily(con, user["id"])
        except Exception:
            log.exception("coin daily claim failed")
            return error("temporarily_unavailable", 503)
        try:
            # Referral payout is independent: failure must never erase today's claim.
            await finalize_referral(con, user)
        except Exception:
            log.exception("coin referral finalization failed")
        result["wallet"] = await wallet(con, user["id"])
        return core.j(result, headers=PRIVATE)


async def referral_data(user_id) -> dict:
    bot = os.getenv("TELEGRAM_BOT_USERNAME", "").strip().lstrip("@")
    if not BOT_NAME.fullmatch(bot):
        raise ValueError("referral_bot_not_configured")
    db = await core.pool()
    async with db.acquire() as con:
        async with con.transaction():
            code = await con.fetchval(
                "SELECT code FROM coin_referral_codes WHERE user_id=$1", user_id)
            if not code:
                candidate = secrets.token_urlsafe(18)
                await con.execute(
                    "INSERT INTO coin_referral_codes(user_id,code) VALUES($1,$2) "
                    "ON CONFLICT(user_id) DO NOTHING", user_id, candidate)
                code = await con.fetchval(
                    "SELECT code FROM coin_referral_codes WHERE user_id=$1", user_id)
            count = await con.fetchval(
                "SELECT count(*)::int FROM coin_referrals WHERE inviter_id=$1 "
                "AND awarded_at IS NOT NULL", user_id)
    return {
        "url": f"https://t.me/{bot}?start=r_{code}",
        "count": count,
        "coinsPerFriend": 10,
    }


@router.post("/api/coins/referral-link")
async def referral_link(req: Request):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    try:
        return core.j(await referral_data(user["id"]), headers=PRIVATE)
    except ValueError:
        return error("referral_bot_not_configured", 503)
    except Exception:
        log.exception("coin referral link failed")
        return error("temporarily_unavailable", 503)


@router.get("/api/internal/telegram/coins/referral-link")
async def bot_referral_link(req: Request):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    telegram_id = req.query_params.get("telegramUserId") or ""
    if not TG_ID.fullmatch(telegram_id):
        return error("invalid_actor")
    db = await core.pool()
    async with db.acquire() as con:
        user = await con.fetchrow(
            "SELECT id FROM users WHERE telegram_id=$1 AND role=ANY($2::text[]) "
            "AND account_status='active'", telegram_id, list(PARTICIPANT_ROLES))
    if not user:
        return error("forbidden", 403)
    try:
        return core.j(await referral_data(user["id"]), headers=PRIVATE)
    except ValueError:
        return error("referral_bot_not_configured", 503)
    except Exception:
        log.exception("bot coin referral link failed")
        return error("temporarily_unavailable", 503)


@router.post("/api/internal/telegram/coins/referral")
async def record_referral(req: Request):
    denied = verify_bot(req)
    if denied is not None:
        return denied
    body = await core.payload(req)
    code = body.get("code") if isinstance(body, dict) else None
    tg = body.get("telegramUserId") if isinstance(body, dict) else None
    if not isinstance(code, str) or not REFERRAL_CODE.fullmatch(code):
        return error("invalid_code")
    if not isinstance(tg, str) or not TG_ID.fullmatch(tg):
        return error("invalid_actor")
    db = await core.pool()
    async with db.acquire() as con:
        try:
            async with con.transaction():
                inviter = await con.fetchrow(
                    """SELECT u.id,u.telegram_id FROM coin_referral_codes c
                       JOIN users u ON u.id=c.user_id
                       WHERE c.code=$1 AND u.role IN ('student','teacher','admin','owner') AND u.account_status='active'""",
                    code)
                if not inviter:
                    return error("invalid_code", 404)
                if inviter["telegram_id"] == tg:
                    return error("self_referral", 409)
                # Referrals are first-time contacts. An existing website user,
                # existing linked contact, or previously claimed Telegram ID
                # cannot be invited again to earn coins.
                existing = await con.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM users WHERE telegram_id=$1) "
                    "OR EXISTS(SELECT 1 FROM telegram_contacts "
                    "WHERE telegram_user_id=$1 AND linked_user_id IS NOT NULL)",
                    tg)
                if existing:
                    return error("already_registered", 409)
                created = await con.fetchval(
                    "INSERT INTO coin_referrals(invitee_telegram_id,inviter_id) "
                    "VALUES($1,$2) ON CONFLICT(invitee_telegram_id) DO NOTHING "
                    "RETURNING invitee_telegram_id", tg, inviter["id"])
                if not created:
                    return error("already_invited", 409)
        except Exception:
            log.exception("coin referral registration failed")
            return error("temporarily_unavailable", 503)
    return core.j({"ok": True, "pending": True}, headers=PRIVATE)


@router.get("/api/coins/gifts")
async def gifts(req: Request):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch(
            "SELECT * FROM coin_gifts WHERE is_active=true ORDER BY category,item_key")
        return core.j({"gifts": [gift_view(row) for row in rows]}, headers=PRIVATE)


@router.get("/api/coins/purchases")
async def purchases(req: Request):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch(
            "SELECT id,gift_id,title_uz,title_en,cost_coins,purchased_at,status "
            "FROM coin_gift_purchases WHERE user_id=$1 "
            "ORDER BY purchased_at DESC LIMIT 100", user["id"])
        return core.j({"purchases": [{
            "id": str(row["id"]), "giftId": str(row["gift_id"]),
            "titleUz": row["title_uz"], "titleEn": row["title_en"],
            "coins": row["cost_coins"], "status": row["status"],
            "purchasedAt": row["purchased_at"].isoformat()
        } for row in rows]}, headers=PRIVATE)


@router.post("/api/coins/gifts/{gift_id}/purchase")
async def purchase_gift(req: Request, gift_id: str):
    user, failure = await participant(req)
    if failure is not None:
        return failure
    parsed = core.uuid_value(gift_id)
    body = await core.payload(req)
    request_id = core.uuid_value(body.get("requestId")) if isinstance(body, dict) else None
    if parsed is None or request_id is None:
        return error("invalid_input")
    from .notification_events import create_notification
    db = await core.pool()
    async with db.acquire() as con:
        try:
            async with con.transaction():
                await con.fetchrow(
                    "SELECT id FROM users WHERE id=$1 AND account_status='active' FOR UPDATE",
                    user["id"])
                existing = await con.fetchrow(
                    "SELECT id,status FROM coin_gift_purchases WHERE user_id=$1 AND request_id=$2",
                    user["id"], request_id)
                if existing:
                    return core.j({"ok": True, "alreadyPurchased": True,
                                   "status": existing["status"],
                                   "wallet": await wallet(con, user["id"])}, headers=PRIVATE)
                gift = await con.fetchrow(
                    "SELECT * FROM coin_gifts WHERE id=$1 AND is_active=true FOR UPDATE", parsed)
                if not gift:
                    return error("not_found", 404)
                owned = await con.fetchval(
                    "SELECT EXISTS(SELECT 1 FROM coin_gift_purchases "
                    "WHERE user_id=$1 AND gift_id=$2 AND status IN ('pending','fulfilled'))",
                    user["id"], parsed)
                if owned:
                    return error("already_owned", 409)
                if gift["stock_remaining"] is not None and gift["stock_remaining"] < 1:
                    return error("out_of_stock", 409)
                balance = await wallet(con, user["id"])
                if balance["balance"] < gift["cost_coins"]:
                    return error("insufficient_coins", 409)
                await con.execute(
                    "INSERT INTO coin_spend(user_id,spend_key,coins) VALUES($1,$2,$3)",
                    user["id"], f"gift:{request_id}", gift["cost_coins"])
                receipt = await con.fetchrow(
                    """INSERT INTO coin_gift_purchases
                       (user_id,gift_id,request_id,title_uz,title_en,cost_coins,status)
                       VALUES($1,$2,$3,$4,$5,$6,'pending') RETURNING id""",
                    user["id"], gift["id"], request_id,
                    gift["title_uz"], gift["title_en"], gift["cost_coins"])
                if gift["stock_remaining"] is not None:
                    await con.execute(
                        "UPDATE coin_gifts SET stock_remaining=stock_remaining-1,"
                        "updated_at=now() WHERE id=$1", gift["id"])
                buyer = await con.fetchval("SELECT name FROM users WHERE id=$1", user["id"])
                owners = await con.fetch(
                    "SELECT id FROM users WHERE role='owner' AND account_status='active'")
                for owner in owners:
                    await create_notification(
                        con, user_id=owner["id"], event_id=f"coin-gift:{receipt['id']}",
                        notification_type="COIN_GIFT_PURCHASE",
                        title="New gift purchase receipt",
                        body=f"{str(buyer or 'User')[:100]} purchased {gift['title_uz'][:100]} for {gift['cost_coins']} coins.",
                        href="/app/leaderboard?view=manage",
                        payload={"purchaseId": str(receipt["id"]), "buyerId": str(user["id"]),
                                 "giftId": str(gift["id"]), "coins": gift["cost_coins"]})
                return core.j({"ok": True, "status": "pending",
                               "receiptId": str(receipt["id"]),
                               "wallet": await wallet(con, user["id"])}, headers=PRIVATE)
        except Exception:
            log.exception("coin gift purchase failed")
            return error("temporarily_unavailable", 503)


@router.get("/api/coins/admin/purchases")
async def owner_purchases(req: Request):
    owner, failure = await active_owner(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch(
            """SELECT p.id,p.user_id,p.gift_id,p.title_uz,p.title_en,p.cost_coins,
                      p.purchased_at,p.status,p.resolved_at,
                      coalesce(nullif(btrim(u.name),''),'User') buyer_name,
                      u.telegram_id,
                      (SELECT t.username FROM telegram_contacts t
                       WHERE t.linked_user_id=u.id AND t.telegram_user_id=u.telegram_id
                         AND t.removed_at IS NULL ORDER BY t.last_seen_at DESC LIMIT 1) telegram_username
               FROM coin_gift_purchases p
               JOIN users u ON u.id=p.user_id
               ORDER BY (p.status='pending') DESC,p.purchased_at DESC LIMIT 200""")
    return core.j({"purchases": [{
        "id": str(row["id"]), "userId": str(row["user_id"]), "giftId": str(row["gift_id"]),
        "buyerName": row["buyer_name"],
        "telegramUrl": (
            f"https://t.me/{row['telegram_username'].lstrip('@')}"
            if isinstance(row["telegram_username"], str) and
               BOT_NAME.fullmatch(row["telegram_username"].lstrip('@'))
            else f"tg://user?id={row['telegram_id']}"
            if isinstance(row["telegram_id"], str) and TG_ID.fullmatch(row["telegram_id"])
            else None
        ),
        "titleUz": row["title_uz"], "titleEn": row["title_en"],
        "coins": row["cost_coins"], "status": row["status"],
        "purchasedAt": row["purchased_at"].isoformat(),
        "resolvedAt": row["resolved_at"].isoformat() if row["resolved_at"] else None,
    } for row in rows]}, headers=PRIVATE)


@router.patch("/api/coins/admin/purchases/{purchase_id}")
async def resolve_purchase(req: Request, purchase_id: str):
    owner, failure = await active_owner(req)
    if failure is not None:
        return failure
    purchase_uuid = core.uuid_value(purchase_id)
    body = await core.payload(req)
    status = body.get("status") if isinstance(body, dict) else None
    if purchase_uuid is None or status not in ("fulfilled", "rejected"):
        return error("invalid_input")
    from .notification_events import create_notification
    db = await core.pool()
    async with db.acquire() as con:
        try:
            async with con.transaction():
                target = await con.fetchrow(
                    "SELECT user_id FROM coin_gift_purchases WHERE id=$1", purchase_uuid)
                if not target:
                    return error("not_found", 404)
                # Use the same lock order as purchasing: user, purchase, then gift.
                await con.fetchrow("SELECT id FROM users WHERE id=$1 FOR UPDATE", target["user_id"])
                purchase = await con.fetchrow(
                    "SELECT * FROM coin_gift_purchases WHERE id=$1 FOR UPDATE", purchase_uuid)
                if purchase["status"] == status:
                    return core.j({"ok": True, "status": status, "alreadyResolved": True}, headers=PRIVATE)
                if purchase["status"] != "pending":
                    return error("already_resolved", 409)
                if status == "rejected":
                    await con.execute(
                        """INSERT INTO coin_gift_refunds(purchase_id,user_id,coins)
                           VALUES($1,$2,$3) ON CONFLICT(purchase_id) DO NOTHING""",
                        purchase_uuid, purchase["user_id"], purchase["cost_coins"])
                    await con.execute(
                        """UPDATE coin_gifts SET stock_remaining=stock_remaining+1,
                           updated_at=now() WHERE id=$1 AND stock_remaining IS NOT NULL""",
                        purchase["gift_id"])
                await con.execute(
                    """UPDATE coin_gift_purchases SET status=$2,resolved_at=now(),
                       resolved_by=$3 WHERE id=$1""", purchase_uuid, status, owner["id"])
                await create_notification(
                    con, user_id=purchase["user_id"],
                    event_id=f"coin-gift:{purchase_uuid}:{status}",
                    notification_type="COIN_GIFT_RESOLVED",
                    title="Gift purchase update",
                    body=("Your gift purchase has been approved." if status == "fulfilled"
                          else "Your gift order was rejected and the coins were refunded."),
                    href="/app/leaderboard",
                    payload={"purchaseId": str(purchase_uuid), "status": status,
                             "coins": purchase["cost_coins"]})
                return core.j({"ok": True, "status": status}, headers=PRIVATE)
        except Exception:
            log.exception("coin gift fulfillment failed")
            return error("temporarily_unavailable", 503)


def valid_image_data(value: str | None) -> bool:
    if value is None:
        return True
    if not isinstance(value, str) or len(value) > 230000:
        return False
    prefix, sep, data = value.partition(";base64,")
    if not sep or prefix not in ("data:image/jpeg", "data:image/png", "data:image/webp"):
        return False
    try:
        image = base64.b64decode(data, validate=True)
    except (ValueError, binascii.Error):
        return False
    if not 0 < len(image) <= MAX_ARTWORK_BYTES:
        return False
    return ((prefix == "data:image/png" and image.startswith(bytes.fromhex("89504e470d0a1a0a")))
            or (prefix == "data:image/jpeg" and image.startswith(bytes.fromhex("ffd8ff")))
            or (prefix == "data:image/webp" and image.startswith(b"RIFF")
                and image[8:12] == b"WEBP"))


async def gift_payload(req: Request) -> dict | None:
    if not req.headers.get("content-type", "").startswith("application/json"):
        return None
    payload = bytearray()
    async for chunk in req.stream():
        if len(payload) + len(chunk) > 260000:
            return None
        payload.extend(chunk)
    try:
        value = json.loads(payload)
    except (ValueError, UnicodeDecodeError):
        return None
    return value if isinstance(value, dict) else None


def valid_gift(data: dict) -> bool:
    return (
        isinstance(data, dict) and
        isinstance(data.get("key"), str) and GIFT_KEY.fullmatch(data["key"]) is not None and
        all(isinstance(data.get(k), str) and 1 <= len(data[k].strip()) <= 120
            for k in ("titleUz", "titleEn")) and
        all(isinstance(data.get(k, ""), str) and len(data.get(k, "")) <= 500
            for k in ("descriptionUz", "descriptionEn")) and
        data.get("category") in CATEGORIES and
        type(data.get("coins")) is int and 1 <= data["coins"] <= 10000 and
        (data.get("stock") is None or
         (type(data["stock"]) is int and 0 <= data["stock"] <= 1000000)) and
        type(data.get("active", True)) is bool and
        valid_image_data(data.get("imageData"))
    )


@router.get("/api/coins/admin/gifts")
async def admin_gifts(req: Request):
    owner, failure = await active_owner(req)
    if failure is not None:
        return failure
    db = await core.pool()
    async with db.acquire() as con:
        rows = await con.fetch("SELECT * FROM coin_gifts ORDER BY created_at DESC")
        return core.j({"gifts": [gift_view(row) for row in rows]}, headers=PRIVATE)


@router.post("/api/coins/admin/gifts")
async def create_gift(req: Request):
    owner, failure = await active_owner(req)
    if failure is not None:
        return failure
    body = await gift_payload(req)
    if not valid_gift(body):
        return error("invalid_input")
    db = await core.pool()
    try:
        async with db.acquire() as con:
            row = await con.fetchrow(
                """INSERT INTO coin_gifts(item_key,title_uz,title_en,description_uz,
                   description_en,category,cost_coins,stock_remaining,is_active,created_by,image_data)
                   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
                   ON CONFLICT(item_key) DO NOTHING RETURNING *""",
                body["key"], body["titleUz"].strip(), body["titleEn"].strip(),
                body.get("descriptionUz", ""), body.get("descriptionEn", ""),
                body["category"], body["coins"], body.get("stock"),
                body.get("active", True), owner["id"], body.get("imageData"))
            if not row:
                return error("duplicate_key", 409)
        return core.j({"ok": True, "gift": gift_view(row)}, headers=PRIVATE)
    except Exception:
        log.exception("coin gift creation failed")
        return error("temporarily_unavailable", 503)


@router.patch("/api/coins/admin/gifts/{gift_id}")
async def update_gift(req: Request, gift_id: str):
    owner, failure = await active_owner(req)
    if failure is not None:
        return failure
    gift_id = core.uuid_value(gift_id)
    body = await gift_payload(req)
    if gift_id is None or not isinstance(body, dict) or not body or any(
        key not in {"titleUz", "titleEn", "descriptionUz", "descriptionEn",
                    "category", "coins", "stock", "active", "imageData"} for key in body
    ):
        return error("invalid_input")
    db = await core.pool()
    try:
        async with db.acquire() as con:
            async with con.transaction():
                row = await con.fetchrow("SELECT * FROM coin_gifts WHERE id=$1 FOR UPDATE", gift_id)
                if not row:
                    return error("not_found", 404)
                merged = {
                    "key": row["item_key"], "titleUz": row["title_uz"],
                    "titleEn": row["title_en"], "descriptionUz": row["description_uz"],
                    "descriptionEn": row["description_en"], "category": row["category"],
                    "coins": row["cost_coins"], "stock": row["stock_remaining"],
                    "active": row["is_active"], "imageData": row["image_data"], **body,
                }
                if not valid_gift(merged):
                    return error("invalid_input")
                updated = await con.fetchrow(
                    """UPDATE coin_gifts SET title_uz=$2,title_en=$3,
                       description_uz=$4,description_en=$5,category=$6,
                       cost_coins=$7,stock_remaining=$8,is_active=$9,image_data=$10,updated_at=now()
                       WHERE id=$1 RETURNING *""",
                    gift_id, merged["titleUz"].strip(), merged["titleEn"].strip(),
                    merged["descriptionUz"], merged["descriptionEn"], merged["category"],
                    merged["coins"], merged["stock"], merged["active"], merged["imageData"])
                return core.j({"ok": True, "gift": gift_view(updated)}, headers=PRIVATE)
    except Exception:
        log.exception("coin gift update failed")
        return error("temporarily_unavailable", 503)


def install() -> None:
    core.app.include_router(router)
