#!/usr/bin/env python3
"""Independently verify the final native campaign. No DB, Git or network writes."""
import argparse
import hashlib
import json
from pathlib import Path
import re

STATE = "1a6f751f17f59caf54074c7ba9932b7e1a2893157ec3b4170a495626d2dc01ac"
MANIFEST_SHA = "017ce3ac0814249f718dc7c494b3d538ec7aa398c26727801cc09d78b7108365"
SOURCE_HASHES = {
    "LISTENING_SOURCE_ZIP": "5c3cdfffe029b3a7c948f34b2be2d17201c760eae1678f6d83e2853073a90c77",
    "SPEAKING_BANK_SOURCE": "209e1161dd71ef3553ee3e3fe189cdc092b71d8d7f1a5e48c6dbb53ba9dc9f16",
}
EXPECTED_GATES = {"initdb", "start", "createdb", "migrations-qa", "migrations-portability",
    "fixtures", "identity-before-tests", "backend", "ui", "typecheck", "lint",
    "app-boot", "r06-http", "identity-after-tests", "stop"}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, type=Path)
    parser.add_argument("--source-manifest", required=True, type=Path)
    parser.add_argument("--receipt", required=True, type=Path)
    args = parser.parse_args()
    repo = args.repo.resolve(strict=True)
    raw = args.source_manifest.read_bytes()
    assert hashlib.sha256(raw).hexdigest() == MANIFEST_SHA, "manifest bytes changed"
    state = json.loads(raw)
    files = state["files"]
    assert state["sha256"] == STATE and len(files) == 1256
    assert hashlib.sha256(json.dumps(files, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest() == STATE
    actual = set()
    for folder in ["src", "tests", "scripts", "drizzle"]:
        for path in (repo/folder).rglob("*"):
            assert not path.is_symlink(), "source symlink"
            if path.is_file():
                actual.add(path.relative_to(repo).as_posix())
    actual.update(name for name in ["package.json", "package-lock.json", "tsconfig.json", "next.config.mjs", "vercel.json"] if (repo/name).is_file())
    assert actual == {row["path"] for row in files}, "source inventory differs"
    for row in files:
        path = repo/row["path"]
        assert path.resolve().is_relative_to(repo)
        assert hashlib.sha256(path.read_bytes()).hexdigest() == row["sha256"], row["path"]
    receipt_path = args.receipt.resolve(strict=True)
    receipt = json.loads(receipt_path.read_text())
    assert receipt["status"] == "PASSED_TWO_FULL_NATIVE_ROUNDS_NO_SKIPS"
    assert receipt["source_sha256"] == STATE and receipt["source_files"] == 1256
    assert receipt["campaigns"] == 1 and len(receipt["rounds"]) == 2
    assert not receipt["build_rerun"] and not receipt["commit_performed"] and not receipt["push_performed"]
    assert receipt["each_round_new_private_cluster"] and not receipt["existing_databases_reset"]
    assert set(receipt["original_inputs"]) == set(SOURCE_HASHES)
    for name, item in receipt["original_inputs"].items():
        assert item["sha256"] == SOURCE_HASHES[name]
        assert hashlib.sha256(Path(item["path"]).read_bytes()).hexdigest() == SOURCE_HASHES[name]
    verified_logs, roots, counts_by_round = 0, set(), []
    backend_inventory = sorted(row["path"] for row in files if re.fullmatch(r"tests/[^/]+\.test\.ts", row["path"]))
    for number, result in enumerate(receipt["rounds"], 1):
        assert result["round"] == number and result["status"] == "PASSED"
        assert result["source_sha256"] == STATE
        private = Path(result["private_root"]).resolve(strict=True)
        assert private.is_relative_to(receipt_path.parent) and private not in roots
        roots.add(private)
        assert json.loads((private/"receipt.json").read_text()) == result
        assert result["cluster_stopped"] and not (private/"data/postmaster.pid").exists()
        assert result["password_file_removed"] and not (private/"password").exists()
        assert result["backend_files"] == backend_inventory
        assert set(result["checks"]) == EXPECTED_GATES
        observed = {}
        for name, check in result["checks"].items():
            log = Path(check["log"])
            assert not log.is_symlink() and log.resolve(strict=True).is_relative_to(private)
            assert check["exit_code"] == 0
            assert hashlib.sha256(log.read_bytes()).hexdigest() == check["sha256"], name
            verified_logs += 1
            if name in ["backend", "ui"]:
                body = log.read_text()
                counts = {}
                for field in ["tests", "pass", "fail", "cancelled", "skipped", "todo"]:
                    values = re.findall(r"^# "+field+r" (\d+)$", body, re.M)
                    assert len(values) == 1, "ambiguous TAP summary"
                    counts[field] = int(values[0])
                assert counts == check["counts"] and counts["tests"] == counts["pass"]
                assert counts["tests"] >= 1491 if name == "backend" else counts["tests"] == 265
                assert all(counts[k] == 0 for k in ["fail", "cancelled", "skipped", "todo"])
                observed[name] = counts
        http = json.loads((private/"r06-http.json").read_text())
        assert http["passed"] and http["appProcessGroupStopped"] and http["privateDatabaseRemoved"]
        assert len(http["http"]) == 53 and http["authenticatedRoles"] == ["student", "teacher", "admin", "owner"]
        assert not any(http[k] for k in ["realProviderVerified", "deployedTargetVerified", "realBrowserVerified", "signedPrivateUrlExpiryVerified"])
        retention = json.loads((private/"r04-http.json").read_text())
        assert retention["passed"] and retention["appProcessGroupStopped"] and retention["privateDatabaseRemoved"]
        assert len(retention["http"]) == 13 and retention["authenticatedPresenceRoles"] == ["student", "teacher", "admin", "owner"]
        assert not any(retention[k] for k in ["deployedSchedulerVerified", "hourlyScheduleVerified", "realBrowserVerified", "productionTouched", "sharedDatabaseTouched", "buildRun"])
        assert all(retention[k] is True for k in ["zeroWriteDryRun", "academicRecordsPreserved", "auditContainsNoChatText"])
        assert retention["recentMessagesPreserved"] == 101 and retention["accountsPreserved"] == 6
        counts_by_round.append(observed)
    print(json.dumps({"verified": True, "source_sha256": STATE, "source_files": 1256,
        "campaigns": 1, "rounds": 2, "counts": counts_by_round, "raw_logs_verified": verified_logs,
        "r06_http_each_round": 53, "r04_http_each_round": 13, "operational_acceptance": False}, indent=2))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
