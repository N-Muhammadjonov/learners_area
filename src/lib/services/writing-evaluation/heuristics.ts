const LINKING_WORDS = [
  "however",
  "moreover",
  "therefore",
  "furthermore",
  "consequently",
  "in contrast",
  "for example",
  "for instance",
  "in conclusion",
  "overall",
  "although",
  "whereas",
  "despite",
  "on the other hand",
  "firstly",
  "secondly",
  "finally",
  "in addition",
  "as a result",
  "nevertheless",
];

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function averageSentenceLength(text: string): number {
  const sentences = splitSentences(text);
  if (sentences.length === 0) return 0;
  const totalWords = sentences.reduce((sum, s) => sum + countWords(s), 0);
  return totalWords / sentences.length;
}

/** Type-token ratio over a normalised token list — a cheap lexical-variety proxy. */
export function lexicalDiversity(text: string): number {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z\s']/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return 0;
  const unique = new Set(tokens);
  return unique.size / tokens.length;
}

export function linkingWordCount(text: string): number {
  const lower = text.toLowerCase();
  return LINKING_WORDS.reduce((count, word) => count + (lower.includes(word) ? 1 : 0), 0);
}

/** Clamp to the IELTS 4.0–9.0 band scale in 0.5 steps. */
export function toBand(raw: number): number {
  const clamped = Math.min(9, Math.max(4, raw));
  return Math.round(clamped * 2) / 2;
}
