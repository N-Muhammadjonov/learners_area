/**
 * THE canonical word counter.
 *
 * One function decides how long a Retention text is: the admin editor's live
 * counter, the server's save validation, the stored `word_count`, the importer
 * and every test all call this one. Two counters that disagree by a word would
 * mean the owner sees "175" while the server sees "176" and rejects a text the
 * editor called valid — so there is exactly one implementation, and it is pure
 * JavaScript with no dependency on Node, the database or React.
 *
 * Counting semantics (deliberate, and documented for authors in
 * `docs/RETENTION_AUTHORING_FORMAT.md`):
 *
 *   * Text is NFKC-normalised first, so a full-width digit or a ligature cannot
 *     change the count.
 *   * A word is a maximal run of letters or digits, optionally joined by
 *     apostrophes or hyphens: `don't` is ONE word, `well-known` is ONE word,
 *     `state-of-the-art` is ONE word.
 *   * Apostrophes: both the straight `'` and the typographic right single quote is accepted as
 *     the same joiner, so a curly and a straight `don't` count identically.
 *   * Punctuation separates: `. , ; : ! ? ( ) [ ] " “ ” …` and every dash other
 *     than a joiner (`—`, `–`, ` - ` in prose) split words.
 *   * Numbers written in digits count as words: `1998` is one word.
 *   * Markdown headers, list markers and fences are counted as typed — the
 *     retained text is plain prose, so this is only relevant if an author pastes
 *     something else in.
 *   * Leading/trailing whitespace and repeated whitespace never add a word.
 */

const WORD_PATTERN = /[\p{L}\p{N}]+(?:['\u2019-][\p{L}\p{N}]+)*/gu;

export function normalizeForWordCount(text: string): string {
  // Grouped digits are one number, not two words: `50,000` counts as one, and
  // `50 000` with a typographic grouping space counts the same way. This is the
  // same rule the evaluator's normaliser applies, so the author's counter and the
  // scorer can never disagree about what a token is.
  // The grouping separators are collapsed BEFORE NFKC: the compatibility
  // normalisation folds U+00A0/U+202F into a plain space, which is also the
  // character that legitimately separates two words in prose, so waiting until
  // afterwards would make `50 000` indistinguishable from `50 000` the other way
  // round. Here the separator is explicit and the rule stays exact.
  return text.replace(/(?<=\d)[,\u00a0\u202f\u2009](?=\d)/gu, "").normalize("NFKC");
}

export function countWords(text: string): number {
  if (typeof text !== "string" || text.length === 0) return 0;
  const normalized = normalizeForWordCount(text);
  const matches = normalized.match(WORD_PATTERN);
  return matches ? matches.length : 0;
}

/** The words themselves, in order — used by the importer and QA tooling only. */
export function words(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return normalizeForWordCount(text).match(WORD_PATTERN) ?? [];
}
