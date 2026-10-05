import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSessionSummary,
  type SummaryAnswerInput,
  type SummaryEvaluationInput,
} from "../src/lib/speaking/ai-session-summary";
import { PRONUNCIATION_CRITERION_KEY } from "../src/lib/services/coach/pronunciation";
import type { PracticePart } from "../src/lib/speaking/practice-browse";

/**
 * Session summary aggregation (spec §28, §29, §49).
 *
 * These tests exist to catch the two ways a summary can lie:
 *   - producing an overall band from Part 1 evidence alone
 *   - averaging a criterion that was never actually assessed
 * plus determinism, because a summary whose numbers move between renders is
 * indistinguishable from a fabricated one.
 */

let uid = 0;

function evaluation(overrides: Partial<SummaryEvaluationInput> = {}): SummaryEvaluationInput {
  return {
    overallEstimate: 6,
    confidence: 0.6,
    criteria: [
      { key: "fluency", label: "Fluency", band: 6 },
      { key: "lexical_resource", label: "Lexical Resource", band: 6 },
      { key: "grammar", label: "Grammar", band: 6 },
      {
        key: PRONUNCIATION_CRITERION_KEY,
        label: "Pronunciation",
        band: null,
        limited: true,
        note: "Not assessed",
      },
    ],
    strengths: [],
    weaknesses: [],
    issues: [],
    nextActions: [],
    fallbackUsed: false,
    ...overrides,
  };
}

function answer(
  ordinal: number,
  part: PracticePart,
  overrides: Partial<SummaryAnswerInput> = {},
): SummaryAnswerInput {
  uid += 1;
  return {
    itemId: `item-${uid}`,
    ordinal,
    part,
    topicKey: `${part}-topic`,
    topicTitle: `Topic ${part}`,
    questionPosition: ordinal + 1,
    clusterSize: 4,
    isCueCard: part === "part2",
    status: "answered",
    attemptId: `attempt-${uid}`,
    evaluation: evaluation(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// §28 — no overall band from Part 1 alone
// ---------------------------------------------------------------------------

test("a part1-only session produces NO overall estimate and says why", () => {
  const summary = buildSessionSummary({
    mode: "part1",
    answers: [answer(0, "part1"), answer(1, "part1"), answer(2, "part1")],
  });
  assert.equal(summary.estimate.band, null, "§28 forbids an overall band from Part 1 alone");
  assert.equal(summary.estimate.suppressedReason, "part1_only");
  assert.equal(summary.estimate.labelKind, "text_based_estimate");
  assert.equal(summary.answeredCount, 3, "the answers still count; only the band is withheld");
  // Per-criterion feedback is still legitimate and still shown.
  assert.ok(summary.criteria.length > 0);
});

test("a FULL session where only Part 1 was answered also gets no band", () => {
  // The stricter reading of §28: what matters is the evidence, not the label the
  // learner clicked. Skipping Parts 2 and 3 must not unlock an interview band.
  const summary = buildSessionSummary({
    mode: "full",
    answers: [
      answer(0, "part1"),
      answer(1, "part1"),
      answer(2, "part2", { status: "skipped", attemptId: null, evaluation: null }),
      answer(3, "part3", { status: "skipped", attemptId: null, evaluation: null }),
    ],
  });
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "part1_only");
  assert.equal(summary.skippedCount, 2);
});

test("a part2 session and a part3 session DO produce an estimate", () => {
  for (const mode of ["part2", "part3"] as const) {
    const part: PracticePart = mode;
    const summary = buildSessionSummary({ mode, answers: [answer(0, part), answer(1, part)] });
    assert.equal(typeof summary.estimate.band, "number", `${mode} should be estimable`);
    assert.equal(summary.estimate.suppressedReason, null);
  }
});

test("a full session with Part 2/3 evidence produces an estimate", () => {
  const summary = buildSessionSummary({
    mode: "full",
    answers: [answer(0, "part1"), answer(1, "part2"), answer(2, "part3"), answer(3, "part3")],
  });
  assert.equal(summary.estimate.band, 6);
  assert.equal(summary.estimate.basedOnAnswers, 4);
  assert.equal(summary.estimate.suppressedReason, null);
});

test("the estimate is the mean of the stored per-answer estimates, rounded to 0.5", () => {
  // Proves it is arithmetic over persisted rows (§29), not a plausible number.
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ overallEstimate: 6 }) }),
      answer(1, "part3", { evaluation: evaluation({ overallEstimate: 7 }) }),
    ],
  });
  assert.equal(summary.estimate.band, 6.5, "mean(6,7) = 6.5");

  const rounded = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ overallEstimate: 6.2 }) }),
      answer(1, "part3", { evaluation: evaluation({ overallEstimate: 6.4 }) }),
    ],
  });
  assert.equal(rounded.estimate.band, 6.5, "mean 6.3 rounds to the nearest 0.5");
});

// ---------------------------------------------------------------------------
// §23 — pronunciation is never aggregated when unassessed
// ---------------------------------------------------------------------------

test("unassessed pronunciation stays band-less and is excluded from the criterion mean", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3"), answer(1, "part3")],
  });
  const pronunciation = summary.criteria.find((c) => c.key === PRONUNCIATION_CRITERION_KEY);
  assert.ok(pronunciation, "pronunciation must still be listed");
  assert.equal(pronunciation.band, null, "no band may be invented for pronunciation");
  assert.equal(pronunciation.limited, true);
  assert.equal(pronunciation.assessedFrom, 0);
  assert.equal(summary.pronunciationAssessed, false);
});

test("pronunciation assessed by a real audio provider is reported as assessed", () => {
  const assessed = evaluation({
    criteria: [
      { key: "fluency", label: "Fluency", band: 6 },
      { key: PRONUNCIATION_CRITERION_KEY, label: "Pronunciation", band: 7, limited: false },
    ],
  });
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3", { evaluation: assessed })],
  });
  const pronunciation = summary.criteria.find((c) => c.key === PRONUNCIATION_CRITERION_KEY);
  assert.equal(pronunciation?.band, 7);
  assert.equal(pronunciation?.limited, false);
  assert.equal(summary.pronunciationAssessed, true);
});

test("a criterion assessed in only some answers keeps its band and shows its coverage", () => {
  const withoutGrammar = evaluation({
    criteria: [{ key: "fluency", label: "Fluency", band: 6 }, { key: "grammar", label: "Grammar", band: null, limited: true }],
  });
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3"), answer(1, "part3", { evaluation: withoutGrammar })],
  });
  const grammar = summary.criteria.find((c) => c.key === "grammar");
  // A band exists from one answer, so it must not simultaneously read
  // "Not assessed" — that contradiction would hide real feedback.
  assert.equal(grammar?.band, 6);
  assert.equal(grammar?.limited, false);
  assert.equal(grammar?.assessedFrom, 1);
});

// ---------------------------------------------------------------------------
// recurring weaknesses
// ---------------------------------------------------------------------------

test("a category in two DISTINCT answers is recurring; in one answer it is not", () => {
  const filler = { category: "SPEAKING_FILLERS", message: "You said 'um' often", severity: "low" as const };

  const recurring = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ issues: [filler] }) }),
      answer(1, "part3", { evaluation: evaluation({ issues: [filler] }) }),
    ],
  });
  assert.equal(recurring.weaknesses.length, 1);
  assert.equal(recurring.weaknesses[0]!.occurrences, 2);

  const oneOff = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ issues: [filler] }) }),
      answer(1, "part3"),
    ],
  });
  assert.equal(oneOff.weaknesses.length, 0, "a single low-severity occurrence is not a pattern");
});

test("three of the same issue inside ONE answer count once, not three times", () => {
  const filler = { category: "SPEAKING_FILLERS", message: "filler", severity: "low" as const };
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3", { evaluation: evaluation({ issues: [filler, filler, filler] }) })],
  });
  assert.equal(summary.weaknesses.length, 0, "one answer cannot manufacture a recurring pattern");
});

test("a single HIGH severity issue qualifies on its own", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", {
        evaluation: evaluation({ issues: [{ category: "SPEAKING_SHORT_RESPONSE", message: "Answers were one word", severity: "high" }] }),
      }),
    ],
  });
  assert.equal(summary.weaknesses.length, 1);
  assert.equal(summary.weaknesses[0]!.highestSeverity, "high");
  assert.equal(summary.weaknesses[0]!.occurrences, 1);
});

test("weaknesses are ordered by evidence, then severity, then category name", () => {
  // Every category here clears the recurring filter (2+ answers, or high
  // severity), so the sort keys are what decide the order — not the filter.
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", {
        evaluation: evaluation({
          issues: [
            { category: "GRAMMAR_TENSE", message: "tense", severity: "low" },
            { category: "SPEAKING_FILLERS", message: "fillers", severity: "low" },
            { category: "SPEAKING_FLUENCY", message: "fluency", severity: "low" },
            { category: "SPEAKING_SHORT_RESPONSE", message: "too short", severity: "high" },
            { category: "SPEAKING_REPETITION", message: "repeats", severity: "high" },
          ],
        }),
      }),
      answer(1, "part3", {
        evaluation: evaluation({
          issues: [
            { category: "GRAMMAR_TENSE", message: "tense", severity: "low" },
            { category: "SPEAKING_FILLERS", message: "fillers", severity: "low" },
            { category: "SPEAKING_FLUENCY", message: "fluency", severity: "low" },
            { category: "SPEAKING_SHORT_RESPONSE", message: "too short", severity: "low" },
          ],
        }),
      }),
    ],
  });
  assert.deepEqual(
    summary.weaknesses.map((w) => [w.category, w.occurrences, w.highestSeverity]),
    [
      // 2 occurrences + high severity wins the tie among the 2-occurrence group
      ["SPEAKING_SHORT_RESPONSE", 2, "high"],
      // then the 2-occurrence lows, alphabetically
      ["GRAMMAR_TENSE", 2, "low"],
      ["SPEAKING_FILLERS", 2, "low"],
      ["SPEAKING_FLUENCY", 2, "low"],
      // 1 occurrence survives only because it is high severity
      ["SPEAKING_REPETITION", 1, "high"],
    ],
  );
});

test("skipped and pending items contribute nothing to the summary", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3"),
      answer(1, "part3", { status: "skipped", attemptId: null, evaluation: null }),
      answer(2, "part3", { status: "pending", attemptId: null, evaluation: null }),
    ],
  });
  assert.equal(summary.totalCount, 3);
  assert.equal(summary.answeredCount, 1);
  assert.equal(summary.skippedCount, 1);
  assert.equal(summary.unansweredCount, 1);
  assert.equal(summary.estimate.basedOnAnswers, 1);
});

// ---------------------------------------------------------------------------
// determinism (§29)
// ---------------------------------------------------------------------------

test("the same stored rows always produce the identical summary", () => {
  const answers = [answer(0, "part1"), answer(1, "part2"), answer(2, "part3")];
  const a = buildSessionSummary({ mode: "full", answers });
  const b = buildSessionSummary({ mode: "full", answers });
  assert.deepEqual(a, b);
});

test("input order does not change the result — the plan order does", () => {
  const answers = [answer(0, "part1"), answer(1, "part2"), answer(2, "part3")];
  const forward = buildSessionSummary({ mode: "full", answers });
  const backward = buildSessionSummary({ mode: "full", answers: [...answers].reverse() });
  assert.deepEqual(forward, backward, "summary must not depend on array arrival order");
  assert.deepEqual(
    forward.topics.map((t) => t.part),
    ["part1", "part2", "part3"],
    "topics render in plan order",
  );
});

// ---------------------------------------------------------------------------
// degenerate sessions
// ---------------------------------------------------------------------------

test("an empty session reports no_answers rather than a zero band", () => {
  const summary = buildSessionSummary({ mode: "full", answers: [] });
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "no_answers");
  assert.equal(summary.totalCount, 0);
});

test("a session where nothing was answered reports no_answers", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3", { status: "skipped", attemptId: null, evaluation: null })],
  });
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "no_answers");
});

test("answers that were sent but never evaluated report not_evaluated, not no_answers", () => {
  // An evaluation can legitimately fail after the recording is safely stored.
  // Saying "you answered nothing" would be false.
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3", { evaluation: null }), answer(1, "part3", { evaluation: null })],
  });
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "not_evaluated");
  assert.equal(summary.answeredCount, 2, "the answers are real; only the feedback is missing");
});

test("a criterion present but never banded yields no_assessed_criteria", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [answer(0, "part3", { evaluation: evaluation({ overallEstimate: null, criteria: [] }) })],
  });
  assert.equal(summary.estimate.band, null);
  assert.equal(summary.estimate.suppressedReason, "no_assessed_criteria");
});

// ---------------------------------------------------------------------------
// presentation data
// ---------------------------------------------------------------------------

test("strengths and next actions are deduplicated, ordered and capped", () => {
  const summary = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ strengths: ["Clear opening", "Good detail"], nextActions: ["Extend answers"] }) }),
      answer(1, "part3", { evaluation: evaluation({ strengths: ["Good detail", "  Clear opening  "], nextActions: ["Extend answers", "Vary tenses"] }) }),
    ],
  });
  assert.deepEqual(summary.strengths, ["Clear opening", "Good detail"], "duplicates and padding removed, first-seen order kept");
  assert.deepEqual(summary.nextActions, ["Extend answers", "Vary tenses"]);
});

test("topics count answered vs total per cluster", () => {
  const summary = buildSessionSummary({
    mode: "full",
    answers: [
      answer(0, "part1", { topicKey: "work", topicTitle: "Work" }),
      answer(1, "part1", { topicKey: "work", topicTitle: "Work", status: "skipped", attemptId: null, evaluation: null }),
      answer(2, "part1", { topicKey: "food", topicTitle: "Food" }),
    ],
  });
  assert.deepEqual(summary.topics, [
    { part: "part1", topicKey: "work", topicTitle: "Work", answered: 1, total: 2 },
    { part: "part1", topicKey: "food", topicTitle: "Food", answered: 1, total: 1 },
  ]);
});

test("the same topic key in two different parts stays two separate clusters", () => {
  const summary = buildSessionSummary({
    mode: "full",
    answers: [
      answer(0, "part2", { topicKey: "travel", topicTitle: "Travel" }),
      answer(1, "part3", { topicKey: "travel", topicTitle: "Travel" }),
    ],
  });
  assert.equal(summary.topics.length, 2);
});

test("bank limitations are passed through so the UI can disclose them", () => {
  const limitations = [{ part: "part1" as const, topicKey: "work", topicTitle: "Work", requested: 3, available: 2 }];
  const summary = buildSessionSummary({ mode: "part1", answers: [answer(0, "part1")], limitations });
  assert.deepEqual(summary.limitations, limitations);
  // The returned array must be a copy, so a caller cannot mutate the input.
  assert.notEqual(summary.limitations, limitations);
});

test("fallbackUsed is true when any answer used the local evaluator", () => {
  const mixed = buildSessionSummary({
    mode: "part3",
    answers: [
      answer(0, "part3", { evaluation: evaluation({ fallbackUsed: false }) }),
      answer(1, "part3", { evaluation: evaluation({ fallbackUsed: true }) }),
    ],
  });
  assert.equal(mixed.fallbackUsed, true);

  const clean = buildSessionSummary({ mode: "part3", answers: [answer(0, "part3")] });
  assert.equal(clean.fallbackUsed, false);
});
