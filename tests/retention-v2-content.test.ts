import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RETENTION_LEVELS, RETENTION_TARGET_PER_LEVEL, isWordCountInRange } from "../src/lib/retention/levels";
import { countWords } from "../src/lib/retention/word-count";
import { validateMeasurementStructure, MEASUREMENT_LIMITS } from "../src/lib/retention/measurement";
import { evaluateRecall } from "../src/lib/retention/evaluator";

/**
 * Approved author source V2, distinct from historical N14 unapproved drafts.
 * No database or network access. Reading/scoring alternatives remain server-side:
 * never import this content bank into a learner-facing bundle.
 */
type Item = {
  sourceId: string;
  level: string;
  bodyText: string;
  scoringStructure: unknown;
};

function allItems(): Item[] {
  return RETENTION_LEVELS.flatMap(level =>
    readFileSync(`content/retention-v2/${level}.jsonl`, "utf8")
      .trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as Item));
}

test("Retention FINAL V2: precisely 75 authored texts, 15 for each CEFR level, no duplicate IDs/bodies", () => {
  const items = allItems();
  assert.equal(items.length, 75);
  assert.equal(new Set(items.map(x => x.sourceId)).size, items.length, "duplicate sourceId");
  assert.equal(new Set(items.map(x => x.bodyText)).size, items.length, "duplicate text");
  for (const level of RETENTION_LEVELS) {
    const texts = items.filter(x => x.level === level);
    assert.equal(texts.length, RETENTION_TARGET_PER_LEVEL, level);
    for (let i = 0; i < texts.length; i++) {
      const item = texts[i]!;
      assert.equal(item.sourceId, `${level}-${String(i + 1).padStart(3, "0")}`);
      const words = countWords(item.bodyText);
      assert.equal(isWordCountInRange(level, words), true, `${item.sourceId} has ${words} words`);
      assert.equal(item.bodyText.length <= 8000, true, `${item.sourceId}: server body length limit`);
    }
  }
});

test("Retention FINAL V2: every score structure satisfies strict production contract and 5x20 point conservation", () => {
  const invalid: Array<{ sourceId: string; issues: unknown }> = [];
  for (const item of allItems()) {
    let structure;
    try {
      structure = validateMeasurementStructure(item.scoringStructure);
    } catch (error) {
      invalid.push({ sourceId: item.sourceId, issues: (error as { details?: unknown }).details ?? String(error) });
      continue;
    }
    assert.equal(JSON.stringify(item.scoringStructure).length <= MEASUREMENT_LIMITS.maxJsonChars, true, item.sourceId);
    assert.equal(structure.schemaVersion, 1, item.sourceId);
    assert.equal(structure.maxScore, 100, item.sourceId);
    assert.equal(structure.claims.length, 5, item.sourceId);
    const ids = new Set<string>();
    for (const claim of structure.claims) {
      assert.equal(ids.has(claim.id), false, item.sourceId + "/" + claim.id);
      ids.add(claim.id);
      assert.equal(claim.points, 20, item.sourceId + "/" + claim.id);
      assert.equal(claim.scope, "sentence", item.sourceId + "/" + claim.id);
      assert.equal(claim.groups.reduce((n, g) => n + g.points, 0), 20, item.sourceId + "/" + claim.id);
      assert.ok(claim.acceptedPhrases.length >= 8, item.sourceId + "/" + claim.id + ": insufficient paraphrases");
      assert.ok(claim.rejectPhrases.length >= 1, item.sourceId + "/" + claim.id + ": missing contradiction guard");
    }
  }
  if (invalid.length) console.error("RETENTION_V2_SCHEMA_ISSUES", JSON.stringify(invalid));
  assert.deepEqual(invalid, [], "author-provided structures must pass the production validator");
});

test("Retention FINAL V2: every source and canonical five-claim recall scores 100, empty and unrelated score zero", () => {
  const anomalies: Array<{ sourceId: string; test: string; got: number }> = [];
  for (const item of allItems()) {
    let structure;
    try { structure = validateMeasurementStructure(item.scoringStructure); }
    catch { continue; } // Invalid structures are reported in the previous test.
    const canonical = structure.claims.map(c => c.label).join("\n");
    for (const [name, answer, target] of [
      ["canonical", canonical, 100],
      ["source", item.bodyText, 100],
      ["empty", "", 0],
      ["unrelated", "The sun is shining on an unrelated mountain.", 0],
    ] as const) {
      const got = evaluateRecall(answer, structure).score;
      if (got !== target) anomalies.push({ sourceId: item.sourceId, test: name, got });
    }
  }
  if (anomalies.length) console.error("RETENTION_V2_SCORING_ISSUES", JSON.stringify(anomalies));
  assert.deepEqual(anomalies, [], "source rubric and scoring engine must agree");
});
