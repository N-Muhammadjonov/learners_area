/**
 * THE lexical normalisation contract for Learners Area (pure; client and server).
 *
 * Search, deduplication, grading and lexical identity all fold text through this
 * module, so "o\u02BBqish", "o\u2018qish", "o\u2019qish" and "o'qish" are the same string
 * everywhere instead of matching in one feature and missing in another.
 *
 * Only APOSTROPHE-LIKE characters are unified. Other punctuation keeps its
 * meaning here; callers that also drop punctuation (grading) do so explicitly.
 *
 * The SQL in drizzle/0029_vocabulary_architecture.sql mirrors `lemmaNorm` and
 * `partOfSpeechNorm` for the backfill; tests/vocabulary-architecture-db.test.ts
 * proves the two agree on every row.
 */

/**
 * ' U+0027 is the canonical form. Variants folded into it:
 * U+2018, U+2019, U+02BB (Uzbek o/g modifier letter), U+02BC, U+0060 grave, U+00B4 acute, U+2032 prime.
 */
export const APOSTROPHE_VARIANTS = "\u2018\u2019\u02BB\u02BC\u0060\u00B4\u2032";
const APOSTROPHE_PATTERN = /[\u2018\u2019\u02BB\u02BC\u0060\u00B4\u2032]/g;

export function foldApostrophes(value: string): string {
  return value.replace(APOSTROPHE_PATTERN, "'");
}

/**
 * Case, apostrophe style and spacing stop mattering. `toLowerCase` (not the
 * locale-aware variant) on purpose: a Turkish-locale browser must not fold "I"
 * to a dotless "ı".
 */
export function normalizeLexical(value: string | null | undefined): string {
  return foldApostrophes((value ?? "").normalize("NFKC").toLowerCase()).replace(/\s+/g, " ").trim();
}

/** Lemma identity of a lexical unit: no article stripping ("a lot of" stays itself). */
export function lemmaNorm(term: string): string {
  return normalizeLexical(term);
}

/** Exact aliases only; "noun phrase" is not a plain "noun". */
export function partOfSpeechNorm(part: string | null | undefined): string {
  const raw = (part ?? "").normalize("NFKC").toLowerCase().trim().replace(/^\((.*)\)$/, "$1").replace(/\.$/, "");
  const aliases: Record<string, string> = { n: "noun", v: "verb", adj: "adjective", adv: "adverb", phr: "phrase", prep: "preposition", "n.phrase": "noun phrase", "v.phrase": "verb phrase" };
  return aliases[raw] ?? raw.replace(/\s+/g, " ");
}

export const LEXICAL_TYPES = [
  "word", "noun_phrase", "verb_phrase", "collocation", "phrasal_verb", "idiom",
  "fixed_expression", "compound", "technical_term", "phrase",
] as const;
export type LexicalType = (typeof LEXICAL_TYPES)[number];

const TYPE_BY_POS: Record<string, LexicalType> = {
  "noun phrase": "noun_phrase",
  "verb phrase": "verb_phrase",
  "phrasal verb": "phrasal_verb",
  idiom: "idiom",
  collocation: "collocation",
  "fixed expression": "fixed_expression",
  compound: "compound",
};

/** Derived only from authored POS + the lemma's shape; never guessed beyond that. */
export function lexicalTypeFor(term: string, partOfSpeech: string | null | undefined): LexicalType {
  const byPos = TYPE_BY_POS[partOfSpeechNorm(partOfSpeech)];
  if (byPos) return byPos;
  return lemmaNorm(term).includes(" ") ? "phrase" : "word";
}

/**
 * Standalone grammar words that are never normal target vocabulary. Inside an
 * accepted multi-word unit ("take into account") they are fine.
 */
export const FUNCTION_WORDS: ReadonlySet<string> = new Set([
  "a", "an", "the", "and", "or", "but", "nor", "so", "yet", "of", "to", "in", "on", "at", "by",
  "for", "from", "with", "into", "onto", "about", "as", "than", "that", "this", "these", "those",
  "it", "its", "is", "are", "was", "were", "be", "been", "am", "do", "does", "did", "have", "has",
  "had", "i", "you", "he", "she", "we", "they", "me", "him", "her", "us", "them", "my", "your",
  "his", "our", "their", "not", "no", "if", "then", "there", "here", "what", "which", "who",
  "whom", "whose", "will", "would", "can", "cannot", "could", "shall", "should", "may", "might", "must",
]);

export function isFunctionWord(term: string): boolean {
  const norm = lemmaNorm(term);
  return !norm.includes(" ") && FUNCTION_WORDS.has(norm);
}
