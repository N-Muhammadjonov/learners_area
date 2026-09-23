export type ReviewGrade = "again" | "hard" | "good" | "easy";
export type VocabState = "new" | "learning" | "review" | "known" | "mastered" | "activated";

export type ReviewInput = {
  grade: ReviewGrade;
  intervalDays: number;
  correctCount: number;
  incorrectCount: number;
};

export type ReviewResult = {
  intervalDays: number;
  correctCount: number;
  incorrectCount: number;
  state: Exclude<VocabState, "activated">; // activation is tracked separately, see below
  nextReviewAt: Date;
};

/**
 * Simplified SM-2-style scheduler. Not a byte-for-byte SM-2 implementation —
 * just its core idea (wrong answers reset the interval, right answers grow
 * it, growth rate depends on how easy the recall felt) kept small enough to
 * unit test and reason about.
 */
export function scheduleReview(input: ReviewInput, now: Date = new Date()): ReviewResult {
  const { grade } = input;

  if (grade === "again") {
    const nextReviewAt = new Date(now);
    nextReviewAt.setDate(nextReviewAt.getDate() + 1);
    return {
      intervalDays: 0,
      correctCount: input.correctCount,
      incorrectCount: input.incorrectCount + 1,
      state: "learning",
      nextReviewAt,
    };
  }

  let nextInterval: number;
  if (input.intervalDays <= 0) {
    nextInterval = grade === "hard" ? 1 : grade === "good" ? 2 : 4;
  } else {
    const multiplier = grade === "hard" ? 1.2 : grade === "good" ? 2.0 : 2.8;
    nextInterval = Math.max(1, Math.round(input.intervalDays * multiplier));
  }

  const state: Exclude<VocabState, "activated"> =
    nextInterval < 7 ? "review" : nextInterval < 30 ? "known" : "mastered";

  const nextReviewAt = new Date(now);
  nextReviewAt.setDate(nextReviewAt.getDate() + nextInterval);

  return {
    intervalDays: nextInterval,
    correctCount: input.correctCount + 1,
    incorrectCount: input.incorrectCount,
    state,
    nextReviewAt,
  };
}

/** A word graduates to "activated" once it's been used correctly in production a few times. */
export const ACTIVATION_THRESHOLD = 3;

export function isActivated(activeUseCount: number): boolean {
  return activeUseCount >= ACTIVATION_THRESHOLD;
}
