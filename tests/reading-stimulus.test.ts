import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSharedStimulus,
  hasBlank,
  isSharedStimulusRow,
  mergeStimulusWindows,
  normaliseStimulusRow,
  parseStimulus,
} from "../src/lib/reading/stimulus";

/**
 * Shared stimuli (notes / summaries / flow-charts).
 *
 * These rows arrive as overlapping windows cut around each question's own blank,
 * so the renderer has to rebuild one stimulus out of them. The cases below are
 * the shapes the imported library actually contains — the same window pair seen
 * in a real NOTE group, and the window that was cut right after a printed number.
 */

const NOTE_WINDOWS = [
  {
    questionNo: 1,
    questionText:
      "Cities · Problems with early cities – dirt – ______ but there were commercial and 2 ______ reasons for improving them",
  },
  {
    questionNo: 2,
    questionText:
      "Problems with early cities – dirt – 1 ______ but there were commercial and ______ reasons for improving them · Urban poverty",
  },
  {
    questionNo: 3,
    questionText:
      "but there were commercial and 2 ______ reasons for improving them · Urban poverty is not a major problem because poor people get ______ – help to develop",
  },
];

test("a window's own blank becomes its own token, a sibling's keeps its number", () => {
  const siblings = new Set([1, 2, 3]);
  assert.equal(
    normaliseStimulusRow("dirt – ______ and 2 ______ reasons", 1, siblings),
    "dirt – {{q1}} and {{q2}} reasons"
  );
});

test("a window cut after a printed number still marks that blank", () => {
  const text = normaliseStimulusRow("poor people get 3", 4, new Set([3, 4]));
  assert.equal(text, "poor people get {{q3}}");
});

test("a trailing number that is not a question in the group is left alone", () => {
  assert.equal(normaliseStimulusRow("the year was 1850", 1, new Set([1, 2])), "the year was 1850");
});

test("overlapping windows stitch into one stimulus with every blank", () => {
  const rebuilt = buildSharedStimulus(NOTE_WINDOWS);
  assert.deepEqual(rebuilt.numbers, [1, 2, 3]);
  assert.deepEqual(rebuilt.missing, []);
  // The shared sentence appears once, not once per window.
  assert.equal(rebuilt.text.split("commercial and").length, 2);
  assert.equal(rebuilt.text.includes("dirt – {{q1}} but there were commercial and {{q2}} reasons"), true);
  assert.equal(rebuilt.text.includes("get {{q3}}"), true);
});

test("windows that do not overlap are kept apart instead of glued together", () => {
  assert.equal(mergeStimulusWindows("First part of the summary.", "A different later sentence."),
    "First part of the summary.\n\nA different later sentence.");
});

test("a blank the reconstruction cannot find is reported, never invented", () => {
  const rebuilt = buildSharedStimulus([
    { questionNo: 1, questionText: "Only ______ in this window" },
    { questionNo: 2, questionText: "Nothing here matches the other window at all" },
  ]);
  assert.deepEqual(rebuilt.numbers, [1]);
  assert.deepEqual(rebuilt.missing, [2]);
});

test("token form parses back into prose and blanks", () => {
  assert.deepEqual(parseStimulus("Mud – {{q1}} and {{q2}} then city"), [
    { kind: "text", text: "Mud – " },
    { kind: "slot", questionNo: 1 },
    { kind: "text", text: " and " },
    { kind: "slot", questionNo: 2 },
    { kind: "text", text: " then city" },
  ]);
});

test("only rows that really share a stimulus are treated as shared", () => {
  assert.equal(isSharedStimulusRow({ renderMode: "shared_stimulus_slot", questionText: "plain" }), true);
  assert.equal(isSharedStimulusRow({ renderMode: "question_row", questionText: "A ______ was found" }), false);
  assert.equal(isSharedStimulusRow({ renderMode: "question_row", questionText: "A ____ and 2 ______ here" }), true);
  assert.equal(isSharedStimulusRow({ renderMode: null, questionText: "A ______ was found" }), false);
});

test("hasBlank answers the same way on repeated calls", () => {
  for (let i = 0; i < 3; i += 1) {
    assert.equal(hasBlank("2 ______ reasons"), true);
    assert.equal(hasBlank("no blank here"), false);
  }
});
