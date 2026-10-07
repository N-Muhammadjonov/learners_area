import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { attemptHistoryLine, classificationDecisionReason } from "../src/lib/listening/classification-triage";

/**
 * OWNER TRIAGE (§§ classification report, binding): the report is READ-ONLY and it EXPLAINS.
 *
 * The owner's rule has two halves and both are tested here:
 *   T1  the script writes nothing — proven on the source, so a future edit that adds an UPDATE or
 *       a DELETE fails the gate rather than quietly mutating production data;
 *   T2  the report delegates its product decision to the application's own decision table instead
 *       of re-implementing (and drifting from) it;
 *   T3  for a row it cannot place it states a REASON drawn from canonical facts alone — and the
 *       reason may not hint at a classification, so it can never become an automatic classifier;
 *   T4  identity is reported from canonical columns, and learner history is reported whenever the
 *       row has been attempted — the owner must see whose results a decision would affect.
 *
 * Nothing here asserts a classification of any real row: the owner decides those.
 */

const CODE = readFileSync("scripts/listening-classification-report.ts", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

test("T1 the triage report performs no write of any kind", () => {
  const statements = CODE.match(/sql`[\s\S]*?`/g) ?? [];
  assert.equal(statements.length, 1, "the report issues exactly one statement");
  assert.match(statements[0], /^\s*sql`\s*select/i, "and that statement is a SELECT");
  for (const verb of ["insert", "update", "delete", "drop", "alter", "truncate", "grant", "create table"]) {
    assert.doesNotMatch(CODE, new RegExp(`\\b${verb}\\b`, "i"), `the report must never issue ${verb.toUpperCase()}`);
  }
});

test("T2 the product decision comes from the application's table, not a copy", () => {
  assert.match(CODE, /productSql\(/, "the report reuses the same expression the catalogues use");
  assert.match(CODE, /versionTypeSql\(/, "and the same revision-contentType expression");
  assert.doesNotMatch(CODE, /contentType\s*===\s*['"]/, "it does not re-implement the decision table by hand");
});

test("T3 a row it cannot place is explained by canonical facts, never guessed", () => {
  const reviewed = classificationDecisionReason({
    product: "unclassified",
    hasPackage: true,
    revisionType: null,
    collection: null,
    parts: 1,
    questions: 8,
  });
  assert.match(reviewed, /4-part \/ 40-question/, "the missing proof is named exactly");
  assert.match(reviewed, /1 part\(s\) and 8 question\(s\)/, "the row's own structure is reported as a fact");
  for (const guess of ["academic", "general", "mcq", "probably", "looks like", "should be"]) {
    assert.equal(new RegExp(guess, "i").test(reviewed), false, `the reason must not suggest '${guess}'`);
  }

  const unknownCollection = classificationDecisionReason({
    product: "unclassified",
    hasPackage: true,
    revisionType: "listening:section",
    collection: "legacy_import",
    parts: null,
    questions: null,
  });
  assert.match(unknownCollection, /collection 'legacy_import'/, "an unrecognised collection is quoted, not interpreted");

  const noPackageNoRevision = classificationDecisionReason({
    product: "unclassified",
    hasPackage: false,
    revisionType: null,
    collection: null,
    parts: null,
    questions: null,
  });
  assert.match(noPackageNoRevision, /no canonical package and no Listening revision/i, "absence of every proof is stated plainly");
  assert.match(noPackageNoRevision, /nothing .* states what this item is/i);
});

test("T4 the report shows identity and the history a decision would affect", () => {
  assert.match(CODE, /source_ref=/, "identity is printed from canonical columns");
  assert.match(CODE, /id=\$\{row\.id\}/);
  assert.match(CODE, /learner history:/);
  assert.match(CODE, /from listening_attempts a where a\.test_id = t\.id/, "history is read per test");
  assert.match(CODE, /a\.status = 'completed'/, "completed attempts are distinguished");
  assert.match(CODE, /count\(distinct a\.user_id\)/, "and the learners affected are counted, not guessed");
  assert.match(CODE, /withdraw content learners have already attempted/, "the consequence of retiring a used row is spelled out");

  assert.equal(attemptHistoryLine({ attempts: 0, completedAttempts: 0, learners: 0, lastAttemptAt: null }), "never attempted");
  const used = attemptHistoryLine({ attempts: 3, completedAttempts: 2, learners: 2, lastAttemptAt: new Date("2026-03-04T10:00:00Z") });
  assert.match(used, /3 attempt\(s\) by 2 learner\(s\), 2 completed, last on 2026-03-04/);
});
