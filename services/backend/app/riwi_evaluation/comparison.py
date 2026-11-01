"""Mode A candidate review and validation gate; never invokes a provider.

External comparison records must arrive through the existing guarded provider
adapter. A provider response is a candidate label, never independent truth.
"""
from __future__ import annotations

from dataclasses import dataclass
import hashlib
import math

from .dataset import Case
from ..riwi_outbound_guard import guard_external_payload


def comparison_payload(case: Case) -> dict:
    if case.split not in {"training", "calibration"}:
        raise ValueError("comparison_requires_development_split")
    # Explicit allowlist omits identifiers, reference answers and label fields.
    result = guard_external_payload("evaluation", {"language": "en", "taskType": case.domain,
                                                   "prompt": case.prompt, "content": case.response})
    if not result.ok:
        raise ValueError(result.reason)
    return result.payload


def comparison_candidate(case: Case, *, provider: str, model: str, raw_response: bytes) -> dict:
    if case.split not in {"training", "calibration"}:
        raise ValueError("holdout_or_validation_not_trainable")
    if not provider or not model or not isinstance(raw_response, bytes) or not 1 <= len(raw_response) <= 200_000:
        raise ValueError("invalid_comparison_receipt")
    return {"case_id": case.case_id, "split": case.split, "content_sha256": case.content_sha256,
            "provider": provider, "model": model, "response_sha256": hashlib.sha256(raw_response).hexdigest(),
            "label_provenance": "external_provider_candidate_unverified", "status": "requires_review", "activated": False}


@dataclass(frozen=True)
class ValidationMetrics:
    dataset_sha256: str
    samples: int
    error_rate: float
    safety_failure_rate: float
    subjective_reference_validated: bool = False

    def __post_init__(self):
        import re
        if not re.fullmatch(r"[0-9a-f]{64}", self.dataset_sha256):
            raise ValueError("invalid_validation_dataset_hash")
        if type(self.samples) is not int or self.samples < 1:
            raise ValueError("missing_validation_samples")
        for value in (self.error_rate, self.safety_failure_rate):
            if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 1:
                raise ValueError("invalid_validation_rate")


def review_promotion(baseline: ValidationMetrics, candidate: ValidationMetrics, *, basebook_reviewed: bool,
                     objective_only: bool = True) -> dict:
    """Assess validation evidence, never use final holdout for promotion tuning."""
    reasons = []
    if baseline.dataset_sha256 != candidate.dataset_sha256 or baseline.samples != candidate.samples:
        reasons.append("validation_dataset_mismatch")
    if candidate.error_rate > baseline.error_rate:
        reasons.append("validation_regression")
    if candidate.safety_failure_rate > 0:
        reasons.append("safety_failure")
    if not basebook_reviewed:
        reasons.append("owner_basebook_pending")
    if not objective_only and not candidate.subjective_reference_validated:
        reasons.append("independent_subjective_reference_missing")
    return {"eligible_for_owner_review": not reasons, "blockers": reasons, "activated": False,
            "final_holdout_used_for_selection": False}
