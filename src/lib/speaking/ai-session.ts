import { groupByTopic, topicKey, type BrowsablePrompt, type PracticePart } from "./practice-browse";

/**
 * Practice with AI — the examiner's script, assembled from the canonical bank.
 * Structure mirrors the IELTS interview: Part 1 (short questions on one
 * familiar topic), Part 2 (one cue card), Part 3 (discussion, preferably on the
 * Part 2 topic). Nothing here invents questions: a part with no published
 * prompts is simply absent from the script.
 */
/**
 * The prompt contract shared by the examiner session and `QuestionRecorder` (§5.1).
 *
 * `QuestionRecorder` reads exactly six fields — `id`, `part`, `promptText`, `cueCard`, `prepSeconds`
 * and `answerSeconds` — and drives its preparation and answer timers from the last two. Its prop used
 * to be typed as the whole database row, which is why the first bounded page response could not feed
 * it: the page omitted `prepSeconds`/`answerSeconds`, so either the timers would have silently fallen
 * back to defaults or the component would not typecheck.
 *
 * Declaring the structural type instead narrows nothing that matters and widens what is accepted: a
 * full `speaking_prompts` row still satisfies it, so every existing caller typechecks unchanged, and a
 * bounded page response now satisfies it too. `topic` stays because `buildExaminerScript` groups on it.
 */
export type ExaminerPrompt = {
  id: string;
  part: "part1" | "part2" | "part3" | "general";
  topic: string | null;
  promptText: string;
  cueCard: string | null;
  prepSeconds: number;
  answerSeconds: number;
};

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
