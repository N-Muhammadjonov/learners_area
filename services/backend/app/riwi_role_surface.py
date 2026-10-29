from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
from typing import Any, Final

from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import RIWI_TARGET_CURSOR_MAX_LENGTH, UUID_RE

TARGET_PAGE_LIMIT: Final[int] = 25


class RiwiTargetScopeError(ValueError):
    def __init__(self, code: str = "forbidden") -> None:
        super().__init__(code)
        self.code = code


def _target_cursor_secret() -> bytes:
    raw = (
        os.environ.get("RIWI_CURSOR_SECRET")
        or os.environ.get("JWT_SECRET")
        or "riwi-offline-deterministic-cursor-secret-v1"
    )
    return raw.encode("utf-8")


def encode_riwi_target_cursor(actor: RiwiActor, sort_name: str, user_id: str) -> str:
    payload = {
        "v": 1,
        "uid": actor.id.lower(),
        "role": actor.role,
        "name": sort_name.strip().lower()[:120],
        "id": user_id.lower(),
    }
    raw = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    b64 = base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")
    sig = hmac.new(_target_cursor_secret(), b64.encode("ascii"), hashlib.sha256).hexdigest()
    return f"{b64}.{sig}"


def decode_riwi_target_cursor(cursor: str | None, actor: RiwiActor) -> tuple[str, str] | None:
    if not cursor:
        return None
    if not isinstance(cursor, str) or len(cursor) > RIWI_TARGET_CURSOR_MAX_LENGTH or "." not in cursor:
        raise RiwiTargetScopeError("invalid_input")
    b64, sig = cursor.split(".", 1)
    expected = hmac.new(_target_cursor_secret(), b64.encode("ascii"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise RiwiTargetScopeError("invalid_input")
    pad = "=" * (-len(b64) % 4)
    try:
        data = json.loads(base64.urlsafe_b64decode((b64 + pad).encode("ascii")).decode("utf-8"))
    except Exception as exc:
        raise RiwiTargetScopeError("invalid_input") from exc
    if (
        not isinstance(data, dict)
        or data.get("v") != 1
        or data.get("uid") != actor.id.lower()
        or data.get("role") != actor.role
        or not isinstance(data.get("name"), str)
        or not isinstance(data.get("id"), str)
        or not UUID_RE.match(data["id"])
    ):
        raise RiwiTargetScopeError("invalid_input")
    return data["name"], data["id"].lower()


def unavailable_riwi_role_surface(role: str) -> dict[str, Any]:
    scope = (
        "self" if role == "student"
        else "assigned_roster" if role == "teacher"
        else "operational_cohort" if role == "admin"
        else "centre"
    )
    return {
        "role": role,
        "scope": scope,
        "status": "unavailable",
        "targetOptions": [],
        "nextCursor": None,
    }


async def list_riwi_target_page(
    conn: Any,
    actor: RiwiActor,
    *,
    cursor: str | None = None,
    limit: int = TARGET_PAGE_LIMIT,
) -> dict[str, Any]:
    if actor.account_status != "active" or actor.role not in ("teacher", "admin", "owner"):
        raise RiwiTargetScopeError("forbidden")
    after = decode_riwi_target_cursor(cursor, actor)
    if conn is None or not hasattr(conn, "fetch"):
        return {"ok": True, "items": [], "nextCursor": None}

    actor_row = await conn.fetchrow(
        "SELECT role::text AS role, account_status::text AS account_status FROM users WHERE id = $1::uuid LIMIT 1",
        actor.id,
    )
    if not actor_row or actor_row["role"] != actor.role or actor_row["account_status"] != "active":
        raise RiwiTargetScopeError("forbidden")

    page_limit = max(1, min(100, int(limit)))
    if actor.role == "teacher":
        if after is not None:
            rows = await conn.fetch(
                """
                SELECT u.id::text AS id, trim(u.name) AS name, lower(trim(u.name)) AS sort_name
                FROM teacher_student_links tsl
                JOIN users u ON u.id = tsl.student_id
                WHERE tsl.teacher_id = $1::uuid
                  AND u.role = 'student'
                  AND u.account_status = 'active'
                  AND (lower(trim(u.name)) > $2 OR (lower(trim(u.name)) = $2 AND u.id > $3::uuid))
                ORDER BY lower(trim(u.name)) ASC, u.id ASC
                LIMIT $4
                """,
                actor.id,
                after[0],
                after[1],
                page_limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT u.id::text AS id, trim(u.name) AS name, lower(trim(u.name)) AS sort_name
                FROM teacher_student_links tsl
                JOIN users u ON u.id = tsl.student_id
                WHERE tsl.teacher_id = $1::uuid
                  AND u.role = 'student'
                  AND u.account_status = 'active'
                ORDER BY lower(trim(u.name)) ASC, u.id ASC
                LIMIT $2
                """,
                actor.id,
                page_limit + 1,
            )
    else:
        if after is not None:
            rows = await conn.fetch(
                """
                SELECT u.id::text AS id, trim(u.name) AS name, lower(trim(u.name)) AS sort_name
                FROM users u
                WHERE u.role = 'student'
                  AND u.account_status = 'active'
                  AND (lower(trim(u.name)) > $1 OR (lower(trim(u.name)) = $1 AND u.id > $2::uuid))
                ORDER BY lower(trim(u.name)) ASC, u.id ASC
                LIMIT $3
                """,
                after[0],
                after[1],
                page_limit + 1,
            )
        else:
            rows = await conn.fetch(
                """
                SELECT u.id::text AS id, trim(u.name) AS name, lower(trim(u.name)) AS sort_name
                FROM users u
                WHERE u.role = 'student'
                  AND u.account_status = 'active'
                ORDER BY lower(trim(u.name)) ASC, u.id ASC
                LIMIT $1
                """,
                page_limit + 1,
            )

    has_more = len(rows) > page_limit
    page_rows = rows[:page_limit]
    items = [{"id": r["id"], "name": r["name"][:120]} for r in page_rows if r["name"]]
    next_cursor = None
    if has_more and page_rows:
        last = page_rows[-1]
        next_cursor = encode_riwi_target_cursor(actor, last["sort_name"], last["id"])
    return {"ok": True, "items": items, "nextCursor": next_cursor}


async def get_riwi_role_surface(conn: Any, actor: RiwiActor) -> dict[str, Any]:
    if not authorize_capability(actor, "riwi.chat.self").allowed:
        return unavailable_riwi_role_surface(actor.role)
    if actor.role == "student":
        return {
            "role": "student",
            "scope": "self",
            "status": "ready",
            "targetOptions": [],
            "nextCursor": None,
        }
    try:
        page = await list_riwi_target_page(conn, actor, limit=TARGET_PAGE_LIMIT)
        scope = (
            "assigned_roster" if actor.role == "teacher"
            else "operational_cohort" if actor.role == "admin"
            else "centre"
        )
        return {
            "role": actor.role,
            "scope": scope,
            "status": "ready",
            "targetOptions": page["items"],
            "nextCursor": page["nextCursor"],
        }
    except Exception:
        return unavailable_riwi_role_surface(actor.role)


async def authorize_target_learner_access(
    conn: Any,
    actor: RiwiActor,
    target_user_id: str | None,
    *,
    for_report: bool = False,
) -> str:
    if actor.account_status != "active":
        raise RiwiTargetScopeError("forbidden")
    if actor.role == "student":
        if target_user_id is not None and target_user_id.lower() != actor.id.lower():
            raise RiwiTargetScopeError("forbidden")
        return actor.id

    if not target_user_id or not UUID_RE.match(target_user_id):
        raise RiwiTargetScopeError("invalid_input")
    if actor.role == "admin" and not for_report:
        raise RiwiTargetScopeError("forbidden")

    if conn is None or not hasattr(conn, "fetchrow"):
        raise RiwiTargetScopeError("forbidden")

    student_row = await conn.fetchrow(
        "SELECT id::text AS id, role::text AS role, account_status::text AS account_status FROM users WHERE id = $1::uuid LIMIT 1",
        target_user_id,
    )
    if not student_row or student_row["role"] != "student" or student_row["account_status"] != "active":
        raise RiwiTargetScopeError("forbidden")

    if actor.role == "teacher":
        link_row = await conn.fetchrow(
            """
            SELECT 1 FROM teacher_student_links
            WHERE teacher_id = $1::uuid AND student_id = $2::uuid
            LIMIT 1
            """,
            actor.id,
            target_user_id,
        )
        if not link_row:
            raise RiwiTargetScopeError("forbidden")
    return student_row["id"]
