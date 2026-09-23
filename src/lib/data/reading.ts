import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingPassages, readingQuestions, readingAttempts, readingAnswers } from "@/db/schema";

export function listActivePassages() {
  return db.query.readingPassages.findMany({
    where: eq(readingPassages.isActive, true),
    orderBy: asc(readingPassages.createdAt),
  });
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
