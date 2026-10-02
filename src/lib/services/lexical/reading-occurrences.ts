import { eq } from "drizzle-orm";
import type { db } from "@/db/client";
import { lexemes, lexicalOccurrences } from "@/db/schema";
import { senseKeyOf } from "@/lib/services/vocabulary/dedupe";
import { isFunctionWord } from "@/lib/text/lexical-normalize";
import { formsOf } from "./forms";
import { linkSenseToUnit } from "./units";
import { canonicalSenseFor, exampleMatchesSentence, findUnitSpans, sentenceAt, type SpanCandidate } from "./listening-occurrences";

type Tx = Pick<typeof db, "select" | "insert" | "update" | "query">;

/** One authored vocabulary entry of a reading passage (same shape as a Listening package entry). */
export type AuthoredVocabulary = {
  word: string; pos: string; def: string; uz: string; ex: string;
  /**
   * Optional exact surfaces the author marked for this unit, for discontinuous
   * expressions the form matcher cannot see ("took the cost into account" for
   * "take into account"). Matched literally; a surface inside the example sentence
   * is resolved, elsewhere unresolved — the same rule as matched forms.
   */
  surfaces?: string[];
};

/**
 * Occurrences for one reading passage — the SAME rule as Listening ingestion
 * (ingestListeningOccurrences), reused, not re-invented:
 *
 *   - each authored entry maps to ONE canonical sense (reused when an equal sense
 *     already exists — Academic, Listening or an earlier set — never duplicated);
 *   - all inflected forms of the unit are matched (run/runs/ran/running); the
 *     longest unit wins, so an MWE beats its member words; a discontinuous MWE is
 *     taken from the author's explicit `surfaces` and placed first;
 *   - standalone function words are never targets;
 *   - only a span inside the authored example sentence is RESOLVED to the sense;
 *     the same spelling elsewhere is stored UNRESOLVED (linked to the unit, no sense).
 *
 * Offsets are absolute in `body`, exactly as Academic occurrences are, so the
 * existing occurrenceSpans/resolveReadingOccurrence integrity checks apply unchanged.
 */
export async function ingestReadingPassageOccurrences(tx: Tx, passageId: string, body: string, vocabulary: AuthoredVocabulary[], provenance = "general_reading") {
  const senses = new Map<string, { lexemeId: string; unitId: string; example: string }>();
  const candidates: SpanCandidate[] = [];
  let skippedFunctionWords = 0;
  for (const entry of vocabulary) {
    if (isFunctionWord(entry.word)) { skippedFunctionWords += 1; continue; }
    const senseKey = senseKeyOf({ term: entry.word, partOfSpeech: entry.pos, meaning: entry.def });
    if (senses.has(senseKey)) continue;
    let sense = await canonicalSenseFor(tx, entry);
    if (!sense) {
      await tx.insert(lexemes).values({
        term: entry.word.trim(), partOfSpeech: entry.pos.trim() || null, definitionEn: entry.def.trim(),
        translationUz: entry.uz.trim() || null, exampleSentence: entry.ex.trim() || null, senseKey,
        provenance, verificationStatus: "unverified", importBatch: `${provenance}:${passageId}`.slice(0, 80),
      }).onConflictDoNothing({ target: lexemes.senseKey });
      sense = await tx.query.lexemes.findFirst({ where: eq(lexemes.senseKey, senseKey) });
    }
    if (!sense) continue;
    const unitId = await linkSenseToUnit(tx, sense, provenance);
    senses.set(senseKey, { lexemeId: sense.id, unitId, example: entry.ex });
    candidates.push({ key: senseKey, forms: formsOf(entry.word, entry.pos).map((form) => form.form) });
  }
  // Authored discontinuous surfaces first (longest), then matched forms that do not overlap them.
  const authored: { keys: string[]; start: number; end: number; surface: string }[] = [];
  for (const entry of vocabulary) {
    const key = senseKeyOf({ term: entry.word, partOfSpeech: entry.pos, meaning: entry.def });
    if (!senses.has(key)) continue;
    for (const surface of entry.surfaces ?? []) {
      for (let at = body.indexOf(surface); at >= 0 && surface; at = body.indexOf(surface, at + surface.length)) {
        if (!authored.some((span) => at < span.end && at + surface.length > span.start)) authored.push({ keys: [key], start: at, end: at + surface.length, surface });
      }
    }
  }
  const matched = findUnitSpans(body, candidates).filter((span) => !authored.some((a) => span.start < a.end && span.end > a.start));
  let resolved = 0;
  let unresolved = 0;
  for (const span of [...authored, ...matched].sort((a, b) => a.start - b.start)) {
    const sentence = sentenceAt(body, span.start, span.end);
    const checkedHere = span.keys.filter((key) => exampleMatchesSentence(senses.get(key)?.example ?? "", sentence));
    const linked = checkedHere.length === 1 ? senses.get(checkedHere[0]!) : undefined;
    const unitIds = new Set(span.keys.map((key) => senses.get(key)?.unitId));
    const inserted = await tx.insert(lexicalOccurrences).values({
      sourceType: "reading", passageId,
      surfaceForm: span.surface.slice(0, 120), startChar: span.start, endChar: span.end,
      sentenceText: sentence, occurrenceType: "vocabulary", isTargetVocabulary: true,
      lexemeId: linked?.lexemeId ?? null, lexicalUnitId: unitIds.size === 1 ? [...unitIds][0] ?? null : null,
      resolutionStatus: linked ? "resolved" : "unresolved", resolutionSource: linked ? provenance : null,
    }).onConflictDoNothing().returning({ id: lexicalOccurrences.id });
    if (inserted.length) { if (linked) resolved += 1; else unresolved += 1; }
  }
  return { senses: senses.size, resolved, unresolved, skippedFunctionWords };
}
