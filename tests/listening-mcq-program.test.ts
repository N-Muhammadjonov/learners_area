import test from "node:test";
import assert from "node:assert/strict";
import {
  MCQ_DAY_QUESTION_COUNT,
  MCQ_FINAL_STAGE,
  MCQ_PROGRAM_REF,
  isMcqDayRow,
  mcqDayProblems,
  mcqDayStates,
  mcqDayStatus,
  mcqProgramProgress,
  type McqDayQuestion,
} from "../src/lib/listening/mcq-program";
import { MCQ_STAGES, optionsVisible, outcomeVisible } from "../src/lib/services/listening/mcq-mastery";

/**
 * THE DEDICATED MCQ PROGRAMME — its rules, tested where they live.
 *
 * The owner's contract in one line: a LEARNER-VISIBLE day holds EXACTLY five valid multiple-choice
 * questions, in the authored order 1…5. Everything below is that sentence taken apart, plus the
 * staged boundary (no options or key before their stage) and the number that must never be claimed
 * (150 questions do not exist until 150 authored questions exist).
 *
 * A green suite here is not a claim about content: the owner's 150 questions are not in this
 * repository, and no fixture pretends to be them.
 */

/** A valid MCQ as a day stores it: canonical id, options, a key. */
function valid(number: number, overrides: Partial<McqDayQuestion> = {}): McqDayQuestion {
  return {
    number,
    typeCode: "mcq_single",
    storageType: "multiple_choice",
    options: ["A) one", "B) two", "C) three"],
    correctAnswer: "one",
    ...overrides,
  };
}

const five = () => [1, 2, 3, 4, 5].map((number) => valid(number));

test("D1 a four-question day is REFUSED for publication", () => {
  const problems = mcqDayProblems([1, 2, 3, 4].map((number) => valid(number)));
  assert.ok(problems.length > 0, "a four-question day is not publishable");
  assert.ok(
    problems.some((problem) => problem.message.includes("exactly 5")),
    `the refusal must state the rule, got: ${problems.map((problem) => problem.message).join(" | ")}`,
  );
  // The missing fifth question is NOT invented: every message refers to a real position.
  assert.ok(problems.every((problem) => problem.question === undefined || [1, 2, 3, 4].includes(problem.question)));
});

test("D2 a six-question day is REFUSED — the extra question is never silently dropped", () => {
  const problems = mcqDayProblems([1, 2, 3, 4, 5, 6].map((number) => valid(number)));
  assert.ok(problems.some((problem) => problem.message.includes("exactly 5")), "six questions is a refusal, not a trim");
});

test("D3 a day of exactly five valid MCQs has NO problems", () => {
  assert.deepEqual(mcqDayProblems(five()), [], "five genuine, complete MCQs publish");
  assert.equal(MCQ_DAY_QUESTION_COUNT, 5);
});

test("D4 a day that repeats a position is REFUSED, and 1…5 must be complete", () => {
  const duplicate = mcqDayProblems([valid(3), valid(3), valid(4), valid(5), valid(5)]);
  assert.ok(duplicate.some((problem) => /appears twice/i.test(problem.message)), "two questions cannot both be position 3");
  assert.ok(duplicate.some((problem) => /ordered 1…5/i.test(problem.message)), "positions 1, 2 are missing");

  // Duplicate positions are refused even when the count is right and everything else is valid.
  const swapped = mcqDayProblems([valid(1), valid(2), valid(3), valid(4), valid(4)]);
  assert.ok(swapped.some((problem) => /ordered 1…5|appears twice/i.test(problem.message)));
});

test("only genuine MCQ may enter a day — Matching, Map/Plan and completion questions are refused", () => {
  const notMcq = [
    { number: 1, typeCode: "matching", options: ["A) one", "B) two"], correctAnswer: "one" },
    { number: 2, typeCode: "map_labeling", options: ["A) one", "B) two"], correctAnswer: "one" },
    { number: 3, typeCode: "plan_labeling", options: ["A) one", "B) two"], correctAnswer: "one" },
    { number: 4, typeCode: "completion", options: null, correctAnswer: "one" },
    // No stated type at all: an option pool never proves a type.
    { number: 5, typeCode: null, options: ["A) one", "B) two"], correctAnswer: "one" },
  ] satisfies McqDayQuestion[];
  const problems = mcqDayProblems(notMcq);
  assert.equal(problems.filter((problem) => /not a multiple-choice question/.test(problem.message)).length, 5);

  // A LEGACY row that only carries the compatibility enum is refused too: the enum is what a
  // map/plan import used to be filed under, so it cannot be the proof.
  const legacyEnumOnly: McqDayQuestion[] = [1, 2, 3, 4, 5].map((number) => ({
    number,
    typeCode: null,
    storageType: "multiple_choice",
    options: ["A) one", "B) two"],
    correctAnswer: "one",
  }));
  assert.ok(mcqDayProblems(legacyEnumOnly).some((problem) => /not a multiple-choice question/.test(problem.message)));

  // Both canonical MCQ identities are accepted — and only those two.
  assert.deepEqual(mcqDayProblems([1, 2, 3, 4, 5].map((number) => valid(number, { typeCode: "mcq_multi", correctAnswer: "A,B" }))), []);
});

test("an ungradable or unanswerable question is refused", () => {
  assert.ok(
    mcqDayProblems(five().map((question) => (question.number === 4 ? valid(4, { correctAnswer: "  " }) : question))).some((problem) =>
      /no correct answer/.test(problem.message),
    ),
    "a question with no key could never be graded",
  );
  assert.ok(
    mcqDayProblems(five().map((question) => (question.number === 2 ? valid(2, { options: ["A) only one"] }) : question))).some((problem) =>
      /at least two/.test(problem.message),
    ),
    "one option is not multiple choice",
  );
  assert.ok(
    mcqDayProblems(five().map((question) => (question.number === 4 ? valid(4, { options: ["A) one", "  ", ""] }) : question))).some((problem) =>
      /at least two/.test(problem.message),
    ),
    "blank options do not count as options",
  );
});

test("the programme identity and its authored shape are stable constants, never parsed text", () => {
  assert.equal(MCQ_PROGRAM_REF, "listening-mcq-program");
  assert.ok(isMcqDayRow({ programRef: MCQ_PROGRAM_REF, programOrdinal: 1 }), "day 1 belongs to the programme");
  assert.ok(isMcqDayRow({ programRef: MCQ_PROGRAM_REF, programOrdinal: 30 }), "so does day 30");
  // GOLDEN-04 There is NO maximum day. Day 31, day 100 and day 4096 are ordinary programme days:
  // the old thirty-day cap must not survive anywhere as a membership rule.
  for (const ordinal of [31, 100, 365, 4096, 100_000])
    assert.ok(
      isMcqDayRow({ programRef: MCQ_PROGRAM_REF, programOrdinal: ordinal }),
      `day ${ordinal} is a programme day: the programme has no day limit`,
    );
  for (const row of [
    { programRef: null, programOrdinal: 3 },
    { programRef: MCQ_PROGRAM_REF, programOrdinal: null },
    { programRef: "some-other-programme", programOrdinal: 3 },
    { programRef: MCQ_PROGRAM_REF, programOrdinal: 0 },
    { programRef: MCQ_PROGRAM_REF, programOrdinal: -1 },
  ])
    assert.ok(!isMcqDayRow(row), `${JSON.stringify(row)} is not a programme day`);
  // A title can say "DAY 12" and mean nothing: membership is the relation, never the text.
  assert.ok(!isMcqDayRow({ programRef: null, programOrdinal: null }));
});

test("the final stage is the engine's own last stage — a day is complete only when a learner got there", () => {
  assert.equal(MCQ_FINAL_STAGE, MCQ_STAGES[MCQ_STAGES.length - 1], "no second definition of \"complete\"");
  // Options and the key are withheld before `revealed`: CSS is not what keeps them secret.
  assert.equal(optionsVisible("listen"), false);
  assert.equal(optionsVisible("notes"), false);
  assert.equal(optionsVisible("committed"), false);
  assert.equal(optionsVisible("revealed"), true);
});

test("day status is derived: the owner's example — Q1/Q2 reasoned, Q3 committed, Q4/Q5 untouched is In progress 2/5", () => {
  const ids = ["q1", "q2", "q3", "q4", "q5"];
  const sessions = [
    { questionId: "q1", stage: "reasoned" },
    { questionId: "q2", stage: "reasoned" },
    { questionId: "q3", stage: "committed" },
  ];
  const states = mcqDayStates(ids, sessions);
  const status = mcqDayStatus(states);
  assert.equal(status.completed, 2, "two questions finished");
  assert.equal(status.inProgress, 1, "one is in flight");
  assert.equal(status.total, 5);
  assert.equal(status.state, "in_progress");

  // Resume: the stage the learner reached is the stage they come back to — question 3 is committed.
  assert.equal(states[2]?.stage, "committed");
  assert.equal(states[2]?.complete, false);
  assert.equal(states[3]?.stage, null, "an unopened question has no stage — not \"not started\" stored somewhere");

  // A day nobody has touched, and a day that is genuinely finished.
  assert.equal(mcqDayStatus(mcqDayStates(ids, [])).state, "not_started");
  assert.equal(mcqDayStatus(mcqDayStates(ids, [])).completed, 0);
  const done = mcqDayStatus(
    mcqDayStates(ids, ids.map((questionId) => ({ questionId, stage: MCQ_FINAL_STAGE }))),
  );
  assert.equal(done.state, "completed");
  assert.equal(done.completed, 5);
  // Five sessions that merely EXIST are not a finished day: nothing was answered.
  const opened = mcqDayStatus(mcqDayStates(ids, ids.map((questionId) => ({ questionId, stage: "revealed" }))));
  assert.equal(opened.state, "in_progress");
  assert.equal(opened.completed, 0);
  // A session whose stage is the final one for a question that is NOT in this day must not count.
  assert.equal(mcqDayStatus(mcqDayStates(ids, [{ questionId: "someone-else", stage: "reasoned" }])).completed, 0);
});

test("the programme never claims questions that do not exist, and never claims a target", () => {
  // With eight published days the honest figure is eight — and nothing is divided by an intention.
  const partial = mcqProgramProgress({ publishedDays: 8, completedDays: 3, completedQuestions: 12 });
  assert.equal(partial.daysPublished, 8);
  assert.equal(partial.daysCompleted, 3);
  assert.equal(partial.questionsPublished, 40, "eight days of five");
  assert.notEqual(partial.questionsPublished, 150, "150 is not claimed before the days exist");
  // GOLDEN-04 No day target is reported at all: a fixed target becomes a lie ("100 of 30") the
  // moment the centre publishes past it, so the figure simply does not exist.
  assert.ok(!("dayTarget" in partial), "no fabricated day target is reported to any caller");

  const empty = mcqProgramProgress({ publishedDays: 0, completedDays: 0, completedQuestions: 0 });
  assert.equal(empty.questionsPublished, 0);
  assert.equal(empty.daysPublished, 0);

  // GOLDEN-04 A hundred published days is a hundred published days: five hundred questions, with
  // no ceiling applied anywhere in the arithmetic.
  const hundred = mcqProgramProgress({ publishedDays: 100, completedDays: 100, completedQuestions: 500 });
  assert.equal(hundred.daysPublished, 100, "a programme may exceed thirty days");
  assert.equal(hundred.questionsPublished, 100 * MCQ_DAY_QUESTION_COUNT, "five questions per published day, uncapped");
  const thousand = mcqProgramProgress({ publishedDays: 1000, completedDays: 7, completedQuestions: 35 });
  assert.equal(thousand.questionsPublished, 5000, "a thousand days is not truncated to thirty");
});
