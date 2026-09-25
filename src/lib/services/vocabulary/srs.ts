/**
 * The vocabulary engine's scheduling rules.
 *
 * ONE engine, used by every module: reading, listening, writing, speaking,
 * grammar, the Coach and the games all add words to the same library and all
 * schedule them with these rules. Nothing else keeps a private word list.
 *
 * Two ladders, deliberately separate:
 *
 *   SRS stages     1 → 3 → 7 → 16 → 35 days. A scheduled revision moves a word
 *                  forward when the student recalls it and back when they do
 *                  not. ONLY scheduled revision moves this ladder.
 *
 *   Mastery        NEW → LEARNING → KNOWN → ACTIVE → MASTERED. Recall drives the
 *                  first half; actually USING the word in a sentence drives the
 *                  second half. A game can never produce MASTERED, because a
 *                  game is casual practice and official progress must mean
 *                  something.
 *
 * Pure module: no database, no React — unit-testable on its own.
 */

/** Interval in days for each stage; index = stage number. */
export const SRS_INTERVALS = [1, 3, 7, 16, 35] as const;
export const NEW_STAGE = -1;

export type Mastery = "new" | "learning" | "known" | "active" | "mastered";
export const MASTERY_ORDER: Mastery[] = ["new", "learning", "known", "active", "mastered"];

export type ReviewOutcome = "correct" | "incorrect";

/** A word the student has never scheduled yet. */
export function isNewEntry(srsStage: number): boolean {
  return srsStage <= NEW_STAGE;
}

/** How many days after a review the word comes back. */
export function intervalDaysFor(stage: number): number {
  if (isNewEntry(stage)) return 0;
  return SRS_INTERVALS[Math.min(stage, SRS_INTERVALS.length - 1)] ?? SRS_INTERVALS[0];
}

/**
 * The next stage for a review.
 *
 * A correct recall advances one stage and stops at the last one (35 days); an
 * incorrect recall drops to the first stage rather than to zero, so a single bad
 * night does not erase weeks of work — and the word returns tomorrow, not in a
 * month.
 */
export function nextStage(currentStage: number, outcome: ReviewOutcome): number {
  if (outcome === "incorrect") return 0;
  if (isNewEntry(currentStage)) return 0;
  return Math.min(currentStage + 1, SRS_INTERVALS.length - 1);
}

export function dueAtFrom(stage: number, from: Date): Date {
  const days = intervalDaysFor(stage);
  const next = new Date(from);
  next.setDate(next.getDate() + (days > 0 ? days : 1));
  // A word reviewed today must never be due today again: the floor of one day is
  // what keeps "due" a meaningful queue.
  return next;
}

/**
 * The visible mastery ladder, derived from evidence — never stored as a mood.
 *
 *   NEW       not scheduled yet
 *   LEARNING  on the ladder, below the third stage, or more misses than hits
 *   KNOWN     reached the 7-day stage with a positive recall record
 *   ACTIVE    the word has been used in the student's own accepted sentence
 *   MASTERED Max stage reached AND used in real writing
 */
export function masteryFor(input: {
  srsStage: number;
  correctCount: number;
  incorrectCount: number;
  activeUseCount: number;
}): Mastery {
  const { srsStage, correctCount, incorrectCount, activeUseCount } = input;
  const used = activeUseCount > 0;
  const atMaxStage = srsStage >= SRS_INTERVALS.length - 1;

  if (atMaxStage && used) return "mastered";
  if (used) return "active";
  if (isNewEntry(srsStage)) return "new";
  if (srsStage >= 2 && correctCount > incorrectCount) return "known";
  return "learning";
}

/** Words that count as "weak" for a game set: remembered less than half the time. */
export function isWeak(input: { correctCount: number; incorrectCount: number; mastery: Mastery }): boolean {
  if (input.mastery === "mastered" || input.mastery === "active") return false;
  const attempts = input.correctCount + input.incorrectCount;
  if (attempts === 0) return true;
  return input.correctCount / attempts < 0.6;
}

/**
 * Where a review lands, in one place.
 *
 * Used by the scheduled revision route and by the unit tests, so the numbers in
 * the UI and the numbers in the database can never drift apart.
 */
export function applyReview(
  entry: { srsStage: number; correctCount: number; incorrectCount: number; activeUseCount: number },
  outcome: ReviewOutcome,
  now: Date
): {
  srsStage: number;
  correctCount: number;
  incorrectCount: number;
  mastery: Mastery;
  intervalDays: number;
  nextReviewAt: Date;
  lastReviewedAt: Date;
} {
  const srsStage = nextStage(entry.srsStage, outcome);
  const correctCount = entry.correctCount + (outcome === "correct" ? 1 : 0);
  const incorrectCount = entry.incorrectCount + (outcome === "incorrect" ? 1 : 0);
  const mastery = masteryFor({
    srsStage,
    correctCount,
    incorrectCount,
    activeUseCount: entry.activeUseCount,
  });
  return {
    srsStage,
    correctCount,
    incorrectCount,
    mastery,
    intervalDays: intervalDaysFor(srsStage),
    nextReviewAt: dueAtFrom(srsStage, now),
    lastReviewedAt: now,
  };
}

/** Recompute mastery after the word was used in a sentence. */
export function masteryAfterUse(entry: {
  srsStage: number;
  correctCount: number;
  incorrectCount: number;
  activeUseCount: number;
}): Mastery {
  return masteryFor(entry);
}
