import { countWords, splitParagraphs, splitSentences } from "@/lib/services/writing-evaluation/heuristics";

/**
 * RIWI's text signal library.
 *
 * Pure functions only — no network, no database, no `server-only` marker — so
 * the same code runs in a unit test, in a route handler, and (for the word
 * counter) in the editor.
 *
 * Every detector here is a *pattern* detector. RIWI states what it measured;
 * it never claims grammatical understanding it does not have. Where a signal
 * is a proxy, the caller is told so through `confidence` and through
 * `limited` criteria rather than a confident-sounding band.
 */

export type DetectedIssue = {
  category:
    | "GRAMMAR_ARTICLE"
    | "GRAMMAR_SVA"
    | "GRAMMAR_TENSE"
    | "GRAMMAR_PREPOSITION"
    | "GRAMMAR_FRAGMENT"
    | "GRAMMAR_PUNCTUATION";
  message: string;
  excerpt: string;
  suggestion: string;
  severity: "low" | "medium" | "high";
};

export type WordCount = { word: string; count: number };

const STOP_WORDS = new Set([
  "the", "a", "an", "and", "or", "but", "if", "of", "to", "in", "on", "at", "for", "with", "as",
  "is", "are", "was", "were", "be", "been", "being", "am", "do", "does", "did", "has", "have",
  "had", "it", "its", "this", "that", "these", "those", "i", "you", "he", "she", "we", "they",
  "my", "your", "his", "her", "our", "their", "there", "here", "so", "than", "then", "also",
  "not", "no", "will", "would", "can", "could", "should", "may", "might", "must", "from", "by",
  "about", "into", "over", "more", "most", "some", "any", "all", "one", "two", "many", "much",
]);

/** Words whose first letter is a vowel letter but whose first *sound* is a consonant. */
const A_CONSONANT_SOUND = [
  "university", "universities", "user", "users", "unique", "unit", "units", "union", "united",
  "uniform", "unicorn", "usual", "usually", "useful", "used", "using", "european", "one", "once",
  "uk", "us", "usa", "un", "eu", "uturn",
];

/** Words whose first letter is a consonant but whose first *sound* is a vowel. */
const AN_VOWEL_SOUND = [
  "hour", "hours", "honest", "honestly", "honour", "honor", "heir", "x", "mp", "mba", "ngo",
  "sms", "fbi", "led", "lcd", "hiv", "ipod", "apple",
];

const LINKING_PHRASES = [
  "however", "moreover", "therefore", "furthermore", "consequently", "in contrast",
  "on the other hand", "for example", "for instance", "in conclusion", "to conclude",
  "to sum up", "in addition", "as a result", "nevertheless", "although", "whereas", "despite",
  "firstly", "secondly", "thirdly", "finally", "overall", "in general", "because", "while",
];

const DISCOURSE_MARKERS = [
  "first of all", "firstly", "secondly", "to begin with", "on the other hand", "in addition",
  "for example", "for instance", "as a result", "in conclusion", "to sum up", "overall",
  "in general", "however", "therefore", "because", "so that", "such as",
];

/** Unambiguous hesitation sounds. Nothing else is ever counted as a filler. */
const HESITATION_FILLERS = ["um", "uh", "erm", "er", "ah", "hmm", "mmm", "eh"];

/**
 * Vague/overused spoken phrases. Reported separately from hesitation sounds
 * because each of these is legitimate English in the right place.
 */
const VAGUE_SPOKEN_PHRASES = ["you know", "i mean", "kind of", "sort of", "like i said", "basically", "actually"];

/** Wrong-preposition patterns that are genuinely detectable as strings. */
const PREPOSITION_FIXES: [string, string, string][] = [
  ["discuss about", "discuss", "discuss takes no preposition"],
  ["depend of", "depend on", "the verb depend takes on"],
  ["depends of", "depends on", "the verb depend takes on"],
  ["married with", "married to", "people are married to someone"],
  ["arrive to", "arrive at", "arrive takes at or in"],
  ["interested for", "interested in", "interested in something"],
  ["afraid from", "afraid of", "afraid of something"],
  ["consist in", "consist of", "consist of parts"],
  ["explain about", "explain", "explain takes a direct object"],
  ["good in ", "good at ", "good at a skill"],
  ["in the last years", "in recent years", "in recent years"],
];

export type TextSignals = {
  text: string;
  lower: string;
  charCount: number;
  wordCount: number;
  words: string[];
  contentWords: string[];
  sentenceCount: number;
  sentences: string[];
  paragraphs: string[];
  avgSentenceWords: number;
  sentenceLengthStdDev: number;
  longSentences: string[];
  shortSentences: string[];
  lexicalDiversity: number;
  typeTokenRatioOnContentWords: number;
  topRepeatedContentWords: WordCount[];
  linkers: WordCount[];
  linkerOccurrences: number;
  uniqueLinkers: number;
  linkersPer100Words: number;
  discourseMarkers: string[];
  hesitationCount: number;
  hesitationRate: number;
  vaguePhraseCount: number;
  repeatedBigrams: WordCount[];
  issues: DetectedIssue[];
  punctuationIssues: DetectedIssue[];
};

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function trimmedExcerpt(sentence: string, max = 200): string {
  const clean = sentence.trim().replace(/\s+/g, " ");
  if (clean.length <= max) return clean;
  // An evidence excerpt is a quote, not display copy: keep a verbatim prefix
  // (prefer a word boundary) and never append an ellipsis absent from the source.
  const boundary = clean.lastIndexOf(" ", max);
  return clean.slice(0, boundary > 0 ? boundary : max).trimEnd();
}

function sentenceContaining(text: string, index: number): string {
  const sentences = splitSentences(text);
  let cursor = 0;
  for (const sentence of sentences) {
    const start = text.indexOf(sentence, cursor);
    if (start === -1) continue;
    cursor = start + sentence.length;
    if (index >= start && index < cursor) return sentence;
  }
  return "";
}

function matchAll(pattern: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push(match);
    if (match.index === re.lastIndex) re.lastIndex += 1;
  }
  return out;
}

export function findArticleIssues(text: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];

  for (const match of matchAll(/\ba\s+([a-z][a-z'-]*)/gi, text)) {
    const word = (match[1] ?? "").toLowerCase();
    if (!word) continue;
    if (A_CONSONANT_SOUND.includes(word)) continue;
    if (!/^[aeiou]/.test(word)) continue;
    issues.push({
      category: "GRAMMAR_ARTICLE",
      message: `"a" before a vowel sound: "${match[0]}"`,
      excerpt: trimmedExcerpt(sentenceContaining(text, match.index)),
      suggestion: `Use "an ${word}".`,
      severity: "medium",
    });
  }

  for (const match of matchAll(/\ban\s+([a-z][a-z'-]*)/gi, text)) {
    const word = (match[1] ?? "").toLowerCase();
    if (!word) continue;
    if (AN_VOWEL_SOUND.includes(word)) continue;
    if (/^[aeiou]/.test(word)) continue;
    // A single capital letter or initialism takes "an" by sound.
    const raw = match[1] ?? "";
    if (/^[A-Z]{1,4}$/.test(raw)) continue;
    issues.push({
      category: "GRAMMAR_ARTICLE",
      message: `"an" before a consonant sound: "${match[0]}"`,
      excerpt: trimmedExcerpt(sentenceContaining(text, match.index)),
      suggestion: `Use "a ${word}".`,
      severity: "medium",
    });
  }

  return issues.slice(0, 6);
}

export function findSubjectVerbIssues(text: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(he|she|it)\s+(have|do|were|are)\b/gi, "third-person singular subject needs has / does / was / is"],
    [/\b(they|we|you)\s+(has|does|is|was)\b/gi, "plural subject needs have / do / are / were"],
    [/\bI\s+(has|is|are|were|does)\b/gi, "I takes have / am / was / do"],
    [/\b(each|every|everyone|everybody|nobody|somebody|someone|either|neither)\s+(are|were|have|do)\b/gi, "singular indefinite subject takes a singular verb"],
    [/\bthere\s+(is|was)\s+(many|several|two|three|four|five|both|few|numerous)\b/gi, "a plural quantity needs there are / there were"],
  ];

  for (const [pattern, explanation] of patterns) {
    for (const match of matchAll(pattern, text)) {
      issues.push({
        category: "GRAMMAR_SVA",
        message: `Subject–verb agreement: "${match[0].trim()}"`,
        excerpt: trimmedExcerpt(sentenceContaining(text, match.index)),
        suggestion: explanation,
        severity: "high",
      });
    }
  }

  return issues.slice(0, 6);
}

export function findTenseIssues(text: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const patterns: [RegExp, string][] = [
    [/\b(did not|didn't)\s+(\w+ed|went|saw|took|made|wrote|came|gave)\b/gi, "after did, use the base form"],
    [/\b(does not|doesn't|do not|don't)\s+(\w+s)\b/gi, "after do / does, use the base form"],
    [/\bwill\s+(\w+ed|went|saw|took|made)\b/gi, "after will, use the base form"],
    [/\b(have|has)\s+(go|see|take|write|be|do|make)\b/gi, "after have / has, use the past participle"],
    [/\bhad\s+(go|see|take|write|be|do|make)\b/gi, "after had, use the past participle"],
    [/\b(was|were)\s+(go|see|take|write|make|be)\b/gi, "after was / were, use the -ing form or a participle"],
    [/\bsince\s+\d{4}\s+.*\b(is|are|was)\b/gi, "with since, the present perfect fits better than a simple tense"],
  ];

  for (const [pattern, explanation] of patterns) {
    for (const match of matchAll(pattern, text)) {
      issues.push({
        category: "GRAMMAR_TENSE",
        message: `Tense pattern: "${match[0].trim()}"`,
        excerpt: trimmedExcerpt(sentenceContaining(text, match.index)),
        suggestion: explanation,
        severity: "high",
      });
    }
  }

  return issues.slice(0, 6);
}

export function findPrepositionIssues(text: string): DetectedIssue[] {
  const lower = text.toLowerCase();
  const issues: DetectedIssue[] = [];
  for (const [wrong, right, explanation] of PREPOSITION_FIXES) {
    const index = lower.indexOf(wrong);
    if (index === -1) continue;
    issues.push({
      category: "GRAMMAR_PREPOSITION",
      message: `Preposition pattern: "${wrong.trim()}"`,
      excerpt: trimmedExcerpt(sentenceContaining(text, index), 160),
      suggestion: `${explanation} — try "${right.trim()}".`,
      severity: "medium",
    });
  }
  return issues.slice(0, 5);
}

const FINITE_VERB_HINT =
  /(\b(?:am|is|are|was|were|be|been|being|has|have|had|do|does|did|will|would|can|could|should|must|may|might)\b|\w+(?:ed|ing)\b|\w+s\b)/i;

/** A short sentence with no recognisable finite verb is flagged as a fragment. */
export function findFragments(text: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  for (const sentence of splitSentences(text)) {
    const words = tokenise(sentence);
    if (words.length === 0 || words.length > 5) continue;
    if (FINITE_VERB_HINT.test(sentence)) continue;
    issues.push({
      category: "GRAMMAR_FRAGMENT",
      message: "Possible sentence fragment — no finite verb detected.",
      excerpt: trimmedExcerpt(sentence, 120),
      suggestion: "Give the idea a subject and a finite verb, or join it to the previous sentence.",
      severity: "medium",
    });
  }
  return issues.slice(0, 5);
}

export function findPunctuationIssues(text: string): DetectedIssue[] {
  const issues: DetectedIssue[] = [];
  const sentences = splitSentences(text);
  const unterminated = sentences.filter((s) => !/[.!?]"?\s*$/.test(s.trim()));
  if (unterminated.length > 0) {
    const first = unterminated[0] ?? "";
    issues.push({
      category: "GRAMMAR_PUNCTUATION",
      message: `${unterminated.length} sentence(s) do not end with a full stop, question mark or exclamation mark.`,
      excerpt: trimmedExcerpt(first, 120),
      suggestion: "Terminate every sentence.",
      severity: "low",
    });
  }
  if (/[a-z],[^ ]/i.test(text)) {
    issues.push({
      category: "GRAMMAR_PUNCTUATION",
      message: "Comma without a following space.",
      excerpt: trimmedExcerpt(text.match(/[a-z],[^ ]/i)?.[0] ?? ",", 60),
      suggestion: "Put a space after every comma.",
      severity: "low",
    });
  }
  if (/(!{2,}|\?{2,}|!\?|\?!)/.test(text)) {
    issues.push({
      category: "GRAMMAR_PUNCTUATION",
      message: "Repeated terminal punctuation.",
      excerpt: trimmedExcerpt(text.match(/(!{2,}|\?{2,}|!\?|\?!)/)?.[0] ?? "", 20),
      suggestion: "Academic writing uses a single terminal mark.",
      severity: "low",
    });
  }
  return issues.slice(0, 3);
}

export function analyseText(text: string): TextSignals {
  const words = tokenise(text);
  const sentences = splitSentences(text);
  const paragraphs = splitParagraphs(text);
  const contentWords = words.filter((w) => !STOP_WORDS.has(w) && w.length > 2);

  const sentenceWordCounts = sentences.map((s) => countWords(s));
  const avgSentenceWords =
    sentenceWordCounts.length === 0
      ? 0
      : sentenceWordCounts.reduce((a, b) => a + b, 0) / sentenceWordCounts.length;
  const variance =
    sentenceWordCounts.length === 0
      ? 0
      : sentenceWordCounts.reduce((a, b) => a + (b - avgSentenceWords) ** 2, 0) / sentenceWordCounts.length;

  const uniqueWords = new Set(words);
  const uniqueContent = new Set(contentWords);

  const contentCounts = new Map<string, number>();
  for (const word of contentWords) contentCounts.set(word, (contentCounts.get(word) ?? 0) + 1);

  const topRepeatedContentWords = [...contentCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ word, count }));

  const lower = text.toLowerCase();
  const linkers: WordCount[] = [];
  for (const phrase of LINKING_PHRASES) {
    const pattern = new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "g");
    const occurrences = (lower.match(pattern) ?? []).length;
    if (occurrences > 0) linkers.push({ word: phrase, count: occurrences });
  }
  const linkerOccurrences = linkers.reduce((sum, l) => sum + l.count, 0);

  const discourseMarkers = DISCOURSE_MARKERS.filter((marker) => lower.includes(marker));

  const hesitationMatches = HESITATION_FILLERS.reduce(
    (sum, filler) => sum + (lower.match(new RegExp(`\\b${filler}\\b`, "g")) ?? []).length,
    0
  );
  const vaguePhraseCount = VAGUE_SPOKEN_PHRASES.reduce(
    (sum, phrase) => sum + (lower.match(new RegExp(`\\b${phrase}\\b`, "g")) ?? []).length,
    0
  );

  const bigramCounts = new Map<string, number>();
  for (let i = 0; i < words.length - 2; i += 1) {
    const bigram = `${words[i] ?? ""} ${words[i + 1] ?? ""}`;
    if (STOP_WORDS.has(words[i] ?? "")) continue;
    bigramCounts.set(bigram, (bigramCounts.get(bigram) ?? 0) + 1);
  }
  const repeatedBigrams = [...bigramCounts.entries()]
    .filter(([, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([word, count]) => ({ word, count }));

  return {
    text,
    lower,
    charCount: text.length,
    wordCount: countWords(text),
    words,
    contentWords,
    sentenceCount: sentences.length,
    sentences,
    paragraphs,
    avgSentenceWords,
    sentenceLengthStdDev: Math.sqrt(variance),
    longSentences: sentences.filter((s) => countWords(s) > 35).slice(0, 3),
    shortSentences: sentences.filter((s) => countWords(s) > 0 && countWords(s) < 6).slice(0, 5),
    lexicalDiversity: words.length === 0 ? 0 : uniqueWords.size / words.length,
    typeTokenRatioOnContentWords:
      contentWords.length === 0 ? 0 : uniqueContent.size / contentWords.length,
    topRepeatedContentWords,
    linkers,
    linkerOccurrences,
    uniqueLinkers: linkers.length,
    linkersPer100Words: countWords(text) === 0 ? 0 : (linkerOccurrences / countWords(text)) * 100,
    discourseMarkers,
    hesitationCount: hesitationMatches,
    hesitationRate: countWords(text) === 0 ? 0 : (hesitationMatches / countWords(text)) * 100,
    vaguePhraseCount,
    repeatedBigrams,
    issues: [
      ...findSubjectVerbIssues(text),
      ...findTenseIssues(text),
      ...findArticleIssues(text),
      ...findPrepositionIssues(text),
      ...findFragments(text),
    ],
    punctuationIssues: findPunctuationIssues(text),
  };
}

/** "correct" | "mostly_correct" | "needs_correction" — a verdict, not a band. */
export type Verdict = "correct" | "mostly_correct" | "needs_correction";

export function verdictFromIssues(issues: DetectedIssue[], critical: boolean): Verdict {
  if (critical) return "needs_correction";
  if (issues.length === 0) return "correct";
  const high = issues.some((i) => i.severity === "high");
  return high ? "needs_correction" : "mostly_correct";
}

/** Sentence keeps a capital letter and a terminal mark — a completeness proxy. */
export function looksLikeCompleteSentence(sentence: string): boolean {
  const trimmed = sentence.trim();
  if (countWords(trimmed) < 3) return false;
  if (!/^["'(]?[A-Z]/.test(trimmed)) return false;
  if (!/[.!?]["')]?\s*$/.test(trimmed)) return false;
  return FINITE_VERB_HINT.test(trimmed);
}

/** Cheap inflection-aware containment check: used vs. uses vs. using vs. use. */
export function containsWordForm(sentence: string, target: string): boolean {
  const base = target.toLowerCase().trim();
  if (!base) return false;
  const stem = base.length > 4 && base.endsWith("e") ? base.slice(0, -1) : base;
  const escaped = stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}(s|es|ed|ing|d|ies|ment|tion)?\\b`, "i").test(sentence);
}
