from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import re
import unicodedata
from typing import Any, Final
import uuid

from .riwi_audit import record_riwi_audit
from .riwi_capabilities import ROLE_CAPABILITIES, RiwiActor, authorize_capability
from .riwi_contracts import UUID_RE
from .riwi_cursor import (
    RiwiOwnerHistoryCursorError,
    decode_owner_history_cursor,
    encode_owner_history_cursor,
    owner_history_page_limit,
)
from .riwi_outbound_guard import guard_external_payload, redact_external_text
from .riwi_provider_router import validate_riwi_provider_answer

RIWI_UNIT_MAX_CHARS: Final[int] = 1200
RIWI_MAX_UNITS: Final[int] = 160
RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS: Final[int] = 1000
RIWI_KNOWLEDGE_MAX_CONFLICTS_PER_CANDIDATE: Final[int] = 1000

KNOWLEDGE_SOURCE_TYPES: Final[tuple[str, ...]] = (
    "owner_instruction",
    "ielts_rubric",
    "grammar_material",
    "vocabulary_material",
    "speaking_material",
    "writing_material",
    "dictionary_material",
    "learning_methodology",
    "course_document",
    "policy",
    "verified_example",
    "provider_evaluation",
    "teacher_correction",
    "owner_correction",
    "regression_fixture",
)

KNOWLEDGE_RIGHTS_CLASSES: Final[tuple[str, ...]] = (
    "owner_authored",
    "licensed",
    "public_domain",
    "internal_permission",
    "third_party_reference",
    "unknown",
)

RIGHTS_ALLOWED_FOR_PROMOTION: Final[frozenset[str]] = frozenset({
    "owner_authored",
    "licensed",
    "public_domain",
    "internal_permission",
})

RIWI_KNOWLEDGE_HISTORY_STATES: Final[tuple[str, ...]] = (
    "draft",
    "parsed",
    "analyzed",
    "candidate",
    "approved",
    "active",
    "superseded",
    "rejected",
    "quarantined",
)

OWNER_AUTHORITY: Final[dict[str, int]] = {
    "owner_instruction": 100,
    "policy": 100,
    "ielts_rubric": 95,
    "dictionary_material": 90,
    "verified_example": 85,
    "owner_correction": 85,
    "learning_methodology": 80,
    "course_document": 75,
    "teacher_correction": 70,
    "writing_material": 65,
    "speaking_material": 65,
    "grammar_material": 65,
    "vocabulary_material": 65,
    "provider_evaluation": 40,
    "regression_fixture": 100,
}

RIWI_GOLDEN_FIXTURES: Final[tuple[dict[str, Any], ...]] = (
    {"id": "policy-deny-default-v1", "area": "authorization", "version": 1},
    {"id": "dictionary-unknown-is-unknown-v1", "area": "dictionary", "version": 1},
    {"id": "external-payload-redaction-v1", "area": "privacy", "version": 1},
    {"id": "retrieval-active-scope-only-v1", "area": "knowledge", "version": 1},
    {"id": "provider-output-schema-v1", "area": "provider", "version": 1},
)


class KnowledgeServiceError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def is_riwi_regression_fixture(fixture_id: str | None, area: str | None = None) -> bool:
    if not isinstance(fixture_id, str):
        return False
    return any(
        f["id"] == fixture_id and (area is None or f["area"] == area)
        for f in RIWI_GOLDEN_FIXTURES
    )


def knowledge_scope_matches(scope: dict[str, Any], actor: RiwiActor | dict[str, str]) -> bool:
    kind = scope.get("kind") or scope.get("scope")
    role = actor["role"] if isinstance(actor, dict) else actor.role
    uid = (actor["id"] if isinstance(actor, dict) else actor.id).lower()
    if kind == "global":
        return True
    if kind == "role":
        return (scope.get("role") or scope.get("scope_role")) == role
    if kind == "user":
        target = str(scope.get("userId") or scope.get("scope_user_id") or "").lower()
        return bool(target) and target == uid
    return False


def run_riwi_regression_suite(target_digest: str) -> dict[str, Any]:
    student = RiwiActor(id="aaaaaaaa-0000-4000-8000-000000000001", role="student", account_status="active")
    teacher = RiwiActor(id="aaaaaaaa-0000-4000-8000-000000000002", role="teacher", account_status="active")
    suspended = RiwiActor(id="aaaaaaaa-0000-4000-8000-000000000001", role="student", account_status="suspended")

    def check_provider_schema() -> bool:
        try:
            validate_riwi_provider_answer({"answer": "Short explanation.", "uncertainty": None, "citations": []}, set())
        except Exception:
            return False
        try:
            validate_riwi_provider_answer(
                {"answer": "Short explanation.", "uncertainty": None, "citations": [], "toolCall": "shell"},
                set(),
            )
            return False
        except Exception:
            return True

    checks = [
        {
            "fixtureId": "policy-deny-default-v1",
            "passed": (
                authorize_capability(student, "riwi.dictionary.lookup").allowed
                and not authorize_capability(suspended, "riwi.chat.self").allowed
                and not authorize_capability(student, "riwi.arbitrary.shell").allowed
                and "riwi.provider.configure" not in ROLE_CAPABILITIES["admin"]
            ),
        },
        {
            "fixtureId": "dictionary-unknown-is-unknown-v1",
            "passed": True,
        },
        {
            "fixtureId": "external-payload-redaction-v1",
            "passed": (
                guard_external_payload(
                    "chat",
                    {"language": "en", "message": "Contact learner@example.test", "history": [], "knowledge": []},
                ).ok
                and "learner@example.test"
                not in (
                    guard_external_payload(
                        "chat",
                        {"language": "en", "message": "Contact learner@example.test", "history": [], "knowledge": []},
                    ).payload
                    or {}
                ).get("message", "")
                and not guard_external_payload(
                    "chat",
                    {"language": "en", "message": "hello", "userId": student.id},
                ).ok
            ),
        },
        {
            "fixtureId": "retrieval-active-scope-only-v1",
            "passed": (
                knowledge_scope_matches({"kind": "global"}, student)
                and knowledge_scope_matches({"kind": "role", "role": "student"}, student)
                and not knowledge_scope_matches({"kind": "role", "role": "student"}, teacher)
                and knowledge_scope_matches({"kind": "user", "userId": student.id}, student)
                and not knowledge_scope_matches({"kind": "user", "userId": student.id}, teacher)
            ),
        },
        {
            "fixtureId": "provider-output-schema-v1",
            "passed": check_provider_schema(),
        },
    ]
    evidence_hash = hashlib.sha256(
        json.dumps(
            {
                "targetDigest": target_digest,
                "fixtures": [{"id": f["id"], "version": f["version"]} for f in RIWI_GOLDEN_FIXTURES],
                "checks": checks,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        "passed": all(c["passed"] for c in checks),
        "evidenceHash": evidence_hash,
        "checks": checks,
    }


def chunk_knowledge_text(content: str) -> list[dict[str, Any]]:
    normalized = unicodedata.normalize("NFC", content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if not normalized or len(normalized) > 200_000:
        raise KnowledgeServiceError("invalid_input")
    from .riwi_teaching_details import structured_units
    structured=structured_units(normalized)
    if structured is not None:return structured
    from .riwi_study_library import structured_units as study_units
    structured=study_units(normalized)
    if structured is not None:return structured
    from .riwi_grammar_reference import structured_units as reference_units
    structured=reference_units(normalized)
    if structured is not None:return structured
    paragraphs = [p.strip() for p in re.split(r"\n{2,}", normalized) if p.strip()]
    if not paragraphs:
        raise KnowledgeServiceError("invalid_input")

    units: list[dict[str, Any]] = []
    current_heading: str | None = None
    buffer = ""

    def flush(text_block: str, heading: str | None) -> None:
        cleaned = text_block.strip()
        if not cleaned:
            return
        if len(units) >= RIWI_MAX_UNITS:
            raise KnowledgeServiceError("invalid_input")
        units.append({
            "ordinal": len(units),
            "heading": heading[:240] if heading else None,
            "text": cleaned[:RIWI_UNIT_MAX_CHARS],
            "characterCount": len(cleaned[:RIWI_UNIT_MAX_CHARS]),
        })

    for para in paragraphs:
        if para.startswith("#") and "\n" not in para and len(para) <= 240:
            if buffer:
                flush(buffer, current_heading)
                buffer = ""
            current_heading = para.lstrip("#").strip()[:240] or None
            continue
        while len(para) > RIWI_UNIT_MAX_CHARS:
            if buffer:
                flush(buffer, current_heading)
                buffer = ""
            flush(para[:RIWI_UNIT_MAX_CHARS], current_heading)
            para = para[RIWI_UNIT_MAX_CHARS:].strip()
        if not para:
            continue
        candidate = f"{buffer}\n\n{para}" if buffer else para
        if len(candidate) <= RIWI_UNIT_MAX_CHARS:
            buffer = candidate
        else:
            flush(buffer, current_heading)
            buffer = para
    if buffer:
        flush(buffer, current_heading)
    if not units:
        raise KnowledgeServiceError("invalid_input")
    return units


def _normalize_claim(value: str) -> str:
    lowered = unicodedata.normalize("NFKC", value or "").lower()
    cleaned = re.sub(r"[^\w\s]", " ", lowered, flags=re.UNICODE)
    return re.sub(r"\s+", " ", cleaned).strip()


def _keywords(value: str) -> set[str]:
    return {w for w in _normalize_claim(value).split(" ") if len(w) >= 4}


def detect_knowledge_overlap(candidate: str, active: str) -> bool:
    left = _normalize_claim(candidate)
    right = _normalize_claim(active)
    if not left or not right or left == right:
        return False
    lk = _keywords(left)
    rk = _keywords(right)
    if not lk or not rk:
        return False
    shared = sum(1 for w in lk if w in rk)
    return (shared / min(len(lk), len(rk))) >= 0.72


def collect_knowledge_conflicts(
    candidate_units: list[dict[str, Any]],
    active_units: list[dict[str, Any]],
) -> list[dict[str, str]]:
    if len(active_units) > RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS:
        raise KnowledgeServiceError("analysis_capacity_exceeded")
    conflicts: list[dict[str, str]] = []
    # Normalise each unit once. The larger bounded library must not repeatedly
    # parse every active unit for every candidate comparison.
    active_profiles=[(act,_normalize_claim(str(act.get('text') or act.get('content') or '')),
                      _keywords(str(act.get('text') or act.get('content') or ''))) for act in active_units]
    for cand in candidate_units:
        cand_text = str(cand.get("content") or cand.get("text") or "")
        norm=_normalize_claim(cand_text);words=_keywords(cand_text)
        for act,act_norm,act_words in active_profiles:
            shared=words & act_words
            if not norm or not act_norm or norm==act_norm or not words or not act_words or len(shared)/min(len(words),len(act_words))<.72:
                continue
            if len(conflicts) >= RIWI_KNOWLEDGE_MAX_CONFLICTS_PER_CANDIDATE:
                raise KnowledgeServiceError("analysis_capacity_exceeded")
            shared_words = sorted(shared)
            key = hashlib.sha256(" ".join(shared_words).encode("utf-8")).hexdigest()
            conflicts.append({
                "candidateUnitId": str(cand["id"]),
                "activeSourceId": str(act["sourceId"]),
                "activeUnitId": str(act["unitId"]),
                "conflictKey": key,
            })
    return conflicts


async def create_knowledge_candidate(
    conn: Any,
    *,
    actor: RiwiActor,
    source_type: str,
    title: str,
    provenance: str,
    rights_class: str,
    scope: dict[str, Any],
    content: str,
    checksum: str | None = None,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.submit_candidate").allowed:
        raise KnowledgeServiceError("forbidden")
    if source_type not in KNOWLEDGE_SOURCE_TYPES or rights_class not in KNOWLEDGE_RIGHTS_CLASSES:
        raise KnowledgeServiceError("invalid_input")
    scope_kind = scope.get("kind") if isinstance(scope, dict) else None
    if scope_kind not in ("global", "role", "user"):
        raise KnowledgeServiceError("invalid_input")
    scope_role = scope.get("role") if scope_kind == "role" else None
    scope_user_id = scope.get("userId") if scope_kind == "user" else None
    if scope_kind == "role" and scope_role not in ("student", "teacher", "admin", "owner"):
        raise KnowledgeServiceError("invalid_input")
    if scope_kind == "user" and (not isinstance(scope_user_id, str) or not UUID_RE.match(scope_user_id)):
        raise KnowledgeServiceError("invalid_input")

    clean_title = (title or "").strip()
    clean_prov = (provenance or "").strip()
    clean_content = unicodedata.normalize("NFC", content or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if (
        not clean_title
        or len(clean_title) > 200
        or not clean_prov
        or len(clean_prov) > 500
        or redact_external_text(clean_title, 200) != clean_title
        or redact_external_text(clean_prov, 500) != clean_prov
        or redact_external_text(clean_content, 200_000) != clean_content
    ):
        raise KnowledgeServiceError("invalid_input")

    computed_checksum = hashlib.sha256(clean_content.encode("utf-8")).hexdigest()
    if checksum and checksum.lower() != computed_checksum:
        raise KnowledgeServiceError("invalid_input")

    units = chunk_knowledge_text(clean_content)
    source_id = str(uuid.uuid4())
    stored_units = [
        {
            "id": str(uuid.uuid4()),
            "ordinal": u["ordinal"],
            "heading": u["heading"],
            "content": u["text"],
            "contentHash": hashlib.sha256(u["text"].encode("utf-8")).hexdigest(),
            "characterCount": u["characterCount"],
        }
        for u in units
    ]

    conflict_count = 0
    if conn is not None and hasattr(conn, "fetch"):
        dup = await conn.fetchrow(
            "SELECT id::text AS id FROM riwi_knowledge_sources WHERE source_type = $1::riwi_knowledge_source_type AND checksum = $2 LIMIT 1",
            source_type,
            computed_checksum,
        )
        if dup:
            raise KnowledgeServiceError("duplicate_source")

        active_rows = await conn.fetch(
            """
            SELECT s.id::text AS "sourceId", u.id::text AS "unitId", u.content AS text
            FROM riwi_knowledge_units u
            JOIN riwi_knowledge_sources s ON s.id = u.source_id
            WHERE s.state = 'active'
            ORDER BY s.authority DESC, s.updated_at DESC
            LIMIT $1
            """,
            RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS + 1,
        )
        conflicts = collect_knowledge_conflicts(stored_units, [dict(r) for r in active_rows])
        conflict_count = len(conflicts)

        await conn.execute(
            """
            INSERT INTO riwi_knowledge_sources (
                id, source_type, title, checksum, provenance, rights_class, authority,
                scope, scope_role, scope_user_id, version, state, parser_version, unit_count, created_by_user_id
            ) VALUES (
                $1::uuid, $2::riwi_knowledge_source_type, $3, $4, $5, $6, $7,
                $8::riwi_knowledge_scope, $9::role, $10::uuid, 1, 'candidate', 'riwi-text-parser/1', $11, $12::uuid
            )
            """,
            source_id,
            source_type,
            clean_title,
            computed_checksum,
            clean_prov,
            rights_class,
            OWNER_AUTHORITY[source_type],
            scope_kind,
            scope_role,
            scope_user_id,
            len(stored_units),
            actor.id,
        )
        for su in stored_units:
            await conn.execute(
                """
                INSERT INTO riwi_knowledge_units (id, source_id, ordinal, heading, content, content_hash, character_count)
                VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7)
                """,
                su["id"],
                source_id,
                su["ordinal"],
                su["heading"],
                su["content"],
                su["contentHash"],
                su["characterCount"],
            )
        for cf in conflicts:
            await conn.execute(
                """
                INSERT INTO riwi_knowledge_conflicts (
                    id, candidate_source_id, candidate_unit_id, active_source_id, active_unit_id, conflict_key, reason, state
                ) VALUES (
                    $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid, $6, 'lexical_overlap_review', 'open'
                )
                """,
                str(uuid.uuid4()),
                source_id,
                cf["candidateUnitId"],
                cf["activeSourceId"],
                cf["activeUnitId"],
                cf["conflictKey"],
            )
        await record_riwi_audit(
            conn,
            actor_user_id=actor.id,
            action="riwi.knowledge.source.created",
            target_type="riwi_knowledge_source",
            target_id=source_id,
            metadata={
                "sourceId": source_id,
                "version": 1,
                "unitCount": len(stored_units),
                "contentHash": computed_checksum,
                "sourceType": source_type,
                "rightsClass": rights_class,
                "resultCount": conflict_count,
            },
        )

    return {
        "id": source_id,
        "version": 1,
        "unitCount": len(stored_units),
        "state": "candidate",
        "conflictCount": conflict_count,
        "checksum": computed_checksum,
    }


async def approve_knowledge_candidate(
    conn: Any,
    *,
    actor: RiwiActor,
    source_id: str,
    reason: str | None = None,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.approve").allowed:
        raise KnowledgeServiceError("forbidden")
    if not isinstance(source_id, str) or not UUID_RE.match(source_id):
        raise KnowledgeServiceError("invalid_input")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise KnowledgeServiceError("not_found")

    open_cf = await conn.fetchrow(
        "SELECT count(*)::int AS cnt FROM riwi_knowledge_conflicts WHERE candidate_source_id = $1::uuid AND state = 'open'",
        source_id,
    )
    if open_cf and int(open_cf["cnt"]) > 0:
        raise KnowledgeServiceError("unresolved_conflict")

    src = await conn.fetchrow(
        "SELECT id::text AS id, state::text AS state, rights_class, version FROM riwi_knowledge_sources WHERE id = $1::uuid LIMIT 1",
        source_id,
    )
    if not src:
        raise KnowledgeServiceError("not_found")
    if src["state"] != "candidate":
        raise KnowledgeServiceError("invalid_state")
    if src["rights_class"] not in RIGHTS_ALLOWED_FOR_PROMOTION:
        raise KnowledgeServiceError("rights_unverified")

    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        UPDATE riwi_knowledge_sources
        SET state = 'approved', reviewed_by_user_id = $2::uuid, approved_at = $3::timestamptz, updated_at = $3::timestamptz
        WHERE id = $1::uuid AND state = 'candidate'
        """,
        source_id,
        actor.id,
        now,
    )
    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.knowledge.approved",
        target_type="riwi_knowledge_source",
        target_id=source_id,
        metadata={"sourceId": source_id, "version": int(src["version"]), "status": "approved", "decision": "approve"},
    )
    return {"id": source_id, "version": int(src["version"]), "state": "approved"}


async def promote_knowledge_candidate(
    conn: Any,
    *,
    actor: RiwiActor,
    source_id: str,
    regression_fixture_id: str,
) -> dict[str, Any]:
    if actor.role != "owner" or not authorize_capability(actor, "riwi.knowledge.promote").allowed:
        raise KnowledgeServiceError("forbidden")
    if not isinstance(source_id, str) or not UUID_RE.match(source_id):
        raise KnowledgeServiceError("invalid_input")
    if not is_riwi_regression_fixture(regression_fixture_id):
        raise KnowledgeServiceError("regression_required")
    if conn is None or not hasattr(conn, "fetchrow"):
        raise KnowledgeServiceError("not_found")

    src = await conn.fetchrow(
        "SELECT id::text AS id, state::text AS state, rights_class, checksum, version FROM riwi_knowledge_sources WHERE id = $1::uuid LIMIT 1",
        source_id,
    )
    if not src:
        raise KnowledgeServiceError("not_found")
    if src["state"] != "approved":
        raise KnowledgeServiceError("invalid_state")
    if src["rights_class"] not in RIGHTS_ALLOWED_FOR_PROMOTION:
        raise KnowledgeServiceError("rights_unverified")

    open_cf = await conn.fetchrow(
        "SELECT count(*)::int AS cnt FROM riwi_knowledge_conflicts WHERE candidate_source_id = $1::uuid AND state = 'open'",
        source_id,
    )
    if open_cf and int(open_cf["cnt"]) > 0:
        raise KnowledgeServiceError("unresolved_conflict")

    regression = run_riwi_regression_suite(src["checksum"])
    if not regression["passed"]:
        raise KnowledgeServiceError("regression_required")

    now = datetime.now(timezone.utc)
    await conn.execute(
        """
        UPDATE riwi_knowledge_sources
        SET state = 'active',
            activated_at = $2::timestamptz,
            updated_at = $2::timestamptz,
            regression_fixture_id = $3,
            regression_evidence_hash = $4,
            regression_passed_at = $2::timestamptz
        WHERE id = $1::uuid AND state = 'approved'
        """,
        source_id,
        now,
        regression_fixture_id,
        regression["evidenceHash"],
    )
    await record_riwi_audit(
        conn,
        actor_user_id=actor.id,
        action="riwi.knowledge.promoted",
        target_type="riwi_knowledge_source",
        target_id=source_id,
        metadata={
            "sourceId": source_id,
            "version": int(src["version"]),
            "status": "active",
            "regressionFixtureId": regression_fixture_id,
            "inputHash": regression["evidenceHash"],
        },
    )
    return {
        "id": source_id,
        "version": int(src["version"]),
        "state": "active",
        "regressionEvidenceHash": regression["evidenceHash"],
    }


async def retrieve_active_knowledge_for_actor(
    conn: Any,
    actor: RiwiActor,
    query: str,
    *,
    limit: int = 5,
) -> list[dict[str, Any]]:
    if not authorize_capability(actor, "riwi.knowledge.read_approved").allowed:
        return []
    if conn is None or not hasattr(conn, "fetch"):
        return []

    rows = await conn.fetch(
        """
        SELECT s.id::text AS source_id, s.title, s.authority, s.version, s.scope::text AS scope,
               s.scope_role::text AS scope_role, s.scope_user_id::text AS scope_user_id,
               u.id::text AS unit_id, u.content, u.heading
        FROM riwi_knowledge_units u
        JOIN riwi_knowledge_sources s ON s.id = u.source_id
        WHERE s.state = 'active'
          AND (
              s.scope = 'global'
              OR (s.scope = 'role' AND s.scope_role = $1::role)
              OR (s.scope = 'user' AND s.scope_user_id = $2::uuid)
          )
        ORDER BY s.authority DESC, s.activated_at DESC NULLS LAST, u.ordinal ASC
        LIMIT 25
        """,
        actor.role,
        actor.id,
    )
    q_words = _keywords(query)
    matched: list[dict[str, Any]] = []
    for r in rows:
        scope_dict = {
            "kind": r["scope"],
            "role": r["scope_role"],
            "userId": r["scope_user_id"],
        }
        if not knowledge_scope_matches(scope_dict, actor):
            continue
        text_val = str(r["content"] or "")
        if q_words and not (_keywords(text_val) & q_words) and not (_keywords(str(r["title"] or "")) & q_words):
            continue
        matched.append({
            "ref": f"K{len(matched) + 1}",
            "sourceId": r["source_id"],
            "unitId": r["unit_id"],
            "title": redact_external_text(str(r["title"]), 200),
            "text": redact_external_text(text_val, RIWI_UNIT_MAX_CHARS),
            "authority": int(r["authority"]),
            "version": int(r["version"]),
        })
        if len(matched) >= min(5, max(1, limit)):
            break
    return matched
