/**
 * Deterministic text normalisation for the Retention evaluator.
 *
 * Retention is a MEMORY exercise, not a grammar test, so everything here exists
 * to remove the differences that are not memory:
 *
 *   * case, Unicode form, curly vs straight apostrophes;
 *   * articles and other function words (`a`, `an`, `the`) — "Company founded
 *     1998" and "The company was founded in 1998" must score the same;
 *   * negative contractions — `didn't` becomes `did not` so a negation is a
 *     negation and can be seen as one;
 *   * number words — `two` and `2` are the same value, deliberately and only for
 *     the words listed below.
 *
 * Everything else is preserved, because everything else can change meaning.
 * There is no stemming and no thesaurus: synonyms come from the author's
 * `anyOf` list, never from a guess.
 *
 * Pure module: no I/O, no clock, no randomness.
 */

/**
 * Function words that carry no memory information.
 *
 * Dropping them from BOTH the learner's answer and the author's alternatives is
 * what makes "Company founded 1998" equal to "The company was founded in 1998".
 * The list is closed and short on purpose: dropping a meaningful word would be a
 * scoring change, not a normalisation.
 */
const FUNCTION_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "at",
  "to",
  "for",
  "with",
  "by",
  "from",
  "as",
  "that",
  "which",
  "was",
  "were",
  "is",
  "are",
  "be",
  "been",
  "being",
  "am",
  "do",
  "does",
  "did",
  "has",
  "have",
  "had",
  "it",
  "its",
  "this",
  "these",
  "those",
  "there",
  "their",
  "and",
  "or",
  "so",
  "than",
  "then",
  "into",
  "about",
  "over",
  "after",
  "before",
  "when",
  "while",
  "also",
  "very",
  "more",
  "most",
  "such",
]);

const NEGATIVE_CONTRACTIONS: Array<[RegExp, string]> = [
  [/\bisn['\u2019]?t\b/gu, " is not "],
  [/\bwasn['\u2019]?t\b/gu, " was not "],
  [/\bweren['\u2019]?t\b/gu, " were not "],
  [/\bdoesn['\u2019]?t\b/gu, " does not "],
  [/\bdon['\u2019]?t\b/gu, " do not "],
  [/\bdidn['\u2019]?t\b/gu, " did not "],
  [/\bhasn['\u2019]?t\b/gu, " has not "],
  [/\bhaven['\u2019]?t\b/gu, " have not "],
  [/\bhadn['\u2019]?t\b/gu, " had not "],
  [/\bcan['\u2019]?t\b/gu, " can not "],
  [/\bcannot\b/gu, " can not "],
  [/\bcouldn['\u2019]?t\b/gu, " could not "],
  [/\bwouldn['\u2019]?t\b/gu, " would not "],
  [/\bshouldn['\u2019]?t\b/gu, " should not "],
  [/\bwon['\u2019]?t\b/gu, " will not "],
  [/\bain['\u2019]?t\b/gu, " is not "],
];

/**
 * Number words with exact, tested equivalences.
 *
 * `two students` and `2 students` are the same fact. Nothing approximate lives
 * here — no "a couple of", no "dozen", no ranges. Scales compose
 * (`fifty thousand` → `50000`), which is the one composition the corpus needs.
 */
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};

const SCALE_WORDS: Record<string, number> = {
  hundred: 100,
  thousand: 1000,
  million: 1_000_000,
  billion: 1_000_000_000,
};

const NEGATION_TOKENS = new Set(["not", "never", "no", "without", "none", "neither", "nor"]);
/** Tokens that end a clause: a negation on the other side of one is not local. */
/** v4: the sentence boundary the evaluator inserts between sentences of an answer-scoped unit. Never skipped inside a phrase. */
export const SENTENCE_BOUNDARY = ".";
const CLAUSE_BOUNDARIES = new Set([SENTENCE_BOUNDARY, ",", ";", "but", "however", "though", "although", "yet", "whereas"]);

export function normalizeText(raw: string): string {
  // Collapse digit-grouping separators on the RAW text: NFKC folds U+00A0 and
  // U+202F into a plain space, and a plain space must keep separating words
  // (`in 1998 500 people` is two numbers, not one).
  let text = (raw ?? "").replace(/(?<=\d)[,\u00a0\u202f\u2009](?=\d)/gu, "").normalize("NFKC").toLowerCase();
  text = text.replace(/[\u2018\u2019\u02bc`´]/gu, "'");
  for (const [pattern, replacement] of NEGATIVE_CONTRACTIONS) text = text.replace(pattern, replacement);
  // Commas and semicolons stay in the stream as their own tokens: they are the
  // clause boundaries a negation window must stop at ("did not close, it
  // expanded" negates `close`, not `expanded"). Everything else is a separator.
  text = text.replace(/[,;]/gu, " $& ");
  text = text.replace(/[^\p{L}\p{N}'\s,;]/gu, " ");
  return text.replace(/\s+/gu, " ").trim();
}

/** Tokens that carry clause structure rather than meaning. */
export const BOUNDARY_TOKENS = new Set([",", ";"]);

/**
 * Normalise, then canonicalise number words and drop function words, producing
 * the token sequence both the learner's answer and the author's alternatives are
 * compared through.
 */
export function tokens(raw: string): string[] {
  const normalized = normalizeText(raw);
  if (!normalized) return [];
  const rawTokens = normalized.split(" ").filter(Boolean);
  const withNumbers = applyNumberWords(rawTokens);
  return withNumbers.filter((token) => !FUNCTION_WORDS.has(token));
}

function applyNumberWords(input: string[]): string[] {
  const out: string[] = [];
  for (let index = 0; index < input.length; index += 1) {
    const token = input[index]!;
    const value = NUMBER_WORDS[token] ?? (SCALE_WORDS[token] !== undefined ? SCALE_WORDS[token] : undefined);
    if (value === undefined) {
      // Digits with grouping separators are already gone (punctuation became a
      // space); a bare digit run stays as it is.
      out.push(token);
      continue;
    }

    let total = value;
    let consumed = 1;
    // "fifty thousand", "two hundred thousand": a value followed by scales.
    while (index + consumed < input.length) {
      const next = input[index + consumed]!;
      const scale = SCALE_WORDS[next];
      if (scale === undefined) break;
      total = total * scale;
      consumed += 1;
    }
    out.push(String(total));
    index += consumed - 1;
  }
  return out;
}

/**
 * Sentences / clauses: the evidence units for a `sentence`-scoped claim.
 *
 * Split on terminal punctuation and newlines. The normalised text has already
 * had most punctuation replaced by spaces, so this runs on the *normalised*
 * string where `.`, `!`, `?` and `;` are gone — which is why splitting happens
 * on raw text first, then each piece is tokenised.
 */
export function splitEvidenceUnits(raw: string): string[] {
  // Honorifics are part of a person's name, not sentence boundaries.
  // Splitting "Dr. Pavel Orlov" into "Dr" and "Pavel Orlov" loses the
  // actor's evidence in an otherwise correct sentence-scoped recall.
  const text = (raw ?? "").normalize("NFKC")
    .replace(/\b(Dr|Mr|Mrs|Ms|Prof)\.(?=\s+\p{L})/giu, "$1");
  const units = text
    // v4: a decimal point ("1.27 million") is not a sentence end.
    .split(/(?:(?<!\d)\.|\.(?!\d)|[!?\n\r])+|;/u)
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0);
  return units.length > 0 ? units : [];
}

export function unitTokens(raw: string): string[] {
  return tokens(raw);
}

/** Levenshtein distance with an early exit once `limit` is exceeded. */
export function levenshtein(a: string, b: string, limit: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  const previous = new Array<number>(b.length + 1);
  const current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    let rowMin = current[0]!;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
      if (current[j]! < rowMin) rowMin = current[j]!;
    }
    if (rowMin > limit) return limit + 1;
    for (let j = 0; j <= b.length; j += 1) previous[j] = current[j]!;
  }
  return previous[b.length]!;
}

/**
 * The EXACT safe typo rule (owner contract §30).
 *
 *   expected token length <= 4  → no fuzzy match
 *   expected token length 5–8   → at most 1 edit
 *   expected token length >= 9  → at most 2 edits
 *
 * Both tokens must be at least 5 characters and must contain at least one
 * letter (digits never fuzz). The length that decides the budget is the
 * AUTHOR's token — the alternative in `anyOf` — so the tolerance is a property
 * of the authored rubric, not of whatever the learner typed.
 */
export function fuzzyTokenMatches(expected: string, actual: string): boolean {
  if (expected === actual) return true;
  if (expected.length < 5 || actual.length < 5) return false;
  if (!/\p{L}/u.test(expected) || !/\p{L}/u.test(actual)) return false;
  const limit = expected.length >= 9 ? 2 : 1;
  return levenshtein(expected, actual, limit) <= limit;
}

/**
 * Match `needle` starting at `start`, stepping over clause punctuation.
 *
 * The comma in "the company, was founded" is structure, not content, so a phrase
 * matches across it — while `not` is content and never skipped.
 */
function exactAt(haystack: string[], needle: string[], start: number): boolean {
  let cursor = start;
  for (const expected of needle) {
    while (cursor < haystack.length && BOUNDARY_TOKENS.has(haystack[cursor]!)) cursor += 1;
    if (cursor >= haystack.length || haystack[cursor] !== expected) return false;
    cursor += 1;
  }
  return true;
}

function fuzzyAt(haystack: string[], needle: string[], start: number): boolean {
  let cursor = start;
  let differences = 0;
  for (const expected of needle) {
    while (cursor < haystack.length && BOUNDARY_TOKENS.has(haystack[cursor]!)) cursor += 1;
    if (cursor >= haystack.length) return false;
    const actual = haystack[cursor]!;
    if (actual !== expected) {
      differences += 1;
      if (differences > 1 || !fuzzyTokenMatches(expected, actual)) return false;
    }
    cursor += 1;
  }
  return true;
}

/**
 * Find `needle` inside `haystack` as a contiguous token sequence.
 *
 * Returns the index of the first token, or -1. `fuzzy` is only ever enabled for
 * `kind: "concept"` groups that are not `critical`: an entity, a number or a date
 * is matched exactly, so `1989` can never satisfy `1998`.
 *
 * Multi-word phrases are kept conservative: at most ONE token may differ, every
 * other token must be exact, and the differing token must pass the safe typo
 * rule. One approximate token can therefore never turn an unrelated phrase into
 * a full semantic match.
 */
export function findPhrase(haystack: string[], needle: string[], fuzzy = false): number {
  if (needle.length === 0 || haystack.length === 0) return -1;

  for (let start = 0; start < haystack.length; start += 1) {
    if (BOUNDARY_TOKENS.has(haystack[start]!)) continue;
    if (exactAt(haystack, needle, start)) return start;
  }
  if (!fuzzy) return -1;

  for (let start = 0; start < haystack.length; start += 1) {
    if (BOUNDARY_TOKENS.has(haystack[start]!)) continue;
    if (fuzzyAt(haystack, needle, start)) return start;
  }
  return -1;
}

/**
 * Every start index of `needle` in `haystack` (v4). Exact matches first, then —
 * only when `fuzzy` — the conservative typo matches. The evaluator uses this so a
 * negated EARLY mention ("there was no garden… later they bought a garden") can
 * no longer hide a later, affirmative one.
 */
export function findPhraseAll(haystack: string[], needle: string[], fuzzy = false): number[] {
  const out: number[] = [];
  if (needle.length === 0 || haystack.length === 0) return out;
  for (let start = 0; start < haystack.length; start += 1) {
    if (BOUNDARY_TOKENS.has(haystack[start]!)) continue;
    if (exactAt(haystack, needle, start)) out.push(start);
  }
  if (!fuzzy) return out;
  for (let start = 0; start < haystack.length; start += 1) {
    if (BOUNDARY_TOKENS.has(haystack[start]!)) continue;
    if (!out.includes(start) && fuzzyAt(haystack, needle, start)) out.push(start);
  }
  return out;
}

/**
 * Is the match at `index` directly negated?
 *
 * A small, local window (three tokens), stopped by a clause boundary, so
 * "The company did not close; it expanded" does not negate `expanded`, and
 * "The company grew, but not in 1998" does not award the date. Everything the
 * window cannot decide is left to the author's `rejectPhrases`.
 */
export function isNegated(unit: string[], index: number): boolean {
  for (let cursor = index - 1; cursor >= 0 && cursor >= index - 3; cursor -= 1) {
    const token = unit[cursor]!;
    if (CLAUSE_BOUNDARIES.has(token)) return false;
    if (token === "not" && unit[cursor + 1] === "only") continue;
    if (NEGATION_TOKENS.has(token)) return true;
  }
  return false;
}

/** Numeric tokens present in a unit, as strings — `50000`, `1998`, `2`. */
export function numericTokens(unit: string[]): string[] {
  return unit.filter((token) => /^\d+$/u.test(token));
}
