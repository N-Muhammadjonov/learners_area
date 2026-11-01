from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Final
import uuid

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import UUID_RE
from .riwi_knowledge import is_riwi_regression_fixture, run_riwi_regression_suite
from .riwi_outbound_guard import redact_external_text

SECURITY_SIGNAL_TYPES: Final[tuple[str, ...]] = (
    "prompt_injection",
    "role_spoof",
    "idor",
    "tool_injection",
    "provider_injection",
    "ssrf",
    "exfiltration",
    "secret_extraction",
    "exam_bypass",
    "replay",
    "toctou",
    "knowledge_poisoning",
    "assessment_policy_injection",
    "prompt_version_downgrade",
)

SECURITY_SIGNAL_STATES: Final[tuple[str, ...]] = (
    "candidate",
    "in_review",
    "approved_regression",
    "rejected",
    "developer_action_required",
)


class SecuritySignalError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def build_security_signal_fingerprint(signal_type: str, route_class: str, reason_code: str) -> str:
    canonical = json.dumps(
        {"type": signal_type, "route": route_class[:120], "reason": reason_code[:120]},
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


async def record_security_signal(
    conn: Any,
    *,
    signal_type: str,
    route_class: str,
    reason_code: str,
    actor_role: str | None = None,
) -> dict[str, Any]:
    if signal_type not in SECURITY_SIGNAL_TYPES:
        raise SecuritySignalError("invalid_input")
    clean_route = redact_external_text((route_class or "/api/riwi/chat").strip(), 120).strip() or "/api/riwi/chat"
    clean_reason = redact_external_text((reason_code or "blocked").strip(), 120).strip() or "blocked"
    fingerprint = build_security_signal_fingerprint(signal_type, clean_route, clean_reason)
    sanitized_evidence = (
        f"classification={signal_type}; route={clean_route}; reason={clean_reason}; raw_prompt=omitted; secrets=omitted"
    )[:500]
    now = datetime.now(timezone.utc)
    sig_id = str(uuid.uuid4())

    if conn is not None and hasattr(conn, "fetchrow"):
        row = await conn.fetchrow(
            """
            INSERT INTO riwi_security_signals (
                id, signal_type, state, fingerprint, occurrence_count,
                first_seen_at, last_seen_at, actor_role, route_class, sanitized_evidence, created_at
            ) VALUES (
                $1::uuid, $2::riwi_security_signal_type, 'candidate', $3, 1,
                $4::timestamptz, $4::timestamptz, $5::role, $6, $7, $4::timestamptz
            )
            ON CONFLICT (fingerprint) DO UPDATE
            SET occurrence_count = riwi_security_signals.occurrence_count + 1,
                last_seen_at = EXCLUDED.last_seen_at
            RETURNING id::text AS id, occurrence_count AS count, state::text AS state
            """,
            sig_id,
            signal_type,
            fingerprint,
            now,
            actor_role if actor_role in ("student", "teacher", "admin", "owner") else None,
            clean_route,
            sanitized_evidence,
        )
        if row:
            return {
                "id": row["id"],
                "type": signal_type,
                "fingerprint": fingerprint,
                "count": int(row["count"]),
                "state": row["state"],
                "sanitizedEvidence": sanitized_evidence,
            }

    return {
        "id": sig_id,
        "type": signal_type,
        "fingerprint": fingerprint,
        "count": 1,
        "state": "candidate",
        "sanitizedEvidence": sanitized_evidence,
    }


async def list_security_signals(conn: Any, actor: RiwiActor) -> list[dict[str, Any]]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.review").allowed:
        raise SecuritySignalError("forbidden")
    if conn is None or not hasattr(conn, "fetch"):
        return []
    rows = await conn.fetch(
        """
        SELECT id::text AS id, signal_type::text AS type, state::text AS state,
               fingerprint, occurrence_count AS count, first_seen_at, last_seen_at,
               actor_role::text AS actor_role, route_class, sanitized_evidence,
               regression_fixture_id
        FROM riwi_security_signals
        ORDER BY last_seen_at DESC, id DESC
        LIMIT 50
        """
    )
    items = []
    for r in rows:
        last_seen = r["last_seen_at"]
        if isinstance(last_seen, datetime) and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)
        items.append({
            "id": r["id"],
            "type": r["type"],
            "state": r["state"],
            "fingerprint": r["fingerprint"],
            "count": int(r["count"]),
            "lastSeenAt": last_seen.isoformat() if isinstance(last_seen, datetime) else str(last_seen),
            "routeClass": r["route_class"],
            "sanitizedEvidence": r["sanitized_evidence"],
            "regressionFixtureId": r["regression_fixture_id"],
        })
    return items


async def review_security_signal(
    conn: Any,
    *,
    actor: RiwiActor,
    signal_id: str,
    state: str,
    regression_fixture_id: str | None = None,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.review").allowed:
        raise SecuritySignalError("forbidden")
    if not isinstance(signal_id, str) or not UUID_RE.match(signal_id) or state not in SECURITY_SIGNAL_STATES:
        raise SecuritySignalError("invalid_input")
    if state == "approved_regression" and not is_riwi_regression_fixture(regression_fixture_id):
        raise SecuritySignalError("regression_required")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise SecuritySignalError("not_found")

    existing = await conn.fetchrow(
        "SELECT id::text AS id, fingerprint FROM riwi_security_signals WHERE id = $1::uuid LIMIT 1",
        signal_id,
    )
    if not existing:
        raise SecuritySignalError("not_found")

    regression = run_riwi_regression_suite(existing["fingerprint"]) if state == "approved_regression" else None
    if state == "approved_regression" and (not regression or not regression["passed"]):
        raise SecuritySignalError("regression_required")

    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        UPDATE riwi_security_signals
        SET state = $2::riwi_security_signal_state,
            reviewed_by_user_id = $3::uuid,
            reviewed_at = $4::timestamptz,
            regression_fixture_id = $5,
            regression_evidence_hash = $6
        WHERE id = $1::uuid
        """,
        signal_id,
        state,
        actor.id,
        now,
        regression_fixture_id if state == "approved_regression" else None,
        regression["evidenceHash"] if regression else None,
    )
    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.security.signal.reviewed",
        target_type="riwi_security_signal",
        target_id=signal_id,
        metadata={"status": state, "regressionFixtureId": regression_fixture_id},
    )
    return {"ok": True, "id": signal_id, "state": state}
