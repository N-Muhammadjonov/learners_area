import assert from "node:assert/strict";
import test from "node:test";
import { selectNextText, shuffled, type RotationCandidate } from "../src/lib/retention/rotation";

/**
 * The rotation contract (§76, §173): no repeat while unseen texts remain.
 *
 * These tests drive the pure selector the way `startOrResumeAttempt` drives it —
 * maintaining the completed list and the cycle the same way the data layer does —
 * so the rules are proved independently of any database. The randomised pick is
 * made deterministic here with a seeded generator; production uses the CSPRNG.
 */

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    // xorshift32 — plenty for a selection test, and reproducible on every run.
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 2 ** 32;
  };
}

const bank = (size: number): RotationCandidate[] =>
  Array.from({ length: size }, (_, index) => ({
    textId: `text-${index + 1}`,
    versionId: `version-${index + 1}-v1`,
  }));

type Session = { textId: string; versionId: string; cycle: number; startedNewCycle: boolean };

/**
 * A learner who finishes every session they start, exactly like the real flow:
 * a completion joins the cycle's ledger, and an exhausted cycle resets it.
 */
function simulate(candidates: () => RotationCandidate[], sessions: number, random: () => number): Session[] {
  const out: Session[] = [];
  let completed: string[] = [];
  let cycle = 1;
  let last: string | null = null;

  for (let index = 0; index < sessions; index += 1) {
    const decision = selectNextText({
      candidates: candidates(),
      completedTextIds: completed,
      cycleNumber: cycle,
      lastCompletedTextId: last,
      random,
    });
    assert.ok(decision, "the bank was not empty");
    if (decision.startedNewCycle) {
      cycle = decision.cycleNumber;
      completed = [];
    }
    completed = [...completed, decision.textId];
    last = decision.textId;
    out.push({ textId: decision.textId, versionId: decision.versionId, cycle: decision.cycleNumber, startedNewCycle: decision.startedNewCycle });
  }
  return out;
}

test("a learner never receives the same text twice while unseen texts remain", () => {
  const sessions = simulate(() => bank(5), 5, seededRandom(7));
  assert.equal(new Set(sessions.map((session) => session.textId)).size, 5);
  assert.ok(sessions.every((session) => session.startedNewCycle === false));
});

test("selection is not a fixed first-row order", () => {
  const firstPicks = new Set<string>();
  for (let seed = 1; seed <= 40; seed += 1) {
    const decision = selectNextText({
      candidates: bank(5),
      completedTextIds: [],
      cycleNumber: 1,
      lastCompletedTextId: null,
      random: seededRandom(seed),
    });
    firstPicks.add(decision!.textId);
  }
  assert.ok(firstPicks.size > 1, `the pick was deterministic across seeds: ${[...firstPicks].join(",")}`);
});

test("15 is a target, not a ceiling: 20 texts cycle through without a repeat", () => {
  const sessions = simulate(() => bank(20), 20, seededRandom(11));
  assert.equal(new Set(sessions.map((session) => session.textId)).size, 20);
});

test("a 120-text bank is fully used before any repeat", () => {
  const sessions = simulate(() => bank(120), 120, seededRandom(13));
  assert.equal(new Set(sessions.map((session) => session.textId)).size, 120);
});

test("the cycle increments only after every active text has been completed", () => {
  const sessions = simulate(() => bank(3), 4, seededRandom(17));
  assert.deepEqual(sessions.map((session) => session.cycle), [1, 1, 1, 2]);
  assert.equal(sessions[3]!.startedNewCycle, true);
});

test("the first text of a new cycle is not the text the learner just finished", () => {
  for (let seed = 1; seed <= 25; seed += 1) {
    const sessions = simulate(() => bank(4), 5, seededRandom(seed));
    assert.notEqual(sessions[4]!.textId, sessions[3]!.textId, `seed ${seed} repeated back-to-back`);
    assert.equal(sessions[4]!.cycle, 2);
  }
});

test("a text added mid-cycle joins the eligible set immediately", () => {
  const candidates = bank(3);
  let completed: string[] = [];
  let cycle = 1;
  const picks: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const decision = selectNextText({ candidates, completedTextIds: completed, cycleNumber: cycle, lastCompletedTextId: picks.at(-1) ?? null, random: seededRandom(23 + index) })!;
    picks.push(decision.textId);
    completed = [...completed, decision.textId];
    cycle = decision.cycleNumber;
  }
  candidates.push({ textId: "text-4", versionId: "version-4-v1" });

  const next = selectNextText({ candidates, completedTextIds: completed, cycleNumber: cycle, lastCompletedTextId: picks.at(-1)!, random: seededRandom(29) })!;
  assert.ok(!completed.includes(next.textId), "an unseen text must win over a completed one");
  assert.equal(next.startedNewCycle, false, "the cycle is not consumed while unseen texts remain");
});

test("an archived text leaves the eligible set without disturbing the cycle", () => {
  const candidates = bank(4);
  const completed: string[] = [];
  const picks: string[] = [];
  for (let index = 0; index < 2; index += 1) {
    const decision = selectNextText({ candidates, completedTextIds: completed, cycleNumber: 1, lastCompletedTextId: picks.at(-1) ?? null, random: seededRandom(31 + index) })!;
    picks.push(decision.textId);
    completed.push(decision.textId);
  }
  // The owner archives one of the texts the learner has NOT seen yet.
  const removed = candidates.find((candidate) => !completed.includes(candidate.textId))!;
  const remaining = candidates.filter((candidate) => candidate.textId !== removed.textId);

  // Finish the rest of the level. The archived text must never appear.
  const seen = [...picks];
  let cycle = 1;
  for (let index = 0; index < 6; index += 1) {
    const decision = selectNextText({ candidates: remaining, completedTextIds: seen, cycleNumber: cycle, lastCompletedTextId: seen.at(-1)!, random: seededRandom(37 + index) })!;
    assert.notEqual(decision.textId, removed.textId);
    if (decision.startedNewCycle) {
      cycle = decision.cycleNumber;
      seen.length = 0;
    }
    seen.push(decision.textId);
  }
  assert.ok(!seen.includes(removed.textId));
});

test("editing a text mid-cycle does not re-offer it: identity is the text, not the version", () => {
  const candidates = bank(3);
  const first = selectNextText({ candidates, completedTextIds: [], cycleNumber: 1, lastCompletedTextId: null, random: seededRandom(41) })!;
  // The owner publishes v2 of every text while the learner is mid-cycle.
  for (const candidate of candidates) candidate.versionId = candidate.versionId.replace("v1", "v2");

  const second = selectNextText({ candidates, completedTextIds: [first.textId], cycleNumber: 1, lastCompletedTextId: first.textId, random: seededRandom(43) })!;
  assert.notEqual(second.textId, first.textId, "the same logical text must not come back with a new version id");
});

test("a level with one active text still rotates: it repeats, and the cycle still advances", () => {
  const sessions = simulate(() => bank(1), 3, seededRandom(47));
  assert.deepEqual(sessions.map((session) => session.textId), ["text-1", "text-1", "text-1"]);
  assert.deepEqual(sessions.map((session) => session.cycle), [1, 2, 3]);
});

test("the same seed produces the same decisions, and no candidate array is mutated", () => {
  const candidates = bank(6);
  const snapshot = JSON.stringify(candidates);
  const a = simulate(() => candidates, 6, seededRandom(53));
  const b = simulate(() => candidates, 6, seededRandom(53));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(candidates), snapshot);
});

test("an empty bank answers null: the learner is told there is no content, not given somebody else's passage", () => {
  assert.equal(
    selectNextText({ candidates: [], completedTextIds: [], cycleNumber: 1, lastCompletedTextId: null, random: seededRandom(59) }),
    null
  );
});

test("the shuffle helper is a permutation and tolerates a degenerate random source", () => {
  const items = ["a", "b", "c", "d", "e"];
  const once = shuffled(items, () => 0);
  const twice = shuffled(items, () => 0.999999);
  assert.deepEqual([...once].sort(), [...items].sort());
  assert.deepEqual([...twice].sort(), [...items].sort());
  assert.deepEqual(items, ["a", "b", "c", "d", "e"], "the input order is never mutated");
});
