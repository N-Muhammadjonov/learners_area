/**
 * Sense-aware deduplication for the word library.
 *
 * The same spelling can be two different words: "bank" (river) and "bank"
 * (money) are both legitimate entries, and collapsing them would destroy a
 * student's progress on one of them. So the identity of a word is its spelling
 * AND its sense:
 *
 *   senseKey = normalized term + normalized part of speech + normalized meaning
 *
 * "Bank (noun, river edge)" and "bank (noun, financial institution)" therefore
 * coexist, while adding "Bank" again with the same meaning is recognised as a
 * duplicate and does not consume a new-word award.
 *
 * Pure module — unit-tested without a database.
 */

/** Lowercase, trim, collapse whitespace, drop a leading article. */
export function normalizeTerm(term: string): string {
  return term
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the)\s+/, "")
    .trim();
}

/** A coarse part-of-speech bucket, so "(noun)" and "n." are the same sense. */
export function normalizePartOfSpeech(part: string | null | undefined): string {
  if (!part) return "";
  const raw = part.toLowerCase().trim();
  if (/^(n|noun)/.test(raw)) return "noun";
  if (/^(v|verb)/.test(raw)) return "verb";
  if (/^(adj|adjective)/.test(raw)) return "adjective";
  if (/^(adv|adverb)/.test(raw)) return "adverb";
  if (/^(phr|phrase|idiom|expression)/.test(raw)) return "phrase";
  if (/^(prep|preposition)/.test(raw)) return "preposition";
  return raw.replace(/[^a-z]+/g, "").slice(0, 20);
}

/** The first meaning, normalized — enough to separate two senses of one word. */
export function normalizeMeaning(meaning: string | null | undefined): string {
  if (!meaning) return "";
  return meaning
    .toLowerCase()
    .split(/[;,.(\n]/)[0] ?? meaning
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9' -]/g, "")
    .trim()
    .slice(0, 60);
}

/**
 * Build the dedup identity.
 *
 * Meaning is optional: a word added without a definition still deduplicates on
 * spelling + part of speech, which is the best available answer rather than no
 * deduplication at all.
 */
export function senseKeyOf(input: {
  term: string;
  partOfSpeech?: string | null;
  meaning?: string | null;
}): string {
  const parts = [normalizeTerm(input.term), normalizePartOfSpeech(input.partOfSpeech)];
  const meaning = normalizeMeaning(input.meaning);
  if (meaning) parts.push(meaning);
  return parts.filter(Boolean).join("|").slice(0, 200);
}

/** Collapse a bulk submission to unique entries, keeping the first occurrence. */
export function dedupeBulk<T extends { term: string; partOfSpeech?: string | null; meaning?: string | null }>(
  items: T[]
): { unique: T[]; duplicates: T[] } {
  const seen = new Map<string, T>();
  const duplicates: T[] = [];
  for (const item of items) {
    const key = senseKeyOf(item);
    if (seen.has(key)) {
      duplicates.push(item);
      continue;
    }
    seen.set(key, item);
  }
  return { unique: [...seen.values()], duplicates };
}
