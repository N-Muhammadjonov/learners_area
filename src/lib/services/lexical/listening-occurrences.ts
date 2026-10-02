import { and, eq, or } from "drizzle-orm";
import type { db } from "@/db/client";
import { lexemes, lexicalOccurrences } from "@/db/schema";
import type { ListeningPackage } from "@/lib/listening/package";
import { legacySenseKeyOf, senseKeyOf } from "@/lib/services/vocabulary/dedupe";
import { foldApostrophes, isFunctionWord, normalizeLexical } from "@/lib/text/lexical-normalize";
import { formsOf } from "./forms";
import { linkSenseToUnit } from "./units";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "query">;

export type SpanCandidate = { key: string; forms: string[] };
export type FoundSpan = { keys: string[]; start: number; end: number; surface: string };

const WORD_CHAR = /[A-Za-z0-9'-]/;

/** Length-preserving fold: ASCII case + apostrophe variants only, so offsets stay valid. */
function foldForMatch(text: string): string {
  return foldApostrophes(text.replace(/[A-Z]/g, (c) => c.toLowerCase()));
}

/**
 * Find every span of the candidate forms in `text` (pure).
 *
 * Longest valid unit wins ("shed pounds" beats "shed"); spans never overlap;
 * matches respect word boundaries ("bank" does not match inside "banker").
 * A span whose form belongs to several candidates keeps ALL their keys — the
 * caller must treat that as ambiguous, never pick one.
 */
export function findUnitSpans(text: string, candidates: SpanCandidate[]): FoundSpan[] {
  const folded = foldForMatch(text);
  const byForm = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    for (const form of candidate.forms) {
      const norm = foldForMatch(form.trim()).replace(/\s+/g, " ");
      if (!norm) continue;
      if (!byForm.has(norm)) byForm.set(norm, new Set());
      byForm.get(norm)!.add(candidate.key);
    }
  }
  const forms = [...byForm.keys()].sort((a, b) => b.length - a.length);
  const taken: boolean[] = new Array(text.length).fill(false);
  const found: FoundSpan[] = [];
  for (const form of forms) {
    // Inside text, a single space in a form may match any run of whitespace.
    const pattern = new RegExp(form.split(" ").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(folded)) !== null) {
      const start = match.index;
      const end = start + match[0].length;
      if ((start > 0 && WORD_CHAR.test(folded[start - 1]!)) || (end < folded.length && WORD_CHAR.test(folded[end]!))) continue;
      if (taken.slice(start, end).some(Boolean)) continue;
      for (let i = start; i < end; i += 1) taken[i] = true;
      found.push({ keys: [...byForm.get(form)!], start, end, surface: text.slice(start, end) });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

const comparable = (value: string) => normalizeLexical(value).replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * True when the author's example is THIS sentence (or contains it / is contained
 * in it). The author checked the meaning in that example only, so only spans
 * in that place inherit the authored sense.
 */
export function exampleMatchesSentence(example: string, sentence: string): boolean {
  const ex = comparable(example);
  const here = comparable(sentence);
  if (!ex || !here) return false;
  return here.includes(ex) || ex.includes(here);
}

export function sentenceAt(text: string, start: number, end: number): string {
  const left = Math.max(text.lastIndexOf(".", start - 1), text.lastIndexOf("?", start - 1), text.lastIndexOf("!", start - 1), text.lastIndexOf("\n", start - 1));
  const stops = [".", "?", "!", "\n"].map((mark) => text.indexOf(mark, end)).filter((index) => index >= 0);
  const right = stops.length ? Math.min(...stops) + 1 : text.length;
  const sentence = text.slice(left + 1, right).trim();
  return sentence.length <= 600 ? sentence : text.slice(Math.max(0, start - 160), end + 160).trim();
}

/**
 * Link a Listening package's AUTHORED vocabulary to exact transcript spans.
 *
 * The package author defined each word's meaning for THIS test (word, POS,
 * definition, Uzbek). That authored sense becomes (or reuses) a canonical sense
 * row with truthful provenance (`listening_package`, unverified), and each span
 * span becomes an occurrence. The author checked the meaning in ONE place — the
 * example sentence (`ex`) — so only a span inside that sentence is RESOLVED to
 * the authored sense. The same spelling elsewhere ("river bank" when the author
 * defined the financial bank) is stored UNRESOLVED, linked to the lexical unit
 * but to no sense; so is a span whose sentence fits several authored senses.
 * Words not authored for the test get no occurrence. Both cases show the
 * honest "meaning not checked yet" state.
 *
 * Idempotent: senses dedupe on sense_key, occurrences on the listening offset index.
 * No timing exists in the transcripts, so start_ms/end_ms stay null (never estimated).
 */
export async function ingestListeningOccurrences(tx: Tx, testId: string, payload: Pick<ListeningPackage, "testId" | "sections" | "vocabulary">) {
  const senses = new Map<string, { lexemeId: string; unitId: string; example: string }>();
  const candidates: SpanCandidate[] = [];
  let skippedFunctionWords = 0;
  for (const entry of payload.vocabulary) {
    if (isFunctionWord(entry.word)) { skippedFunctionWords += 1; continue; }
    const senseKey = senseKeyOf({ term: entry.word, partOfSpeech: entry.pos, meaning: entry.def });
    if (senses.has(senseKey)) continue;
    // Reuse an existing canonical sense with the same term, POS and meaning — the
    // same rule as addVocabularyBatch — even when it was stored under a legacy key.
    const legacyKey = legacySenseKeyOf({ term: entry.word, partOfSpeech: entry.pos, meaning: entry.def });
    const existing = (await tx.select().from(lexemes).where(or(
      eq(lexemes.senseKey, senseKey), eq(lexemes.senseKey, legacyKey), eq(lexemes.term, entry.word.trim()), eq(lexemes.term, entry.word.trim().toLowerCase()),
    ))).find((row) => row.senseKey === senseKey || senseKeyOf({ term: row.term, partOfSpeech: row.partOfSpeech, meaning: row.definitionEn }) === senseKey);
    if (existing) {
      const unitId = await linkSenseToUnit(tx, existing, "listening_package");
      senses.set(senseKey, { lexemeId: existing.id, unitId, example: entry.ex });
      candidates.push({ key: senseKey, forms: formsOf(entry.word, entry.pos).map((form) => form.form) });
      continue;
    }
    await tx.insert(lexemes).values({
      term: entry.word.trim(), partOfSpeech: entry.pos.trim() || null, definitionEn: entry.def.trim(),
      translationUz: entry.uz.trim() || null, exampleSentence: entry.ex.trim() || null, senseKey,
      provenance: "listening_package", verificationStatus: "unverified", importBatch: `listening:${payload.testId}`.slice(0, 80),
    }).onConflictDoNothing({ target: lexemes.senseKey });
    const sense = await tx.query.lexemes.findFirst({ where: eq(lexemes.senseKey, senseKey) });
    if (!sense) continue;
    const unitId = await linkSenseToUnit(tx, sense, "listening_package");
    senses.set(senseKey, { lexemeId: sense.id, unitId, example: entry.ex });
    candidates.push({ key: senseKey, forms: formsOf(entry.word, entry.pos).map((form) => form.form) });
  }
  let resolved = 0;
  let unresolved = 0;
  for (const section of payload.sections) {
    const transcript = section.transcript;
    if (!transcript.trim()) continue;
    for (const span of findUnitSpans(transcript, candidates)) {
      const sentence = sentenceAt(transcript, span.start, span.end);
      const checkedHere = span.keys.filter((key) => exampleMatchesSentence(senses.get(key)?.example ?? "", sentence));
      const linked = checkedHere.length === 1 ? senses.get(checkedHere[0]!) : undefined;
      const unitIds = new Set(span.keys.map((key) => senses.get(key)?.unitId));
      const inserted = await tx.insert(lexicalOccurrences).values({
        sourceType: "listening", listeningTestId: testId, sectionNumber: section.number, segmentKey: `s${section.number}`,
        surfaceForm: span.surface.slice(0, 120), startChar: span.start, endChar: span.end,
        sentenceText: sentence, occurrenceType: "vocabulary", isTargetVocabulary: true,
        lexemeId: linked?.lexemeId ?? null, lexicalUnitId: unitIds.size === 1 ? [...unitIds][0] ?? null : null,
        resolutionStatus: linked ? "resolved" : "unresolved", resolutionSource: linked ? "listening_package" : null,
      }).onConflictDoNothing().returning({ id: lexicalOccurrences.id });
      if (inserted.length) { if (linked) resolved += 1; else unresolved += 1; }
    }
  }
  return { senses: senses.size, resolved, unresolved, skippedFunctionWords };
}

/** Spans for the transcript UI of one test: id + offsets per section. No meanings. */
export async function listeningOccurrenceSpans(tx: Tx, testId: string) {
  const rows = await tx.select({
    id: lexicalOccurrences.id, sectionNumber: lexicalOccurrences.sectionNumber, startChar: lexicalOccurrences.startChar,
    endChar: lexicalOccurrences.endChar, surfaceForm: lexicalOccurrences.surfaceForm,
  }).from(lexicalOccurrences).where(and(eq(lexicalOccurrences.listeningTestId, testId), eq(lexicalOccurrences.sourceType, "listening")));
  const bySection: Record<number, { id: string; startChar: number; endChar: number; surfaceForm: string }[]> = {};
  for (const row of rows) {
    if (row.sectionNumber === null) continue;
    (bySection[row.sectionNumber] ??= []).push({ id: row.id, startChar: row.startChar, endChar: row.endChar, surfaceForm: row.surfaceForm });
  }
  return bySection;
}
