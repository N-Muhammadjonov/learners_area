import assert from "node:assert/strict";
import test from "node:test";

import {
  MCQ_FLOW,
  advance,
  nextStep,
  optionsVisible,
  stageIndex,
  type McqStage,
} from "../src/lib/services/listening/mcq-mastery";
import {
  SPEED_RATES,
  SPEED_UNLOCK_RATIO,
  speedTrainingStatus,
  supportsRateControl,
} from "../src/lib/services/listening/speed-training";
import {
  CHARS_PER_WORD,
  computeTypingMetrics,
  levenshtein,
} from "../src/lib/services/writing/typing";

// ---------------------------------------------------------------------------
// MCQ Mastery — the drill's order is the feature
// ---------------------------------------------------------------------------

test("the MCQ drill only ever moves one stage forward", () => {
  assert.deepEqual(
    MCQ_FLOW.map((step) => `${step.from}->${step.to}`),
    ["listen->notes", "notes->committed", "committed->revealed", "revealed->chosen", "chosen->reasoned"]
  );
});

test("no stage may be skipped", () => {
  assert.equal(advance("listen", { step: "revealed" }).ok, false);
  assert.equal(advance("listen", { step: "committed", text: "x" }).ok, false);
  assert.equal(advance("notes", { step: "notes", text: "x" }).ok, false);
  const backwards = advance("reasoned", { step: "listen" });
  assert.equal(backwards.ok, false);
});

test("an empty or too short text field does not advance the drill", () => {
  assert.equal(advance("listen", { step: "notes", text: "  " }).ok, false);
  assert.equal(advance("notes", { step: "committed", text: "" }).ok, false);
  assert.equal(advance("chosen", { step: "reasoned", text: "hm" }).ok, false);
});

test("a choice must be one of the real options", () => {
  const options = ["Room 2A", "Room 4B"];
  assert.equal(advance("revealed", { step: "chosen", text: "Room 9Z", options }).ok, false);
  assert.equal(advance("revealed", { step: "chosen", text: "Room 4B", options }).ok, true);
});

test("the options stay hidden until the reveal, and the outcome until the choice", () => {
  assert.equal(optionsVisible("listen"), false);
  assert.equal(optionsVisible("notes"), false);
  assert.equal(optionsVisible("committed"), false);
  assert.equal(optionsVisible("revealed"), true);
  assert.equal(optionsVisible("chosen"), true);
  assert.equal(optionsVisible("reasoned"), true);
  assert.equal(stageIndex("reasoned") > stageIndex("chosen"), true);
});

test("the drill has no step after the reasoning", () => {
  assert.equal(nextStep("reasoned"), null);
});

// ---------------------------------------------------------------------------
// Speed training — evidence before speed
// ---------------------------------------------------------------------------

test("speed training unlocks on the stated share, not on effort", () => {
  const below = speedTrainingStatus([{ score: 7, total: 10 }]);
  assert.equal(below.unlocked, false);
  assert.equal(below.percent, 70);
  assert.equal(below.thresholdPercent, Math.round(SPEED_UNLOCK_RATIO * 100));

  const at = speedTrainingStatus([{ score: 8, total: 10 }]);
  assert.equal(at.unlocked, true);

  const above = speedTrainingStatus([
    { score: 2, total: 10 },
    { score: 9, total: 10 },
  ]);
  assert.equal(above.unlocked, true, "the best attempt decides, not the last");
  assert.equal(above.percent, 90);
});

test("an unscored or absent attempt never unlocks the drill", () => {
  const none = speedTrainingStatus([]);
  assert.equal(none.unlocked, false);
  assert.equal(none.notAttemptedYet, true);
  assert.equal(none.percent, 0);

  const unscored = speedTrainingStatus([{ score: null, total: null }]);
  assert.equal(unscored.unlocked, false);
  assert.equal(unscored.notAttemptedYet, true);
});

test("the rate ladder runs from the exam speed to double", () => {
  assert.equal(SPEED_RATES[0], 1);
  assert.equal(SPEED_RATES[SPEED_RATES.length - 1], 2);
  assert.equal([...SPEED_RATES].sort((a, b) => a - b).join(","), SPEED_RATES.join(","));
});

test("rate control is claimed only for media we can actually play", () => {
  assert.equal(supportsRateControl("audio"), true);
  assert.equal(supportsRateControl("video"), true);
  assert.equal(supportsRateControl("file"), true);
  assert.equal(supportsRateControl("link"), false);
});

// ---------------------------------------------------------------------------
// Typing trainer — server-computed, edit-distance accuracy
// ---------------------------------------------------------------------------

test("an exact copy scores full accuracy and the textbook WPM", () => {
  // 50 characters = 10 words, typed in one minute = 10 WPM.
  const target = "a".repeat(50);
  const metrics = computeTypingMetrics(target, target, 60_000);
  assert.equal(metrics.accuracy, 100);
  assert.equal(metrics.wpm, 50 / CHARS_PER_WORD);
});

test("accuracy is an edit distance, and every error costs", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("same", "same"), 0);

  const half = computeTypingMetrics("abcd", "ab", 60_000);
  assert.equal(half.accuracy, 50, "two missing of four characters is 50%");

  const oneWrong = computeTypingMetrics("abcd", "abce", 60_000);
  assert.equal(oneWrong.accuracy, 75);
});

test("a run outside the accepted duration window is refused", () => {
  assert.throws(() => computeTypingMetrics("hello", "hello", 1_000), /invalid_duration/);
  assert.throws(() => computeTypingMetrics("hello", "hello", 3 * 60 * 60 * 1000), /invalid_duration/);
  assert.throws(() => computeTypingMetrics("   ", "   ", 30_000), /empty_target/);
});
