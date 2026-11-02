from __future__ import annotations

from datetime import datetime, timedelta, timezone
import json
from typing import Any
import uuid

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import (
    RIWI_CONVERSATION_TTL_DAYS,
    RIWI_MAX_ANSWER_CHARS,
    RIWI_MAX_MESSAGE_CHARS,
    RIWI_PROVENANCE,
    UUID_RE,
)
from .riwi_retention import (
    compute_riwi_retention_cutoffs,
    is_message_within_retention_window,
    is_user_offline_expired,
    touch_riwi_online_activity,
)


class RiwiConversationError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def _verify_active_actor_and_online_window(
    conn: Any,
    actor: RiwiActor,
    *,
    now: datetime | None = None,
    touch_online: bool = False,
) -> datetime:
    if not authorize_capability(actor, "riwi.chat.self").allowed:
        raise RiwiConversationError("forbidden")
    current = now if now is not None else datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)

    if conn is not None and hasattr(conn, "fetchrow"):
        user_row = await conn.fetchrow(
            """
            SELECT u.role::text AS role,
                   u.account_status::text AS account_status,
                   u.last_active_at AS last_active_at,
                   (SELECT MAX(ae.created_at) FROM activity_events ae WHERE ae.user_id = u.id) AS latest_event_at
            FROM users u
            WHERE u.id = $1::uuid
            LIMIT 1
            """,
            actor.id,
        )
        if not user_row or user_row["role"] != actor.role or user_row["account_status"] != "active":
            raise RiwiConversationError("forbidden")
        if is_user_offline_expired(user_row["last_active_at"], user_row["latest_event_at"], current):
            await conn.execute(
                "DELETE FROM riwi_conversations WHERE user_id = $1::uuid",
                actor.id,
            )
            if not touch_online:
                raise RiwiConversationError("not_found")
        if touch_online:
            await touch_riwi_online_activity(conn, actor.id, current)
    return current


async def get_conversation_transcript(
    conn: Any,
    actor: RiwiActor,
    conversation_id: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not isinstance(conversation_id, str) or not UUID_RE.match(conversation_id):
        raise RiwiConversationError("invalid_input")
    current = await _verify_active_actor_and_online_window(conn, actor, now=now, touch_online=True)
    cutoffs = compute_riwi_retention_cutoffs(current)

    if conn is None or not hasattr(conn, "fetchrow"):
        raise RiwiConversationError("not_found")

    conv = await conn.fetchrow(
        """
        SELECT id::text AS id, user_id::text AS user_id, role_at_creation::text AS role_at_creation,
               locale, expires_at, deleted_at
        FROM riwi_conversations
        WHERE id = $1::uuid
        LIMIT 1
        """,
        conversation_id,
    )
    if (
        not conv
        or conv["user_id"] != actor.id
        or conv["role_at_creation"] != actor.role
        or conv["deleted_at"] is not None
        or conv["expires_at"] <= cutoffs.now
    ):
        raise RiwiConversationError("not_found")

    # D-01: Retain all messages within the 30-day window without an arbitrary message-count cap
    rows = await conn.fetch(
        """
        SELECT id::text AS id, role::text AS role, content, metadata, created_at
        FROM riwi_conversation_messages
        WHERE conversation_id = $1::uuid
          AND created_at >= $2::timestamptz
        ORDER BY created_at ASC, id ASC
        """,
        conversation_id,
        cutoffs.message_cutoff,
    )
    messages = []
    for row in rows:
        meta = row["metadata"]
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = {}
        meta = meta if isinstance(meta, dict) else {}
        created_at = row["created_at"]
        if isinstance(created_at, datetime) and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        prov = meta.get("provenance")
        messages.append({
            "role": row["role"],
            "content": str(row["content"])[:RIWI_MAX_ANSWER_CHARS],
            "createdAt": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at),
            "correlationId": meta.get("correlationId") if isinstance(meta.get("correlationId"), str) else None,
            "provenance": prov if prov in RIWI_PROVENANCE else None,
            "provider": meta.get("provider") if isinstance(meta.get("provider"), dict) else None,
            "citations": meta.get("citations") if isinstance(meta.get("citations"), list) else [],
            "reportSnapshot": meta.get("reportSnapshot") if isinstance(meta.get("reportSnapshot"), dict) else None,
        })

    return {
        "ok": True,
        "conversationId": conv["id"],
        "messages": messages,
    }


async def get_tutoring_history(
    conn: Any, actor: RiwiActor, conversation_id: str,
    *, now: datetime | None = None,
) -> list[dict[str, str]]:
    """Reuse transcript ownership/retention checks before a paid follow-up.

    Only paired teaching turns are eligible. Reports and security decisions
    stay inside the site; the external payload guard still redacts this text.
    This context limit does not change stored conversation retention.
    """
    transcript = await get_conversation_transcript(conn, actor, conversation_id, now=now)
    messages = transcript["messages"][-12:]
    allowed = {"canonical_dictionary", "canonical_grammar", "approved_knowledge", "external_provider"}
    history = []
    for user, answer in zip(messages, messages[1:]):
        if (user["role"] == "user" and answer["role"] == "assistant"
                and user.get("correlationId")
                and user["correlationId"] == answer.get("correlationId")
                and answer.get("provenance") in allowed
                and not answer.get("reportSnapshot")):
            history.extend({"role": item["role"], "content": item["content"][:1000]}
                           for item in (user, answer))
    return history[-6:]


async def delete_conversation(
    conn: Any,
    actor: RiwiActor,
    conversation_id: str,
    *,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not isinstance(conversation_id, str) or not UUID_RE.match(conversation_id):
        raise RiwiConversationError("invalid_input")
    current = await _verify_active_actor_and_online_window(conn, actor, now=now, touch_online=True)
    if conn is None or not hasattr(conn, "fetchrow"):
        raise RiwiConversationError("not_found")

    deleted = await conn.fetchrow(
        """
        DELETE FROM riwi_conversations
        WHERE id = $1::uuid AND user_id = $2::uuid AND role_at_creation = $3::role
        RETURNING id::text AS id
        """,
        conversation_id,
        actor.id,
        actor.role,
    )
    if not deleted:
        raise RiwiConversationError("not_found")

    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.conversation.deleted",
        target_type="riwi_conversation",
        target_id=conversation_id,
        metadata={"role": actor.role, "status": "deleted"},
    )
    return {"ok": True, "deleted": True, "conversationId": conversation_id}


async def append_conversation_turn(
    conn: Any,
    *,
    actor: RiwiActor,
    conversation_id: str | None,
    user_message: str,
    assistant_answer: str,
    correlation_id: str,
    provenance: str,
    provider: dict[str, Any] | None,
    citations: list[dict[str, Any]],
    report_snapshot: dict[str, Any] | None = None,
    now: datetime | None = None,
) -> str:
    current = await _verify_active_actor_and_online_window(conn, actor, now=now, touch_online=True)
    cutoffs = compute_riwi_retention_cutoffs(current)
    expires_at = current + timedelta(days=RIWI_CONVERSATION_TTL_DAYS)

    if conn is None or not hasattr(conn, "fetchrow"):
        return conversation_id or str(uuid.uuid4())

    target_conv_id = conversation_id
    if target_conv_id:
        existing = await conn.fetchrow(
            """
            SELECT id::text AS id, user_id::text AS user_id, role_at_creation::text AS role_at_creation,
                   deleted_at, expires_at
            FROM riwi_conversations
            WHERE id = $1::uuid
            LIMIT 1
            """,
            target_conv_id,
        )
        if (
            not existing
            or existing["user_id"] != actor.id
            or existing["role_at_creation"] != actor.role
            or existing["deleted_at"] is not None
            or existing["expires_at"] <= cutoffs.now
        ):
            raise RiwiConversationError("not_found")
        await conn.execute(
            """
            UPDATE riwi_conversations
            SET updated_at = $2::timestamptz, expires_at = $3::timestamptz
            WHERE id = $1::uuid
            """,
            target_conv_id,
            current,
            expires_at,
        )
    else:
        target_conv_id = str(uuid.uuid4())
        await conn.execute(
            """
            INSERT INTO riwi_conversations (id, user_id, role_at_creation, locale, expires_at, created_at, updated_at)
            VALUES ($1::uuid, $2::uuid, $3::role, $4, $5::timestamptz, $6::timestamptz, $6::timestamptz)
            """,
            target_conv_id,
            actor.id,
            actor.role,
            actor.locale[:5] if actor.locale else "uz",
            expires_at,
            current,
        )

    await conn.execute(
        """
        INSERT INTO riwi_conversation_messages (id, conversation_id, role, content, metadata, created_at)
        VALUES ($1::uuid, $2::uuid, 'user', $3, $4::jsonb, $5::timestamptz)
        """,
        str(uuid.uuid4()),
        target_conv_id,
        user_message[:RIWI_MAX_MESSAGE_CHARS],
        json.dumps({"correlationId": correlation_id}),
        current,
    )
    assistant_meta = {
        "correlationId": correlation_id,
        "provenance": provenance,
        "provider": provider,
        "citations": citations[:8],
        "reportSnapshot": report_snapshot,
    }
    await conn.execute(
        """
        INSERT INTO riwi_conversation_messages (id, conversation_id, role, content, metadata, created_at)
        VALUES ($1::uuid, $2::uuid, 'assistant', $3, $4::jsonb, $5::timestamptz)
        """,
        str(uuid.uuid4()),
        target_conv_id,
        assistant_answer[:RIWI_MAX_ANSWER_CHARS],
        json.dumps(assistant_meta),
        current + timedelta(milliseconds=1),
    )
    return target_conv_id
