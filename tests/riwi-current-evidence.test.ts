import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
// @ts-expect-error audited ESM helper has no generated declarations
import { assertNewEvidenceOutput, assertUnusedEvidencePath, evidenceArtifactPaths, verifySource, parseTestReceipt } from "../scripts/lib/riwi-current-evidence.mjs";

test("current evidence rejects stale sources, historical overwrite, fabricated SHA and passing suites with skipped evidence", () => {
  assert.throws(() => assertNewEvidenceOutput("docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl"), /historical_ledger_write_denied/);
  assert.throws(() => verifySource({ id: "A", sha256: "f".repeat(64), blob: "f".repeat(40) }, "MUST absent requirement"), /source_identity_mismatch/);
  assert.equal(parseTestReceipt("PASS supplied_sha=ffffffff", 0).verified, false);
  assert.equal(parseTestReceipt("# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n", 0).verified, false);
  const passing = "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(parseTestReceipt(passing, 1).verified, false);
  assert.equal(parseTestReceipt(passing, 0).verified, true);
});

test("fresh evidence has batch-specific sidecars and refuses existing files, directories and dangling links", () => {
  const directory = mkdtempSync(join(tmpdir(), "riwi-evidence-boundaries-"));
  try {
    const output = join(directory, "RIWI-BATCH-16-CURRENT-EVIDENCE.jsonl");
    assert.doesNotThrow(() => assertNewEvidenceOutput(output));
    const paths = evidenceArtifactPaths(output, ["a123"]);
    assert.equal(paths.manifest, join(directory, "RIWI-BATCH-16-EVIDENCE-MANIFEST.json"));
    assert.deepEqual(paths.receipts, [join(directory, "RIWI-BATCH-16-EVIDENCE-a123.txt")]);
    writeFileSync(output, "preserved");
    assert.throws(() => assertNewEvidenceOutput(output), /existing_evidence_write_denied/);
    assert.equal(readFileSync(output, "utf8"), "preserved");
    assert.throws(() => assertUnusedEvidencePath(directory), /existing_evidence_write_denied/);
    symlinkSync(join(directory, "absent"), paths.manifest);
    assert.throws(() => assertUnusedEvidencePath(paths.manifest), /existing_evidence_write_denied/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("generator rejects a published evidence destination before loading sources or overwriting its ledger/sidecars", () => {
  const paths = ["docs/RIWI-BATCH-15-CURRENT-EVIDENCE.jsonl", "docs/RIWI-BATCH-15-EVIDENCE-MANIFEST.json", "docs/RIWI-BATCH-15-EVIDENCE-a8336625b65e.txt"];
  const before = paths.map(path => readFileSync(path));
  const result = spawnSync(process.execPath, ["scripts/riwi-current-evidence.mjs", "/absent-source-fixture", paths[0]!], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /existing_evidence_write_denied/);
  paths.forEach((path, index) => assert.deepEqual(readFileSync(path), before[index]));
});

test("receipt parsing uses final reporter counts and cannot accept an earlier embedded passing summary", () => {
  const passing = "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  const failed = "# tests 3\n# pass 2\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(parseTestReceipt(passing + failed, 0).verified, false);
  assert.equal(parseTestReceipt(failed + passing, 0).verified, true);
  assert.deepEqual(parseTestReceipt(passing + failed, 1).counts, { tests: 3, pass: 2, fail: 1, cancelled: 0, skipped: 0, todo: 0 });
});
