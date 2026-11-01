from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
import os
import re
from typing import Any, Final

from .riwi_capabilities import RiwiActor

UUID_RE: Final[re.Pattern[str]] = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

OWNER_HISTORY_COLLECTIONS: Final[frozenset[str]] = frozenset({
    "audit_events",
    "knowledge_sources",
    "learning_signals",
    "learning_reviews",
    "provider_experiments",
    "assessment_policy_versions",
    "targets",
})


class RiwiOwnerHistoryCursorError(ValueError):
    def __init__(self, code: str = "invalid_cursor") -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True)
class RiwiOwnerHistoryPosition:
    sort_at: datetime
    id: str

    @property
    def sortAt(self) -> datetime:
        return self.sort_at


def _cursor_secret() -> bytes:
    raw = (
        os.environ.get("RIWI_CURSOR_SECRET")
        or os.environ.get("AUTH_SECRET")
        or os.environ.get("JWT_SECRET")
        or ""
    ).strip()
    if len(raw) < 16:
        raise RiwiOwnerHistoryCursorError("cursor_secret_not_configured")
    return hmac.digest(raw.encode("utf-8"), b"riwi:owner-history-cursor:v1", "sha256")


def owner_history_page_limit(raw_limit: Any, default: int = 20, maximum: int = 50) -> int:
    if raw_limit is None or raw_limit == "":
        return default
    if isinstance(raw_limit, bool):
        raise RiwiOwnerHistoryCursorError("invalid_limit")
    try:
        parsed = int(raw_limit)
    except (TypeError, ValueError) as exc:
        raise RiwiOwnerHistoryCursorError("invalid_limit") from exc
    if parsed < 1 or parsed > maximum:
        raise RiwiOwnerHistoryCursorError("invalid_limit")
    return parsed


def encode_owner_history_cursor(
    *,
    actor: RiwiActor | dict[str, str],
    collection: str,
    after: RiwiOwnerHistoryPosition | dict[str, Any],
    scope_id: str | None = None,
    filter_val: str | None = None,
) -> str:
    if collection not in OWNER_HISTORY_COLLECTIONS:
        raise RiwiOwnerHistoryCursorError("invalid_collection")
    actor_id = actor["id"] if isinstance(actor, dict) else actor.id
    actor_role = actor["role"] if isinstance(actor, dict) else actor.role
    sort_at = after["sortAt"] if isinstance(after, dict) and "sortAt" in after else (
        after["sort_at"] if isinstance(after, dict) else after.sort_at
    )
    item_id = after["id"] if isinstance(after, dict) else after.id
    if isinstance(sort_at, datetime):
        if sort_at.tzinfo is None:
            sort_at = sort_at.replace(tzinfo=timezone.utc)
        sort_iso = sort_at.astimezone(timezone.utc).isoformat()
    elif isinstance(sort_at, str):
        sort_iso = sort_at
    else:
        raise RiwiOwnerHistoryCursorError("invalid_sort_at")
    if not isinstance(item_id, str) or not UUID_RE.match(item_id):
        raise RiwiOwnerHistoryCursorError("invalid_id")

    envelope = {
        "v": 1,
        "uid": actor_id.lower(),
        "role": actor_role,
        "col": collection,
        "sid": scope_id or "",
        "flt": filter_val or "",
        "at": sort_iso,
        "id": item_id.lower(),
    }
    body_bytes = json.dumps(envelope, separators=(",", ":"), sort_keys=True).encode("utf-8")
    body_b64 = base64.urlsafe_b64encode(body_bytes).decode("ascii").rstrip("=")
    sig = hmac.new(_cursor_secret(), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{body_b64}.{sig}"


def decode_owner_history_cursor(
    cursor: str | None,
    actor: RiwiActor | dict[str, str],
    collection: str,
    scope_id: str | None = None,
    filter_val: str | None = None,
) -> RiwiOwnerHistoryPosition | None:
    if cursor is None or cursor == "":
        return None
    if not isinstance(cursor, str) or len(cursor) > 2048 or "." not in cursor:
        raise RiwiOwnerHistoryCursorError("invalid_cursor")
    body_b64, sig = cursor.split(".", 1)
    expected_sig = hmac.new(_cursor_secret(), body_b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected_sig):
        raise RiwiOwnerHistoryCursorError("cursor_signature_mismatch")
    padding = "=" * (-len(body_b64) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode((body_b64 + padding).encode("ascii")).decode("utf-8"))
    except Exception as exc:
        raise RiwiOwnerHistoryCursorError("cursor_decode_failed") from exc
    if not isinstance(payload, dict) or payload.get("v") != 1:
        raise RiwiOwnerHistoryCursorError("cursor_version_mismatch")

    actor_id = (actor["id"] if isinstance(actor, dict) else actor.id).lower()
    actor_role = actor["role"] if isinstance(actor, dict) else actor.role
    if (
        payload.get("uid") != actor_id
        or payload.get("role") != actor_role
        or payload.get("col") != collection
        or payload.get("sid") != (scope_id or "")
        or payload.get("flt") != (filter_val or "")
    ):
        raise RiwiOwnerHistoryCursorError("cursor_scope_mismatch")

    item_id = payload.get("id")
    sort_iso = payload.get("at")
    if not isinstance(item_id, str) or not UUID_RE.match(item_id) or not isinstance(sort_iso, str):
        raise RiwiOwnerHistoryCursorError("cursor_position_invalid")
    try:
        parsed_dt = datetime.fromisoformat(sort_iso.replace("Z", "+00:00"))
        if parsed_dt.tzinfo is None:
            parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
    except ValueError as exc:
        raise RiwiOwnerHistoryCursorError("cursor_timestamp_invalid") from exc
    return RiwiOwnerHistoryPosition(sort_at=parsed_dt, id=item_id.lower())
