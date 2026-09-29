import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexicalOccurrences, lexemes, readingAttempts, readingPassages } from "@/db/schema";
import { isLive } from "@/lib/services/cms/publication";

export type VocabularySourceSnapshot = {
  occurrenceId: string;
  lexemeId: string;
  sourceTitle: string;
  surfaceForm: string;
  sentenceText: string;
};

/** Resolve authority afresh on lookup AND save. A guessed occurrence is not access. */
export async function resolveReadingOccurrence(userId: string, sourceId: string, occurrenceId: string) {
  const attempt = await db.query.readingAttempts.findFirst({ where: and(eq(readingAttempts.id, sourceId), eq(readingAttempts.userId, userId)) });
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, attempt?.passageId ?? sourceId) });
  if (!passage || (!attempt && !isLive(passage))) return null;
  const [row] = await db.select({ occurrence: lexicalOccurrences, lexeme: lexemes }).from(lexicalOccurrences)
    .innerJoin(lexemes, eq(lexemes.id, lexicalOccurrences.lexemeId))
    .where(and(eq(lexicalOccurrences.id, occurrenceId), eq(lexicalOccurrences.passageId, passage.id)));
  if (!row) return null;
  const occurrence = row.occurrence;
  if (occurrence.startChar < 0 || occurrence.endChar <= occurrence.startChar
    || passage.bodyText.slice(occurrence.startChar, occurrence.endChar).toLowerCase() !== occurrence.surfaceForm.toLowerCase()) return null;
  // Retain only a short authentic excerpt, not the entire learning material.
  const suppliedSentence = occurrence.sentenceText?.trim();
  const sentenceText = suppliedSentence && passage.bodyText.includes(suppliedSentence) && suppliedSentence.length <= 600
    ? suppliedSentence : passage.bodyText.slice(Math.max(0, occurrence.startChar - 160), occurrence.endChar + 160);
  return { lexeme: row.lexeme, snapshot: {
    occurrenceId: occurrence.id, lexemeId: row.lexeme.id, sourceTitle: passage.title.slice(0, 240),
    surfaceForm: occurrence.surfaceForm, sentenceText,
  } satisfies VocabularySourceSnapshot };
}
