import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingPassages, readingQuestions, readingAttempts, readingAnswers } from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";

export function listActivePassages() {
  // A draft, a not-yet-due schedule and an archive are all invisible here; the
  // one rule that decides that lives in the publication service.
  return db.query.readingPassages.findMany({
    where: liveWhere({
      publicationState: readingPassages.publicationState,
      publishAt: readingPassages.publishAt,
    }),
    orderBy: asc(readingPassages.createdAt),
  });
}

/**
 * Load a passage only if a student may start work on it.
 *
 * The list filter alone is not enough: a passage that was withdrawn would still
 * be open to anyone who kept its id or bookmarked the URL. `isLive` is applied
 * here, at the moment of starting, and deliberately NOT when a past attempt is
 * read back — an archived passage must stay readable to the student who already
 * worked on it.
 */
export async function getStartablePassage(passageId: string) {
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, passageId) });
  if (!passage || !isLive(passage)) return null;
  return passage;
}

export async function getPassageWithQuestions(passageId: string) {
  const passage = await db.query.readingPassages.findFirst({ where: eq(readingPassages.id, passageId) });
  if (!passage) return null;
  const questions = await db.query.readingQuestions.findMany({
    where: eq(readingQuestions.passageId, passageId),
    orderBy: asc(readingQuestions.order),
  });
  return { passage, questions };
}

export async function getAttemptDetail(attemptId: string, userId: string) {
  const attempt = await db.query.readingAttempts.findFirst({
    where: and(eq(readingAttempts.id, attemptId), eq(readingAttempts.userId, userId)),
  });
  if (!attempt) return null;

  const [passageData, answers] = await Promise.all([
    getPassageWithQuestions(attempt.passageId),
    db.query.readingAnswers.findMany({ where: eq(readingAnswers.attemptId, attemptId) }),
  ]);
  if (!passageData) return null;

  return { attempt, passage: passageData.passage, questions: passageData.questions, answers };
}

export function listUserAttempts(userId: string) {
  return db
    .select({ attempt: readingAttempts, passage: readingPassages })
    .from(readingAttempts)
    .innerJoin(readingPassages, eq(readingAttempts.passageId, readingPassages.id))
    .where(eq(readingAttempts.userId, userId))
    .orderBy(desc(readingAttempts.startedAt));
}
