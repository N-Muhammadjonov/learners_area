import "server-only";
import { canonicalDictionaryStatus } from "./dictionary-status";
export { canonicalDictionaryStatus } from "./dictionary-status";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexemes, listeningAttempts, readingAttempts } from "@/db/schema";
import { lookupCatalogue } from "@/lib/services/lexical/enrichment";
import { lexicalDetailFor, resolveOccurrence } from "@/lib/services/lexical/context";
import type { Role } from "@/lib/auth/roles";
import type { VocabularySourceSnapshot } from "@/lib/services/lexical/context";

export type DictionaryActor = { id: string; role: Role };
export type DictionaryLookup =
  | { status: "locked" }
  | { status: "unresolved" }
  | { status: "resolved"; canonicalLexemeId: string; senseId: string; term: string; definitionEn: string; translationUz: string | null; partOfSpeech: string | null; lexicalType: string | null; example: string | null; collocations: string | null; source: string; verified: boolean; pronunciation: string | null; occurrence: VocabularySourceSnapshot | null };

/** Fail closed during any active Academic Reading or full Listening attempt. */
export async function hasOpenExam(actor: DictionaryActor, database: Pick<typeof db, "select"> = db): Promise<boolean> {
  if (actor.role !== "student") return false;
  const [reading] = await database.select({ id: readingAttempts.id }).from(readingAttempts)
    .where(and(eq(readingAttempts.userId, actor.id), eq(readingAttempts.status, "in_progress"))).limit(1);
  if (reading) return true;
  const [listening] = await database.select({ id: listeningAttempts.id }).from(listeningAttempts)
    .where(and(eq(listeningAttempts.userId, actor.id), eq(listeningAttempts.status, "in_progress"))).limit(1);
  return Boolean(listening);
}

export async function lookupCanonicalDictionary(term: string, actor: DictionaryActor, database: typeof db = db): Promise<DictionaryLookup> {
  if (await hasOpenExam(actor, database)) return { status: "locked" };
  const safeTerm = term.trim().slice(0, 120);
  if (!safeTerm) return { status: "unresolved" };
  const entry = await lookupCatalogue(safeTerm, database);
  if (canonicalDictionaryStatus(entry) === "unresolved") return { status: "unresolved" };
  if (!entry) return { status: "unresolved" };
  const lexical = entry.canonicalLexemeId
    ? await database.query.lexemes.findFirst({ where: eq(lexemes.id, entry.canonicalLexemeId) })
    : null;
  const details = lexical ? await lexicalDetailFor(lexical, database) : null;
  return {
    status: "resolved", canonicalLexemeId: entry.canonicalLexemeId!, senseId: entry.canonicalLexemeId!,
    term: entry.term, definitionEn: entry.definitionEn,
    translationUz: entry.translationUz, partOfSpeech: entry.partOfSpeech,
    lexicalType: details?.lexicalType ?? null,
    example: entry.exampleSentence, collocations: entry.collocations,
    source: entry.sourceLabel,
    verified: lexical?.verificationStatus === "verified",
    pronunciation: details?.ipa ?? null,
    occurrence: null,
  };
}

/** Exact source-aware dictionary lookup; the occurrence, sense, and exam state are all resolved afresh. */
export async function lookupDictionaryOccurrence(input: {
  actor: DictionaryActor;
  sourceType: "reading" | "listening";
  sourceId: string;
  occurrenceId: string;
  term?: string | null;
}, database: typeof db = db): Promise<DictionaryLookup> {
  const resolved = await resolveDictionaryOccurrence({
    actor: input.actor, sourceType: input.sourceType, sourceId: input.sourceId, occurrenceId: input.occurrenceId,
  }, database);
  if (!resolved || resolved.status === "unresolved") return { status: "unresolved" };
  if (resolved.status === "locked") return { status: "locked" };
  const expected = input.term?.trim().normalize("NFKC").toLocaleLowerCase();
  const actual = resolved.snapshot.surfaceForm.trim().normalize("NFKC").toLocaleLowerCase();
  const lemma = resolved.lexeme.term.trim().normalize("NFKC").toLocaleLowerCase();
  if (expected && expected !== actual && expected !== lemma) return { status: "unresolved" };
  const details = await lexicalDetailFor(resolved.lexeme, database);
  return {
    status: "resolved", canonicalLexemeId: resolved.lexeme.id, senseId: resolved.lexeme.id,
    term: resolved.lexeme.term, definitionEn: resolved.lexeme.definitionEn,
    translationUz: resolved.lexeme.translationUz, partOfSpeech: resolved.lexeme.partOfSpeech,
    lexicalType: details?.lexicalType ?? null,
    example: resolved.lexeme.exampleSentence, collocations: resolved.lexeme.collocations,
    source: resolved.snapshot.sourceTitle, verified: resolved.lexeme.verificationStatus === "verified",
    pronunciation: details?.ipa ?? null, occurrence: resolved.snapshot,
  };
}

export function extractDictionaryTerm(message: string): string | null {
  const text = message.trim().replace(/[\u201c\u201d]/g, '"').replace(/[\u2018\u2019]/g, "'");
  const patterns = [
    // Uzbek: resilient so'zining ma'nosi nima? / resilient tarjimasi?
    /^(.{1,120}?)\s+so'z(?:ning|ining|i)?\s+(?:ma'nosi|tarjimasi|nimani anglatadi)\b/i,
    /^(.{1,120}?)\s+(?:ma'nosi|tarjimasi)(?:\s+(?:nima|qanday))?\s*[?!.]?$/i,
    // Russian: Что значит resilient? / значение слова resilient
    /что\s+(?:значит|означает)\s+['"]?([\p{L}\p{N}][\p{L}\p{N}\s'-]{0,118})/iu,
    /значение\s+(?:слова|выражения)\s+['"]?([\p{L}\p{N}][\p{L}\p{N}\s'-]{0,118})/iu,
    /\bmeaning\s+of\s+['"]?([^?'".,;]{1,120})/i,
    /\bdefinition\s+of\s+['"]?([^?'".,;]{1,120})/i,
    /\bdefine\s+['"]?([^?'".,;]{1,120})/i,
    /\btranslate\s+['"]?([^?'".,;]{1,120})/i,
    /\bwhat\s+does\s+['"]?([^?'".,;]{1,120}?)['"]?\s+mean\b/i,
    /\b(?:word|phrase)\s+['"]([^'"]{1,120})['"]/i,
  ];
  const genericWords = new Set(["bu", "ushbu", "shu", "this", "that", "word", "слово", "это слово"]);
  for (const pattern of patterns) {
    const value = text.match(pattern)?.[1]?.trim().replace(/^['"]|['"]$/g, "").replace(/[?!.;,]+$/, "").trim();
    const normalized = value?.toLocaleLowerCase();
    const genericPhrase = value ? /^(?:bu|ushbu|shu)\s+so'z(?:ning|ining|i)?$/i.test(value) : false;
    if (value && !genericWords.has(normalized ?? "") && !genericPhrase) return value.slice(0, 120);
  }
  return null;
}

export async function resolveDictionaryOccurrence(input: {
  actor: DictionaryActor;
  sourceType: "reading" | "listening";
  sourceId: string;
  occurrenceId: string;
}, database: typeof db = db) {
  return resolveOccurrence(input.actor, input.sourceType, input.sourceId, input.occurrenceId, database);
}

export function formatDictionaryAnswer(entry: Extract<DictionaryLookup, { status: "resolved" }>, locale: "en" | "uz") {
  const facts = [
    `${entry.term}${entry.partOfSpeech ? ` (${entry.partOfSpeech})` : ""}: ${entry.definitionEn}`,
    entry.lexicalType ? `Lexical type: ${entry.lexicalType}.` : null,
    entry.translationUz ? `Uzbek: ${entry.translationUz}` : null,
    entry.collocations ? `Collocations: ${entry.collocations}` : null,
    entry.example ? `Example: ${entry.example}` : null,
    entry.occurrence
      ? `Occurrence: “${entry.occurrence.surfaceForm}” in “${entry.occurrence.sentenceText}” — ${entry.occurrence.sourceTitle}.`
      : null,
  ].filter((item): item is string => Boolean(item));
  return {
    answer: facts.join("\n"),
    uncertainty: entry.verified ? null : locale === "uz"
      ? "Bu lug'at yozuvi hali tekshirilmagan; uni yakuniy manba sifatida qabul qilmang."
      : "This catalogue entry has not been verified; do not treat it as authoritative.",
  };
}
