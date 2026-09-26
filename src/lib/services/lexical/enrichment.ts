import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes } from "@/db/schema";

/**
 * LexicalEnrichmentService — the ONE way a word gets a meaning.
 *
 * The platform keeps two things apart on purpose:
 *
 *   global lexical data  →  `lexemes`: spelling, part of speech, definition,
 *                           Uzbek gloss, example, collocations. One catalogue row
 *                           per *sense*, shared by every student.
 *   student learning state → `user_vocabulary`: SRS stage, mastery, counts,
 *                           folder, source. Belongs to one student only.
 *
 * This service answers the first question ("what does this word mean?") and the
 * answer can come from two kinds of place:
 *
 *   1. **The centre's own catalogue** — authored words, topic packs, words a
 *      teacher added. This is the source of record and it is what students see.
 *   2. **A dictionary adapter** — a 60k-entry dictionary, a licensed word list,
 *      an API. None is installed today: the registry below starts empty, which is
 *      the honest state, and `listLexicalSources()` says so.
 *
 * What the service refuses to do:
 *
 *   - invent a definition. If no source knows the word it returns `null`, and the
 *     caller has to ask a human. A fabricated meaning silently teaches the wrong
 *     thing, which is worse than an empty field.
 *   - let a broken adapter break a lookup: an adapter that throws is skipped, and
 *     the next source is asked.
 *   - let one adapter shadow the catalogue: the catalogue always answers first,
 *     so a dictionary can never overwrite a word the centre has authored.
 *
 * Adding the real dictionary later is one file and one registration — see
 * `registerLexicalSource`. No caller changes, no new table, no duplicated paths.
 */

export type LexicalEntry = {
  term: string;
  partOfSpeech: string | null;
  definitionEn: string;
  translationUz: string | null;
  exampleSentence: string | null;
  collocations: string | null;
  acceptedTranslations: string[];
  /** Where the meaning came from: `catalogue` or an adapter id. */
  source: string;
  /** Human label for that source, so provenance can be shown rather than guessed. */
  sourceLabel: string;
};

/** What an adapter returns — the same shape, minus the provenance the service sets. */
export type LexicalEntryDraft = Omit<LexicalEntry, "source" | "sourceLabel">;

export type LexicalSource = {
  id: string;
  label: string;
  /**
   * False when the deployment has not been given credentials or data for this
   * source. A disabled source is never queried and never counted as available.
   */
  isEnabled(): boolean;
  /** The word, or null when this source does not know it. Must not invent one. */
  lookup(term: string): Promise<LexicalEntryDraft | null>;
};

const adapters: LexicalSource[] = [];

/** Registers an adapter. Registering the same id twice is a no-op. */
export function registerLexicalSource(source: LexicalSource): void {
  if (adapters.some((existing) => existing.id === source.id)) return;
  adapters.push(source);
}

/** What is actually available right now — used by the interface to be honest. */
export function listLexicalSources(): { id: string; label: string; enabled: boolean }[] {
  return adapters.map((adapter) => ({ id: adapter.id, label: adapter.label, enabled: adapter.isEnabled() }));
}

/** True when a dictionary adapter (not the catalogue) could answer a lookup. */
export function hasDictionaryAdapter(): boolean {
  return adapters.some((adapter) => adapter.isEnabled());
}

function normalise(term: string): string {
  return term.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * The first enabled source that knows the word, in registration order.
 *
 * Exported on its own because it is the part worth testing: it holds the rules
 * (skip disabled, skip failures, never accept an empty definition) without
 * needing a database.
 */
export async function resolveFromSources(term: string, sources: LexicalSource[]): Promise<LexicalEntry | null> {
  const wanted = normalise(term);
  if (!wanted) return null;

  for (const source of sources) {
    if (!source.isEnabled()) continue;
    let found: LexicalEntryDraft | null = null;
    try {
      found = await source.lookup(term.trim());
    } catch {
      // An unreachable dictionary is not a definition. Try the next source.
      continue;
    }
    if (!found) continue;
    // An entry without a meaning is not an entry.
    if (!found.definitionEn || found.definitionEn.trim().length === 0) continue;
    return {
      ...found,
      definitionEn: found.definitionEn.trim(),
      source: source.id,
      sourceLabel: source.label,
    };
  }
  return null;
}

/** The centre's own catalogue row for a spelling, or null. */
async function lookupCatalogue(term: string): Promise<LexicalEntry | null> {
  const wanted = normalise(term);
  if (!wanted) return null;
  const row = await db.query.lexemes.findFirst({ where: eq(lexemes.term, wanted) });
  if (!row) return null;
  return {
    term: row.term,
    partOfSpeech: row.partOfSpeech,
    definitionEn: row.definitionEn,
    translationUz: row.translationUz,
    exampleSentence: row.exampleSentence,
    collocations: row.collocations,
    acceptedTranslations: row.acceptedTranslations ?? [],
    source: "catalogue",
    sourceLabel: "Learners Area catalogue",
  };
}

/**
 * Enriches ONE term: the centre's catalogue first, then the adapters.
 *
 * Returns null when nobody knows the word. That null is the whole point — it is
 * the difference between "we do not know this yet" and a made-up definition.
 */
export async function enrichTerm(term: string): Promise<LexicalEntry | null> {
  const fromCatalogue = await lookupCatalogue(term);
  if (fromCatalogue) return fromCatalogue;
  return resolveFromSources(term, adapters);
}

/**
 * Enriches a batch, preserving the caller's order in `entries`.
 *
 * The unresolved list is as important as the resolved one: it is what the caller
 * shows a human instead of filling in a guess.
 */
export async function enrichTerms(
  terms: string[]
): Promise<{ entries: Map<string, LexicalEntry>; unresolved: string[] }> {
  const entries = new Map<string, LexicalEntry>();
  const unresolved: string[] = [];
  for (const term of terms) {
    const entry = await enrichTerm(term);
    if (entry) entries.set(term, entry);
    else unresolved.push(term);
  }
  return { entries, unresolved };
}
