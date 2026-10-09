import { groupByTopic, topicKey, type BrowsablePrompt, type PracticePart } from "./practice-browse";

/** Canonical, examiner-like session planning. No question text is generated here. */
export type AiMode = "full" | PracticePart;
export const AI_MODES: readonly AiMode[] = ["full", "part1", "part2", "part3"];
export const MIN_TOPIC_QUESTIONS = 3;
export const DEFAULT_TOPIC_QUESTIONS = 4;
export const MAX_TOPIC_QUESTIONS = 6;
// Backwards-compatible exports used by existing callers/tests.
export const PART1_QUESTIONS = DEFAULT_TOPIC_QUESTIONS;
export const PART3_QUESTIONS = DEFAULT_TOPIC_QUESTIONS;

export type AiPlanItem<P extends BrowsablePrompt = BrowsablePrompt> = {
  prompt: P;
  ordinal: number;
  topicKey: string;
  topicPosition: number;
  questionPosition: number;
};

export type AiSessionPlan<P extends BrowsablePrompt = BrowsablePrompt> = {
  version: 2;
  mode: AiMode;
  seed: string;
  limitations: string[];
  items: AiPlanItem<P>[];
};

type Pick = <T>(items: readonly T[]) => T;
const defaultPick: Pick = (items) => items[Math.floor(Math.random() * items.length)]!;

function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

/** Small deterministic PRNG: the persisted seed makes a plan reproducible for audit/tests. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h += 0x6d2b79f5;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function countFor(size: number): number {
  if (size < MIN_TOPIC_QUESTIONS) return size;
  return Math.min(size, DEFAULT_TOPIC_QUESTIONS, MAX_TOPIC_QUESTIONS);
}

/**
 * Builds a stable, topic-contiguous plan from canonical prompt rows. Randomness
 * is injected/seeded and the resulting prompt ids are persisted by the server.
 */
export function buildAiSessionPlan<P extends BrowsablePrompt>(
  prompts: readonly P[],
  mode: AiMode,
  options: { seed?: string; recentPromptIds?: readonly string[] } = {},
): AiSessionPlan<P> {
  if (new Set(prompts.map(prompt => prompt.id)).size !== prompts.length) throw new Error("duplicate_prompt_id");
  // Stable ordering makes seed replay independent of SQL tie/order changes.
  prompts = [...prompts].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const seed = options.seed ?? crypto.randomUUID();
  const random = seededRandom(seed);
  const recent = new Set(options.recentPromptIds ?? []);
  const limitations: string[] = [];
  const selected: Array<{ prompt: P; key: string; topicPosition: number; questionPosition: number }> = [];
  let topicPosition = 0;
  let cueTopic: string | null = null;

  const rankPrompts = (group: { key: string; prompts: P[] }) => {
    const fresh = shuffled(group.prompts.filter((p) => !recent.has(p.id)), random);
    const reused = shuffled(group.prompts.filter((p) => recent.has(p.id)), random);
    const count = countFor(group.prompts.length);
    if (group.prompts.length < MIN_TOPIC_QUESTIONS) limitations.push(`${group.key}:${group.prompts.length}`);
    return [...fresh, ...reused].slice(0, count);
  };
  const appendGroup = (group: { key: string; prompts: P[] }) => {
    topicPosition += 1;
    rankPrompts(group).forEach((prompt, index) => selected.push({ prompt, key: group.key, topicPosition, questionPosition: index + 1 }));
  };

  if (mode === "full" || mode === "part1") {
    const groups = shuffled(groupByTopic(prompts, "part1"), random);
    // One coherent cluster for part-only, two where the full bank supports an interview-like opening.
    const wanted = mode === "full" && groups.length > 1 ? 2 : 1;
    groups.slice(0, wanted).forEach(appendGroup);
  }
  if (mode === "full" || mode === "part2") {
    const groups = shuffled(groupByTopic(prompts, "part2"), random);
    const discussionTopics = new Set(groupByTopic(prompts, "part3").map(group => group.key));
    const group = mode === "full" ? groups.find(group => discussionTopics.has(group.key)) ?? groups[0] : groups[0];
    if (group) {
      topicPosition += 1;
      const candidates = [...shuffled(group.prompts.filter((p) => !recent.has(p.id)), random), ...shuffled(group.prompts.filter((p) => recent.has(p.id)), random)];
      const prompt = candidates[0];
      if (prompt) {
        cueTopic = group.key;
        selected.push({ prompt, key: group.key, topicPosition, questionPosition: 1 });
      }
    }
  }
  if (mode === "full" || mode === "part3") {
    const groups = shuffled(groupByTopic(prompts, "part3"), random);
    const matching = cueTopic ? groups.find((group) => group.key === cueTopic) : undefined;
    const group = matching ?? groups[0];
    if (cueTopic && group && !matching) limitations.push(`unrelated_part3:${cueTopic}`);
    if (group) appendGroup(group);
  }

  for (const part of ["part1", "part2", "part3"] as const) {
    if ((mode === "full" || mode === part) && !selected.some(item => item.prompt.part === part)) limitations.push(`missing:${part}`);
  }

  return {
    version: 2,
    mode,
    seed,
    limitations,
    items: selected.map((item, index) => ({ ...item, ordinal: index + 1, topicKey: item.key })),
  };
}

/** Legacy client helper retained for non-persisted consumers. */
export function buildExaminerScript<P extends BrowsablePrompt>(prompts: readonly P[], mode: AiMode, pick: Pick = defaultPick): P[] {
  const script: P[] = [];
  const p1 = groupByTopic(prompts, "part1");
  const p2 = groupByTopic(prompts, "part2");
  const p3 = groupByTopic(prompts, "part3");
  let cueTopic: string | null = null;
  if ((mode === "full" || mode === "part1") && p1.length) script.push(...pick(p1).prompts.slice(0, PART1_QUESTIONS));
  if ((mode === "full" || mode === "part2") && p2.length) {
    const cue = pick(pick(p2).prompts);
    cueTopic = topicKey(cue.topic);
    script.push(cue);
  }
  if ((mode === "full" || mode === "part3") && p3.length) {
    const matching = cueTopic ? p3.find((g) => g.key === cueTopic) : undefined;
    script.push(...(matching ?? pick(p3)).prompts.slice(0, PART3_QUESTIONS));
  }
  return script;
}
