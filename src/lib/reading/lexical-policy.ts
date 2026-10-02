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
   * A non-exam learning passage. Policy-ready, but NO product surface exists yet:
   * every current reading passage is an Academic test (the "General" hub tab is an
   * empty General Training placeholder; topic code "general" is a topic, not a mode).
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
  if (mode === "ACADEMIC_EXAM") return false;
  if (mode === "GENERAL_READING") return true;
  if (state.examInProgress) return false;
  return state.submitted || state.staff;
}
