import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

test("legacy generator refuses its implicit or explicit historical ledger target before reading sources", () => {
  for (const output of [undefined, "docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl"]) {
    const env = { ...process.env };
    delete env.RIWI_LEDGER_OUT;
    if (output) env.RIWI_LEDGER_OUT = output;
    assert.throws(() => execFileSync(process.execPath, ["scripts/generate-riwi-final-ledger.mjs"], { env, stdio: "pipe" }), /historical_ledger_write_denied/);
  }
});

test("ledger generation cannot turn an unimplemented requirement or supplied SHA into PASS", () => {
  const directory = mkdtempSync(join(tmpdir(), "riwi-ledger-proof-"));
  try {
    const samples = {
      A: "MUST implement an absent RIWI capability and verify it.\n",
      B: "MUST register an absent task and execute its golden fixture.\n",
      C: "MUST prove an absent Speaking behavior with learner evidence.\n",
      D: "MUST export real data to a fresh destination and verify integrity.\n",
    };
    for (const [source, text] of Object.entries(samples)) writeFileSync(join(directory, `RIWI_SOURCE_${source}.txt`), text);
    const output = join(directory, "ledger.jsonl");
    execFileSync(process.execPath, ["scripts/generate-riwi-final-ledger.mjs"], {
      env: { ...process.env, RIWI_SOURCE_DIR: directory, RIWI_LEDGER_OUT: output, RIWI_VERIFIED_SHA: "f".repeat(40) },
    });
    const records = readFileSync(output, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    assert.equal(records.length, 4);
    for (const row of records) {
      assert.equal(row.status, "EXTERNALLY UNVERIFIED", row.requirement_summary);
      assert.equal(row.last_verified_sha, null);
      assert.equal(row.runtime_evidence, null);
      assert.equal(row.browser_evidence, null);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
