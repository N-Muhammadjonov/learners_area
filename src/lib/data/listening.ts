import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningTests, listeningQuestions, listeningAttempts, listeningAnswers } from "@/db/schema";

export function listActiveTests() {
  return db.query.listeningTests.findMany({
    where: eq(listeningTests.isActive, true),
    orderBy: asc(listeningTests.createdAt),
  });
}

export async function getTestWithQuestions(testId: string) {
  const test = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, testId) });
  if (!test) return null;
  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, testId),
    orderBy: asc(listeningQuestions.order),
  });
  return { test, questions };
}

export async function getAttemptDetail(attemptId: string, userId: string) {
  const attempt = await db.query.listeningAttempts.findFirst({
    where: and(eq(listeningAttempts.id, attemptId), eq(listeningAttempts.userId, userId)),
  });
  if (!attempt) return null;

  const [testData, answers] = await Promise.all([
    getTestWithQuestions(attempt.testId),
    db.query.listeningAnswers.findMany({ where: eq(listeningAnswers.attemptId, attemptId) }),
  ]);
  if (!testData) return null;

  return { attempt, test: testData.test, questions: testData.questions, answers };
}

export function listUserAttempts(userId: string) {
  return db
    .select({ attempt: listeningAttempts, test: listeningTests })
    .from(listeningAttempts)
    .innerJoin(listeningTests, eq(listeningAttempts.testId, listeningTests.id))
    .where(eq(listeningAttempts.userId, userId))
    .orderBy(desc(listeningAttempts.startedAt));
}
