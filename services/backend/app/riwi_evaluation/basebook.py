"""Immutable Owner Basebook intake and requirement-to-evidence traceability.

This is an offline artifact builder, not a new authorization boundary or a
replacement for the existing knowledge approval/promotion workflow.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
import hashlib
import re
from typing import Iterable


@dataclass(frozen=True)
class Requirement:
    id: str
    text: str
    start_line: int
    end_line: int
    source_sha256: str
    contract_keys: tuple[str, ...]


@dataclass(frozen=True)
class Evidence:
    requirement_id: str
    contract_key: str
    implementation_ref: str
    test_ref: str
    test_run_sha256: str
    outcome: str


def ingest_basebook(raw: bytes, *, version: str, known_contracts: Iterable[str]) -> dict:
    """Preserve exact bytes by digest and parse explicit requirement paragraphs.

    Paragraphs start with ``[RIWI-REQ-<id>]``. Contract links use
    ``[contract:<key>]``. Unmarked source text is preserved by the digest and
    recorded as unmapped; it is never silently treated as implemented.
    """
    if not isinstance(raw, bytes) or not raw or len(raw) > 2_000_000:
        raise ValueError("invalid_basebook_bytes")
    if not isinstance(version, str) or not 1 <= len(version.strip()) <= 120:
        raise ValueError("invalid_basebook_version")
    text = raw.decode("utf-8-sig", errors="strict")
    source_hash = hashlib.sha256(raw).hexdigest()
    known = frozenset(known_contracts)
    lines = text.splitlines()
    starts = [(i, m.group(1)) for i, line in enumerate(lines)
              if (m := re.match(r"^\s*\[(RIWI-REQ-[A-Za-z0-9_-]+)\]\s*", line))]
    requirements = []
    seen = set()
    for j, (start, req_id) in enumerate(starts):
        if req_id in seen:
            raise ValueError("duplicate_requirement_id")
        seen.add(req_id)
        end = starts[j + 1][0] if j + 1 < len(starts) else len(lines)
        body = "\n".join(lines[start:end]).strip()
        keys = tuple(dict.fromkeys(re.findall(r"\[contract:([^\]\s]+)\]", body)))
        if any(key not in known for key in keys):
            raise ValueError("unknown_assessment_contract")
        requirements.append(asdict(Requirement(req_id, body, start + 1, end, source_hash, keys)))
    return {
        "schema_version": 1,
        "version": version.strip(),
        "source_sha256": source_hash,
        "source_bytes": len(raw),
        "status": "candidate_requires_owner_review",
        "requirements": requirements,
        "unmapped_prefix_lines": starts[0][0] if starts else len(lines),
        "unlinked_requirement_ids": [r["id"] for r in requirements if not r["contract_keys"]],
        "activated": False,
    }


def traceability_report(manifest: dict | None, evidence: Iterable[Evidence] = ()) -> dict:
    if manifest is None:
        return {"status": "awaiting_owner_basebook", "requirements": [], "fully_verified": False}
    requirements = manifest["requirements"]
    by_id = {r["id"]: r for r in requirements}
    linked: dict[str, list[Evidence]] = {key: [] for key in by_id}
    for item in evidence:
        if item.requirement_id not in by_id:
            raise ValueError("unknown_requirement")
        if item.contract_key not in by_id[item.requirement_id]["contract_keys"]:
            raise ValueError("evidence_contract_mismatch")
        if item.outcome not in {"pass", "fail", "not_run"}:
            raise ValueError("invalid_evidence_outcome")
        if not item.implementation_ref or not item.test_ref or not re.fullmatch(r"[0-9a-f]{64}", item.test_run_sha256):
            raise ValueError("missing_evidence_reference")
        linked[item.requirement_id].append(item)
    rows = []
    for req_id, requirement in by_id.items():
        items = linked[req_id]
        required_keys = set(requirement["contract_keys"])
        passed_keys = {i.contract_key for i in items if i.outcome == "pass"}
        covered = bool(required_keys) and required_keys <= passed_keys and all(i.outcome == "pass" for i in items)
        rows.append({"requirement_id": req_id, "status": "evidence_linked_requires_review" if covered else "unverified",
                     "evidence": [asdict(i) for i in items]})
    return {
        "status": "candidate_requires_owner_review",
        "source_sha256": manifest["source_sha256"],
        "requirements": rows,
        # File references and submitted receipts do not prove Owner acceptance.
        "fully_verified": False,
        "activated": False,
    }
