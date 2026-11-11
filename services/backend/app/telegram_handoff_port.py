"""Issue a verified, short-lived Telegram-to-website login handoff."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Request

from . import main as core
from .db import PooledReads
from .internal_bot_ready_port import verify_bot
from .rate_limit import RULES, async_counter as counter, too_many
from .step18_telegram_admission_port import gates
from .telegram_preferences_port import valid_actor

router = APIRouter()


@router.post("/api/internal/telegram/auth/handoff")
async def create_handoff(req: Request):
    denied = verify_bot(req)
    if denied is not None:
        return denied

    body = await core.payload(req)
    actor = body.get("telegramUserId") if isinstance(body, dict) else None
    if not valid_actor(actor):
        return core.j({"error": "invalid_actor"}, 400)

    RULES.setdefault("telegram_handoff", (10, 300))
    retry = await counter("telegram_handoff", "tg:" + actor, consume=True)
    if retry:
        return too_many(retry)

    database = await core.pool()
    gated = await gates(PooledReads(database), actor)
    if gated:
        code = gated["error"]
        return core.j({"error": code}, 403 if code in ("phone_required", "not_subscribed") else 503)

    async with database.acquire() as conn:
        async with conn.transaction():
            contact = await conn.fetchrow(
                """SELECT phone_verified_at, bot_blocked_at, removed_at
                   FROM telegram_contacts WHERE telegram_user_id=$1""",
                actor,
            )
            if not contact or not contact["phone_verified_at"]:
                return core.j({"error": "phone_required"}, 403)
            if contact["bot_blocked_at"] or contact["removed_at"]:
                return core.j({"error": "account_unavailable"}, 403)

            account = await conn.fetchrow(
                """SELECT id, account_status FROM users WHERE telegram_id=$1""",
                actor,
            )
            if account and account["account_status"] not in ("active", "pending"):
                return core.j({"error": "account_unavailable"}, 403)
            purpose = "login" if account else "register"

            token_hash = hashlib.sha256(secrets.token_bytes(32)).hexdigest()
            nonce = secrets.token_hex(32)
            nonce_hash = hashlib.sha256(nonce.encode()).hexdigest()
            expires_at = datetime.now(timezone.utc) + timedelta(minutes=5)
            intent_id = await conn.fetchval(
                """INSERT INTO telegram_login_intents
                    (token_hash, browser_nonce_hash, telegram_user_id,
                     purpose, status, expires_at, confirmed_at)
                   VALUES ($1, $2, $3, $4, 'confirmed', $5, NOW())
                   RETURNING id""",
                token_hash, nonce_hash, actor, purpose, expires_at,
            )

    return core.j({"ok": True, "intentId": str(intent_id), "browserNonce": nonce, "purpose": purpose})


def install() -> None:
    core.app.include_router(router)
