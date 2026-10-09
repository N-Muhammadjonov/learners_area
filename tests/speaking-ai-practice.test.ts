import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAiSessionPlan, MAX_TOPIC_QUESTIONS, MIN_TOPIC_QUESTIONS } from "../src/lib/speaking/ai-session";

const prompts = [
  ...Array.from({ length: 9 }, (_, index) => ({ id: `work-${index}`, part: "part1", topic: "Work" })),
  ...Array.from({ length: 7 }, (_, index) => ({ id: `home-${index}`, part: "part1", topic: "Home" })),
  { id: "cue-work", part: "part2", topic: "Work" },
  ...Array.from({ length: 8 }, (_, index) => ({ id: `discussion-${index}`, part: "part3", topic: "Work" })),
];

test("AI plan is deterministic for a persisted seed, unique, bounded and topic-contiguous", () => {
  const first = buildAiSessionPlan(prompts, "full", { seed: "stable-session" });
  const second = buildAiSessionPlan(prompts, "full", { seed: "stable-session" });
  assert.deepEqual(first.items.map((item) => item.prompt.id), second.items.map((item) => item.prompt.id));
  assert.equal(new Set(first.items.map((item) => item.prompt.id)).size, first.items.length);
  const different = buildAiSessionPlan(prompts, "full", { seed: "another-session" });
  assert.notDeepEqual(first.items.map((item) => item.prompt.id), different.items.map((item) => item.prompt.id));
  for (const topicPosition of new Set(first.items.map((item) => item.topicPosition))) {
    const group = first.items.filter((item) => item.topicPosition === topicPosition);
    if (group[0]?.prompt.part !== "part2") assert.ok(group.length >= MIN_TOPIC_QUESTIONS && group.length <= MAX_TOPIC_QUESTIONS);
    const indices = first.items.flatMap((item, index) => item.topicPosition === topicPosition ? [index] : []);
    assert.equal(indices.at(-1)! - indices[0]! + 1, indices.length, "one topic occupies one contiguous block");
  }
});

test("small canonical topics are used honestly and recorded as a limitation", () => {
  const plan = buildAiSessionPlan([{ id: "one", part: "part3", topic: "Rare" }, { id: "two", part: "part3", topic: "Rare" }], "part3", { seed: "small" });
  assert.equal(plan.items.length, 2);
  assert.deepEqual(plan.limitations, ["rare:2"]);
});

test("recent prompts are de-prioritized without emptying an exhausted pool", () => {
  const recent = prompts.filter((prompt) => prompt.part === "part3").map((prompt) => prompt.id);
  const plan = buildAiSessionPlan(prompts, "part3", { seed: "reuse", recentPromptIds: recent });
  assert.equal(plan.items.length, 4);
});

test("AI recorder keeps Stop local and submits only from explicit Send", () => {
  const source = readFileSync("src/components/speaking/AiQuestionRecorder.tsx", "utf8");
  const stopBody = source.slice(source.indexOf("async function stopRecording"), source.indexOf("async function clear"));
  assert.doesNotMatch(stopBody, /\/submit|startUpload/);
  assert.match(stopBody, /setPhase\("review"\)/);
  assert.match(source, /sendToRiwi/);
  assert.match(source, /browserTranscriptRaw/);
  assert.match(source, /browserTranscriptEdited/);
});

test("full sessions choose a related Part 2/3 pair whenever the bank provides one", () => {
  const bank = [...prompts, { id: "cue-unrelated", part: "part2", topic: "Unrelated" }];
  for (let index = 0; index < 100; index++) {
    const plan = buildAiSessionPlan(bank, "full", { seed: `pair-${index}` });
    const cue = plan.items.find(item => item.prompt.part === "part2")!;
    const discussion = plan.items.find(item => item.prompt.part === "part3")!;
    assert.equal(cue.topicKey, discussion.topicKey);
  }
});

test("plan reproducibility does not depend on database row order and missing coverage stays explicit", () => {
  assert.deepEqual(buildAiSessionPlan(prompts, "full", { seed: "stable" }), buildAiSessionPlan([...prompts].reverse(), "full", { seed: "stable" }));
  const incomplete = buildAiSessionPlan([{ id: "cue", part: "part2", topic: "Only" }, { id: "other", part: "part3", topic: "Other" }], "full", { seed: "small" });
  assert.ok(incomplete.limitations.includes("missing:part1"));
  assert.ok(incomplete.limitations.includes("unrelated_part3:only"));
  assert.throws(() => buildAiSessionPlan([{ id: "dup", part: "part1", topic: "A" }, { id: "dup", part: "part1", topic: "A" }], "part1"), /duplicate_prompt_id/);
});
