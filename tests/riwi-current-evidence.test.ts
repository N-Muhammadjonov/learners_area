import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error audited ESM helper has no generated declarations
import { assertNewEvidenceOutput, verifySource, parseTestReceipt } from "../scripts/lib/riwi-current-evidence.mjs";

test("current evidence rejects stale sources, historical overwrite, fabricated SHA and passing suites with skipped evidence", () => {
  assert.throws(() => assertNewEvidenceOutput("docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl"), /historical_ledger_write_denied/);
  assert.throws(() => verifySource({ id: "A", sha256: "f".repeat(64), blob: "f".repeat(40) }, "MUST absent requirement"), /source_identity_mismatch/);
  assert.equal(parseTestReceipt("PASS supplied_sha=ffffffff", 0).verified, false);
  assert.equal(parseTestReceipt("# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 0\n", 0).verified, false);
  const passing = "# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n";
  assert.equal(parseTestReceipt(passing, 1).verified, false);
  assert.equal(parseTestReceipt(passing, 0).verified, true);
});
