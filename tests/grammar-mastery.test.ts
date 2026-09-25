import assert from "node:assert/strict";
import test from "node:test";

import {
  checkStructures,
  structureVerdict,
  summarizeTopicMastery,
} from "../src/lib/services/grammar/mastery";
import { isOpen, resolveState, transition } from "../src/lib/services/lessons/state";
import { joinState, opensAt } from "../src/lib/services/live-classes/window";

// ---------------------------------------------------------------------------
// Grammar — three activities, ~80% over three sessions, structure checking
// ---------------------------------------------------------------------------

test("grammar mastery needs all three activities practised", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 6, 0, 0));
  const rows = [
    { exerciseId: "e1", activity: "correct_it" as const, isCorrect: true, attemptedAt: day(1) },
    { exerciseId: "e2", activity: "correct_it" as const, isCorrect: true, attemptedAt: day(1) },
    { exerciseId: "e1", activity: "translate_it" as const, isCorrect: true, attemptedAt: day(2) },
    { exerciseId: "e2", activity: "translate_it" as const, isCorrect: true, attemptedAt: day(2) },
  ];
  const partial = summarizeTopicMastery(rows);
  assert.equal(partial.allActivitiesPractised, false);
  assert.equal(partial.mastered, false);
  assert.equal(partial.sessions, 2);
  assert.equal(partial.byActivity.find((a) => a.activity === "activate_it")?.attempted, 0);
});

test("grammar mastery needs three separate days, not three attempts", () => {
  const sameDay = new Date(Date.UTC(2026, 0, 1, 6, 0, 0));
  const rows = ["correct_it", "translate_it", "activate_it"].map((activity, index) => ({
    exerciseId: `e${index}`,
    activity: activity as "correct_it" | "translate_it" | "activate_it",
    isCorrect: true,
    attemptedAt: new Date(sameDay.getTime() + index * 60_000),
  }));
  const summary = summarizeTopicMastery(rows);
  assert.equal(summary.sessions, 1);
  assert.equal(summary.scorePercent, 100);
  assert.equal(summary.mastered, false, "one evening is not mastery");
  assert.equal(summary.sessionsRemaining, 2);
});

test("a retry replaces the old mistake instead of adding to it", () => {
  const early = new Date(Date.UTC(2026, 0, 1, 6));
  const later = new Date(Date.UTC(2026, 0, 2, 6));
  const rows = [
    { exerciseId: "e1", activity: "correct_it" as const, isCorrect: false, attemptedAt: early },
    { exerciseId: "e1", activity: "correct_it" as const, isCorrect: true, attemptedAt: later },
  ];
  const summary = summarizeTopicMastery(rows);
  assert.equal(summary.attempted, 1, "only the latest attempt per exercise counts");
  assert.equal(summary.scorePercent, 100);
});

test("mastery is reached on three days with ~80% across the three activities", () => {
  const day = (n: number) => new Date(Date.UTC(2026, 0, n, 6));
  const rows = [
    { exerciseId: "e1", activity: "correct_it" as const, isCorrect: true, attemptedAt: day(1) },
    { exerciseId: "e2", activity: "correct_it" as const, isCorrect: true, attemptedAt: day(2) },
    { exerciseId: "e1", activity: "translate_it" as const, isCorrect: true, attemptedAt: day(2) },
    { exerciseId: "e2", activity: "translate_it" as const, isCorrect: true, attemptedAt: day(3) },
    { exerciseId: "e1", activity: "activate_it" as const, isCorrect: true, attemptedAt: day(3) },
    { exerciseId: "e2", activity: "activate_it" as const, isCorrect: false, attemptedAt: day(3) },
  ];
  const summary = summarizeTopicMastery(rows);
  assert.equal(summary.sessions, 3);
  assert.equal(summary.scorePercent, 83);
  assert.equal(summary.mastered, true);
});

test("structures are matched as phrases, with inflections, never as a whole sentence", () => {
  const used = checkStructures("Although public transport is cheaper, many people still prefer to drive.", [
    "although",
    "prefer",
  ]);
  assert.deepEqual(used.used, ["although", "prefer"]);
  assert.equal(used.complete, true);

  const inflected = checkStructures("They prefer trains, and traffic is the main problem.", ["traffic", "problem"]);
  assert.equal(inflected.complete, true);

  const missing = checkStructures("Buses are cheaper.", ["although", "prefer"]);
  assert.deepEqual(missing.missing, ["although", "prefer"]);
  assert.equal(missing.complete, false);

  // A perfectly good answer sharing almost no words with a sample answer still
  // passes, because nothing is compared against the sample sentence.
  const rewritten = checkStructures("Even though buses cost less, most people choose to drive.", ["even though", "choose"]);
  assert.equal(rewritten.complete, true);
});

test("this structure checker never claims success over an empty structure list", () => {
  const nothing = checkStructures("Anything at all.", []);
  assert.equal(nothing.complete, false);
  assert.equal(structureVerdict(nothing, false), "undetermined");
  assert.equal(structureVerdict(nothing, true), "incorrect");
});

// ---------------------------------------------------------------------------
// Lesson state — the rules live on the server
// ---------------------------------------------------------------------------

test("a locked or scheduled lesson cannot be started from the client", () => {
  assert.equal(transition("locked", "in_progress").ok, false);
  assert.equal(transition("locked", "completed").ok, false);
  assert.equal(transition("scheduled", "completed").ok, false);
});

test("progress moves forward and completion is not a stamp you can repeat", () => {
  assert.deepEqual(transition("available", "in_progress"), { ok: true, state: "in_progress" });
  assert.deepEqual(transition("assigned", "completed"), { ok: true, state: "completed" });
  assert.deepEqual(transition("in_progress", "completed"), { ok: true, state: "completed" });
  assert.equal(transition("completed", "completed").ok, false);
  assert.equal(transition("completed", "in_progress").ok, false);
});

test("a lesson with no progress row shows the centre's default state", () => {
  assert.equal(resolveState(undefined, "locked"), "locked");
  assert.equal(resolveState(undefined, "available"), "available");
  assert.equal(resolveState("completed", "available"), "completed");
  assert.equal(isOpen("locked"), false);
  assert.equal(isOpen("scheduled"), false);
  assert.equal(isOpen("available"), true);
  assert.equal(isOpen("assigned"), true);
  assert.equal(isOpen("in_progress"), true);
});

// ---------------------------------------------------------------------------
// Live class join window
// ---------------------------------------------------------------------------

const CLASS = { status: "upcoming" as const, scheduledAt: new Date("2026-03-02T10:00:00Z"), durationMinutes: 60 };

test("the room opens a quarter of an hour early and closes half an hour after the end", () => {
  const before = new Date(CLASS.scheduledAt.getTime() - 16 * 60 * 1000);
  const opens = new Date(CLASS.scheduledAt.getTime() - 14 * 60 * 1000);
  const during = new Date(CLASS.scheduledAt.getTime() + 30 * 60 * 1000);
  const after = new Date(CLASS.scheduledAt.getTime() + 91 * 60 * 1000);

  assert.equal(joinState(CLASS, before), "too_early");
  assert.equal(joinState(CLASS, opens), "open");
  assert.equal(joinState(CLASS, during), "open");
  assert.equal(joinState(CLASS, after), "closed");
});

test("a live class is always joinable, a cancelled one never is", () => {
  const now = new Date("2026-03-02T10:00:00Z");
  assert.equal(joinState({ ...CLASS, status: "live" }, now), "open");
  assert.equal(joinState({ ...CLASS, status: "cancelled" }, now), "cancelled");
  // A cancelled class stays closed even inside what would have been its window.
  assert.equal(joinState({ ...CLASS, status: "cancelled", scheduledAt: now }, now), "cancelled");
});

test("a completed class cannot be joined again", () => {
  const now = new Date("2026-03-05T10:00:00Z");
  assert.equal(joinState({ ...CLASS, status: "completed" }, now), "closed");
  assert.equal(joinState({ ...CLASS, status: "recorded" }, now), "closed");
  assert.equal(opensAt(CLASS).toISOString(), "2026-03-02T09:45:00.000Z");
});
