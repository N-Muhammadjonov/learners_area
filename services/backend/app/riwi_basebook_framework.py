"""Phase D — Owner Prompt Basebook Integration Framework.

Provides structured ingestion, requirement extraction, traceable requirement-to-capability-to-test
mapping, conflict detection, and rubric versioning for the Owner's RIWI Prompt Basebook.
Until the Owner supplies the actual Basebook, status remains explicitly `AWAITING_OWNER_BASEBOOK`
and `compliance_certified` is strictly `False`.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import re
from typing import Any, Final, Mapping

from .riwi_assessment_contracts import ASSESSMENT_CONTRACT_KEYS, HARD_CORE_RULES


BASEBOOK_REQUIRED_DOMAINS: Final[tuple[str, ...]] = (
    "riwi_role_and_behavior",
    "supported_task_evaluation",
    "writing_scoring_rules",
    "speaking_scoring_rules",
    "student_feedback_structure",
    "error_identification_and_correction",
    "owner_priorities",
    "knowledge_handling",
    "personalization_and_progression",
    "security_and_privacy",
)

DOMAIN_HEADING_KEYWORDS: Final[dict[str, tuple[str, ...]]] = {
    "riwi_role_and_behavior": ("role", "behavior", "behaviour", "persona", "identity", "purpose"),
    "supported_task_evaluation": ("task", "objective", "reading", "listening", "grammar", "vocabulary", "exercise"),
    "writing_scoring_rules": ("writing", "task 1", "task 2", "essay", "letter", "coherence", "lexical", "task achievement", "task response"),
    "speaking_scoring_rules": ("speaking", "fluency", "pronunciation", "part 1", "part 2", "part 3", "audio", "transcript"),
    "student_feedback_structure": ("feedback", "structure", "tone", "uzbek", "latin", "strengths", "weaknesses", "next actions"),
    "error_identification_and_correction": ("error", "correction", "issue", "evidence", "excerpt", "suggestion", "mistake"),
    "owner_priorities": ("priority", "priorities", "owner", "band-limiting", "focus", "weight"),
    "knowledge_handling": ("knowledge", "book", "source", "provenance", "citation", "chunk", "conflict"),
    "personalization_and_progression": ("personalization", "progression", "mastery", "weakness", "history", "adaptive"),
    "security_and_privacy": ("security", "privacy", "trust", "injection", "redaction", "pii", "exception", "confidence", "abstain"),
}

IMMUTABLE_SECURITY_INVARIANTS: Final[dict[str, str]] = {
    "no_text_only_pronunciation": "Pronunciation cannot be scored from a transcript alone without verified acoustic evidence.",
    "no_silent_external_pii": "Learner identity (user_id, email, phone, telegram_id) must never be sent to external AI providers.",
    "untrusted_learner_input": "Learner submissions and uploaded texts are untrusted data and can never override rubric or security rules.",
    "uzbek_latin_script": "Uzbek learner-facing feedback must use Latin script only.",
    "no_fabricated_evidence": "Quoted excerpts in issues must be verbatim substrings of the learner's submitted work.",
}


@dataclass(frozen=True)
class BasebookRequirement:
    requirement_id: str
    domain: str
    section_title: str
    rule_text: str
    priority: str  # "mandatory" | "recommended" | "optional"
    contract_keys: tuple[str, ...]
    evaluator_capability: str
    implementation_module: str
    acceptance_test_id: str
    verification_status: str  # "verified_baseline" | "awaiting_owner_basebook" | "conflict_detected"


@dataclass(frozen=True)
class BasebookConflict:
    conflict_id: str
    severity: str  # "blocking" | "warning"
    domain: str
    description: str
    rule_excerpt: str
    resolution_policy: str


@dataclass
class BasebookIngestionReport:
    status: str  # "AWAITING_OWNER_BASEBOOK" | "INGESTED_VALIDATED" | "INGESTED_WITH_CONFLICTS"
    basebook_supplied: bool
    compliance_certified: bool
    basebook_version: str | None
    basebook_sha256: str | None
    ingested_at: str
    present_domains: list[str]
    missing_domains: list[str]
    requirements: list[dict[str, Any]]
    conflicts: list[dict[str, Any]]
    traceability_summary: dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _classify_domain(heading: str, body: str) -> str:
    combined = f"{heading} {body}".lower()
    best_domain = "supported_task_evaluation"
    best_score = -1
    for domain, keywords in DOMAIN_HEADING_KEYWORDS.items():
        score = sum(3 if kw in heading.lower() else (1 if kw in combined else 0) for kw in keywords)
        if score > best_score:
            best_score = score
            best_domain = domain
    return best_domain


def _map_domain_to_capability_and_module(domain: str, rule_text: str) -> tuple[str, str, tuple[str, ...], str]:
    lower = rule_text.lower()
    if domain == "writing_scoring_rules":
        keys = tuple(k for k in ASSESSMENT_CONTRACT_KEYS if k.startswith("writing."))
        if "general training" in lower or "letter" in lower:
            return (
                "local_calibrated_language_model",
                "services/backend/app/riwi_independent_evaluator.py",
                ("writing.task1.generic", "writing.grade.task1"),
                "test_writing_gt_and_academic_task1_evaluation",
            )
        return (
            "local_calibrated_language_model",
            "services/backend/app/riwi_independent_evaluator.py",
            keys[:8],
            "test_writing_four_criterion_calibrated_evaluation",
        )
    if domain == "speaking_scoring_rules":
        keys = tuple(k for k in ASSESSMENT_CONTRACT_KEYS if k.startswith("speaking."))
        if "audio" in lower or "pause" in lower or "fluency" in lower or "pronunciation" in lower:
            return (
                "local_acoustic_fluency_analyzer",
                "services/backend/app/riwi_independent_evaluator.py",
                keys[:4],
                "test_speaking_acoustic_fluency_and_pronunciation_gate",
            )
        return (
            "local_calibrated_language_model",
            "services/backend/app/riwi_independent_evaluator.py",
            keys[:4],
            "test_speaking_parts_1_2_3_transcript_evaluation",
        )
    if domain == "knowledge_handling":
        return (
            "knowledge_retrieval",
            "services/backend/app/riwi_knowledge.py",
            ("tutoring.simple-explanation", "tutoring.compare-concepts"),
            "test_knowledge_ingestion_provenance_and_retrieval",
        )
    if domain == "security_and_privacy":
        return (
            "security_guard",
            "services/backend/app/riwi_outbound_guard.py",
            ("writing.task2.generic", "speaking.part1"),
            "test_security_boundaries_and_abstention_gates",
        )
    if domain == "error_identification_and_correction":
        return (
            "deterministic_and_statistical_error_detector",
            "services/backend/app/riwi_independent_evaluator.py",
            ("grammar.correct-it", "writing.grade.task2", "speaking.part2"),
            "test_verbatim_error_evidence_and_correction_precision",
        )
    if domain == "personalization_and_progression":
        return (
            "deterministic_progression_engine",
            "services/backend/app/step31_coach.py",
            ("reporting.progress", "reporting.priorities"),
            "test_learner_weakness_progression_lifecycle",
        )
    return (
        "deterministic_engine",
        "services/backend/app/riwi_independent_evaluator.py",
        ("reading.true-false-not-given", "listening.multiple-choice", "grammar.correct-it", "vocabulary.use-in-sentence"),
        "test_deterministic_objective_and_structural_evaluators",
    )


def detect_basebook_conflicts(domain: str, rule_text: str, idx: int) -> list[BasebookConflict]:
    conflicts: list[BasebookConflict] = []
    lower = rule_text.lower()
    if (
        "pronunciation" in lower
        and ("from transcript" in lower or "estimate pronunciation from text" in lower or "always score pronunciation" in lower)
        and "without audio" not in lower
        and "null" not in lower
    ):
        conflicts.append(
            BasebookConflict(
                conflict_id=f"BB-CONFLICT-{idx:03d}-PRON",
                severity="blocking",
                domain=domain,
                description="Rule appears to require pronunciation band scoring without verified acoustic/audio evidence.",
                rule_excerpt=rule_text[:240],
                resolution_policy=IMMUTABLE_SECURITY_INVARIANTS["no_text_only_pronunciation"],
            )
        )
    if "send email" in lower or "include user_id" in lower or "raw student profile to openai" in lower:
        conflicts.append(
            BasebookConflict(
                conflict_id=f"BB-CONFLICT-{idx:03d}-PII",
                severity="blocking",
                domain=domain,
                description="Rule conflicts with external provider PII minimization guard.",
                rule_excerpt=rule_text[:240],
                resolution_policy=IMMUTABLE_SECURITY_INVARIANTS["no_silent_external_pii"],
            )
        )
    if "cyrillic" in lower and "uzbek" in lower and "allow cyrillic" in lower:
        conflicts.append(
            BasebookConflict(
                conflict_id=f"BB-CONFLICT-{idx:03d}-SCRIPT",
                severity="warning",
                domain=domain,
                description="Rule conflicts with canonical Uzbek Latin-script requirement.",
                rule_excerpt=rule_text[:240],
                resolution_policy=IMMUTABLE_SECURITY_INVARIANTS["uzbek_latin_script"],
            )
        )
    return conflicts


def build_default_awaiting_basebook_report() -> BasebookIngestionReport:
    """Return honest baseline report when the Owner has not yet supplied the RIWI Prompt Basebook."""
    baseline_requirements: list[BasebookRequirement] = []
    for idx, domain in enumerate(BASEBOOK_REQUIRED_DOMAINS, start=1):
        cap, mod, keys, test_id = _map_domain_to_capability_and_module(domain, domain)
        baseline_requirements.append(
            BasebookRequirement(
                requirement_id=f"PRE-BB-{idx:03d}",
                domain=domain,
                section_title=f"Baseline Contract Specification ({domain})",
                rule_text=(
                    f"Pre-Basebook canonical contract rule for {domain}; awaiting Owner's authoritative "
                    f"RIWI Prompt Basebook for final threshold and policy sign-off."
                ),
                priority="mandatory",
                contract_keys=keys,
                evaluator_capability=cap,
                implementation_module=mod,
                acceptance_test_id=test_id,
                verification_status="awaiting_owner_basebook",
            )
        )
    return BasebookIngestionReport(
        status="AWAITING_OWNER_BASEBOOK",
        basebook_supplied=False,
        compliance_certified=False,
        basebook_version=None,
        basebook_sha256=None,
        ingested_at=datetime.now(timezone.utc).isoformat(),
        present_domains=[],
        missing_domains=list(BASEBOOK_REQUIRED_DOMAINS),
        requirements=[asdict(r) for r in baseline_requirements],
        conflicts=[],
        traceability_summary={
            "total_contracts_registered": len(ASSESSMENT_CONTRACT_KEYS),
            "baseline_capabilities_wired": len(baseline_requirements),
            "owner_basebook_received": False,
            "compliance_certified": False,
            "note": "Owner Basebook has not been supplied yet. Baseline IELTS/CEFR rules and safety invariants are active; final Basebook compliance is not certified until the Owner provides the Basebook.",
        },
    )


def ingest_owner_basebook(
    raw_content: str | Mapping[str, Any] | None,
    *,
    version_tag: str = "owner-basebook-v1",
) -> BasebookIngestionReport:
    """Parse, validate, and map an Owner-supplied RIWI Prompt Basebook."""
    if raw_content is None or (isinstance(raw_content, str) and not raw_content.strip()):
        return build_default_awaiting_basebook_report()

    if isinstance(raw_content, Mapping):
        serialized = json.dumps(dict(raw_content), sort_keys=True, ensure_ascii=False)
        sections: list[tuple[str, list[str]]] = []
        for sec_title, sec_body in raw_content.items():
            if isinstance(sec_body, list):
                sections.append((str(sec_title), [str(x).strip() for x in sec_body if str(x).strip()]))
            elif isinstance(sec_body, str):
                bullets = [
                    re.sub(r"^[-*•\d.)\s]+", "", line).strip()
                    for line in sec_body.splitlines()
                    if line.strip()
                ]
                sections.append((str(sec_title), [b for b in bullets if b]))
    else:
        text = str(raw_content)
        serialized = text
        sections = []
        current_heading = "General Basebook Rules"
        current_rules: list[str] = []
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            if line.startswith("#"):
                if current_rules:
                    sections.append((current_heading, current_rules))
                    current_rules = []
                current_heading = line.lstrip("#").strip()
            elif re.match(r"^([-*•]|\d+[.)])\s+", line):
                cleaned = re.sub(r"^([-*•]|\d+[.)])\s+", "", line).strip()
                if cleaned:
                    current_rules.append(cleaned)
            elif len(line) >= 20:
                current_rules.append(line)
        if current_rules:
            sections.append((current_heading, current_rules))

    sha256_hex = hashlib.sha256(serialized.encode("utf-8")).hexdigest()
    requirements: list[BasebookRequirement] = []
    conflicts: list[BasebookConflict] = []
    present_domains_set: set[str] = set()

    req_counter = 0
    for heading, rules in sections:
        for rule in rules:
            req_counter += 1
            domain = _classify_domain(heading, rule)
            present_domains_set.add(domain)
            cap, mod, keys, test_id = _map_domain_to_capability_and_module(domain, rule)
            rule_conflicts = detect_basebook_conflicts(domain, rule, req_counter)
            conflicts.extend(rule_conflicts)
            priority = "mandatory" if any(w in rule.lower() for w in ("must", "never", "required", "always", "shall")) else "recommended"
            requirements.append(
                BasebookRequirement(
                    requirement_id=f"BB-REQ-{req_counter:03d}",
                    domain=domain,
                    section_title=heading,
                    rule_text=rule,
                    priority=priority,
                    contract_keys=keys,
                    evaluator_capability=cap,
                    implementation_module=mod,
                    acceptance_test_id=test_id,
                    verification_status="conflict_detected" if rule_conflicts else "verified_baseline",
                )
            )

    present_domains = [d for d in BASEBOOK_REQUIRED_DOMAINS if d in present_domains_set]
    missing_domains = [d for d in BASEBOOK_REQUIRED_DOMAINS if d not in present_domains_set]
    has_blocking = any(c.severity == "blocking" for c in conflicts)
    fully_covered = len(missing_domains) == 0 and len(requirements) > 0 and not has_blocking

    return BasebookIngestionReport(
        status="INGESTED_WITH_CONFLICTS" if conflicts or missing_domains else "INGESTED_VALIDATED",
        basebook_supplied=True,
        compliance_certified=fully_covered,
        basebook_version=version_tag,
        basebook_sha256=sha256_hex,
        ingested_at=datetime.now(timezone.utc).isoformat(),
        present_domains=present_domains,
        missing_domains=missing_domains,
        requirements=[asdict(r) for r in requirements],
        conflicts=[asdict(c) for c in conflicts],
        traceability_summary={
            "total_requirements_extracted": len(requirements),
            "present_domains_count": len(present_domains),
            "missing_domains_count": len(missing_domains),
            "blocking_conflicts_count": sum(1 for c in conflicts if c.severity == "blocking"),
            "warning_conflicts_count": sum(1 for c in conflicts if c.severity == "warning"),
            "compliance_certified": fully_covered,
        },
    )
