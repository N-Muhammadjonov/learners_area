import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { RETENTION_LEVELS, RETENTION_TARGET_PER_LEVEL, isWordCountInRange } from "../src/lib/retention/levels";
import { countWords } from "../src/lib/retention/word-count";
import { validateMeasurementStructure, MEASUREMENT_LIMITS } from "../src/lib/retention/measurement";
import { evaluateRecall } from "../src/lib/retention/evaluator";
import { tokens, splitEvidenceUnits } from "../src/lib/retention/normalize";
import { loadCalibratedRetentionV2 } from "../scripts/retention-v2/calibration";

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
  return loadCalibratedRetentionV2();
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

test("Retention FINAL V2: calibrated author source and every canonical factual recall grade exactly 100", () => {
  for (const item of allItems()) {
    const structure = validateMeasurementStructure(item.scoringStructure);
    const canonical = structure.claims.map(c => c.label).join("\n");
    assert.equal(evaluateRecall(canonical, structure).score, 100, item.sourceId + " canonical");
    assert.equal(evaluateRecall(item.bodyText, structure).score, 100, item.sourceId + " source");
    assert.equal(evaluateRecall("", structure).score, 0, item.sourceId + " empty");
    assert.equal(evaluateRecall("The sun is shining on an unrelated mountain.", structure).score, 0, item.sourceId + " unrelated");
    const isolated = structure.claims.map(c => c.groups[0]!.anyOf[0]!).join(", ");
    assert.ok(evaluateRecall(isolated, structure).score < 100, item.sourceId + " keyword stuffing");
  }
});

test("Retention FINAL V2: original owner corpus stays byte-for-byte immutable and corrections use only grounded phrases", () => {
  const original = RETENTION_LEVELS.flatMap(level =>
    readFileSync(`content/retention-v2/${level}.jsonl`, "utf8")
      .trim().split("\n").map(line => JSON.parse(line) as Item));
  const fixed = allItems();
  const raw = JSON.parse(readFileSync("content/retention-v2/calibration-gaps.json", "utf8")) as {
    status: string; anomalies: Array<{ sourceId: string; test: string; got: number }>;
  };
  assert.equal(raw.status, "QA_HOLD_DO_NOT_PUBLISH", "old source mismatch receipt must not be rewritten");
  assert.equal(raw.anomalies.length, 49, "historical 49 source-score mismatches remain auditable");
  assert.equal(fixed.length, original.length);
  for (let i = 0; i < fixed.length; i++) {
    assert.equal(fixed[i]!.bodyText, original[i]!.bodyText);
    assert.equal(fixed[i]!.sourceId, original[i]!.sourceId);
    const before = original[i]!.scoringStructure as ReturnType<typeof validateMeasurementStructure>;
    const after = fixed[i]!.scoringStructure as ReturnType<typeof validateMeasurementStructure>;
    assert.equal(before.claims.length, after.claims.length);
    for (let j = 0; j < before.claims.length; j++) {
      const claim = before.claims[j]!;
      const actual = after.claims[j]!;
      assert.deepEqual(claim.groups, actual.groups, "no weights, critical anchors or alternatives changed");
      assert.deepEqual(claim.rejectPhrases, actual.rejectPhrases, "no contradiction guards changed");
      assert.equal(claim.points, actual.points);
      assert.equal(claim.label, actual.label);
    }
  }
});

test("Retention FINAL V2: negation, comparative opposites and critical dates still defeat full credit", () => {
  const items = new Map(allItems().map(item => [item.sourceId, item]));
  const year = items.get("A2-004")!;
  const recall = (i: Item) => (i.scoringStructure as ReturnType<typeof validateMeasurementStructure>).claims.map(c => c.label).join("\n");
  assert.ok(evaluateRecall(recall(year).replace("2024", "2025"), validateMeasurementStructure(year.scoringStructure)).score < 100, "wrong year");
  const c2 = items.get("C2-014")!;
  assert.equal(evaluateRecall(c2.bodyText, validateMeasurementStructure(c2.scoringStructure)).score, 100, "Dr. must remain part of a single fact");
  assert.ok(evaluateRecall(recall(c2).replace("2020", "2021"), validateMeasurementStructure(c2.scoringStructure)).score < 100, "C2 wrong year");
  assert.ok(evaluateRecall(recall(c2).replace("fewer projects qualified", "more projects qualified"), validateMeasurementStructure(c2.scoringStructure)).score < 100, "more and fewer are opposite meanings");
  assert.deepEqual(tokens("more projects"), ["more", "projects"]);
  assert.deepEqual(tokens("most projects"), ["most", "projects"]);
  assert.equal(splitEvidenceUnits("Dr. Pavel Orlov started the review in 2020. It succeeded.").length, 2);
  assert.ok(evaluateRecall("Daniel started the bicycle repair table in 2024. But this was not true.", validateMeasurementStructure(year.scoringStructure)).breakdown.claims[0]!.awardedPoints === 0, "explicit factual denial");
});
