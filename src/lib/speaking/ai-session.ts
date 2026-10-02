import { groupByTopic, topicKey, type BrowsablePrompt, type PracticePart } from "./practice-browse";

/**
 * Practice with AI — the examiner's script, assembled from the canonical bank.
 * Structure mirrors the IELTS interview: Part 1 (short questions on one
 * familiar topic), Part 2 (one cue card), Part 3 (discussion, preferably on the
 * Part 2 topic). Nothing here invents questions: a part with no published
 * prompts is simply absent from the script.
 */
export type AiMode = "full" | PracticePart;
export const AI_MODES: readonly AiMode[] = ["full", "part1", "part2", "part3"];
export const PART1_QUESTIONS = 4;
export const PART3_QUESTIONS = 4;

type Pick = <T>(items: readonly T[]) => T;
const defaultPick: Pick = (items) => items[Math.floor(Math.random() * items.length)]!;

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
