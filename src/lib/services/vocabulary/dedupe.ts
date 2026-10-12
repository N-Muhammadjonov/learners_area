import { createHash } from "node:crypto";
import { foldApostrophes, partOfSpeechNorm } from "@/lib/text/lexical-normalize";

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
  return foldApostrophes(term.toLowerCase())
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(a|an|the)\s+/, "")
    .trim();
}

/** Exact aliases only; noun phrase and verb phrase are not plain nouns/verbs. */
export function normalizePartOfSpeech(part: string | null | undefined): string {
  return partOfSpeechNorm(part);
}

/** Preserve the full sense; only typography, whitespace and final full stop differ. */
export function normalizeMeaning(meaning: string | null | undefined): string {
  return (meaning ?? "").normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim().replace(/\.$/, "").trim();
}

/** New identities are bounded without truncating semantic information. Existing
 * rows keep their keys; the engine resolves equivalent legacy rows before insert.
 */
export function senseKeyOf(input: { term: string; partOfSpeech?: string | null; meaning?: string | null }): string {
  const identity = [normalizeTerm(input.term), normalizePartOfSpeech(input.partOfSpeech), normalizeMeaning(input.meaning)];
  return `v2:${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}`;
}

/** Frozen import/seed compatibility only. Never use this coarse key alone to
 * accept an existing sense: compare the full normalized definition and POS.
 */
/** A coarse part-of-speech bucket, so "(noun)" and "n." are the same sense. */
function legacyPartOfSpeech(part: string | null | undefined): string {
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
function legacyMeaning(meaning: string | null | undefined): string {
  if (!meaning) return "";
  return meaning
    .toLowerCase()
    .split(/[;,.(\n]/)[0] ?? meaning
    .replace(/\s+/g, " ")
    .replace(/[^a-z0-9' -]/g, "")
    .trim()
    .slice(0, 60);
}

export function legacySenseKeyOf(input: {
  term: string;
  partOfSpeech?: string | null;
  meaning?: string | null;
}): string {
  const parts = [normalizeTerm(input.term), legacyPartOfSpeech(input.partOfSpeech)];
  const meaning = legacyMeaning(input.meaning);
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
