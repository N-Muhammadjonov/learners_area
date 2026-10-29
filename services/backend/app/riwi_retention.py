from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from .riwi_audit import record_riwi_audit
from .riwi_contracts import (
    RIWI_CONVERSATION_TTL_DAYS,
    RIWI_INACTIVE_OFFLINE_DAYS,
    RIWI_OFFLINE_DELETE_DAY,
)


@dataclass(frozen=True)
class RiwiRetentionCutoffs:
    now: datetime
    message_cutoff: datetime
    offline_cutoff: datetime


def compute_riwi_retention_cutoffs(now: datetime | None = None) -> RiwiRetentionCutoffs:
    current = now if now is not None else datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return RiwiRetentionCutoffs(
        now=current,
        message_cutoff=current - timedelta(days=RIWI_CONVERSATION_TTL_DAYS),
        offline_cutoff=current - timedelta(days=RIWI_INACTIVE_OFFLINE_DAYS),
    )


def is_user_offline_expired(
    last_active_at: datetime | None,
    latest_activity_event_at: datetime | None = None,
    now: datetime | None = None,
) -> bool:
    cutoffs = compute_riwi_retention_cutoffs(now)
    candidates: list[datetime] = []
    for ts in (last_active_at, latest_activity_event_at):
        if isinstance(ts, datetime):
            candidates.append(ts if ts.tzinfo is not None else ts.replace(tzinfo=timezone.utc))
    if not candidates:
        return True
    effective_last_seen = max(candidates)
    return effective_last_seen <= cutoffs.offline_cutoff


def is_message_within_retention_window(created_at: datetime, now: datetime | None = None) -> bool:
    cutoffs = compute_riwi_retention_cutoffs(now)
    ts = created_at if created_at.tzinfo is not None else created_at.replace(tzinfo=timezone.utc)
    return ts >= cutoffs.message_cutoff


async def touch_riwi_online_activity(conn: Any, user_id: str, now: datetime | None = None) -> bool:
    if conn is None or not hasattr(conn, "execute"):
        return False
    current = now if now is not None else datetime.now(timezone.utc)
    await conn.execute(
        """
        UPDATE users
        SET last_active_at = GREATEST(last_active_at, $2::timestamptz)
        WHERE id = $1::uuid AND account_status = 'active'
        """,
        user_id,
        current,
    )
    return True


async def purge_expired_riwi_conversations(
    conn: Any,
    *,
    now: datetime | None = None,
    dry_run: bool = False,
) -> dict[str, Any]:
    cutoffs = compute_riwi_retention_cutoffs(now)
    if conn is None or not hasattr(conn, "fetch"):
        return {
            "dryRun": dry_run,
            "ttlDays": RIWI_CONVERSATION_TTL_DAYS,
            "offlineDays": RIWI_INACTIVE_OFFLINE_DAYS,
            "offlineDeleteDay": RIWI_OFFLINE_DELETE_DAY,
            "deletedConversations": 0,
            "deletedMessages": 0,
        }

    expired_conv_rows = await conn.fetch(
        """
        SELECT c.id::text AS id
        FROM riwi_conversations c
        JOIN users u ON u.id = c.user_id
        LEFT JOIN LATERAL (
            SELECT MAX(ae.created_at) AS latest_event_at
            FROM activity_events ae
            WHERE ae.user_id = u.id
        ) ev ON true
        WHERE c.deleted_at IS NOT NULL
           OR c.expires_at <= $1::timestamptz
           OR GREATEST(u.last_active_at, COALESCE(ev.latest_event_at, u.last_active_at)) <= $2::timestamptz
        """,
        cutoffs.now,
        cutoffs.offline_cutoff,
    )
    conv_ids = [r["id"] for r in expired_conv_rows]
    old_msg_row = await conn.fetchrow(
        """
        SELECT count(*)::int AS cnt
        FROM riwi_conversation_messages
        WHERE created_at < $1::timestamptz
           OR conversation_id = ANY($2::uuid[])
        """,
        cutoffs.message_cutoff,
        conv_ids,
    )
    msg_count = int(old_msg_row["cnt"]) if old_msg_row else 0

    if not dry_run:
        await conn.execute(
            "DELETE FROM riwi_conversation_messages WHERE created_at < $1::timestamptz",
            cutoffs.message_cutoff,
        )
        if conv_ids:
            await conn.execute(
                "DELETE FROM riwi_conversations WHERE id = ANY($1::uuid[])",
                conv_ids,
            )
        await record_riwi_audit(
            conn,
            actor_user_id=None,
            action="riwi.conversation.retention.purged",
            target_type="riwi_conversation_retention",
            target_id="d01-retention",
            metadata={
                "status": "purged",
                "deletedConversations": len(conv_ids),
                "deletedMessages": msg_count,
            },
        )

    return {
        "dryRun": dry_run,
        "ttlDays": RIWI_CONVERSATION_TTL_DAYS,
        "offlineDays": RIWI_INACTIVE_OFFLINE_DAYS,
        "offlineDeleteDay": RIWI_OFFLINE_DELETE_DAY,
        "deletedConversations": len(conv_ids),
        "deletedMessages": msg_count,
    }
