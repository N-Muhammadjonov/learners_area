import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { assignmentResponses, vocabularyUsages } from "@/db/schema";

/**
 * The artifacts an evaluation refers to.
 *
 * Keeping them as rows (not as a string embedded in an evaluation) means the
 * feedback page can always show the exact sentence or response that was judged,
 * and a student's history of attempts stays intact even if an evaluation is
 * later produced by a different provider.
 */

export function listVocabularyUsages(userVocabularyId: string, userId: string) {
  return db
    .select()
    .from(vocabularyUsages)
    .where(
      and(eq(vocabularyUsages.userVocabularyId, userVocabularyId), eq(vocabularyUsages.userId, userId))
    )
    .orderBy(desc(vocabularyUsages.createdAt));
}

export function listUsagesForEntries(params: { userVocabularyIds: string[]; userId: string }) {
  if (params.userVocabularyIds.length === 0) return Promise.resolve([]);
  return db
    .select()
    .from(vocabularyUsages)
    .where(eq(vocabularyUsages.userId, params.userId))
    .orderBy(desc(vocabularyUsages.createdAt));
}

export async function createVocabularyUsage(params: {
  userId: string;
  userVocabularyId: string;
  sentence: string;
}) {
  const [row] = await db
    .insert(vocabularyUsages)
    .values({
      userId: params.userId,
      userVocabularyId: params.userVocabularyId,
      sentence: params.sentence,
    })
    .returning();
  return row!;
}

export async function getAssignmentResponse(assignmentId: string, userId: string) {
  return (
    (await db.query.assignmentResponses.findFirst({
      where: and(
        eq(assignmentResponses.assignmentId, assignmentId),
        eq(assignmentResponses.userId, userId)
      ),
    })) ?? null
  );
}

/** Batch the learner's responses for a page of assignments (no per-card reads). */
export function listAssignmentResponses(assignmentIds: string[], userId: string) {
  if (assignmentIds.length === 0) return Promise.resolve([]);
  return db.query.assignmentResponses.findMany({
    where: and(
      inArray(assignmentResponses.assignmentId, assignmentIds),
      eq(assignmentResponses.userId, userId),
    ),
  });
}

/** One response per assignment per student — a second save updates it in place. */
export async function saveAssignmentResponse(params: {
  assignmentId: string;
  userId: string;
  content: string;
}) {
  const existing = await getAssignmentResponse(params.assignmentId, params.userId);
  if (existing) {
    const [updated] = await db
      .update(assignmentResponses)
      .set({ content: params.content, updatedAt: new Date() })
      .where(eq(assignmentResponses.id, existing.id))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(assignmentResponses)
    .values({
      assignmentId: params.assignmentId,
      userId: params.userId,
      content: params.content,
    })
    .returning();
  return created!;
}
