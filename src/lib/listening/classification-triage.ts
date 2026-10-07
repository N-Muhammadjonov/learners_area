/**
 * OWNER TRIAGE HELPERS — the *reason* a row could not be classified, and nothing more.
 *
 * This module exists so the owner-facing report (`scripts/listening-classification-report.ts`) can
 * explain itself under test. It is deliberately toothless: it takes facts the database already
 * holds and returns a sentence saying which canonical fact is missing. It cannot classify, it
 * cannot write, and it never looks at a title, a source reference, a file name, a duration or a
 * bare question count — the owner's rule is that an unprovable legacy row is flagged for a human
 * decision, never guessed into a classification.
 */
import { FORMAL_FULL_TEST_PARTS, FORMAL_FULL_TEST_QUESTIONS, type ListeningProductKind } from "./product";

/** The facts the report reads for one row — a faithful shape of the single SELECT it runs. */
export type ClassifiableRow = {
  product: ListeningProductKind;
  hasPackage: boolean;
  /** The latest Listening revision's declared contentType, when there is one. */
  revisionType: string | null;
  /** The package's authored collection, when the package states one. */
  collection: string | null;
  parts: number | null;
  questions: number | null;
};

/** What the report's `learner history` line must never lose: real results belong to real learners. */
export type AttemptHistory = {
  attempts: number;
  completedAttempts: number;
  learners: number;
  lastAttemptAt: Date | string | null;
};

export function attemptHistoryLine(history: AttemptHistory): string {
  if (history.attempts === 0) return "never attempted";
  const last =
    history.lastAttemptAt === null
      ? ""
      : `, last on ${new Date(history.lastAttemptAt).toISOString().slice(0, 10)}`;
  return `${history.attempts} attempt(s) by ${history.learners} learner(s), ${history.completedAttempts} completed${last}`;
}

/**
 * WHY this row needs a human decision — stated in the product's own terms.
 *
 * Every branch names a canonical fact that is absent or unrecognised. None of them say "it looks
 * like…", because a look is not proof; and the function returns a reason, not a product, so it
 * cannot be wired up as an automatic classifier by accident.
 */
export function classificationDecisionReason(row: ClassifiableRow): string {
  if (row.hasPackage) {
    if (row.collection) {
      return `the package states collection '${row.collection}', which is not a collection this product recognises`;
    }
    const shaped =
      `the package states no collection and its structure is not a provable ${FORMAL_FULL_TEST_PARTS}-part / ` +
      `${FORMAL_FULL_TEST_QUESTIONS}-question full test (it declares ${row.parts ?? "?"} part(s) and ${row.questions ?? "?"} question(s))`;
    return row.revisionType
      ? `${shaped}; its latest revision declares contentType '${row.revisionType}', which does not classify a package-backed row`
      : shaped;
  }
  if (row.revisionType) {
    return (
      `no canonical package; its latest revision declares contentType '${row.revisionType}', which the product treats as ` +
      "no proof of an Academic full test or a General section"
    );
  }
  return "no canonical package and no Listening revision: nothing in the row's own canonical data states what this item is";
}
