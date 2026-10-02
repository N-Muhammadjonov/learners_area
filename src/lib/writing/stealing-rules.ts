import { activationTokens, containsItem } from "./activation-rules";

/** The 7-step Language Stealing workflow (§44 + PDF Language Stealing pages). */
export const STEALING_STEPS = ["source", "brainstorm", "draft", "analyse", "compare", "memorise", "rewrite"] as const;
export type StealingStep = (typeof STEALING_STEPS)[number];
export const REWRITE_DELAY_DAYS = 3;
export const MIN_BRAINSTORM_WORDS = 8;
export const MIN_DRAFT_WORDS = 40;
export const MIN_COMPARE_WORDS = 12;
/** An adapted sentence below this AI adaptation band is never accepted. */
export const MIN_ADAPTATION_BAND = 5;

/** Generic Learners Area topic labels used when the library has no other topic to offer. */
export const FALLBACK_TOPICS = ["education", "environment", "technology", "health", "work", "transport", "crime", "tourism", "media", "family"] as const;

const STOP = new Set(["the", "a", "an", "of", "to", "in", "on", "and", "or", "is", "are", "was", "were", "be", "it", "this", "that", "for", "with", "as", "by", "at", "from", "its", "their", "has", "have", "can", "will", "more", "than"]);
export const wordCount = (s: string) => activationTokens(s).length;

function editDistance(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return dp[a.length]![b.length]!;
}

export type CopyCheck = { nearCopy: boolean; reason: "exact" | "edit_distance" | "topic_words" | null; editDistance: number; topicOverlap: number };

/**
 * Deterministic near-copy guard (runs BEFORE any AI call; AI then judges nuance).
 * Normalises case, punctuation, apostrophes, hyphens and whitespace, then flags:
 *  1. exact: identical token sequence;
 *  2. edit_distance: word-level edit distance ≤ max(2, 30% of the source example
 *     length) — e.g. swapping one or two nouns in an otherwise identical sentence;
 *  3. topic_words: ≥ 60% of the example's own topic words (content words that are
 *     not part of the pattern itself, ≥ 2 such words) reappear — the topic was not changed.
 * Pattern words never count against the learner: re-using the pattern is the point.
 */
export function nearCopy(answer: string, sourceExample: string, pattern: string): CopyCheck {
  const a = activationTokens(answer);
  const e = activationTokens(sourceExample);
  const dist = editDistance(a, e);
  const patternWords = new Set(activationTokens(pattern));
  const topicWords = [...new Set(e.filter((w) => w.length >= 3 && !STOP.has(w) && !patternWords.has(w)))];
  const aSet = new Set(a);
  const overlap = topicWords.length ? topicWords.filter((w) => aSet.has(w)).length / topicWords.length : 0;
  if (a.join(" ") === e.join(" ")) return { nearCopy: true, reason: "exact", editDistance: 0, topicOverlap: 1 };
  if (dist <= Math.max(2, Math.floor(e.length * 0.3))) return { nearCopy: true, reason: "edit_distance", editDistance: dist, topicOverlap: overlap };
  if (topicWords.length >= 2 && overlap >= 0.6) return { nearCopy: true, reason: "topic_words", editDistance: dist, topicOverlap: overlap };
  return { nearCopy: false, reason: null, editDistance: dist, topicOverlap: overlap };
}

/** Which of the learner's stolen patterns appear in a text (informational, for the Day-3 rewrite). */
export function patternsUsed(text: string, patterns: { id: string; pattern: string }[]): string[] {
  return patterns.filter((p) => {
    const core = p.pattern.replace(/\.{2,}|…|\[[^\]]*\]|\([^)]*\)/g, " sth ");
    return containsItem(text, core);
  }).map((p) => p.id);
}
