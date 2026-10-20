import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lexicalOccurrences, lexemes } from "@/db/schema";
import { classifyDatabaseError } from "@/lib/http/database-errors";

export async function videoVocabulary(id: string) {
  try {
    // One authored sense per canonical lexeme, using its first resolved source
    // context. Repeated appearances must not crowd later words out of a cap.
    const rows = await db.selectDistinctOn([lexicalOccurrences.lexemeId], { occurrenceId: lexicalOccurrences.id, id: lexemes.id, term: lexemes.term,
      partOfSpeech: lexemes.partOfSpeech, definitionEn: lexemes.definitionEn, translationUz: lexemes.translationUz,
      exampleSentence: lexicalOccurrences.sentenceText, startChar: lexicalOccurrences.startChar,
      endChar: lexicalOccurrences.endChar, surfaceForm: lexicalOccurrences.surfaceForm, segmentKey: lexicalOccurrences.segmentKey,
    }).from(lexicalOccurrences).innerJoin(lexemes, eq(lexemes.id, lexicalOccurrences.lexemeId))
      .where(and(eq(lexicalOccurrences.videoLessonId, id), eq(lexicalOccurrences.sourceType, "video"), eq(lexicalOccurrences.resolutionStatus, "resolved")))
      .orderBy(asc(lexicalOccurrences.lexemeId), asc(lexicalOccurrences.startChar));
    return {ready: true as const, items: rows};
  } catch(error) {
    const reason = classifyDatabaseError(error);
    if (reason === "schema_missing" || reason === "column_missing") return {ready: false as const, items: []};
    throw error;
  }
}
