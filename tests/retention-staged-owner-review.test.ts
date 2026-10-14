import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/** Regression for the QA-HOLD admin preview; NOT a publication acceptance test. */
test("Retention V2 preview: reads all 75 staged texts in five levels without exposing rubrics to learners", () => {
  const levels = ["A2", "B1", "B2", "C1", "C2"];
  const ids = new Set<string>();
  for (const level of levels) {
    const content = readFileSync(`content/retention-v2/${level}.jsonl`, "utf8");
    const rows = content.trim().split("\n").map(line => JSON.parse(line) as {
      sourceId: string; level: string; bodyText: string; scoringStructure: object;
    });
    assert.equal(rows.length, 15, level);
    for (const row of rows) {
      assert.equal(row.level, level);
      assert.equal(ids.has(row.sourceId), false);
      ids.add(row.sourceId);
      assert.ok(row.bodyText.trim().length > 200);
      assert.ok(row.scoringStructure && typeof row.scoringStructure === "object");
    }
  }
  assert.equal(ids.size, 75);
  const gaps = JSON.parse(readFileSync("content/retention-v2/calibration-gaps.json", "utf8")) as {
    status: string; anomalies: Array<{ sourceId: string; test: string; got: number }>;
  };
  assert.equal(gaps.status, "QA_HOLD_DO_NOT_PUBLISH");
  assert.equal(new Set(gaps.anomalies.map(x => x.sourceId)).size, 29);
  assert.equal(gaps.anomalies.length, 49);
  assert.ok(gaps.anomalies.every(x => ids.has(x.sourceId)));
});

test("Retention V2 preview: guarded server-only route, no mutation and deploy-safe private file tracing", () => {
  const page = readFileSync("src/app/app/(shell)/admin/reading/retention/staged/page.tsx", "utf8");
  const helper = readFileSync("src/lib/retention/staged-review.ts", "utf8");
  const config = readFileSync("next.config.mjs", "utf8");
  const cms = readFileSync("src/app/app/(shell)/admin/reading/retention/page.tsx", "utf8");
  assert.match(page, /requireAdministrator\(\)/, "guard page before rendering staged content");
  assert.match(page, /if \(!administrator\) redirect\("\/app"\)/);
  assert.match(page, /readStagedRetentionReview\(level\)/);
  assert.match(page, /data-retention-qa-hold/);
  assert.doesNotMatch(page, /createRetentionText|updateRetentionText|db\.insert|POST\(/);
  assert.doesNotMatch(page, /scoringStructure/, "full rubric must not be serialized to admin browser");
  assert.match(helper, /import "server-only"/);
  assert.match(helper, /QA_HOLD_DO_NOT_PUBLISH/);
  assert.doesNotMatch(helper, /db\/client|db\.insert|update\(/, "staging is read-only");
  assert.match(config, /"\/app\/admin\/reading\/retention\/staged": \["\.\/content\/retention-v2\/\*\.jsonl"/);
  assert.match(cms, /data-retention-staged-review-link/);
  assert.doesNotMatch(helper, /\.\.\//, "staged files cannot path-traverse");
});
