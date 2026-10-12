import type { ListeningProductKind } from "./product";

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
  "SECTION_PRACTICE", // a General Listening standalone section — the learner's own activity
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
  /*
   * A standalone General section is not a timed exam: looking a word up IS part of the one
   * activity the owner designed for it, so its own open attempt must not lock it. The
   * `examInProgress` rule below exists so a second tab cannot turn a RUNNING FULL EXAM into a
   * dictionary — it is kept for every mode where an exam can be running for the same test.
   */
  if (mode === "SECTION_PRACTICE") return true;
  if (state.examInProgress) return false;
  return true;
}

/**
 * The mode of a Listening source, from the product the source actually IS.
 *
 * One decision, two readers: the section page (does this activity show the text surface?) and
 * the lexical API routes (may this learner's lookup be answered?). Asking `product.ts` — the
 * same classifier the catalogues use — is what keeps a section from being locked out of the
 * vocabulary it exists to teach, while the Academic full exam stays sealed.
 */
export function modeForListeningProduct(product: ListeningProductKind): ListeningMode {
  return product === "general_section" ? "SECTION_PRACTICE" : "REVIEW_CONTROL";
}
