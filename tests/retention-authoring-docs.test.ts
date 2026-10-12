import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseMeasurementStructureJson } from "../src/lib/retention/measurement";
import { countWords } from "../src/lib/retention/word-count";
import { isWordCountInRange } from "../src/lib/retention/levels";

/**
 * The authoring document is not decoration: the example the owner will copy is
 * executed by the PRODUCTION validator here. If the format changes and the doc is
 * not updated, or the doc's example stops being worth exactly 100 points, this
 * test fails — which is the only way a "documented format" stays true.
 */

const doc = readFileSync(join(process.cwd(), "docs/RETENTION_AUTHORING_FORMAT.md"), "utf8");

const textExample = doc
  .split("<!-- retention-text-example:start -->")[1]!
  .split("```text")[1]!
  .split("```")[0]!
  .trim();

const jsonExample = doc.split("## 2. MEASUREMENT STRUCTURE")[1]!.match(/```json\n([\s\S]*?)```/)![1]!;

test("the documented example text is a real B1 text by the production word counter", () => {
  const words = countWords(textExample);
  assert.equal(words, 172, "the document states 172 words; the counter must agree");
  assert.ok(isWordCountInRange("B1", words), `${words} is outside B1's 160–195`);
});

test("the documented Measurement Structure passes the production validator", () => {
  const structure = parseMeasurementStructureJson(jsonExample);
  assert.equal(structure.schemaVersion, 1);
  assert.equal(structure.maxScore, 100);
  assert.equal(structure.claims.length, 4);
  assert.equal(
    structure.claims.reduce((sum, claim) => sum + claim.points, 0),
    100,
    "the example must be worth exactly 100 points"
  );
  for (const claim of structure.claims) {
    assert.equal(
      claim.groups.reduce((sum, group) => sum + group.points, 0),
      claim.points,
      `claim ${claim.id} groups must sum to its points`
    );
  }
});

test("the documented example contains no executable shape", () => {
  for (const forbidden of ["function", "=>", "eval(", "new RegExp", "setTimeout"]) {
    assert.ok(!jsonExample.includes(forbidden), `the example must not mention ${forbidden}`);
  }
});

test("the document states the level table, the conservation rule and the target-not-maximum rule", () => {
  for (const level of ["A2", "B1", "B2", "C1", "C2"]) {
    assert.ok(doc.includes(level), `the level table mentions ${level}`);
  }
  assert.match(doc, /100–125/);
  assert.match(doc, /160–195/);
  assert.match(doc, /240–285/);
  assert.match(doc, /280–330/);
  assert.match(doc, /390–450/);
  assert.match(doc, /exactly 100 points/);
  assert.match(doc, /target\*\*, not a maximum|target.*not a maximum/i);
  assert.match(doc, /Delete.*archives/is);
  assert.match(doc, /grouped number is \*\*one\*\* word: `50,000`/);
});

import { evaluateRecall as evaluatePair } from "../src/lib/retention/evaluator";
import type { RetentionLevel } from "../src/lib/retention/levels";

for (const level of ["A2", "C1"] as RetentionLevel[]) {
  test(`the documented complete ${level} pair passes the production counter, validator and scorer`, () => {
    const section = doc.split(`<!-- retention-pair:${level}:start -->`)[1]?.split(`<!-- retention-pair:${level}:end -->`)[0];
    assert.ok(section, `the ${level} pair is present`);
    const text = section.split("```text")[1]!.split("```")[0]!.trim();
    const json = section.match(/```json\n([\s\S]*?)```/)![1]!;
    const words = countWords(text);
    assert.ok(isWordCountInRange(level, words), `${level} text has ${words} words`);
    assert.ok(doc.includes(`${level} pair (${words} words`), "the stated word count is the real one");
    const structure = parseMeasurementStructureJson(json);
    assert.equal(structure.claims.reduce((sum, claim) => sum + claim.points, 0), 100);
    assert.ok(structure.claims.some((claim) => claim.groups.some((group) => group.critical)), "has critical facts");
    assert.ok(structure.claims.some((claim) => claim.rejectPhrases.length > 0), "has reject phrases");
    // Recalling the whole source must earn full marks; an empty answer earns none.
    assert.equal(evaluatePair(text, structure).score, 100);
    assert.equal(evaluatePair("", structure).score, 0);
  });
}

test("the document states the current evaluator version and the grammar/semantic limits", () => {
  assert.match(doc, /retention-deterministic-v3/);
  assert.match(doc, /-v5/);
  assert.match(doc, /Grammar is not scored/);
  assert.match(doc, /cannot prove in general that a learner's sentence is semantically true/);
});
