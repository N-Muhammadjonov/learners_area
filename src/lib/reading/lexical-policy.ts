/**
 * Reading runtime modes and whether contextual vocabulary assistance is allowed.
 *
 * Same principle as Listening (src/lib/listening/lexical-policy.ts): precomputed
 * occurrence/sense data is DATA availability; revealing it is a PERMISSION decided
 * here and enforced on the server (resolveOccurrence → 403) as well as in the UI.
 */
export const READING_MODES = [
  /** An in-progress IELTS Academic attempt: the passage is a plain exam text. */
  "ACADEMIC_EXAM",
  /** A submitted Academic attempt (analysis / evidence / retention review). */
  "ACADEMIC_REVIEW",
  /**
   * General Reading (0030): a LEARNING passage — develop reading, not measure it.
   * Decided only by the passage's persisted row in general_reading_passages; a
   * request can never claim it. Help is on immediately, in Passage and Full mode.
   */
  "GENERAL_READING",
] as const;
export type ReadingMode = (typeof READING_MODES)[number];

export type ReadingExamState = {
  /** At least one submitted attempt of this passage by this learner. */
  submitted: boolean;
  /** An attempt of this passage is currently open (a second tab is not a dictionary). */
  examInProgress: boolean;
  staff: boolean;
};

export function readingLexicalAssistanceAllowed(mode: ReadingMode, state: ReadingExamState): boolean {
  // V4: successful own review may use the canonical Dictionary. Neither staff
  // privileges nor an earlier submission unlock a currently active assessment.
  return mode === "GENERAL_READING" || (mode === "ACADEMIC_REVIEW" && state.submitted && !state.examInProgress);
}
