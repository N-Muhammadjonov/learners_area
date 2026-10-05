import test from "node:test";
import assert from "node:assert/strict";
import {
  boundedQuestionCount,
  buildSessionPlan,
  isEndOfTopicCluster,
  mulberry32,
  planFromPersistedItems,
  planTopicsAreContiguous,
  randomSessionSeed,
  topicAt,
  TOPIC_CLUSTER_MAX,
  TOPIC_CLUSTER_MIN,
  type SessionPlan,
} from "../src/lib/speaking/ai-session-plan";

/**
 * Practice with AI — session plan / randomization matrix (spec §64).
 *
 * The plan is pure, so every assertion here runs against a synthetic canonical
 * bank with no database and no network. What is being protected is a product
 * rule, not an implementation detail: the examiner must stay on one topic long
 * enough, must never invent a question, and must produce the SAME plan for the
 * SAME seed so a refresh cannot reshuffle an active session.
 */

type FakePrompt = { id: string; part: string; topic: string | null };

/** A bank shaped like the real one: several topics per part, uneven sizes. */
function bank(spec: { part1?: Record<string, number>; part2?: Record<string, number>; part3?: Record<string, number> }): FakePrompt[] {
  const prompts: FakePrompt[] = [];
  for (const part of ["part1", "part2", "part3"] as const) {
    const topics = spec[part] ?? {};
    for (const [topic, count] of Object.entries(topics)) {
      for (let i = 0; i < count; i += 1) prompts.push({ id: `${part}-${topic}-${i}`, part, topic });
    }
  }
  return prompts;
}

const RICH_BANK = bank({
  part1: { "Work & Career": 9, Food: 6, Travel: 5, Hometown: 4 },
  part2: { "Work & Career": 3, Food: 3, Travel: 2 },
  part3: { "Work & Career": 8, Food: 7, Travel: 6 },
});

/** A bank that cannot satisfy the cluster minimum anywhere. */
const THIN_BANK = bank({ part1: { Solo: 2, Tiny: 1 }, part3: { Solo: 2 } });

function plans(prompts: FakePrompt[], mode: "full" | "part1" | "part2" | "part3", seeds: number[], recent?: Set<string>): SessionPlan[] {
  return seeds.map((seed) => buildSessionPlan(prompts, { mode, seed, recentPromptIds: recent }));
}

const SEEDS = Array.from({ length: 40 }, (_, i) => (i + 1) * 7919);

test("cluster bounds: never fewer than 3 when the bank permits, never more than 6", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    for (const topic of plan.topics) {
      if (topic.part === "part2") {
        assert.equal(topic.size, 1, "Part 2 is exactly one cue card");
        continue;
      }
      assert.ok(topic.size >= TOPIC_CLUSTER_MIN, `cluster too small: ${topic.size}`);
      assert.ok(topic.size <= TOPIC_CLUSTER_MAX, `cluster too large: ${topic.size}`);
    }
  }
});

test("Part 1 clusters stop at 4 questions; Part 3 may run to 6", () => {
  const sizes = { part1: new Set<number>(), part3: new Set<number>() };
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    for (const topic of plan.topics) {
      if (topic.part === "part1") sizes.part1.add(topic.size);
      if (topic.part === "part3") sizes.part3.add(topic.size);
    }
  }
  assert.ok(sizes.part1.size >= 1, "no Part 1 cluster was ever planned — the assertion above would be vacuous");
  assert.ok(sizes.part3.size >= 1, "no Part 3 cluster was ever planned — the assertion above would be vacuous");
  assert.ok(Math.max(...sizes.part1) <= 4, `Part 1 exceeded 4: ${[...sizes.part1]}`);
  assert.ok(Math.max(...sizes.part3) <= 6, `Part 3 exceeded 6: ${[...sizes.part3]}`);
});

test("same topic stays contiguous — the examiner never alternates topic per question", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    assert.ok(planTopicsAreContiguous(plan), `interleaved topics in plan seed=${plan.seed}`);
  }
});

test("contiguity check really detects an interleaved plan (guard against a vacuous test)", () => {
  const good = buildSessionPlan(RICH_BANK, { mode: "part1", seed: 11 });
  assert.ok(planTopicsAreContiguous(good));
  // Hand-built chaos: Work, Food, Work — exactly the pattern the spec forbids.
  const chaotic: SessionPlan = {
    ...good,
    items: [
      { ordinal: 0, promptId: "a", part: "part1", topicKey: "work", topicTitle: "Work", topicPosition: 0, questionPosition: 1, clusterSize: 2, isCueCard: false },
      { ordinal: 1, promptId: "b", part: "part1", topicKey: "food", topicTitle: "Food", topicPosition: 1, questionPosition: 1, clusterSize: 1, isCueCard: false },
      { ordinal: 2, promptId: "c", part: "part1", topicKey: "work", topicTitle: "Work", topicPosition: 0, questionPosition: 2, clusterSize: 2, isCueCard: false },
    ],
  };
  assert.equal(planTopicsAreContiguous(chaotic), false);
});

test("no duplicate question inside one session", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    const ids = plan.items.map((i) => i.promptId);
    assert.equal(new Set(ids).size, ids.length, `duplicate prompt in seed=${plan.seed}`);
  }
});

test("the canonical bank is the only prompt source — nothing is generated", () => {
  const known = new Set(RICH_BANK.map((p) => p.id));
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    for (const item of plan.items) {
      assert.ok(known.has(item.promptId), `plan invented prompt ${item.promptId}`);
    }
  }
});

test("same seed reproduces the identical plan (refresh cannot reshuffle)", () => {
  const a = buildSessionPlan(RICH_BANK, { mode: "full", seed: 424242 });
  const b = buildSessionPlan(RICH_BANK, { mode: "full", seed: 424242 });
  assert.deepEqual(a, b);
});

test("different seeds usually produce different plans (every session feels different)", () => {
  const signatures = new Set(
    plans(RICH_BANK, "full", SEEDS).map((p) => p.items.map((i) => i.promptId).join(",")),
  );
  assert.ok(signatures.size > SEEDS.length * 0.5, `only ${signatures.size} distinct plans from ${SEEDS.length} seeds`);
});

test("randomSessionSeed varies and is a safe 32-bit unsigned integer", () => {
  const seeds = new Set(Array.from({ length: 50 }, () => randomSessionSeed()));
  assert.ok(seeds.size > 40, "seed generator is not varying");
  for (const seed of seeds) {
    assert.ok(Number.isInteger(seed) && seed >= 0 && seed <= 0xffffffff, `bad seed ${seed}`);
  }
});

test("mulberry32 is deterministic and stays inside [0,1)", () => {
  const a = mulberry32(99);
  const b = mulberry32(99);
  for (let i = 0; i < 200; i += 1) {
    const x = a();
    assert.equal(x, b());
    assert.ok(x >= 0 && x < 1);
  }
});

test("Part 2 contributes exactly one cue card and no other part does", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    const cues = plan.items.filter((i) => i.isCueCard);
    assert.equal(cues.length, 1, "expected exactly one cue card");
    assert.equal(cues[0]!.part, "part2");
    assert.equal(plan.items.filter((i) => i.part === "part2").length, 1);
  }
});

test("Part 3 prefers the topic canonically connected to the Part 2 cue card", () => {
  let matched = 0;
  const withPart3Topic = plans(RICH_BANK, "full", SEEDS).filter((p) => p.items.some((i) => i.part === "part3"));
  for (const plan of withPart3Topic) {
    const cue = plan.items.find((i) => i.isCueCard)!;
    const part3 = plan.items.filter((i) => i.part === "part3");
    // The bank has a Part 3 topic for every Part 2 topic, so the canonical
    // connection must always win here — no "related topic" guesswork.
    assert.equal(part3[0]!.topicKey, cue.topicKey, "Part 3 drifted from the cue card topic");
    matched += 1;
  }
  assert.ok(matched > 0, "no full-mode plan contained both Part 2 and Part 3");
});

test("part ordering follows the examiner: Part 1, then Part 2, then Part 3", () => {
  const order = { part1: 0, part2: 1, part3: 2 };
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    const ranks = plan.items.map((i) => order[i.part]);
    assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `parts out of order in seed=${plan.seed}`);
  }
});

test("part-only modes emit only that part", () => {
  for (const mode of ["part1", "part2", "part3"] as const) {
    for (const plan of plans(RICH_BANK, mode, SEEDS.slice(0, 10))) {
      assert.ok(plan.items.every((i) => i.part === mode), `${mode} plan leaked another part`);
      assert.equal(plan.mode, mode);
    }
  }
});

test("ordinals are dense and 0-based; questionPosition is 1-based within its cluster", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) {
    plan.items.forEach((item, i) => assert.equal(item.ordinal, i, "ordinals are not dense"));
    for (const topic of plan.topics) {
      const cluster = plan.items.filter((i) => i.topicPosition === topic.topicPosition);
      assert.equal(cluster.length, topic.size);
      assert.deepEqual(cluster.map((i) => i.questionPosition), cluster.map((_, i) => i + 1));
      assert.ok(cluster.every((i) => i.clusterSize === topic.size));
      assert.equal(topic.startOrdinal, cluster[0]!.ordinal);
    }
  }
});

test("a topic with fewer than 3 published questions is used as-is and the shortfall is recorded", () => {
  for (const plan of plans(THIN_BANK, "part1", SEEDS)) {
    if (plan.items.length === 0) continue;
    for (const topic of plan.topics) {
      const available = THIN_BANK.filter((p) => p.part === topic.part && p.topic === topic.topicTitle).length;
      assert.equal(topic.size, Math.min(available, TOPIC_CLUSTER_MAX), "padded a thin topic with invented questions");
    }
    for (const limitation of plan.limitations) {
      assert.equal(limitation.requested, TOPIC_CLUSTER_MIN);
      assert.ok(limitation.available < TOPIC_CLUSTER_MIN, "recorded a limitation that was not one");
      assert.ok(limitation.available > 0);
    }
    assert.ok(plan.limitations.length > 0, "thin bank produced no limitation record");
  }
});

test("a rich bank records no limitations", () => {
  for (const plan of plans(RICH_BANK, "full", SEEDS)) assert.equal(plan.limitations.length, 0);
});

test("recent-history avoidance still fills the session (never empties the pool)", () => {
  // Mark EVERY prompt as recently used: the worst case for avoidance.
  const all = new Set(RICH_BANK.map((p) => p.id));
  for (const plan of plans(RICH_BANK, "full", SEEDS.slice(0, 15), all)) {
    assert.ok(plan.items.length >= 4, `avoidance starved the session to ${plan.items.length} items`);
    assert.ok(planTopicsAreContiguous(plan));
  }
});

test("recent-history avoidance de-prioritizes recently used questions", () => {
  const baseline = buildSessionPlan(RICH_BANK, { mode: "full", seed: 555 });
  const recentlyUsed = new Set(baseline.items.map((i) => i.promptId));
  const avoided = buildSessionPlan(RICH_BANK, { mode: "full", seed: 555, recentPromptIds: recentlyUsed });
  const overlap = avoided.items.filter((i) => recentlyUsed.has(i.promptId)).length;
  assert.ok(overlap < recentlyUsed.size, "avoidance changed nothing");
});

test("avoidance does not hide content forever: an exhausted pool is reused safely", () => {
  const only = bank({ part1: { Solo: 3 } });
  const used = new Set(only.map((p) => p.id));
  const plan = buildSessionPlan(only, { mode: "part1", seed: 17, recentPromptIds: used });
  assert.equal(plan.items.length, 3, "reuse did not happen; session would be empty");
  assert.deepEqual(plan.items.map((i) => i.promptId).sort(), only.map((p) => p.id).sort());
});

test("an empty or unusable bank yields an empty plan rather than a crash or a guess", () => {
  for (const mode of ["full", "part1", "part2", "part3"] as const) {
    const plan = buildSessionPlan([], { mode, seed: 3 });
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.topics, []);
    assert.deepEqual(plan.limitations, []);
  }
  // Part 2 exists but Part 1/3 do not: only the cue card is planned.
  const cueOnly = bank({ part2: { Food: 2 } });
  const plan = buildSessionPlan(cueOnly, { mode: "full", seed: 3 });
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]!.isCueCard, true);
});

test("boundedQuestionCount honours the minimum/default/maximum contract", () => {
  const rng = mulberry32(1234);
  for (let i = 0; i < 500; i += 1) {
    const n = boundedQuestionCount(20, TOPIC_CLUSTER_MAX, rng);
    assert.ok(n >= TOPIC_CLUSTER_MIN && n <= TOPIC_CLUSTER_MAX, `out of bounds: ${n}`);
  }
  // Bank smaller than the minimum: return the real count, never pad.
  assert.equal(boundedQuestionCount(0, 6, rng), 0);
  assert.equal(boundedQuestionCount(1, 6, rng), 1);
  assert.equal(boundedQuestionCount(2, 6, rng), 2);
  assert.equal(boundedQuestionCount(3, 6, rng), 3);
  // A per-part ceiling below the global maximum is respected.
  for (let i = 0; i < 200; i += 1) assert.ok(boundedQuestionCount(9, 4, rng) <= 4);
});

test("boundedQuestionCount makes the DEFAULT (4) the most likely cluster size", () => {
  const counts = new Map<number, number>();
  const rng = mulberry32(20261004);
  for (let i = 0; i < 4000; i += 1) {
    const n = boundedQuestionCount(20, TOPIC_CLUSTER_MAX, rng);
    counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const defaultHits = counts.get(4) ?? 0;
  for (const [n, hits] of counts) if (n !== 4) assert.ok(defaultHits > hits, `size ${n} (${hits}) beat the default (${defaultHits})`);
});

test("topicAt and isEndOfTopicCluster describe the cluster boundary correctly", () => {
  const plan = buildSessionPlan(RICH_BANK, { mode: "part1", seed: 808 });
  assert.ok(plan.items.length >= 3);
  const firstTopic = topicAt(plan, 0)!;
  assert.equal(firstTopic.topicPosition, 0);
  assert.equal(topicAt(plan, plan.items.length), null, "past the end must be null, not a guess");

  const lastOfCluster = firstTopic.startOrdinal + firstTopic.size - 1;
  assert.equal(isEndOfTopicCluster(plan, lastOfCluster), true);
  if (firstTopic.size > 1) assert.equal(isEndOfTopicCluster(plan, firstTopic.startOrdinal), false);
  assert.equal(isEndOfTopicCluster(plan, plan.items.length), false);
});

test("a persisted plan rebuilds identically — resume does not re-randomize", () => {
  const original = buildSessionPlan(RICH_BANK, { mode: "full", seed: 31337 });
  const rebuilt = planFromPersistedItems({
    mode: original.mode,
    seed: original.seed,
    planVersion: original.planVersion,
    limitations: original.limitations,
    // Deliberately shuffled and stringified like a DB round-trip would be.
    items: [...original.items]
      .reverse()
      .map((i) => ({
        ordinal: i.ordinal,
        promptId: i.promptId,
        part: i.part,
        topicKey: i.topicKey,
        topicTitle: i.topicTitle,
        topicPosition: i.topicPosition,
        questionPosition: i.questionPosition,
        clusterSize: i.clusterSize,
        isCueCard: i.isCueCard,
      })),
  });

  assert.deepEqual(rebuilt.items, original.items, "resume reordered or altered the plan");
  assert.equal(rebuilt.seed, original.seed);
  assert.equal(rebuilt.planVersion, original.planVersion);
  assert.deepEqual(rebuilt.topics.map((t) => [t.topicPosition, t.part, t.topicKey, t.size, t.startOrdinal]),
    original.topics.map((t) => [t.topicPosition, t.part, t.topicKey, t.size, t.startOrdinal]));
  assert.ok(planTopicsAreContiguous(rebuilt));
});

test("a prompt deleted after session creation drops out without inventing a replacement", () => {
  const original = buildSessionPlan(RICH_BANK, { mode: "part1", seed: 909 });
  const rebuilt = planFromPersistedItems({
    mode: original.mode,
    seed: original.seed,
    planVersion: original.planVersion,
    items: original.items.map((i, idx) => ({
      ordinal: i.ordinal,
      // Simulate `ON DELETE set null` on the first row only.
      promptId: idx === 0 ? null : i.promptId,
      part: i.part,
      topicKey: i.topicKey,
      topicTitle: i.topicTitle,
      topicPosition: i.topicPosition,
      questionPosition: i.questionPosition,
      clusterSize: i.clusterSize,
      isCueCard: i.isCueCard,
    })),
  });
  assert.equal(rebuilt.items.length, original.items.length - 1);
  assert.ok(rebuilt.items.every((i) => Boolean(i.promptId)));
});

test("a full session spans more than one topic when the bank allows it", () => {
  const multi = plans(RICH_BANK, "full", SEEDS).filter((p) => p.topics.length >= 3);
  assert.ok(multi.length > 0, "no full session ever covered Part 1 + Part 2 + Part 3");
});
