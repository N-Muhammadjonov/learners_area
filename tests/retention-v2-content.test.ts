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
  for (const item of allItems()) {
    const structure = validateMeasurementStructure(item.scoringStructure);
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
});

test("Retention FINAL V2: every source and canonical five-claim recall scores 100, empty and unrelated score zero", () => {
  for (const item of allItems()) {
    const structure = validateMeasurementStructure(item.scoringStructure);
    const canonical = structure.claims.map(c => c.label).join("\n");
    assert.equal(evaluateRecall(canonical, structure).score, 100, item.sourceId + " canonical");
    assert.equal(evaluateRecall(item.bodyText, structure).score, 100, item.sourceId + " source");
    assert.equal(evaluateRecall("", structure).score, 0, item.sourceId + " empty");
    assert.equal(evaluateRecall("The sun is shining on an unrelated mountain.", structure).score, 0, item.sourceId + " unrelated");
  }
});
