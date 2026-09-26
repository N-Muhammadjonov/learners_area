/**
 * Grading a game answer — the ONE rule that decides whether a typed answer is
 * right.
 *
 * This module is deliberately pure and free of any database import, because the
 * same rule has to run in two places:
 *
 *   - in the browser, so a student sees an instant verdict while playing;
 *   - on the server, so the verdict the ledger records is the server's own.
 *
 * The games used to send their verdict ("correct": true) and the server simply
 * believed it, which meant a student could earn every casual point without
 * answering anything. Now the browser sends what was typed and the server
 * grades it again; a submitted answer can never disagree with the stored one
 * because both sides call `gradeSpelling` below.
 *
 * Nothing here is generated content: the accepted set is the word as authored
 * plus the alternatives the centre wrote for it. A word authored without
 * alternatives therefore has exactly one correct answer.
 */

/**
 * Fold an answer down to its comparable form: case, apostrophe style, spacing
 * and punctuation stop mattering, so "Traffic congestion." and "traffic
 * congestion" are the same answer while "congestion" and "decongestion" are not.
 *
 * `toLowerCase` is used rather than a locale-aware lower-casing on purpose: a
 * Turkish-locale browser would otherwise fold "I" to a dotless "ı" and mark a
 * correct English answer wrong.
 */
export function normalizeAnswer(value: string): string {
  return value
    .toLowerCase()
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Every spelling the centre accepts for one word: the word and its authored alternatives. */
export function acceptedSpellings(input: {
  term: string;
  acceptedTranslations?: string[] | null;
}): string[] {
  const seen = new Set<string>();
  for (const entry of [input.term, ...(input.acceptedTranslations ?? [])]) {
    const folded = normalizeAnswer(entry ?? "");
    if (folded) seen.add(folded);
  }
  return [...seen];
}

/** True when the typed answer is one of the accepted spellings. */
export function gradeSpelling(
  input: { term: string; acceptedTranslations?: string[] | null },
  submitted: string,
): boolean {
  const folded = normalizeAnswer(submitted);
  if (!folded) return false;
  return acceptedSpellings(input).includes(folded);
}

/** True when a sentence the student assembled equals the sentence it was built from. */
export function gradeSentence(expected: string, submitted: string): boolean {
  const folded = normalizeAnswer(submitted);
  return folded.length > 0 && folded === normalizeAnswer(expected);
}

/**
 * What the browser is allowed to send.
 *
 *   "spelling"  a typed answer — the server grades it itself
 *   "sentence"  an assembled sentence — the server grades it itself
 *   "self"      the student's own recall judgement ("I knew it"), or a pairing
 *               the browser checked between two of its own cards. The server has
 *               nothing to compare these against, so they are recorded as
 *               practice and earn no points: a claim is not evidence.
 */
export type GameSubmission =
  | { kind: "spelling"; text: string }
  | { kind: "sentence"; text: string }
  | { kind: "self"; known: boolean };

/** Kinds the server can verify on its own. */
export function isVerifiableKind(kind: GameSubmission["kind"]): boolean {
  return kind === "spelling" || kind === "sentence";
}
