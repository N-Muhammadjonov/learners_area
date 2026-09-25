/**
 * Typing Trainer — real keystrokes, server-computed numbers.
 *
 * IELTS is still a written exam for most students here, and typing speed is the
 * one writing skill that can be measured honestly and instantly. Two rules:
 *
 * 1. The browser sends *what was typed* and *how long it took* — never a WPM or
 *    an accuracy. Both are recomputed on the server from the raw text, so a
 *    hand-crafted request cannot post a 140 WPM run.
 * 2. Accuracy is an edit distance, not a "looks about right": insertions,
 *    deletions and substitutions all cost, the same way they cost a marker
 *    reading the paper.
 */

/** Standard typing-test convention: one "word" is five characters. */
export const CHARS_PER_WORD = 5;

/** Runs outside this window are not a typing test and are refused. */
export const MIN_DURATION_MS = 5_000;
export const MAX_DURATION_MS = 60 * 60 * 1000;

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  return previous[b.length] ?? 0;
}

export type TypingMetrics = {
  /** Words per minute, one decimal. */
  wpm: number;
  /** Character accuracy, 0–100, one decimal. */
  accuracy: number;
  durationMs: number;
  typedChars: number;
  targetChars: number;
};

/**
 * Compute the metrics of a run from the raw material.
 *
 * @throws when the duration is out of range or the target is empty — a caller
 *         that sends nonsense gets an error, not a number.
 */
export function computeTypingMetrics(
  targetText: string,
  typedText: string,
  durationMs: number
): TypingMetrics {
  if (!targetText.trim()) throw new Error("empty_target");
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error("invalid_duration");
  }

  const distance = levenshtein(targetText, typedText);
  const longest = Math.max(targetText.length, typedText.length) || 1;
  const accuracy = Math.max(0, (1 - distance / longest) * 100);

  // Elapsed time comes from the client clock (it measured the typing), but it is
  // bounded, and the word count is derived from the text the server can see.
  const minutes = durationMs / 60_000;
  const wpm = typedText.length / CHARS_PER_WORD / minutes;

  return {
    wpm: Math.round(wpm * 10) / 10,
    accuracy: Math.round(accuracy * 10) / 10,
    durationMs,
    typedChars: typedText.length,
    targetChars: targetText.length,
  };
}
