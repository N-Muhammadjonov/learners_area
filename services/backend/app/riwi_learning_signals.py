from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Final
import uuid

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import RiwiActor, authorize_capability
from .riwi_contracts import UUID_RE
from .riwi_knowledge import (
    create_knowledge_candidate,
    is_riwi_regression_fixture,
    run_riwi_regression_suite,
)
from .riwi_outbound_guard import redact_external_text

LEARNING_SIGNAL_TYPES: Final[tuple[str, ...]] = (
    "user_feedback",
    "teacher_correction",
    "owner_correction",
    "provider_agreement",
    "provider_disagreement",
    "low_confidence_eval",
    "repeated_user_confusion",
    "hallucination_report",
    "manual_qa_finding",
    "rubric_reference",
    "known_good_example",
    "known_bad_example",
)

PRODUCER_REQUIRED: Final[dict[str, str]] = {
    "provider_agreement": "provider_lab",
    "provider_disagreement": "provider_lab",
    "low_confidence_eval": "evaluation_service",
    "repeated_user_confusion": "gateway",
}

SUCCESSFUL_RESPONSE_SOURCES: Final[frozenset[str]] = frozenset({
    "canonical_dictionary",
    "canonical_grammar",
    "approved_knowledge",
    "deterministic_learning_data",
    "deterministic_report",
    "external_provider",
})


class LearningServiceError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


async def create_learning_signal(
    conn: Any,
    *,
    actor: RiwiActor,
    signal_type: str,
    source_id: str,
    candidate_claim: str,
    evidence_summary: str,
    target_user_id: str | None = None,
    scope: str | None = None,
    provider_id: str | None = None,
    model: str | None = None,
    prompt_version: str | None = None,
    rubric_version: str | None = None,
    producer: str | None = None,
) -> dict[str, Any]:
    if not authorize_capability(actor, "riwi.chat.self").allowed:
        raise LearningServiceError("forbidden")
    if signal_type not in LEARNING_SIGNAL_TYPES:
        raise LearningServiceError("invalid_input")
    if not isinstance(source_id, str) or not UUID_RE.match(source_id):
        raise LearningServiceError("invalid_input")
    if target_user_id is not None and (not isinstance(target_user_id, str) or not UUID_RE.match(target_user_id)):
        raise LearningServiceError("invalid_input")

    if signal_type in ("owner_correction", "manual_qa_finding", "rubric_reference", "known_good_example", "known_bad_example") and actor.role != "owner":
        raise LearningServiceError("forbidden")
    if signal_type in ("user_feedback", "hallucination_report") and actor.role != "student":
        raise LearningServiceError("forbidden")
    if signal_type == "teacher_correction" and actor.role != "teacher":
        raise LearningServiceError("forbidden")

    req_prod = PRODUCER_REQUIRED.get(signal_type)
    if (req_prod and producer != req_prod) or (producer and req_prod != producer):
        raise LearningServiceError("forbidden")

    if actor.role == "teacher" and (not target_user_id or scope == "global"):
        raise LearningServiceError("invalid_input")
    if actor.role == "student" and scope and scope != "user":
        raise LearningServiceError("forbidden")
    if actor.role == "student" and target_user_id and target_user_id.lower() != actor.id.lower():
        raise LearningServiceError("forbidden")

    resolved_target = actor.id if actor.role == "student" else target_user_id
    resolved_scope = "user" if actor.role == "student" else (scope or ("user" if resolved_target else "global"))
    if (resolved_scope == "user" and not resolved_target) or (resolved_scope == "global" and resolved_target):
        raise LearningServiceError("invalid_input")

    clean_claim = redact_external_text((candidate_claim or "").strip(), 4000).strip()
    clean_evidence = redact_external_text((evidence_summary or "").strip(), 1200).strip()
    if not clean_claim or not clean_evidence:
        raise LearningServiceError("invalid_input")

    evidence_hash = hashlib.sha256(
        json.dumps([clean_claim, clean_evidence], separators=(",", ":")).encode("utf-8")
    ).hexdigest()

    if conn is not None and hasattr(conn, "fetchrow"):
        if actor.role == "teacher" and resolved_target:
            on_roster = await conn.fetchrow(
                "SELECT 1 FROM teacher_student_links WHERE teacher_user_id = $1::uuid AND student_user_id = $2::uuid LIMIT 1",
                actor.id,
                resolved_target,
            )
            if not on_roster:
                raise LearningServiceError("forbidden")

        existing = await conn.fetchrow(
            """
            SELECT id::text AS id, state::text AS state, signal_type::text AS signal_type, evidence_hash
            FROM riwi_learning_signals
            WHERE actor_user_id = $1::uuid AND signal_type = $2::riwi_learning_signal_type AND source_id = $3::uuid
            LIMIT 1
            """,
            actor.id,
            signal_type,
            source_id,
        )
        if existing:
            if existing["evidence_hash"] != evidence_hash:
                raise LearningServiceError("idempotency_conflict")
            return {"id": existing["id"], "state": existing["state"], "signalType": existing["signal_type"]}

    sig_id = str(uuid.uuid4())
    if conn is not None and hasattr(conn, "execute"):
        await conn.execute(
            """
            INSERT INTO riwi_learning_signals (
                id, signal_type, state, actor_user_id, actor_role, target_user_id, source_id,
                provider_id, model, prompt_version, rubric_version, candidate_claim, evidence_summary, evidence_hash, scope
            ) VALUES (
                $1::uuid, $2::riwi_learning_signal_type, 'candidate', $3::uuid, $4::role, $5::uuid, $6::uuid,
                $7, $8, $9, $10, $11, $12, $13, $14::riwi_knowledge_scope
            )
            """,
            sig_id,
            signal_type,
            actor.id,
            actor.role,
            resolved_target,
            source_id,
            provider_id,
            model,
            prompt_version,
            rubric_version,
            clean_claim,
            clean_evidence,
            evidence_hash,
            resolved_scope,
        )
        await record_riwi_audit(
            conn,
            actor_user_id=actor.id,
            action="riwi.learning.signal.created",
            target_type="riwi_learning_signal",
            target_id=sig_id,
            metadata={"signalId": sig_id, "role": actor.role, "status": "candidate"},
        )

    return {"id": sig_id, "state": "candidate", "signalType": signal_type}


async def submit_riwi_student_feedback(
    conn: Any,
    *,
    actor: RiwiActor,
    correlation_id: str | None = None,
    rating: str | None = None,
    conversation_id: str | None = None,
    helpful: bool | None = None,
    reason: str | None = None,
) -> dict[str, Any]:
    if actor.role != "student" or not authorize_capability(actor, "riwi.feedback.student").allowed:
        raise LearningServiceError("forbidden")
    resolved_id = (correlation_id or conversation_id or "").strip()
    resolved_rating = (
        rating
        if rating in ("helpful", "not_helpful")
        else ("helpful" if helpful is True else "not_helpful" if helpful is False else "")
    )
    if not isinstance(resolved_id, str) or not UUID_RE.match(resolved_id) or resolved_rating not in ("helpful", "not_helpful"):
        raise LearningServiceError("invalid_input")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise LearningServiceError("not_found")

    req_row = await conn.fetchrow(
        """
        SELECT metadata
        FROM audit_log
        WHERE actor_user_id = $1::uuid
          AND action = 'riwi.request.completed'
          AND target_type = 'riwi_request'
          AND target_id = $2
        LIMIT 1
        """,
        actor.id,
        resolved_id,
    )
    answer_source = None
    if req_row:
        meta = req_row["metadata"]
        if isinstance(meta, str):
            try:
                meta = json.loads(meta)
            except Exception:
                meta = None
        if isinstance(meta, dict) and meta.get("status") == "succeeded" and meta.get("answerSource") in SUCCESSFUL_RESPONSE_SOURCES:
            answer_source = meta.get("answerSource")

    if not answer_source and conversation_id:
        conv_row = await conn.fetchrow(
            "SELECT id::text AS id, user_id::text AS user_id FROM riwi_conversations WHERE id = $1::uuid LIMIT 1",
            resolved_id,
        )
        if conv_row and str(conv_row.get("user_id") or "").lower() == actor.id.lower():
            answer_source = "canonical_dictionary"

    if not answer_source:
        raise LearningServiceError("not_found")

    clean_reason = redact_external_text((reason or "").strip(), 400).strip()
    claim_suffix = f" ({clean_reason})" if clean_reason else ""
    sig = await create_learning_signal(
        conn,
        actor=actor,
        signal_type="user_feedback",
        source_id=resolved_id,
        target_user_id=actor.id,
        scope="user",
        candidate_claim=f"Student marked a RIWI answer as {resolved_rating.replace('_', ' ')}{claim_suffix}.",
        evidence_summary=f"rating={resolved_rating}; answer_source={answer_source}; correlation={resolved_id}; answer_text=omitted",
    )
    return {"recorded": True, **sig}


async def review_learning_signal(
    conn: Any,
    *,
    actor: RiwiActor,
    signal_id: str,
    decision: str,
    reason: str,
    regression_fixture_id: str | None = None,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.review").allowed:
        raise LearningServiceError("forbidden")
    if not isinstance(signal_id, str) or not UUID_RE.match(signal_id) or decision not in ("approve", "reject", "request_changes"):
        raise LearningServiceError("invalid_input")
    clean_reason = redact_external_text((reason or "").strip(), 1000).strip()
    if not clean_reason:
        raise LearningServiceError("invalid_input")
    if decision == "approve" and not is_riwi_regression_fixture(regression_fixture_id):
        raise LearningServiceError("regression_required")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise LearningServiceError("not_found")

    sig = await conn.fetchrow(
        "SELECT id::text AS id, state::text AS state, evidence_hash FROM riwi_learning_signals WHERE id = $1::uuid LIMIT 1",
        signal_id,
    )
    if not sig:
        raise LearningServiceError("not_found")
    if sig["state"] not in ("candidate", "in_review"):
        raise LearningServiceError("invalid_state")

    regression = run_riwi_regression_suite(sig["evidence_hash"]) if decision == "approve" else None
    if decision == "approve" and (not regression or not regression["passed"]):
        raise LearningServiceError("regression_required")

    review_id = str(uuid.uuid4())
    new_state = "accepted" if decision == "approve" else "rejected" if decision == "reject" else "in_review"
    now = datetime.now(timezone.utc) if regression else None
    await conn.execute(
        """
        INSERT INTO riwi_learning_reviews (
            id, signal_id, reviewer_user_id, decision, reason,
            regression_fixture_id, regression_evidence_hash, regression_passed_at
        ) VALUES (
            $1::uuid, $2::uuid, $3::uuid, $4::riwi_review_decision, $5,
            $6, $7, $8::timestamptz
        )
        """,
        review_id,
        signal_id,
        actor.id,
        decision,
        clean_reason,
        regression_fixture_id if decision == "approve" else None,
        regression["evidenceHash"] if regression else None,
        now,
    )
    await conn.execute(
        "UPDATE riwi_learning_signals SET state = $2::riwi_learning_signal_state WHERE id = $1::uuid",
        signal_id,
        new_state,
    )
    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.learning.reviewed",
        target_type="riwi_learning_signal",
        target_id=signal_id,
        metadata={
            "signalId": signal_id,
            "role": actor.role,
            "status": new_state,
            "decision": decision,
            "regressionFixtureId": regression_fixture_id if decision == "approve" else None,
        },
    )
    return {"signalId": signal_id, "reviewId": review_id, "state": new_state}


async def create_knowledge_candidate_from_learning_signal(
    conn: Any,
    *,
    actor: RiwiActor,
    signal_id: str,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.promote").allowed:
        raise LearningServiceError("forbidden")
    if not isinstance(signal_id, str) or not UUID_RE.match(signal_id):
        raise LearningServiceError("invalid_input")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise LearningServiceError("not_found")

    sig = await conn.fetchrow(
        """
        SELECT id::text AS id, signal_type::text AS signal_type, state::text AS state,
               target_user_id::text AS target_user_id, candidate_claim, evidence_hash, scope::text AS scope
        FROM riwi_learning_signals
        WHERE id = $1::uuid
        LIMIT 1
        """,
        signal_id,
    )
    if not sig:
        raise LearningServiceError("not_found")
    if sig["state"] != "accepted":
        raise LearningServiceError("invalid_state")

    source_type = (
        "teacher_correction"
        if sig["signal_type"] == "teacher_correction"
        else "owner_correction"
        if sig["signal_type"] in ("owner_correction", "manual_qa_finding")
        else None
    )
    if not source_type:
        raise LearningServiceError("promotion_blocked")

    scope_dict = (
        {"kind": "global"}
        if sig["scope"] == "global"
        else {"kind": "user", "userId": sig["target_user_id"]}
        if sig["target_user_id"]
        else None
    )
    if not scope_dict:
        raise LearningServiceError("promotion_blocked")

    candidate = await create_knowledge_candidate(
        conn,
        actor=actor,
        source_type=source_type,
        title=f"Accepted {sig['signal_type'].replace('_', ' ')} learning signal",
        provenance=f"RIWI accepted {sig['signal_type'].replace('_', ' ')} correction; owner-reviewed learning evidence",
        rights_class="internal_permission",
        scope=scope_dict,
        content=sig["candidate_claim"],
    )
    return {
        "replayed": False,
        "signalId": signal_id,
        **candidate,
        "scope": scope_dict["kind"],
    }
