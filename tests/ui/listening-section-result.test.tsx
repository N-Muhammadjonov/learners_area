import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * GENERAL LISTENING — WHAT A FINISHED SECTION SHOWS (§27–§29, §33).
 *
 * The owner's golden result, stated as a surface rather than a hope: after a successful submit the
 * SAME section shows ITS OWN result — the score as x/y, and per question the learner's answer, the
 * correct answer where it belongs, and the centre's short explanation. Two limits matter as much
 * as the content:
 *
 *   • EVIDENCE ONLY WHEN IT WAS AUTHORED. An explanation the centre never wrote must render
 *     nothing at all — never a blank line, never a placeholder, never generated wording. A review
 *     may not imply that something was explained when nobody explained it.
 *   • NEVER THE ACADEMIC PRODUCT. The finished General section shows its own result and a truthful
 *     retake action: no Academic hub, no four-part framing, no Script / MCQ / Matching cards. A
 *     General review must also not be gated behind the Academic review-evidence item (LSN-008) —
 *     it depends on this section's own authored material, nothing else.
 *
 * Executed in jsdom against the REAL component and the REAL dictionary: DOM-level evidence, not
 * real-browser evidence.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/listening" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "localStorage"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { ListeningAnalysis } = await import("../../src/components/listening/ListeningAnalysis");

type QuestionRow = Parameters<typeof ListeningAnalysis>[0]["questions"][number];
type AnswerRow = Parameters<typeof ListeningAnalysis>[0]["answers"][number];

/** The smallest honest stand-ins for the schema rows: only the fields the review reads. */
const question = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "q-1",
    order: 1,
    questionText: "The guide mentions the fountain first.",
    correctAnswer: "fountain",
    explanation: "",
    ...overrides,
  }) as unknown as QuestionRow;

const answer = (overrides: Partial<Record<string, unknown>> = {}) =>
  ({
    id: "a-1",
    attemptId: "attempt-1",
    questionId: "q-1",
    userAnswer: "fountain",
    isCorrect: true,
    ...overrides,
  }) as unknown as AnswerRow;

async function renderResult(input: { score: number | null; total: number | null; questions: QuestionRow[]; answers: AnswerRow[] }) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => {
    root.render(<ListeningAnalysis dict={en} {...input} />);
  });
  return root;
}

const html = () => document.body.innerHTML;
const text = () => document.body.textContent!;

test("R1 the finished section shows the score as x/y", async () => {
  const root = await renderResult({ score: 6, total: 8, questions: [question()], answers: [answer()] });
  try {
    assert.ok(text().includes(`6/8`), "the learner's own score out of the section's own question count");
    assert.ok(text().includes(en.listening.score), "and the score is labelled, not a bare pair of numbers");
    // No fabricated percentage, band, timestamp or "last updated" line.
    assert.equal(/\b\d{1,3}%|band \d/i.test(text()), false, "no invented statistic is added to the result");
  } finally {
    root.unmount();
  }
});

test("R2 every question shows the learner's answer, and the correct answer where it belongs", async () => {
  const questions = [
    question({ id: "q-1", order: 1, questionText: "First marker?", correctAnswer: "fountain", explanation: "The guide says 'first'." }),
    question({ id: "q-2", order: 2, questionText: "Second marker?", correctAnswer: "library", explanation: "Heard as 'the tall library'." }),
  ];
  const answers = [
    answer({ id: "a-1", questionId: "q-1", userAnswer: "fountain", isCorrect: true }),
    answer({ id: "a-2", questionId: "q-2", userAnswer: "museum", isCorrect: false }),
  ];
  const root = await renderResult({ score: 1, total: 2, questions, answers });
  try {
    assert.ok(text().includes("First marker?"), "each question is shown");
    assert.ok(text().includes("Second marker?"));
    assert.ok(text().includes(en.listening.yourAnswer), "the learner's own answer is labelled");
    assert.ok(text().includes("fountain") && text().includes("museum"), "and both of their answers appear");
    assert.ok(text().includes(en.listening.correctAnswer), "the correct answer appears for the wrong one");
    assert.ok(text().includes("library"), "naming what was expected");
    assert.ok(text().includes(en.listening.correct) && text().includes(en.listening.incorrect), "each row is marked right or wrong");
    // The review is the one place an authored explanation may appear — and it is the centre's text.
    assert.ok(text().includes("The guide says 'first'.") && text().includes("Heard as 'the tall library'."));
  } finally {
    root.unmount();
  }
});

test("R3 evidence appears ONLY when the centre authored it — an empty explanation renders nothing", async () => {
  const questions = [
    question({ id: "q-1", order: 1, questionText: "Authored evidence?", explanation: "Because the speaker repeats the time." }),
    question({ id: "q-2", order: 2, questionText: "No evidence authored?", explanation: "" }),
    question({ id: "q-3", order: 3, questionText: "Whitespace is not evidence?", explanation: "   " }),
  ];
  const answers = [
    answer({ id: "a-1", questionId: "q-1", userAnswer: "yes", isCorrect: true }),
    answer({ id: "a-2", questionId: "q-2", userAnswer: "no", isCorrect: true }),
    answer({ id: "a-3", questionId: "q-3", userAnswer: "no", isCorrect: false }),
  ];
  const root = await renderResult({ score: 2, total: 3, questions, answers });
  try {
    const evidence = document.querySelectorAll("[data-listening-analysis-evidence]");
    assert.equal(evidence.length, 1, "exactly one evidence line, for the one authored explanation");
    assert.equal(evidence[0]!.textContent, "Because the speaker repeats the time.");
    assert.equal(text().includes("undefined"), false, "nothing is rendered in place of missing evidence");
    assert.equal(text().includes("null"), false);
    // No fabricated timestamp, score-per-question statistic or generated wording anywhere.
    assert.equal(/\b(20\d\d-\d\d-\d\d|AI\b|generated|auto-?explained)/i.test(text()), false);
  } finally {
    root.unmount();
  }
});

test("R4 the review is this attempt's own: an answer from elsewhere is never shown", async () => {
  const questions = [question({ id: "q-1", order: 1, questionText: "Mine?" })];
  const answers = [
    answer({ id: "a-1", questionId: "q-1", userAnswer: "kept", isCorrect: true }),
    // A row belonging to a question this section does not have — a leaked or stale row must not
    // be rendered, and must not be able to claim a card of its own.
    answer({ id: "a-2", questionId: "q-elsewhere", userAnswer: "NOT MINE TO SHOW", isCorrect: true }),
  ];
  const root = await renderResult({ score: 1, total: 1, questions, answers });
  try {
    assert.ok(text().includes("kept"), "the learner's own answer is shown");
    assert.equal(html().includes("NOT MINE TO SHOW"), false, "an answer that is not this section's never appears");
    assert.equal(document.querySelectorAll("[data-listening-analysis-evidence]").length, 0, "and no evidence is invented for it");
  } finally {
    root.unmount();
  }
});

test("R5 the finished section's page composes ITS result — never the Academic product", async () => {
  const route = readFileSync("src/app/app/(shell)/listening/general/[sectionId]/page.tsx", "utf8");
  const code = route.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  // The result branch renders the learner's own analysis and the section's own actions.
  assert.match(code, /view\.kind === "exercise" \?/, "the page has exactly two modes");
  assert.match(code, /data-listening-section-result/, "the result mode is marked for the smoke suite");
  assert.match(code, /listening-analysis-|ListeningAnalysis/, "the result mode renders the section's own analysis");
  assert.match(code, /SectionRetakeButton/, "and a truthful retake action");

  // Nothing Academic is composed here: no hub loader, no package activities, no four-part framing,
  // no study activities, no MCQ screen — the General section is one exercise and its own review.
  for (const forbidden of ["academicListeningTest", "packageActivities", "part", "mcq", "match", "study", "script"]) {
    const pattern = new RegExp(`\\b${forbidden}\\b`, "i");
    assert.equal(pattern.test(code.replace(/data-listening-section-[a-z]+/g, "")), false, `the section route must not compose ${forbidden}`);
  }

  // And the review is not gated behind the Academic review-evidence item: it reads this section's
  // own authored material through the section loader, nothing else.
  assert.match(code, /loadSectionExercise\(sectionId, user, dict\)/, "the loader is the section's own");
  assert.equal(
    /revision|LSN-008|studyPack|contentVersion/i.test(code.replace(/\/\*[\s\S]*?\*\//g, "")),
    false,
    "the General review depends on no Academic review-evidence machinery",
  );
});
