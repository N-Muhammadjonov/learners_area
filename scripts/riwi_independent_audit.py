#!/usr/bin/env python3
"""Reproduce Phase B-J evidence without database writes or provider calls."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import resource
import socket
import subprocess
import sys
import time
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "services/backend"
BASE_SHA = "bf7319a3418e918a84d50fd2c451e32e4b687015"
sys.path.insert(0, str(BACKEND))

from app.riwi_evaluation import VERSION
from app.riwi_evaluation.basebook import ingest_basebook, traceability_report
from app.riwi_evaluation.dataset import export_jsonl, generate_cases, validate_splits
from app.riwi_evaluation.independent import ObjectiveKey, evaluate_objective, evaluate_writing


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args], text=True).strip()


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False, allow_nan=False) + "\n", encoding="utf-8")


def source_ref(name, symbol):
    path = BACKEND / "app" / name
    lines = path.read_text().splitlines()
    line = next((i for i, text in enumerate(lines, 1) if symbol in text), None)
    return {"path": str(path.relative_to(ROOT)), "line": line, "sha256": digest(path.read_bytes())}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=ROOT / "docs/riwi-port/independent")
    parser.add_argument("--basebook", type=Path)
    parser.add_argument("--basebook-version", default="owner-candidate-v1")
    args = parser.parse_args()
    # Do not silently audit an unrelated checkout.
    subprocess.run(["git", "-C", str(ROOT), "merge-base", "--is-ancestor", BASE_SHA, "HEAD"], check=True)
    args.output.mkdir(parents=True, exist_ok=True)
    runtime_routes = None
    runtime_import_error = None
    try:
        from app.main import app
        runtime_routes = {(method, route.path) for route in app.routes for method in (getattr(route, "methods", ()) or ())
                          if getattr(route, "path", "").startswith("/api/")}
    except ImportError as exc:
        runtime_import_error = type(exc).__name__ + ": " + str(exc)
    original_path = ROOT / "docs/riwi-port/checkpoint5-audit/ENDPOINT_DIFFERENCES.json"
    preserved = json.loads(original_path.read_text())
    differences = preserved["shared_endpoint_metadata_differences"]
    rows = []
    for difference in differences:
        key = (difference["method"], difference["path"])
        rows.append({"method": key[0], "path": key[1], "previous_source": difference["old"].get("source"),
                     "previous_status": difference["old"].get("status"),
                     "imported_claim": difference["gemini"].get("status"),
                     "runtime_route_registered": key in runtime_routes if runtime_routes is not None else None,
                     "business_behavior_verified": False, "database_integration_verified": False,
                     "review_state": "unresolved_requires_endpoint_evidence"})
    provenance = {"base_sha": BASE_SHA, "preserved_source_sha256": digest(original_path.read_bytes()),
                  "metadata_differences": len(rows), "resolved": 0, "fully_resolved": False,
                  "route_reclassification": preserved["historical_route_reclassification"], "endpoints": rows}
    write_json(args.output / "ENDPOINT_PROVENANCE_REVIEW.json", provenance)
    inventory = json.loads((BACKEND / "PORT_STATUS.json").read_text())
    registered = runtime_routes or set()
    registered_riwi = sorted([list(key) for key in registered if key[1].startswith("/api/riwi/")])
    architecture = {
        "base_sha": BASE_SHA, "audit_checkout_head": git("rev-parse", "HEAD"),
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "inventory_claimed_method_count": inventory["total_methods"],
        "runtime_registered_api_methods": len(registered) if runtime_routes is not None else None,
        "runtime_riwi_routes": registered_riwi, "runtime_import_error": runtime_import_error,
        "provenance_review": {"metadata_differences": len(rows), "resolved": 0, "fully_resolved": False},
        "findings": [
            {"finding": "Writing uses surface patterns and word/paragraph counts. The task prompt is not used to establish semantic relevance.",
             "evidence": source_ref("step32_writing_riwi.py", "def wval("), "independent_band_accuracy": "unverified"},
            {"finding": "Speaking consumes transcript text and optional duration. Pronunciation is explicitly unassessed.",
             "evidence": source_ref("step31_riwi_evaluators.py", "def sval("), "audio_inference": False},
            {"finding": "External RIWI chat requires both rollout configuration and an injected transport.",
             "evidence": source_ref("riwi_gateway.py", "rollout.external_ai and external_runner is not None")},
            {"finding": "The opt-in independent-v1 Coach path returns pattern feedback without subjective bands and bypasses provider lookup.",
             "evidence": source_ref("step31_coach.py", "async def resolve(")},
        ],
        "live_database_parity_executed": False, "production_readiness_certified": False,
    }
    write_json(args.output / "ARCHITECTURE_PHASE_B.json", architecture)
    ram_bytes = None
    ram_measurement_error = None
    try:
        if platform.system() == "Darwin":
            ram_bytes = int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True, stderr=subprocess.PIPE))
        elif hasattr(os, "sysconf"):
            ram_bytes = os.sysconf("SC_PAGE_SIZE") * os.sysconf("SC_PHYS_PAGES")
    except (subprocess.CalledProcessError, OSError, ValueError) as exc:
        ram_measurement_error = type(exc).__name__ + ": host memory measurement unavailable in this sandbox"
    feasibility = {
        "platform": platform.platform(), "python": platform.python_version(), "cpu_count": os.cpu_count(),
        "host_ram_bytes": ram_bytes, "host_ram_is_deployment_budget": False,
        "host_ram_measurement_error": ram_measurement_error,
        "installed_libraries": {name: importlib.util.find_spec(name) is not None for name in ("numpy", "onnxruntime", "torch", "transformers", "whisper")},
        "implementable_and_testable": ["trusted-key objective evaluation", "bounded pattern feedback", "source-family split datasets",
                                        "Basebook intake and evidence mapping", "local PCM energy telemetry", "guarded provider candidate review"],
        "not_established": ["independent IELTS band accuracy", "semantic prompt relevance", "phoneme/pronunciation assessment",
                            "local model weights and model licence", "target-host memory and latency budget", "human-reference calibration"],
        "decision": "Objective evaluation is feasible. Subjective feedback is limited to observable patterns; independently validated band scoring remains blocked.",
    }
    write_json(args.output / "FEASIBILITY_PHASE_C.json", feasibility)
    manifest = None
    if args.basebook:
        from app.riwi_assessment_contracts import LEGACY_ASSESSMENT_CONTRACT_KEYS, PROMPT_BOOK_ADDITIONAL_KEYS
        raw = args.basebook.read_bytes()
        manifest = ingest_basebook(raw, version=args.basebook_version,
                                   known_contracts=(*LEGACY_ASSESSMENT_CONTRACT_KEYS, *PROMPT_BOOK_ADDITIONAL_KEYS))
        # Keep an exact source copy next to the digest and traceability report.
        (args.output / "OWNER_BASEBOOK_SOURCE.txt").write_bytes(raw)
        write_json(args.output / "BASEBOOK_MANIFEST.json", manifest)
    write_json(args.output / "BASEBOOK_STATUS.json", traceability_report(manifest))
    cases = generate_cases()
    data = export_jsonl(cases)
    (args.output / "EXERCISES_AND_EVALUATION_DATASET.jsonl").write_text(data, encoding="utf-8")
    dataset_report = validate_splits(cases)
    dataset_report["jsonl_sha256"] = digest(data.encode())
    write_json(args.output / "DATASET_PHASE_E.json", dataset_report)
    holdout = [c for c in cases if c.split == "final_holdout" and c.expected_correct is not None]
    attempts = 0

    def deny_network(*unused_args, **unused_kwargs):
        nonlocal attempts
        attempts += 1
        raise RuntimeError("offline_evaluation_network_forbidden")

    timings, correct = [], 0
    started = time.perf_counter()
    with patch.object(socket.socket, "connect", deny_network), patch.object(socket.socket, "connect_ex", deny_network), \
            patch.object(socket.socket, "sendto", deny_network), patch.object(socket, "create_connection", deny_network), \
            patch.object(socket, "getaddrinfo", deny_network):
        for case in holdout:
            tick = time.perf_counter()
            result = evaluate_objective(case.response, ObjectiveKey(case.accepted_answers))
            timings.append((time.perf_counter() - tick) * 1000)
            correct += result["correct"] == case.expected_correct
        probe = evaluate_writing(task_type="task2", prompt="Discuss education.", content="Unrelated words. " * 130)
        assert probe["evaluation"]["overallEstimate"] is None
    elapsed = time.perf_counter() - started
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    timings.sort()
    qa = {"base_sha": BASE_SHA, "evaluator_version": VERSION, "mode": "B",
          "network_guard": "in-process Python socket guard; OS-level network isolation not verified",
          "outbound_attempts_observed": attempts,
          "objective_synthetic_holdout": {"samples": len(holdout), "matches_reference": correct, "accuracy": correct / len(holdout),
                                          "limitation": "Answer-key checks on generated examples; not a general language or IELTS accuracy benchmark."},
          "subjective_band_mae": None, "subjective_band_rmse": None, "subjective_band_agreement": None,
          "subjective_metrics_status": "unavailable_no_independent_reference_labels",
          "basebook_status": traceability_report(manifest)["status"],
          "elapsed_seconds": elapsed, "objective_p95_ms": timings[int((len(timings) - 1) * .95)],
          "process_peak_rss_mb": rss / (1024 * 1024 if platform.system() == "Darwin" else 1024),
          "rss_scope": "whole audit process including optional FastAPI import",
          "external_comparison_calls": 0, "model_training_performed": False,
          "production_ready": False, "phase_completion": {
              "B": "audit_completed_with_unresolved_provenance", "C": "feasibility_measured_subjective_scoring_blocked",
              "D": "framework_implemented_owner_basebook_pending" if manifest is None else "candidate_basebook_requires_owner_review",
              "E": "synthetic_exercises_and_split_dataset_generated", "F": "objective_and_pattern_engine_implemented_no_calibrated_subjective_model",
              "G": "candidate_review_framework_implemented_live_external_comparison_not_run", "H": "scoped_offline_engineering_checks_executed",
              "I": "see_independent_test_receipt", "J": "review_only_no_main_merge_no_production_deployment"}}
    write_json(args.output / "OFFLINE_QA_PHASE_H.json", qa)
    print(json.dumps({"output": str(args.output), "dataset_cases": len(cases), "objective_holdout": len(holdout),
                      "metadata_differences_unresolved": len(rows), "runtime_api_methods": architecture["runtime_registered_api_methods"]}))


if __name__ == "__main__":
    main()
