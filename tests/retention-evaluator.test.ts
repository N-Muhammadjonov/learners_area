import test from "node:test";
import assert from "node:assert/strict";
import { evaluateRecall } from "../src/lib/retention/evaluator";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";
import { RETENTION_EVALUATOR_VERSION } from "../src/lib/retention/types";
import type { MeasurementStructureV1 } from "../src/lib/retention/types";

/**
 * The evaluator matrix from the owner's contract (§74, §75, §172).
 *
 * Every fixture is validated by the PRODUCTION validator before it is used, so a
 * test can never pass against a structure the application would refuse to save.
 */

function structure(value: unknown): MeasurementStructureV1 {
  return validateMeasurementStructure(value);
}

/** 60 + 40 = 100; groups inside each claim sum to the claim. */
const company = structure({
  schemaVersion: 1,
  maxScore: 100,
  claims: [
    {
      id: "founding",
      label: "The company was founded in 1998 by two students.",
      points: 60,
      scope: "sentence",
      groups: [
        { id: "subject", points: 10, kind: "concept", anyOf: ["company", "business", "firm"] },
        { id: "action", points: 20, kind: "concept", anyOf: ["founded", "started", "established", "set up", "began"] },
        { id: "date", points: 20, kind: "date", anyOf: ["1998"], critical: true },
        { id: "people", points: 10, kind: "number", anyOf: ["two students", "2 students", "two university students"] },
      ],
      acceptedPhrases: ["two students started the company in 1998"],
      rejectPhrases: ["the company closed", "the company ended"],
    },
    {
      id: "growth",
      label: "The business grew quickly in its first year.",
      points: 40,
      scope: "sentence",
      groups: [
        { id: "growth", points: 20, kind: "concept", anyOf: ["grew", "grow", "increased", "expanded"] },
        { id: "when", points: 20, kind: "concept", anyOf: ["first year", "first twelve months"] },
      ],
      acceptedPhrases: ["the business grew quickly in its first year"],
      rejectPhrases: ["the business decreased", "the business shrank"],
    },
  ],
});

const population = structure({
  schemaVersion: 1,
  maxScore: 100,
  claims: [
    {
      id: "population",
      label: "The population increased to 50,000.",
      points: 100,
      scope: "sentence",
      groups: [
        { id: "subject", points: 30, kind: "concept", anyOf: ["population", "inhabitants", "residents"] },
        { id: "change", points: 30, kind: "concept", anyOf: ["increased", "grew", "rose"] },
        { id: "value", points: 40, kind: "number", anyOf: ["50,000", "50000"], critical: true },
      ],
      acceptedPhrases: ["the population increased to 50000"],
      rejectPhrases: ["the population decreased", "the population fell", "the population declined"],
    },
  ],
});

const score = (answer: string, rubric: MeasurementStructureV1 = company) => evaluateRecall(answer, rubric).score;
const statuses = (answer: string, rubric: MeasurementStructureV1 = company) =>
  evaluateRecall(answer, rubric).breakdown.claims.map((claim) => claim.status);

// ---------------------------------------------------------------------------
// §74 — CASE 1..17
// ---------------------------------------------------------------------------

test("CASE 1: the exact sentence earns the full claim", () => {
  assert.equal(score("The company was founded in 1998 by two students."), 60);
});

test("CASE 2: articles and function words change nothing", () => {
  const withArticle = score("The company was founded in 1998 by two students.");
  const withoutArticles = score("Company founded 1998 by two students.");
  assert.equal(withoutArticles, withArticle);
  assert.equal(withoutArticles, 60);
});

test("CASE 3: anyOf synonyms are interchangeable", () => {
  assert.equal(score("The business was started in 1998 by two students."), 60);
  assert.equal(score("The firm was established in 1998 by two students."), 60);
  assert.equal(score("The company was set up in 1998 by two students."), 60);
});

test("CASE 4: the learner's word order is their own", () => {
  assert.equal(score("In 1998, two students founded the company."), 60);
  assert.equal(score("By two students was the company founded in 1998."), 60);
});

test("CASE 5: minor grammar errors keep the factual points", () => {
  assert.equal(score("Company was founded 1998 by two students."), 60); // articles and prepositions dropped
  assert.equal(score("The company were founded in 1998 by two students."), 60); // agreement error
  assert.equal(score("The company is founded in 1998 by two students."), 60); // tense error
  assert.equal(score("the company founded in 1998 by two students"), 60); // no capitals, no full stop
});

test("CASE 6: a small typo in an ordinary concept is tolerated — inside the documented budget", () => {
  assert.equal(score("The comany was founded in 1998 by two students."), 60); // 1 edit, 7 letters
  assert.equal(score("The business was establised in 1998 by two students."), 60); // 1 edit, 11 letters
  // Outside the budget it is refused, on purpose: a transposition is two edits,
  // and the rule for a 7-letter concept is one.
  assert.equal(score("The compnay was founded in 1998 by two students."), 50);
});

test("CASE 7: a wrong date loses the date points, and nothing else", () => {
  const result = evaluateRecall("The company was founded in 1989 by two students.", company);
  assert.equal(result.score, 40);
  const founding = result.breakdown.claims[0]!;
  assert.deepEqual(founding.missingGroupIds, ["date"]);
  assert.deepEqual(founding.missingCriticalGroupIds, ["date"]);
  assert.equal(founding.status, "partial");
});

test("CASE 8: a wrong number loses the number points", () => {
  const result = evaluateRecall("The company was founded in 1998 by five students.", company);
  const founding = result.breakdown.claims[0]!;
  assert.equal(result.score, 50);
  assert.ok(!founding.matchedGroupIds.includes("people"));
});

test("CASE 9: a negated fact earns nothing", () => {
  const result = evaluateRecall("The business did not grow in its first year.", company);
  const growth = result.breakdown.claims[1]!;
  assert.ok(!growth.matchedGroupIds.includes("growth"), "did not grow must not satisfy the growth concept");
  assert.equal(growth.awardedPoints, 0);
});

test("CASE 10: a reject phrase zeroes the whole claim", () => {
  const result = evaluateRecall("The company closed in 1998.", company);
  assert.equal(result.score, 0);
  assert.equal(result.breakdown.claims[0]!.status, "contradicted");
  assert.equal(result.breakdown.claims[0]!.awardedPoints, 0);
});

test("CASE 11: half the fact is worth half the claim", () => {
  const result = evaluateRecall("The company was founded in 1998.", company);
  assert.equal(result.score, 50);
  assert.equal(result.breakdown.claims[0]!.status, "partial");
});

test("CASE 12: keywords scattered across unrelated sentences never make a full claim", () => {
  const answer = "The company was successful.\n1998 was an interesting year.\nAnother organization was founded.";
  const result = evaluateRecall(answer, company);
  const founding = result.breakdown.claims[0]!;
  assert.notEqual(founding.status, "captured");
  assert.equal(founding.awardedPoints, 20, "only the best single sentence counts");
  assert.equal(result.score, 20);
});

test("CASE 13: an accepted phrase grants the claim in full", () => {
  const result = evaluateRecall("Two students started the company in 1998.", company);
  assert.equal(result.score, 60);
  assert.equal(result.breakdown.claims[0]!.status, "captured");
});

test("CASE 14: a misspelt critical entity is not accepted", () => {
  const proper = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "place",
        label: "Marie Curie discovered radium.",
        points: 100,
        scope: "sentence",
        groups: [
          { id: "person", points: 50, kind: "entity", anyOf: ["Marie Curie"], critical: true },
          { id: "thing", points: 50, kind: "concept", anyOf: ["radium", "radium discovered"] },
        ],
        rejectPhrases: ["Albert Einstein"],
      },
    ],
  });
  assert.equal(score("Marie Curie discovered radium.", proper), 100);
  // "Maree Curie" is one edit away, but a critical entity is matched exactly.
  assert.equal(score("Maree Curie discovered radium.", proper), 50);
});

test("CASE 15: a completely unrelated answer scores zero", () => {
  assert.equal(score("My favourite colour is blue and I like football."), 0);
});

test("CASE 16: an empty answer scores zero", () => {
  assert.equal(score(""), 0);
  assert.equal(score("   \n  "), 0);
});

test("CASE 17: the same input twice is byte-identical", () => {
  const answer = "The business was started in 1998 by two students. It grew in its first year.";
  const first = evaluateRecall(answer, company);
  const second = evaluateRecall(answer, company);
  assert.deepEqual(first, second);
  assert.equal(first.breakdown.evaluatorVersion, RETENTION_EVALUATOR_VERSION);
});

// ---------------------------------------------------------------------------
// §172 — CASE 18..30
// ---------------------------------------------------------------------------

test("CASE 18: several synonyms of one group are still worth the group, once", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "growth",
        label: "The business grew.",
        points: 100,
        scope: "answer",
        groups: [{ id: "growth", points: 100, kind: "concept", anyOf: ["grew", "increase", "rose"] }],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("it grew and increased and rose", rubric), 100);
});

test("CASE 19: a negation somewhere else in the sentence negates nothing else", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "expansion",
        label: "The business expanded.",
        points: 100,
        scope: "sentence",
        groups: [{ id: "growth", points: 100, kind: "concept", anyOf: ["expanded"] }],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("The company did not close; it expanded.", rubric), 100);
  assert.equal(score("The company did not close, it expanded.", rubric), 100);
});

test("CASE 20: an accepted phrase cannot outrun a conflicting critical number", () => {
  const result = evaluateRecall("The population increased to 500,000.", population);
  assert.notEqual(result.breakdown.claims[0]!.status, "captured");
  assert.equal(result.score, 60, "the two concept groups still count; the number does not");
});

test("CASE 21: a reject phrase beats a positive keyword in the same claim", () => {
  const result = evaluateRecall("The population decreased to 50,000.", population);
  assert.equal(result.breakdown.claims[0]!.status, "contradicted");
  assert.equal(result.score, 0);
});

test("CASE 22: sentence scope never stitches two sentences into one fact", () => {
  const result = evaluateRecall("The company was founded in 1998. Two students joined.", company);
  const founding = result.breakdown.claims[0]!;
  assert.equal(founding.awardedPoints, 50);
  assert.ok(!founding.matchedGroupIds.includes("people"));
});

test("CASE 23: answer scope is allowed to combine across sentences", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "founding",
        label: "The company was founded in 1998 by two students.",
        points: 100,
        scope: "answer",
        groups: [
          { id: "subject", points: 30, kind: "concept", anyOf: ["company", "business"] },
          { id: "action", points: 30, kind: "concept", anyOf: ["founded", "started"] },
          { id: "date", points: 40, kind: "date", anyOf: ["1998"], critical: true },
        ],
        rejectPhrases: ["the company closed"],
      },
    ],
  });
  assert.equal(score("I remember the company. It was founded at some point, and the year 1998 was mentioned.", rubric), 100);
  assert.equal(score("I remember the company. It was founded in 1998.", rubric), 100);
});

test("CASE 24: a concept typo inside the safe threshold is accepted", () => {
  assert.equal(score("The busines was founded in 1998 by two students."), 60); // 1 edit, 7 letters
});

test("CASE 25: a concept typo outside the safe threshold is rejected", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "founding",
        label: "The company was founded.",
        points: 100,
        scope: "sentence",
        groups: [
          { id: "subject", points: 50, kind: "concept", anyOf: ["company"] },
          { id: "action", points: 50, kind: "concept", anyOf: ["founded"] },
        ],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("The comapny was founded.", rubric), 50); // 2 edits on a 7-letter word: refused
  assert.equal(score("The company was fonuded.", rubric), 50); // 2 edits on a 7-letter word: refused
});

test("CASE 26: a critical concept is matched exactly, never fuzzily", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "city",
        label: "The summit was held in Geneva.",
        points: 100,
        scope: "sentence",
        groups: [
          { id: "city", points: 100, kind: "concept", anyOf: ["Geneva"], critical: true },
        ],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("The summit was held in Geneva.", rubric), 100);
  assert.equal(score("The summit was held in Geneve.", rubric), 0);
});

test("CASE 27: the number-word equivalence is exact and deliberate", () => {
  assert.equal(score("The company was founded in 1998 by 2 students."), 60);
  assert.equal(score("The company was founded in 1998 by two students."), 60);
  assert.equal(score("The population increased to fifty thousand.", population), 100);
  assert.equal(score("The population increased to 50000.", population), 100);
});

test("CASE 28: a wrong number earns no numeric points", () => {
  assert.equal(score("The population increased to 45,000.", population), 60);
  assert.equal(score("The population increased to 500,000.", population), 60);
});

test("CASE 29: repetition never exceeds the configured group points", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "growth",
        label: "The business grew.",
        points: 100,
        scope: "answer",
        groups: [
          { id: "growth", points: 60, kind: "concept", anyOf: ["grew", "increased", "expanded"] },
          { id: "when", points: 40, kind: "concept", anyOf: ["first year"] },
        ],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("grew increased expanded and grew again in the first year", rubric), 100);
});

test("CASE 30: every breakdown adds up to exactly the reported score", () => {
  const answers = [
    "The company was founded in 1998 by two students. The business grew quickly in its first year.",
    "Company founded 1998 by two students, business grew first year",
    "The company closed in 1998.",
    "",
  ];
  for (const answer of answers) {
    const result = evaluateRecall(answer, company);
    const summed = result.breakdown.claims.reduce((total, claim) => total + claim.awardedPoints, 0);
    assert.equal(summed, result.score, `breakdown must sum to the score for "${answer}"`);
    assert.equal(result.breakdown.score, result.score);
    assert.ok(Number.isInteger(result.score) && result.score >= 0 && result.score <= 100);
  }
});

// ---------------------------------------------------------------------------
// §75 — false-positive security tests
// ---------------------------------------------------------------------------

test("FALSE POSITIVE: the opposite change is not credited", () => {
  const result = evaluateRecall("The population decreased to 50,000.", population);
  assert.equal(result.score, 0);
  assert.equal(result.breakdown.claims[0]!.status, "contradicted");
});

test("FALSE POSITIVE: a different magnitude is not the same number", () => {
  const result = evaluateRecall("The population increased to 500,000.", population);
  assert.notEqual(result.score, 100);
  assert.ok(!result.breakdown.claims[0]!.matchedGroupIds.includes("value"));
});

test("FALSE POSITIVE: naming the words and denying the meaning earns nothing", () => {
  const answer = "I remember the words population, increase, fifty thousand but this was not what happened.";
  const result = evaluateRecall(answer, population);
  assert.notEqual(result.score, 100);
  assert.equal(result.score, 0);
  assert.equal(result.breakdown.claims[0]!.status, "contradicted");
});

test("FALSE POSITIVE: the date cannot be borrowed from a different sentence for a sentence-scoped claim", () => {
  const answer = "1998 was a year. The company was founded by two students.";
  const result = evaluateRecall(answer, company);
  const founding = result.breakdown.claims[0]!;
  assert.deepEqual([...founding.matchedGroupIds].sort(), ["action", "people", "subject"]);
  assert.deepEqual(founding.missingCriticalGroupIds, ["date"], "the year is in the wrong sentence and must not count");
  assert.equal(founding.status, "partial");
});

test("FALSE POSITIVE: a claim about the same vocabulary needs its own evidence", () => {
  const overlapping = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "first",
        label: "The company was founded in 1998.",
        points: 50,
        scope: "sentence",
        groups: [
          { id: "subject", points: 20, kind: "concept", anyOf: ["company"] },
          { id: "date", points: 30, kind: "date", anyOf: ["1998"], critical: true },
        ],
        rejectPhrases: [],
      },
      {
        id: "second",
        label: "The company opened a new office in 2005.",
        points: 50,
        scope: "sentence",
        groups: [
          { id: "subject2", points: 20, kind: "concept", anyOf: ["company"] },
          { id: "date2", points: 30, kind: "date", anyOf: ["2005"], critical: true },
        ],
        rejectPhrases: [],
      },
    ],
  });
  const result = evaluateRecall("The company was founded in 1998.", overlapping);
  assert.equal(result.breakdown.claims[0]!.awardedPoints, 50);
  const second = result.breakdown.claims[1]!;
  assert.deepEqual(second.matchedGroupIds, ["subject2"], "the shared word matches; the shared claim does not");
  assert.deepEqual(second.missingCriticalGroupIds, ["date2"], "1998 must not satisfy the 2005 claim");
});

test("FALSE POSITIVE: a negation window stops at a clause boundary", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "date",
        label: "The bridge opened in 1998.",
        points: 100,
        scope: "sentence",
        groups: [
          { id: "action", points: 50, kind: "concept", anyOf: ["opened"] },
          { id: "year", points: 50, kind: "date", anyOf: ["1998"], critical: true },
        ],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("The bridge did not close in 1998, it opened.", rubric), 50, "the negated date must not be awarded");
  assert.equal(score("The bridge opened, not in 1998 but in 1999.", rubric), 50);
});

test("FALSE POSITIVE: an entity or number alternative never fuzz-matches", () => {
  const rubric = structure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [
      {
        id: "flight",
        label: "The flight carried 250 passengers.",
        points: 100,
        scope: "sentence",
        groups: [
          { id: "count", points: 100, kind: "number", anyOf: ["250"] },
        ],
        rejectPhrases: [],
      },
    ],
  });
  assert.equal(score("The flight carried 250 passengers.", rubric), 100);
  assert.equal(score("The flight carried 251 passengers.", rubric), 0);
  assert.equal(score("The flight carried 25 passengers.", rubric), 0);
  assert.equal(score("The flight carried 2500 passengers.", rubric), 0);
});

// --- v2 regressions: critical facts are never credited through an accepted phrase ---
function oneClaim(groups: unknown[], acceptedPhrases: string[] = [], rejectPhrases: string[] = []): MeasurementStructureV1 {
  return structure({ schemaVersion: 1, maxScore: 100, claims: [{ id: "fact", label: "Company founded in 1998 by two students", points: 100, scope: "sentence", groups, acceptedPhrases, rejectPhrases }] });
}
const numericPair = oneClaim([
  { id: "subject", kind: "concept", points: 10, anyOf: ["company"] },
  { id: "action", kind: "concept", points: 20, anyOf: ["started"] },
  { id: "date", kind: "date", critical: true, points: 40, anyOf: ["1998"] },
  { id: "people", kind: "number", critical: true, points: 30, anyOf: ["2"] },
], ["two students started the company"]);

test("v2: accepted phrase + wrong date + correct people number loses the date points", () => {
  const claim = evaluateRecall("Two students started the company in 1989.", numericPair).breakdown.claims[0]!;
  assert.equal(claim.awardedPoints, 60);
  assert.deepEqual(claim.missingCriticalGroupIds, ["date"]);
  assert.equal(claim.status, "partial");
});

test("v2: accepted phrase + correct date + wrong people number loses the people points", () => {
  const claim = evaluateRecall("Three students started the company in 1998.", numericPair).breakdown.claims[0]!;
  assert.ok(!claim.matchedGroupIds.includes("people"));
  assert.equal(claim.awardedPoints, 70);
});

test("v2: legitimate accepted phrase with full critical evidence still scores 100", () => {
  const result = evaluateRecall("Two students started the company in 1998.", numericPair);
  assert.equal(result.score, 100);
  assert.equal(result.breakdown.claims[0]!.status, "captured");
});

test("v2: accepted phrase cannot credit a wrong or missing critical entity", () => {
  const entity = oneClaim([
    { id: "subject", kind: "entity", critical: true, points: 40, anyOf: ["Acme"] },
    { id: "action", kind: "concept", points: 60, anyOf: ["started"] },
  ], ["company started"]);
  const wrong = evaluateRecall("The Beta company started.", entity).breakdown.claims[0]!;
  assert.equal(wrong.awardedPoints, 60);
  assert.deepEqual(wrong.missingCriticalGroupIds, ["subject"]);
  assert.equal(evaluateRecall("The Acme company started.", entity).score, 100);
});

test("v2: matched groups and awarded points stay consistent", () => {
  const claim = evaluateRecall("Two students started the company in 1989.", numericPair).breakdown.claims[0]!;
  const points: Record<string, number> = { subject: 10, action: 20, date: 40, people: 30 };
  assert.equal(claim.matchedGroupIds.reduce((sum, id) => sum + points[id]!, 0), claim.awardedPoints);
});

const basicFact = oneClaim([
  { id: "subject", kind: "concept", points: 40, anyOf: ["company"] },
  { id: "date", kind: "date", critical: true, points: 60, anyOf: ["1998"] },
]);

test("v2: an unrelated denial does not negate a correctly remembered fact", () => {
  const result = evaluateRecall("The company was founded in 1998. The weather report was not true.", basicFact);
  assert.equal(result.score, 100);
  assert.equal(result.breakdown.claims[0]!.status, "captured");
});

test("v2: a same-fact denial, in the sentence or referring back to it, still zeroes the claim", () => {
  assert.equal(evaluateRecall("The company was founded in 1998, but that is not true.", basicFact).score, 0);
  const referring = evaluateRecall("The company was founded in 1998. But this was not what happened.", basicFact);
  assert.equal(referring.score, 0);
  assert.equal(referring.breakdown.claims[0]!.status, "contradicted");
});

test("v2: answer-scoped claims apply denials per sentence too", () => {
  const answerScoped = structure({ schemaVersion: 1, maxScore: 100, claims: [{ id: "fact", label: "The company was founded in 1998", points: 100, scope: "answer", groups: [
    { id: "subject", kind: "concept", points: 40, anyOf: ["company"] },
    { id: "date", kind: "date", critical: true, points: 60, anyOf: ["1998"] },
  ], acceptedPhrases: [], rejectPhrases: [] }] });
  assert.equal(evaluateRecall("The company was founded in 1998. The weather report was not true.", answerScoped).score, 100);
  assert.equal(evaluateRecall("The company was founded in 1998. It was not true.", answerScoped).score, 0);
});

test("v2: evaluator version is bumped for newly graded attempts", () => {
  // v4: occurrence-complete matching + sentence boundaries in answer scope (N14 audit).
  assert.equal(RETENTION_EVALUATOR_VERSION, "retention-deterministic-v4");
});

const v4 = (scope: "answer" | "sentence") => structure({ schemaVersion: 1, maxScore: 100, claims: [{ id: "cheap", label: "Cheap flights replaced night trains", points: 100, scope, groups: [
  { id: "flights", kind: "concept", points: 50, anyOf: ["cheap flights"] },
  { id: "trains", kind: "concept", points: 50, anyOf: ["night trains"] },
], acceptedPhrases: [], rejectPhrases: [] }] });

test("v4: a negation does not cross a full stop in answer scope", () => {
  assert.equal(evaluateRecall("Some people saw no future. Cheap flights replaced night trains.", v4("answer")).score, 100);
});

test("v4: negation inside the same sentence still removes the group", () => {
  assert.equal(evaluateRecall("There were no cheap flights, but night trains ran.", v4("answer")).score, 50);
  assert.equal(evaluateRecall("There were no cheap flights, but night trains ran.", v4("sentence")).score, 50);
});

test("v4: a negated first mention does not hide a later affirmative mention", () => {
  assert.equal(evaluateRecall("At first there were no cheap flights, later cheap flights replaced night trains.", v4("sentence")).score, 100);
});

test("v4: an authored phrase is never matched across two sentences", () => {
  assert.equal(evaluateRecall("They were cheap. Flights replaced night trains.", v4("answer")).score, 50);
});

test("unrelated disclaimer sharing a critical date cannot negate the company claim", () => {
  const structure = validateMeasurementStructure({
    schemaVersion: 1,
    maxScore: 100,
    claims: [{
      id: "company-founded",
      label: "The company was founded in 1998",
      points: 100,
      scope: "sentence",
      groups: [
        { id: "subject", kind: "concept", points: 40, anyOf: ["company"] },
        { id: "date", kind: "date", critical: true, points: 60, anyOf: ["1998"] },
      ],
      acceptedPhrases: [],
      rejectPhrases: [],
    }],
  });
  const unrelated = evaluateRecall(
    "The company was founded in 1998. The weather report for 1998 was not true.",
    structure,
  );
  assert.equal(unrelated.score, 100);
  assert.equal(unrelated.breakdown.claims[0]?.status, "captured");
  const actualDenial = evaluateRecall(
    "The company was founded in 1998. It was not true.",
    structure,
  );
  assert.equal(actualDenial.score, 0);
  assert.equal(actualDenial.breakdown.claims[0]?.status, "contradicted");
  const bareDateDenial = evaluateRecall("The company was founded in 1998. 1998 was not true.", structure);
  assert.equal(bareDateDenial.score, 0);
});

test("v4: a decimal number is not split into two sentences", () => {
  const decimal = structure({ schemaVersion: 1, maxScore: 100, claims: [{ id: "deaths", label: "About 1.27 million deaths in 2019", points: 100, scope: "sentence", groups: [
    { id: "n", kind: "number", critical: true, points: 60, anyOf: ["1.27 million"] },
    { id: "d", kind: "date", critical: true, points: 40, anyOf: ["2019"] },
  ], acceptedPhrases: [], rejectPhrases: [] }] });
  assert.equal(evaluateRecall("About 1.27 million people died in 2019.", decimal).score, 100);
  assert.equal(evaluateRecall("About 1.28 million people died in 2019.", decimal).score, 40);
  assert.equal(evaluateRecall("It was 2019. 27 million died.", decimal).score, 40);
});
