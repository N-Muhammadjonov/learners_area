import assert from "node:assert/strict";
import test from "node:test";
import { buildDeadlines, resolvePhase } from "../src/lib/retention/phase";
import { RETENTION_READ_SECONDS, RETENTION_WRITE_SECONDS } from "../src/lib/retention/levels";

/**
 * The timer contract (§77, §174), tested at the exact boundary seconds.
 *
 * Everything is computed from absolute timestamps, so these assertions are the
 * same arithmetic the server performs on a row that was written minutes, days or
 * weeks ago. There is no sleeping in this file.
 */

const T0 = new Date("2026-02-01T10:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

test("the deadlines are exactly 120s and 300s after the start", () => {
  const deadlines = buildDeadlines(T0);
  assert.equal(deadlines.readStartedAt.getTime(), T0.getTime());
  assert.equal(deadlines.readEndsAt.getTime(), T0.getTime() + RETENTION_READ_SECONDS * 1000);
  assert.equal(deadlines.writeStartedAt.getTime(), deadlines.readEndsAt.getTime());
  assert.equal(deadlines.writeEndsAt.getTime(), T0.getTime() + 300_000);
  assert.equal(RETENTION_WRITE_SECONDS, 180);
});

test("phase boundaries: 119 is reading, 120 is recall, 299 is recall, 300 is over", () => {
  const timing = { status: "reading" as const, ...buildDeadlines(T0) };
  assert.equal(resolvePhase(timing, at(0)).phase, "reading");
  assert.equal(resolvePhase(timing, at(60)).phase, "reading");
  assert.equal(resolvePhase(timing, at(119)).phase, "reading");
  assert.equal(resolvePhase(timing, at(120)).phase, "recall");
  assert.equal(resolvePhase(timing, at(121)).phase, "recall");
  assert.equal(resolvePhase(timing, at(299)).phase, "recall");
  assert.equal(resolvePhase(timing, at(300)).phase, "timed_out");
  assert.equal(resolvePhase(timing, at(301)).phase, "timed_out");
});

test("only a spent, non-terminal attempt needs finalization", () => {
  const deadlines = buildDeadlines(T0);
  assert.equal(resolvePhase({ status: "reading", ...deadlines }, at(299)).needsFinalization, false);
  assert.equal(resolvePhase({ status: "reading", ...deadlines }, at(300)).needsFinalization, true);
  assert.equal(resolvePhase({ status: "recall", ...deadlines }, at(300)).needsFinalization, true);
  // A terminal attempt is never resurrected or re-finalized.
  assert.equal(resolvePhase({ status: "completed", ...deadlines }, at(10_000)).needsFinalization, false);
  assert.equal(resolvePhase({ status: "completed", ...deadlines }, at(10_000)).phase, "completed");
  assert.equal(resolvePhase({ status: "timed_out", ...deadlines }, at(10_000)).phase, "timed_out");
  assert.equal(resolvePhase({ status: "timed_out", ...deadlines }, at(10_000)).millisecondsRemaining, 0);
});

test("the countdown the browser renders comes from the deadline, not from the mount time", () => {
  const deadlines = buildDeadlines(T0);
  // A learner who refreshes at 2:30 has 2:30 of writing left — not a fresh 3:00.
  const refreshed = resolvePhase({ status: "recall", ...deadlines }, at(150));
  assert.equal(refreshed.millisecondsRemaining, 150_000);
  assert.equal(refreshed.millisecondsUntilWriteEnds, 150_000);
  const later = resolvePhase({ status: "recall", ...deadlines }, at(270));
  assert.equal(later.millisecondsRemaining, 30_000);
  assert.equal(later.millisecondsUntilWriteEnds, 30_000);
  // Reading shows the reading clock, not the writing one.
  assert.equal(resolvePhase({ status: "reading", ...deadlines }, at(30)).millisecondsRemaining, 90_000);
  assert.equal(resolvePhase({ status: "reading", ...deadlines }, at(30)).millisecondsUntilWriteEnds, 270_000);
});

test("a returning learner who waited far past the deadline is simply timed out", () => {
  const deadlines = buildDeadlines(T0);
  const nextDay = new Date(T0.getTime() + 24 * 60 * 60 * 1000);
  const resolution = resolvePhase({ status: "recall", ...deadlines }, nextDay);
  assert.equal(resolution.phase, "timed_out");
  assert.equal(resolution.needsFinalization, true);
  assert.equal(resolution.millisecondsUntilWriteEnds, 0);
  assert.equal(resolution.millisecondsRemaining, 0);
});
