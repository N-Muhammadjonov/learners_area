import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingLanguagePatterns, writingLessonProgress, writingLessons, writingModelTexts, writingTranslationSets } from "@/db/schema";
import { liveWhere } from "@/lib/services/cms/publication";

/** Published Writing lessons with this learner's completion. */
export async function listWritingLessons(userId: string) {
  return db.select({
    id: writingLessons.id, title: writingLessons.title, category: writingLessons.category, summary: writingLessons.summary,
    durationMinutes: writingLessons.durationMinutes, completedAt: writingLessonProgress.completedAt,
  }).from(writingLessons)
    .leftJoin(writingLessonProgress, and(eq(writingLessonProgress.lessonId, writingLessons.id), eq(writingLessonProgress.userId, userId)))
    .where(liveWhere({ publicationState: writingLessons.publicationState, publishAt: writingLessons.publishAt }))
    .orderBy(asc(writingLessons.position), asc(writingLessons.createdAt));
}

export async function getWritingLesson(id: string, userId: string) {
  const [row] = await db.select({ lesson: writingLessons, completedAt: writingLessonProgress.completedAt }).from(writingLessons)
    .leftJoin(writingLessonProgress, and(eq(writingLessonProgress.lessonId, writingLessons.id), eq(writingLessonProgress.userId, userId)))
    .where(and(eq(writingLessons.id, id), liveWhere({ publicationState: writingLessons.publicationState, publishAt: writingLessons.publishAt })))
    .limit(1);
  return row ?? null;
}

/** Counts of published content per Writing tool, for honest empty states. */
export async function writingContentCounts() {
  const [sets, texts, patterns] = await Promise.all([
    db.select({ n: count() }).from(writingTranslationSets).where(liveWhere({ publicationState: writingTranslationSets.publicationState, publishAt: writingTranslationSets.publishAt })),
    db.select({ n: count() }).from(writingModelTexts).where(liveWhere({ publicationState: writingModelTexts.publicationState, publishAt: writingModelTexts.publishAt })),
    db.select({ n: count() }).from(writingLanguagePatterns).where(liveWhere({ publicationState: writingLanguagePatterns.publicationState, publishAt: writingLanguagePatterns.publishAt })),
  ]);
  return { translationSets: sets[0]?.n ?? 0, modelTexts: texts[0]?.n ?? 0, patterns: patterns[0]?.n ?? 0 };
}
