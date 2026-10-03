/**
 * Listening runtime modes and whether contextual vocabulary assistance is allowed.
 *
 * FULL_EXAM is a realistic IELTS test: no word click, no meaning, no translation,
 * no pronunciation, no vocabulary styling — whatever lexical data exists in the
 * database. Contextual lookup belongs to study/control surfaces AFTER submission.
 *
 * Precomputed occurrence data is DATA availability; this policy is the learner's
 * PERMISSION to reveal it. Both the pages and the API routes call it, so hiding
 * the popup is never the only barrier.
 */
export const LISTENING_MODES = [
  "FULL_EXAM", // activity 1 — the timed exam
  "REVIEW_CONTROL", // activity 2 review & revision, attempt revision, controlled practice
  "KEYWORD_PRACTICE", // activities 3–4 — paraphrase training; interaction unchanged
  "VOCABULARY_STUDY", // activity 5 — dedicated vocabulary session
] as const;
export type ListeningMode = (typeof LISTENING_MODES)[number];

export function modeForActivity(activity: number): ListeningMode {
  if (activity === 1) return "FULL_EXAM";
  if (activity === 3 || activity === 4) return "KEYWORD_PRACTICE";
  if (activity === 5) return "VOCABULARY_STUDY";
  return "REVIEW_CONTROL";
}

export type ListeningExamState = {
  /** At least one completed (submitted) full exam for this test by this learner. */
  submitted: boolean;
  /** An exam attempt for this test is currently open. */
  examInProgress: boolean;
  staff: boolean;
};

/**
 * Pure decision. Only FULL_EXAM forbids contextual lookup.
 * Study modes support independent prepared exercises, and are closed
 * while an exam attempt for the same test is open — a second tab cannot become
 * a dictionary for the running exam.
 */
export function lexicalAssistanceAllowed(mode: ListeningMode, state: ListeningExamState): boolean {
  if (mode === "FULL_EXAM") return false;
  if (state.examInProgress) return false;
  return true;
}
