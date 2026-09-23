import { and, asc, eq, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { userVocabulary, lexemes } from "@/db/schema";

export function listUserVocabulary(userId: string) {
  return db
    .select({ entry: userVocabulary, lexeme: lexemes })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(eq(userVocabulary.userId, userId))
    .orderBy(asc(userVocabulary.nextReviewAt));
}

export function listDueVocabulary(userId: string) {
  return db
    .select({ entry: userVocabulary, lexeme: lexemes })
    .from(userVocabulary)
    .innerJoin(lexemes, eq(userVocabulary.lexemeId, lexemes.id))
    .where(and(eq(userVocabulary.userId, userId), lte(userVocabulary.nextReviewAt, new Date())))
    .orderBy(asc(userVocabulary.nextReviewAt))
    .limit(20);
}
