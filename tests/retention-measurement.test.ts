import test from "node:test";
import assert from "node:assert/strict";
import {
  MEASUREMENT_LIMITS,
  parseMeasurementStructureJson,
  stripSingleJsonFence,
  validateMeasurementStructure,
} from "../src/lib/retention/measurement";
import { RetentionError, isRetentionError } from "../src/lib/retention/errors";

/**
 * The Measurement Structure validator matrix (§171).
 *
 * Nothing here "looks like" JSON: every case is parsed by the production
 * validator, so the test proves the same contract the CMS enforces on save.
 */

const valid = {
  schemaVersion: 1,
  maxScore: 100,
  claims: [
    {
      id: "claim_1",
      label: "The company was founded in 1998 by two students.",
      points: 100,
      scope: "sentence",
      groups: [
        { id: "subject", points: 30, kind: "concept", anyOf: ["company", "business"] },
        { id: "action", points: 30, kind: "concept", anyOf: ["founded", "started"] },
        { id: "date", points: 40, kind: "date", anyOf: ["1998"], critical: true },
      ],
      acceptedPhrases: ["two students started the company in 1998"],
      rejectPhrases: ["the company closed"],
    },
  ],
};

function expectRejected(value: unknown, code: string) {
  try {
    validateMeasurementStructure(value);
  } catch (error) {
    assert.ok(isRetentionError(error), "the validator must throw a RetentionError");
    assert.equal((error as RetentionError).code, "retention_invalid_structure");
    const issues = ((error as RetentionError).details as { issues: { code: string }[] }).issues;
    assert.ok(
      issues.some((issue) => issue.code === code),
      `expected issue "${code}", got ${JSON.stringify(issues)}`
    );
    return;
  }
  assert.fail(`expected the structure to be rejected with "${code}"`);
}

const clone = () => JSON.parse(JSON.stringify(valid)) as typeof valid;

test("a valid V1 structure is accepted and canonicalised", () => {
  const parsed = validateMeasurementStructure(valid);
  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.maxScore, 100);
  assert.equal(parsed.claims.length, 1);
  assert.equal(parsed.claims[0]!.groups[2]!.critical, true);
  assert.equal(parsed.claims[0]!.groups[0]!.critical, false, "critical defaults to false");
  assert.deepEqual(parsed.claims[0]!.acceptedPhrases, valid.claims[0]!.acceptedPhrases);
  // Optional phrase arrays may be omitted entirely.
  const minimal = clone();
  delete (minimal.claims[0] as Record<string, unknown>).acceptedPhrases;
  delete (minimal.claims[0] as Record<string, unknown>).rejectPhrases;
  const parsedMinimal = validateMeasurementStructure(minimal);
  assert.deepEqual(parsedMinimal.claims[0]!.acceptedPhrases, []);
  assert.deepEqual(parsedMinimal.claims[0]!.rejectPhrases, []);
});

test("schemaVersion other than 1 is rejected", () => {
  const value = clone();
  (value as { schemaVersion: number }).schemaVersion = 2;
  expectRejected(value, "schema_version_unsupported");
});

test("maxScore other than 100 is rejected", () => {
  const value = clone();
  (value as { maxScore: number }).maxScore = 99;
  expectRejected(value, "max_score_not_100");
});

test("an empty claims array is rejected", () => {
  const value = clone();
  value.claims = [];
  expectRejected(value, "claims_empty");
});

test("duplicate claim ids are rejected", () => {
  const value = clone();
  value.claims = [clone().claims[0]!, clone().claims[0]!] as typeof valid.claims;
  expectRejected(value, "claim_id_duplicate");
});

test("duplicate group ids inside a claim are rejected", () => {
  const value = clone();
  value.claims[0]!.groups[1]!.id = "subject";
  expectRejected(value, "group_id_duplicate");
});

test("a group with non-positive points is rejected", () => {
  for (const points of [0, -5]) {
    const value = clone();
    value.claims[0]!.groups[0]!.points = points;
    expectRejected(value, points === 0 ? "group_points_positive" : "group_points_positive");
  }
});

test("a claim with non-positive points is rejected", () => {
  const value = clone();
  value.claims[0]!.points = 0;
  expectRejected(value, "claim_points_positive");
});

test("group points must sum to exactly the claim's points", () => {
  const value = clone();
  value.claims[0]!.groups[0]!.points = 31;
  expectRejected(value, "claim_group_points_mismatch");
});

test("claim points must sum to exactly 100", () => {
  const value = clone();
  value.claims[0]!.points = 90;
  value.claims[0]!.groups[0]!.points = 19;
  expectRejected(value, "claim_group_points_mismatch");
  const stillWrong = clone();
  stillWrong.claims[0]!.points = 99;
  stillWrong.claims[0]!.groups = [
    { id: "a", points: 50, kind: "concept", anyOf: ["x"] },
    { id: "b", points: 49, kind: "concept", anyOf: ["y"] },
  ];
  expectRejected(stillWrong, "claims_total_not_100");
});

test("an empty anyOf is rejected", () => {
  const value = clone();
  value.claims[0]!.groups[0]!.anyOf = [];
  expectRejected(value, "anyof_empty");
});

test("an unsupported group kind is rejected", () => {
  const value = clone();
  (value.claims[0]!.groups[0] as { kind: string }).kind = "regex";
  expectRejected(value, "group_kind_unsupported");
});

test("an unsupported scope is rejected", () => {
  const value = clone();
  (value.claims[0] as { scope: string }).scope = "paragraph";
  expectRejected(value, "claim_scope_unsupported");
});

test("executable-looking shapes are refused by the strict schema, not evaluated", () => {
  const withRegex = clone();
  (withRegex.claims[0]!.groups[0] as Record<string, unknown>).regex = "^c.*y$";
  expectRejected(withRegex, "group_unexpected_field");

  const withCallback = clone();
  (withCallback.claims[0] as Record<string, unknown>).score = "() => 100";
  expectRejected(withCallback, "claim_unexpected_field");

  const withScript = clone();
  (withScript as Record<string, unknown>).script = "process.exit(0)";
  expectRejected(withScript, "root_unexpected_field");

  const withFunction = clone();
  (withFunction.claims[0]!.groups[0] as Record<string, unknown>).match = { $function: "eval" };
  expectRejected(withFunction, "group_unexpected_field");
});

test("oversized arrays and strings are rejected before anything parses them", () => {
  const tooManyClaims = { schemaVersion: 1, maxScore: 100, claims: Array.from({ length: MEASUREMENT_LIMITS.maxClaims + 1 }, () => clone().claims[0]!) };
  expectRejected(tooManyClaims, "claims_too_many");

  const tooManyGroups = clone();
  tooManyGroups.claims[0]!.groups = Array.from({ length: MEASUREMENT_LIMITS.maxGroupsPerClaim + 1 }, (_, index) => ({
    id: `g${index}`,
    points: 1,
    kind: "concept",
    anyOf: ["x"],
  }));
  tooManyGroups.claims[0]!.points = MEASUREMENT_LIMITS.maxGroupsPerClaim + 1;
  expectRejected(tooManyGroups, "claim_groups_too_many");

  const tooManyAlternatives = clone();
  tooManyAlternatives.claims[0]!.groups[0]!.anyOf = Array.from(
    { length: MEASUREMENT_LIMITS.maxAnyOfPerGroup + 1 },
    (_, index) => `word${index}`
  );
  expectRejected(tooManyAlternatives, "anyof_too_many");

  const longAlternative = clone();
  longAlternative.claims[0]!.groups[0]!.anyOf = ["x".repeat(MEASUREMENT_LIMITS.maxAlternativeChars + 1)];
  expectRejected(longAlternative, "anyof_alternative_too_long");

  const longLabel = clone();
  longLabel.claims[0]!.label = "x".repeat(MEASUREMENT_LIMITS.maxLabelChars + 1);
  expectRejected(longLabel, "claim_label_too_long");
});

test("the JSON entry point refuses syntax errors, emptiness, oversized input and prose", () => {
  for (const [raw, code] of [
    ["{ not json", "json_syntax"],
    ["", "structure_empty"],
    ["   ", "structure_empty"],
    [`{"schemaVersion":1,${"x".repeat(MEASUREMENT_LIMITS.maxJsonChars)}}`, "structure_too_large"],
  ] as const) {
    try {
      parseMeasurementStructureJson(raw);
      assert.fail(`expected "${code}" for ${raw.slice(0, 20)}`);
    } catch (error) {
      assert.ok(isRetentionError(error));
      const issues = (error as RetentionError).details as { issues: { code: string }[] };
      assert.ok(issues.issues.some((issue) => issue.code === code), `expected ${code}`);
    }
  }
  // Prose around JSON is not interpreted, and is refused rather than guessed at.
  assert.throws(() => parseMeasurementStructureJson(`Here is the structure:\n${JSON.stringify(valid)}\nThanks!`));
});

test("exactly one outer Markdown fence is stripped, and nothing else", () => {
  assert.equal(stripSingleJsonFence("```json\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripSingleJsonFence("```\n{\"a\":1}\n```"), "{\"a\":1}");
  assert.equal(stripSingleJsonFence("{\"a\":1}"), "{\"a\":1}");
  // Two fences are not one fence: the inner fence stays and JSON.parse refuses it.
  assert.throws(() => parseMeasurementStructureJson("```json\n```json\n{}\n```\n```"));
  const fenced = parseMeasurementStructureJson("```json\n" + JSON.stringify(valid) + "\n```");
  assert.equal(fenced.claims[0]!.id, "claim_1");
});

test("a structure with the same points written as floats is refused", () => {
  const value = clone();
  value.claims[0]!.groups[0]!.points = 30.5;
  expectRejected(value, "group_points_integer");
});
