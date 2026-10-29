"""Phase G — RIWI External-AI Comparison Learning Pipeline (Mode A).

Implements the permission-gated, privacy-redacted comparison-learning loop:
  EVALUATE -> COMPARE -> IDENTIFY ERROR -> VALIDATE LABEL -> IMPROVE -> RETEST -> VERSION -> APPROVE

Strict guardrails:
  1. External AI comparison executes ONLY when `mode == "A"`, `owner_authorized == True`,
     and `external_ai_consent == True`.
  2. All outbound prompts and learner texts pass through `redact_outbound_prompt()` before
     leaving the local boundary.
  3. External AI outputs are treated as reference signals requiring validation against
     rubric invariants — never automatically trusted if they violate word-count caps,
     copied-prompt rules, or speaking pronunciation constraints.
  4. Candidate calibration updates are promoted ONLY if `VALIDATION` MAE improves and
     `FINAL_HOLDOUT` MAE, latency, and bias guardrails do not regress, with instant rollback.
"""
from __future__ import annotations

import copy
from dataclasses import asdict, dataclass
import hashlib
import json
import time
from typing import Any, Callable, Final, Mapping

import numpy as np

from .riwi_independent_evaluator import (
     RiwiHybridLocalEvaluator,
    _round_half_band,
    extract_feature_vector,
    get_riwi_local_evaluator,
)
from .riwi_outbound_guard import redact_external_text


ROOT_CAUSE_CATEGORIES: Final[tuple[str, ...]] = (
    "rubric_interpretation",
    "missing_knowledge",
    "model_weakness",
    "evaluator_error",
)


@dataclass(frozen=True)
class DisagreementRecord:
    case_id: str
    module: str
    task_type: str
    riwi_overall: float | None
    external_overall: float | None
    overall_delta: float
    criterion_deltas: dict[str, float]
    missed_issue_categories: list[str]
    extra_issue_categories: list[str]
    root_cause: str
    external_label_validated: bool
    validation_reason: str
    redacted_submission_sha256: str


class RiwiComparisonLearningPipeline:
    """Manages Mode A dual evaluation, disagreement classification, and gated promotion."""

    def __init__(self, evaluator: RiwiHybridLocalEvaluator | None = None) -> None:
        self.evaluator = evaluator or get_riwi_local_evaluator()
        self.disagreement_log: list[DisagreementRecord] = []
        self._rollback_history: list[dict[str, Any]] = []

    def run_dual_evaluation(
        self,
        *,
        case_id: str,
        module: str,
        task_type: str,
        prompt: str,
        submission: str,
        target_word_count: int = 250,
        mode: str = "B",
        owner_authorized: bool = False,
        external_ai_consent: bool = False,
        external_evaluator_fn: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """Step 1 & 2: EVALUATE locally and (when Mode A + authorized + consented) compare with External AI."""
        local_res = self.evaluator.evaluate_writing(
            task_type=task_type,
            prompt=prompt,
            content=submission,
            target_word_count=target_word_count,
        )

        if mode != "A" or not owner_authorized or not external_ai_consent or external_evaluator_fn is None:
            return {
                "case_id": case_id,
                "mode": mode,
                "external_comparison_executed": False,
                "blocked_reason": (
                    None
                    if mode == "B"
                    else "requires_mode_A_owner_authorization_and_external_ai_consent"
                ),
                "local_result": local_res,
                "external_result": None,
                "comparison": None,
            }

        redacted_prompt = redact_external_text(prompt, 8000)
        redacted_submission = redact_external_text(submission, 20000)
        prompt_redactions = redacted_prompt.count('[redacted-')
        sub_redactions = redacted_submission.count('[redacted-')
        outbound_payload = {
            "case_id": case_id,
            "module": module,
            "task_type": task_type,
            "prompt": redacted_prompt,
            "submission": redacted_submission,
            "target_word_count": target_word_count,
            "pii_redactions_applied": int(prompt_redactions + sub_redactions),
        }
        external_res = external_evaluator_fn(outbound_payload)
        comparison = self.compare_and_classify(
            case_id=case_id,
            module=module,
            task_type=task_type,
            prompt=redacted_prompt,
            submission=redacted_submission,
            target_word_count=target_word_count,
            local_result=local_res,
            external_result=external_res,
        )
        return {
            "case_id": case_id,
            "mode": "A",
            "external_comparison_executed": True,
            "pii_redactions_applied": int(prompt_redactions + sub_redactions),
            "local_result": local_res,
            "external_result": external_res,
            "comparison": asdict(comparison),
        }

    def compare_and_classify(
        self,
        *,
        case_id: str,
        module: str,
        task_type: str,
        prompt: str,
        submission: str,
        target_word_count: int,
        local_result: Mapping[str, Any],
        external_result: Mapping[str, Any],
    ) -> DisagreementRecord:
        """Step 2, 3 & 4: COMPARE, IDENTIFY ERROR root cause, and VALIDATE external label."""
        local_ov = local_result.get("overallEstimate")
        ext_ov = external_result.get("overallEstimate")
        overall_delta = round(float(local_ov or 0.0) - float(ext_ov or 0.0), 2)

        local_crit = {
            c["key"]: float(c["band"])
            for c in local_result.get("criteria", [])
            if c.get("band") is not None
        }
        ext_crit = {
            c["key"]: float(c["band"])
            for c in external_result.get("criteria", [])
            if c.get("band") is not None
        }
        criterion_deltas = {
            k: round(local_crit.get(k, 0.0) - ext_crit.get(k, 0.0), 2)
            for k in sorted(set(local_crit) | set(ext_crit))
        }

        local_cats = {i.get("category", "") for i in local_result.get("issues", []) if i.get("category")}
        ext_cats = {i.get("category", "") for i in external_result.get("issues", []) if i.get("category")}
        missed = sorted(ext_cats - local_cats)
        extra = sorted(local_cats - ext_cats)

        # Validate external label against non-negotiable IELTS rubric invariants
        wc = len((submission or "").split())
        ext_valid = True
        validation_reason = "external_label_consistent_with_rubric_invariants"
        if wc < int(target_word_count * 0.5) and float(ext_ov or 0.0) >= 6.5:
            ext_valid = False
            validation_reason = "rejected_external_label_over_scored_severely_under_length_script"
        elif local_result.get("abstentionReason") == "copied_prompt_suspected" and float(ext_ov or 0.0) >= 5.5:
            ext_valid = False
            validation_reason = "rejected_external_label_ignored_copied_prompt"
        elif module == "speaking":
            ext_pron = next(
                (c.get("band") for c in external_result.get("criteria", []) if c.get("key") == "pronunciation"),
                None,
            )
            if ext_pron is not None and not external_result.get("audioAnalyzed"):
                ext_valid = False
                validation_reason = "rejected_external_label_hallucinated_pronunciation_from_text_only"

        # Classify root cause of disagreement
        max_abs_crit = max((abs(v) for v in criterion_deltas.values()), default=0.0)
        if not ext_valid:
            root_cause = "evaluator_error"
        elif "WRITING_TASK_RESPONSE" in missed or abs(criterion_deltas.get("task_response", 0.0)) >= 1.0 or abs(criterion_deltas.get("task_achievement", 0.0)) >= 1.0:
            root_cause = "rubric_interpretation"
        elif "WRITING_LEXICAL_REPETITION" in missed or abs(criterion_deltas.get("lexical", 0.0)) >= 1.0:
            root_cause = "missing_knowledge"
        elif max_abs_crit >= 0.5:
            root_cause = "model_weakness"
        else:
            root_cause = "rubric_interpretation"

        rec = DisagreementRecord(
            case_id=case_id,
            module=module,
            task_type=task_type,
            riwi_overall=local_ov,
            external_overall=ext_ov,
            overall_delta=overall_delta,
            criterion_deltas=criterion_deltas,
            missed_issue_categories=missed,
            extra_issue_categories=extra,
            root_cause=root_cause,
            external_label_validated=ext_valid,
            validation_reason=validation_reason,
            redacted_submission_sha256=hashlib.sha256((submission or "").encode("utf-8")).hexdigest(),
        )
        self.disagreement_log.append(rec)
        return rec

    def _compute_split_metrics(
        self,
        items: list[dict[str, Any]],
        slopes: list[float],
        intercepts: list[float],
    ) -> dict[str, float]:
        assert self.evaluator._ort_session is not None
        abs_errors: list[float] = []
        signed_errors: list[float] = []
        latencies_ms: list[float] = []

        for item in items:
            if item["module"] not in ("writing", "speaking"):
                continue
            t0 = time.perf_counter()
            vec, _ = extract_feature_vector(
                prompt=item["prompt_text"],
                submission=item["learner_submission"],
                task_type=item["metadata"].get("taskType", "task2"),
                target_word_count=item["target_word_count"],
                is_letter=bool(item["metadata"].get("isGeneralTrainingLetter")),
                duration_ms=item["metadata"].get("durationMs"),
            )
            raw_out = self.evaluator._ort_session.run(["Y"], {"X": vec.reshape(1, -1).astype(np.float32)})[0][0]
            preds = [_round_half_band(float(raw_out[i]) * slopes[i] + intercepts[i]) for i in range(4)]
            latencies_ms.append((time.perf_counter() - t0) * 1000.0)

            crit = item["reference_target"]["criteria"]
            if item["module"] == "writing":
                c1 = crit.get("task_achievement") or crit.get("task_response") or 6.0
                targets = [c1, crit["coherence"], crit["lexical"], crit["grammar"]]
            else:
                targets = [crit["fluency"], crit["fluency"], crit["lexical"], crit["grammar"]]

            for p_val, t_val in zip(preds, targets):
                abs_errors.append(abs(p_val - t_val))
                signed_errors.append(p_val - t_val)

        return {
            "mae": round(float(np.mean(abs_errors)) if abs_errors else 0.0, 4),
            "mean_signed_bias": round(float(np.mean(signed_errors)) if signed_errors else 0.0, 4),
            "p95_latency_ms": round(float(np.percentile(latencies_ms, 95)) if latencies_ms else 0.0, 3),
        }

    def evaluate_and_promote_candidate(
        self,
        *,
        candidate_version: str,
        candidate_slopes: list[float],
        candidate_intercepts: list[float],
        validation_items: list[dict[str, Any]],
        holdout_items: list[dict[str, Any]],
    ) -> dict[str, Any]:
        """Step 5, 6, 7 & 8: IMPROVE -> RETEST -> VERSION -> APPROVE (with rollback protection)."""
        current_cal = copy.deepcopy(self.evaluator._calibration)
        base_slopes = list(current_cal.get("slopes", [1.0, 1.0, 1.0, 1.0]))
        base_intercepts = list(current_cal.get("intercepts", [0.0, 0.0, 0.0, 0.0]))

        base_val = self._compute_split_metrics(validation_items, base_slopes, base_intercepts)
        base_holdout = self._compute_split_metrics(holdout_items, base_slopes, base_intercepts)

        cand_val = self._compute_split_metrics(validation_items, candidate_slopes, candidate_intercepts)
        cand_holdout = self._compute_split_metrics(holdout_items, candidate_slopes, candidate_intercepts)

        val_non_regressed = cand_val["mae"] <= base_val["mae"] + 1e-6
        holdout_non_regressed = cand_holdout["mae"] <= base_holdout["mae"] + 1e-6
        latency_ok = cand_holdout["p95_latency_ms"] <= 25.0
        bias_ok = abs(cand_holdout["mean_signed_bias"]) <= 0.15

        promoted = bool(val_non_regressed and holdout_non_regressed and latency_ok and bias_ok)
        if promoted:
            self._rollback_history.append(current_cal)
            self.evaluator._calibration = {
                **current_cal,
                "model_version": candidate_version,
                "slopes": [round(float(s), 6) for s in candidate_slopes],
                "intercepts": [round(float(b), 6) for b in candidate_intercepts],
                "previous_version": current_cal.get("model_version"),
            }

        return {
            "candidate_version": candidate_version,
            "promoted": promoted,
            "active_version": self.evaluator._calibration.get("model_version"),
            "guardrails": {
                "validation_non_regressed": val_non_regressed,
                "holdout_non_regressed": holdout_non_regressed,
                "latency_within_budget": latency_ok,
                "bias_within_tolerance": bias_ok,
            },
            "baseline_metrics": {
                "validation": base_val,
                "holdout": base_holdout,
            },
            "candidate_metrics": {
                "validation": cand_val,
                "holdout": cand_holdout,
            },
            "rollback_available": len(self._rollback_history) > 0,
        }

    def rollback_last_promotion(self) -> dict[str, Any]:
        """Restore the immediately preceding calibration snapshot."""
        if not self._rollback_history:
            return {
                "rolled_back": False,
                "reason": "no_prior_snapshot_in_history",
                "active_version": self.evaluator._calibration.get("model_version"),
            }
        prev = self._rollback_history.pop()
        self.evaluator._calibration = prev
        return {
            "rolled_back": True,
            "active_version": prev.get("model_version"),
            "restored_slopes": prev.get("slopes"),
            "restored_intercepts": prev.get("intercepts"),
        }
