/** The five IELTS Task 2 question families (§40). Mirrors the 0031 CHECK. */
export const TRANSLATION_QUESTION_TYPES = ["opinion", "discussion", "problem_solution", "advantages_disadvantages", "two_part"] as const;
export type TranslationQuestionType = (typeof TRANSLATION_QUESTION_TYPES)[number];
export const TRANSLATION_BANDS = [6, 7, 8] as const;

/** After this many checked tries a sentence is closed and the trainer moves on. */
export const MAX_TRIES = 3;

/**
 * Stage A normalisation: case, curly quotes, dashes, whitespace and final
 * punctuation never decide correctness. Wording still does.
 */
export function normalizeAnswer(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc`]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[.,;:!?"]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesAccepted(answer: string, accepted: string[]): boolean {
  const a = normalizeAnswer(answer);
  return a.length > 0 && accepted.some((x) => normalizeAnswer(x) === a);
}
