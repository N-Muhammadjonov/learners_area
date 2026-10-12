/**
 * Learners Area Writing → Typing.
 *
 * The browser renders the interaction, but the server remains authoritative for
 * WPM, raw WPM, accuracy and consistency. The client submits typed words and
 * cumulative per-second character samples; it never submits trusted scores.
 */

export const CHARS_PER_WORD = 5;
export const MIN_DURATION_MS = 3_000;
export const MAX_DURATION_MS = 30 * 60 * 1000;

/** Timed presets in seconds. null = Full text. */
export const TYPING_PRESETS = [30, 60, 120, 180] as const;
export type TypingPreset = (typeof TYPING_PRESETS)[number];
export function isTypingPreset(v: unknown): v is TypingPreset {
  return typeof v === "number" && (TYPING_PRESETS as readonly number[]).includes(v);
}

export type TypingMetrics = {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  consistency: number | null;
  correct: number;
  incorrect: number;
  extra: number;
  missed: number;
  typedChars: number;
  targetChars: number;
  mistakes: number;
  completion: number;
  durationMs: number;
};

/** Split the canonical corpus exactly as the typing stage does. */
export function splitTypingWords(body: string): string[] {
  return body.trim().split(/\s+/).filter(Boolean);
}

/**
 * Monkeytype-style word/character accounting, adapted for Learners Area.
 *
 * - committed words are everything before the final array item
 * - the final item is the current in-progress word
 * - missed characters are counted only after a word is committed
 * - net WPM credits only fully-correct committed words (+ their spaces)
 * - raw WPM credits every typed character
 */
export function computeWordTypingMetrics(
  target: string[],
  typedWords: string[],
  seconds: number,
  samples: number[],
): TypingMetrics {
  const committed = typedWords.slice(0, -1);
  const partial = typedWords[typedWords.length - 1] ?? "";
  let correct = 0;
  let incorrect = 0;
  let extra = 0;
  let missed = 0;
  let goodChars = 0;
  let goodSpaces = 0;

  const compare = (typed: string, expected: string, isCommitted: boolean) => {
    const overlap = Math.min(typed.length, expected.length);
    for (let i = 0; i < overlap; i += 1) {
      if (typed[i] === expected[i]) correct += 1;
      else incorrect += 1;
    }
    extra += Math.max(0, typed.length - expected.length);
    if (isCommitted) missed += Math.max(0, expected.length - typed.length);
  };

  committed.forEach((word, index) => {
    const expected = target[index] ?? "";
    compare(word, expected, true);
    if (word === expected && expected) {
      goodChars += expected.length;
      goodSpaces += 1;
    }
  });

  const partialIndex = committed.length;
  const expectedPartial = target[partialIndex] ?? "";
  compare(partial, expectedPartial, false);

  const finishedLastWord =
    partialIndex === target.length - 1 &&
    expectedPartial.length > 0 &&
    partial === expectedPartial;
  if (finishedLastWord) goodChars += expectedPartial.length;

  const typedChars =
    committed.reduce((sum, word) => sum + word.length + 1, 0) + partial.length;
  const targetChars = target.join(" ").length;
  const safeSeconds = Math.max(1, seconds);
  const r1 = (n: number) => Math.round(n * 10) / 10;
  const wpm = ((goodChars + goodSpaces) / CHARS_PER_WORD) * (60 / safeSeconds);
  const rawWpm = (typedChars / CHARS_PER_WORD) * (60 / safeSeconds);
  const denominator = correct + incorrect + extra + missed;
  const accuracy = denominator > 0 ? (correct / denominator) * 100 : 0;
  const completedTargetChars = Math.min(
    targetChars,
    committed.reduce((sum, word, i) => sum + (target[i]?.length ?? 0) + 1, 0) +
      Math.min(partial.length, expectedPartial.length),
  );

  return {
    wpm: r1(wpm),
    rawWpm: r1(rawWpm),
    accuracy: r1(accuracy),
    consistency: consistencyFromSamples(samples),
    correct,
    incorrect,
    extra,
    missed,
    typedChars,
    targetChars,
    mistakes: incorrect + extra + missed,
    completion: targetChars ? r1((completedTargetChars / targetChars) * 100) : 0,
    durationMs: Math.round(safeSeconds * 1000),
  };
}

/**
 * Per-second cumulative character samples -> raw WPM variability -> 0..100.
 * This mirrors the supplied trainer algorithm while leaving scoring server-side.
 */
export function consistencyFromSamples(samples: number[]): number | null {
  if (samples.length < 4) return null;
  const rates = samples.map((value, index) => (value - (samples[index - 1] ?? 0)) * 12);
  const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
  if (mean <= 0) return null;
  const variance = rates.reduce((sum, rate) => sum + (rate - mean) ** 2, 0) / rates.length;
  const cov = Math.sqrt(variance) / mean;
  const mapped = 100 * (1 - Math.tanh(cov + cov ** 3 / 3 + cov ** 5 / 5));
  return Math.round(mapped * 10) / 10;
}

export function validateTypingSubmission(
  target: string[],
  typedWords: string[],
  samples: number[],
  seconds: number,
): string | null {
  if (!Array.isArray(typedWords) || typedWords.length < 1 || typedWords.length > target.length + 1) {
    return "bad_words";
  }
  if (typedWords.some((word) => typeof word !== "string" || word.length > 80 || word.includes(" "))) {
    return "bad_words";
  }
  const typedChars =
    typedWords.slice(0, -1).reduce((sum, word) => sum + word.length + 1, 0) +
    (typedWords.at(-1)?.length ?? 0);
  if (typedChars / Math.max(1, seconds) > 25) return "implausible_speed";
  if (samples.length > Math.ceil(seconds) + 2) return "bad_samples";
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i]!;
    if (!Number.isInteger(value) || value < 0) return "bad_samples";
    if (i > 0 && value < samples[i - 1]!) return "bad_samples";
    if (value - (samples[i - 1] ?? 0) > 40) return "bad_samples";
  }
  if (samples.length && samples.at(-1)! > typedChars + 1) return "bad_samples";
  return null;
}

/* -------------------------------------------------------------------------
 * Compatibility helpers retained for historical tests and old stored runs.
 * New runs use computeWordTypingMetrics above.
 * ---------------------------------------------------------------------- */

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? 0) + 1,
        (current[j - 1] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost,
      );
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length] ?? 0;
}

export type TypingResult = {
  wpm: number;
  rawWpm: number;
  accuracy: number;
  correctChars: number;
  mistakes: number;
  typedChars: number;
  targetChars: number;
  completion: number;
  durationMs: number;
};

/**
 * The legacy metric, and a DIFFERENT contract from `computeTypingResult` below:
 *
 *   computeTypingMetrics  accuracy is the edit distance over the WHOLE target text, so a
 *                         run that stops halfway is charged for what it never typed
 *                         ("two missing of four characters is 50%").
 *   computeTypingResult   accuracy is over WHAT WAS TYPED, with `completion` carrying the
 *                         untyped remainder ("a learner who stops halfway is not charged
 *                         for the untyped rest").
 *
 * Both are accepted behaviour and both are pinned by tests, so neither may quietly become
 * the other: `tests/listening-and-typing.test.ts` asserts this formula, while the trainer
 * uses the word-level `computeWordTypingMetrics` and the legacy model-text run uses
 * `computeTypingResult`. During the Content OS ⇄ learners-area-next integration this
 * function had been rewritten to delegate to `computeTypingResult`, which silently changed
 * a published number and turned that base test red; it is restored here, unchanged, and
 * nothing else in the tree uses it.
 */
export function computeTypingMetrics(
  targetText: string,
  typedText: string,
  durationMs: number,
): Pick<TypingResult, "wpm" | "accuracy" | "durationMs" | "typedChars" | "targetChars"> {
  if (!targetText.trim()) throw new Error("empty_target");
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error("invalid_duration");
  }

  const distance = levenshtein(targetText, typedText);
  const longest = Math.max(targetText.length, typedText.length) || 1;
  const accuracy = Math.max(0, (1 - distance / longest) * 100);

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

export function computeTypingResult(
  targetText: string,
  typedText: string,
  durationMs: number,
): TypingResult {
  if (!targetText.trim()) throw new Error("empty_target");
  if (!Number.isFinite(durationMs) || durationMs < MIN_DURATION_MS || durationMs > MAX_DURATION_MS) {
    throw new Error("invalid_duration");
  }
  const typed = typedText.slice(0, targetText.length + 200);
  const reference = targetText.slice(0, Math.min(targetText.length, typed.length));
  const mistakes = typed.length ? levenshtein(reference, typed) : 0;
  const correctChars = Math.max(0, typed.length - mistakes);
  const minutes = durationMs / 60_000;
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return {
    wpm: r1(correctChars / CHARS_PER_WORD / minutes),
    rawWpm: r1(typed.length / CHARS_PER_WORD / minutes),
    accuracy: typed.length ? r1((correctChars / typed.length) * 100) : 0,
    correctChars,
    mistakes,
    typedChars: typed.length,
    targetChars: targetText.length,
    completion: r1(Math.min(100, (Math.min(typed.length, targetText.length) / targetText.length) * 100)),
    durationMs,
  };
}
