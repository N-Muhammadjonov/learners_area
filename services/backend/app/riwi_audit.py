from __future__ import annotations

from datetime import datetime, timezone
import json
from typing import Any, Final
import uuid

from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_cursor import (
    RiwiOwnerHistoryCursorError,
    decode_owner_history_cursor,
    encode_owner_history_cursor,
    owner_history_page_limit,
)
from .riwi_outbound_guard import contains_secret_material, redact_external_text

ALLOWED_RIWI_AUDIT_METADATA_KEYS: Final[frozenset[str]] = frozenset({
    "role",
    "targetUserId",
    "targetId",
    "toolName",
    "providerId",
    "model",
    "taskProfile",
    "status",
    "code",
    "reason",
    "decision",
    "durationMs",
    "resultCount",
    "sourceId",
    "signalId",
    "version",
    "unitCount",
    "inputHash",
    "contentHash",
    "sourceChecksum",
    "sourceType",
    "rightsClass",
    "regressionFixtureId",
    "answerSource",
    "deletedConversations",
    "deletedMessages",
})


def sanitize_riwi_audit_metadata(metadata: dict[str, Any] | None) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    cleaned: dict[str, Any] = {}
    for key, val in metadata.items():
        if key not in ALLOWED_RIWI_AUDIT_METADATA_KEYS or val is None:
            continue
        if isinstance(val, str):
            if contains_secret_material(val):
                cleaned[key] = "[redacted-secret]"
            else:
                cleaned[key] = redact_external_text(val, 240)
        elif isinstance(val, (int, float, bool)):
            cleaned[key] = val
    return cleaned


async def record_riwi_audit(
    conn: Any,
    *,
    actor_user_id: str | None,
    action: str,
    target_type: str | None = None,
    target_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    audit_id = str(uuid.uuid4())
    safe_meta = sanitize_riwi_audit_metadata(metadata)
    if conn is not None and hasattr(conn, "execute"):
        await conn.execute(
            """
            INSERT INTO audit_log (id, actor_user_id, action, target_type, target_id, metadata)
            VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6::jsonb)
            """,
            audit_id,
            actor_user_id,
            action[:80],
            target_type[:40] if target_type else None,
            str(target_id)[:80] if target_id else None,
            json.dumps(safe_meta),
        )
    return audit_id


async def record_riwi_usage_metric(
    conn: Any,
    *,
    actor_user_id: str | None,
    actor_role: str,
    task_profile: str,
    provider_id: str | None,
    model: str | None,
    state: str,
    duration_ms: int,
    correlation_id: str,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    estimated_cost_micros: int | None = None,
) -> str:
    metric_id = str(uuid.uuid4())
    if conn is not None and hasattr(conn, "execute"):
        await conn.execute(
            """
            INSERT INTO riwi_usage_metrics (
                id, actor_user_id, actor_role, task_profile, provider_id, model,
                state, duration_ms, input_tokens, output_tokens, estimated_cost_micros, correlation_id
            ) VALUES (
                $1::uuid, $2::uuid, $3::role, $4, $5, $6,
                $7, $8, $9, $10, $11, $12::uuid
            )
            """,
            metric_id,
            actor_user_id,
            actor_role,
            task_profile[:60],
            provider_id[:60] if provider_id else None,
            model[:120] if model else None,
            state[:24],
            max(0, int(duration_ms)),
            input_tokens if isinstance(input_tokens, int) and input_tokens >= 0 else None,
            output_tokens if isinstance(output_tokens, int) and output_tokens >= 0 else None,
            estimated_cost_micros if isinstance(estimated_cost_micros, int) and estimated_cost_micros >= 0 else None,
            correlation_id,
        )
    return metric_id


async def list_riwi_audit_page(
    conn: Any,
    actor: RiwiActor,
    *,
    cursor: str | None = None,
    limit: Any = 20,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.audit.read_all").allowed:
        raise PermissionError("forbidden")
    page_limit = owner_history_page_limit(limit, default=20, maximum=50)
    after = decode_owner_history_cursor(cursor, actor, "audit_events")
    if conn is None or not hasattr(conn, "fetch"):
        return {"ok": True, "events": [], "nextCursor": None, "totalCount": 0}

    count_row = await conn.fetchrow(
        "SELECT count(*)::int AS total FROM audit_log WHERE action LIKE 'riwi.%' OR action = 'ai.control.set'"
    )
    total_count = int(count_row["total"]) if count_row else 0

    if after is not None:
        rows = await conn.fetch(
            """
            SELECT id::text AS id, actor_user_id::text AS actor_user_id, action, target_type, target_id, metadata, created_at
            FROM audit_log
            WHERE (action LIKE 'riwi.%' OR action = 'ai.control.set')
              AND (created_at < $1 OR (created_at = $1 AND id < $2::uuid))
            ORDER BY created_at DESC, id DESC
            LIMIT $3
            """,
            after.sort_at,
            after.id,
            page_limit + 1,
        )
    else:
        rows = await conn.fetch(
            """
            SELECT id::text AS id, actor_user_id::text AS actor_user_id, action, target_type, target_id, metadata, created_at
            FROM audit_log
            WHERE (action LIKE 'riwi.%' OR action = 'ai.control.set')
            ORDER BY created_at DESC, id DESC
            LIMIT $1
            """,
            page_limit + 1,
        )

    has_more = len(rows) > page_limit
    page_rows = rows[:page_limit]
    events = []
    for row in page_rows:
        raw_meta = row["metadata"]
        if isinstance(raw_meta, str):
            try:
                raw_meta = json.loads(raw_meta)
            except Exception:
                raw_meta = {}
        created_at = row["created_at"]
        if isinstance(created_at, datetime) and created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        events.append({
            "id": row["id"],
            "actorUserId": row["actor_user_id"],
            "action": row["action"],
            "targetType": row["target_type"],
            "targetId": row["target_id"],
            "metadata": sanitize_riwi_audit_metadata(raw_meta if isinstance(raw_meta, dict) else {}),
            "createdAt": created_at.isoformat() if isinstance(created_at, datetime) else str(created_at),
            "_sortAt": created_at,
        })

    next_cursor = None
    if has_more and events:
        last = events[-1]
        next_cursor = encode_owner_history_cursor(
            actor=actor,
            collection="audit_events",
            after={"sort_at": last["_sortAt"], "id": last["id"]},
        )
    for item in events:
        item.pop("_sortAt", None)
    return {"ok": True, "events": events, "nextCursor": next_cursor, "totalCount": total_count}
