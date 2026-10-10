import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
// @ts-expect-error audited ESM helper has no generated declarations
import { snapshotSource } from "../scripts/lib/riwi-current-evidence.mjs";

const read = (path: string) => JSON.parse(readFileSync(path, "utf8"));
const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");

test("branch packet covers every collision with immutable SQL identities and cannot be mistaken for a merged/deployed schema", () => {
  const report = read("docs/RIWI-BATCH-15-MIGRATION-CONFLICTS.json");
  assert.equal(report.riwi_base, "7f805af85705906f6c37710a3030f3eb357e90c0");
  assert.deepEqual(report.collisions.map((row: { prefix: number }) => row.prefix), Array.from({ length: 15 }, (_, i) => i + 36));
  for (const row of report.collisions) {
    assert.notEqual(row.riwi.journal.tag, row.website.journal.tag);
    assert.equal(sha256(readFileSync(row.riwi.path)), row.riwi.sha256);
    assert.notEqual(row.riwi.sha256, row.website.sha256);
  }
  assert.equal(report.catalog_comparison.columns.changed.length, 5);
  assert.match(report.execution, /READ_ONLY_RECONCILIATION/);
});

test("current requirement receipts bind executed tests to unchanged code and raw transcript artifacts, without accepting unmapped source text", () => {
  const manifest = read("docs/RIWI-BATCH-15-EVIDENCE-MANIFEST.json");
  assert.equal(snapshotSource(process.cwd()).sha256, manifest.source_state.sha256);
  assert.equal(manifest.legacy_ledger.usable_as_current_acceptance, false);
  for (const receipt of manifest.receipts) {
    assert.equal(receipt.verified, true);
    assert.equal(receipt.counts.fail, 0); assert.equal(receipt.counts.skipped, 0);
    assert.equal(sha256(readFileSync(receipt.artifact)), receipt.artifact_sha256);
    assert.equal(receipt.source_state_sha256, manifest.source_state.sha256);
  }
  const rows = readFileSync("docs/RIWI-BATCH-15-CURRENT-EVIDENCE.jsonl", "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.ok(rows.every(row => row.status !== "PASS"));
  assert.equal(rows.filter(row => row.status === "LOCALLY_VERIFIED_SCOPED").length, 5);
  assert.ok(rows.filter(row => row.status === "REVIEW_REQUIRED").length > 10_000);
  assert.ok(rows.every(row => row.external_evidence === null && row.last_verified_git_sha === null));
});

test("manual matrix spans all roles/devices/locales/themes and explicitly preserves every missing deployed receipt", () => {
  const matrix = read("docs/RIWI-BATCH-15-RUNTIME-MATRIX.json");
  assert.equal(matrix.rows.length, 4 * 3 * 2 * 2 * 12);
  assert.equal(new Set(matrix.rows.map((row: { id: string }) => row.id)).size, matrix.rows.length);
  assert.equal(matrix.browser_receipts, 0);
  assert.ok(matrix.rows.every((row: { status: string; state_sha: unknown; evidence_artifact: unknown }) => row.status === "DEPLOYED_RUNTIME_UNVERIFIED" && row.state_sha === null && row.evidence_artifact === null));
  const progress = read("docs/RIWI-REMAINING-PROMPT-PROGRESS.json");
  assert.equal(progress.total, 34);
  assert.equal(progress.groups.filter((row: { status: string }) => row.status === "CLOSED").length, progress.closed);
});
