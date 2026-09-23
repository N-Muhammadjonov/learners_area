import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleReview, isActivated, ACTIVATION_THRESHOLD } from "../src/lib/services/spaced-repetition";

const FIXED_NOW = new Date("2026-01-15T00:00:00Z");

test("scheduleReview: 'again' resets interval to 0 and schedules for tomorrow", () => {
  const result = scheduleReview(
    { grade: "again", intervalDays: 10, correctCount: 3, incorrectCount: 1 },
    FIXED_NOW
  );
  assert.equal(result.intervalDays, 0);
  assert.equal(result.state, "learning");
  assert.equal(result.incorrectCount, 2);
  assert.equal(result.correctCount, 3); // unchanged on a miss
  assert.equal(result.nextReviewAt.toISOString().slice(0, 10), "2026-01-16");
});

test("scheduleReview: first-ever 'good' grade starts a 2-day interval", () => {
  const result = scheduleReview(
    { grade: "good", intervalDays: 0, correctCount: 0, incorrectCount: 0 },
    FIXED_NOW
  );
  assert.equal(result.intervalDays, 2);
  assert.equal(result.correctCount, 1);
  assert.equal(result.state, "review");
});

test("scheduleReview: interval grows faster on 'easy' than 'hard'", () => {
  const hard = scheduleReview({ grade: "hard", intervalDays: 10, correctCount: 2, incorrectCount: 0 }, FIXED_NOW);
  const easy = scheduleReview({ grade: "easy", intervalDays: 10, correctCount: 2, incorrectCount: 0 }, FIXED_NOW);
  assert.ok(easy.intervalDays > hard.intervalDays, "easy should grow the interval more than hard");
});

test("scheduleReview: state graduates known -> mastered as interval grows past 30 days", () => {
  const result = scheduleReview(
    { grade: "easy", intervalDays: 20, correctCount: 4, incorrectCount: 0 },
    FIXED_NOW
  );
  assert.ok(result.intervalDays >= 30);
  assert.equal(result.state, "mastered");
});

test("isActivated: below threshold is false, at/above is true", () => {
  assert.equal(isActivated(ACTIVATION_THRESHOLD - 1), false);
  assert.equal(isActivated(ACTIVATION_THRESHOLD), true);
});
