import { and, desc, eq, gt, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  onboardingProfiles,
  writingSubmissions,
  userVocabulary,
  activityEvents,
  evaluations,
} from "@/db/schema";

async function computeStreak(userId: string): Promise<number> {
  const events = await db
    .select({ createdAt: activityEvents.createdAt })
    .from(activityEvents)
    .where(eq(activityEvents.userId, userId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(400);

  const days = new Set(events.map((e) => e.createdAt.toISOString().slice(0, 10)));
  let streak = 0;
  const cursor = new Date();
  // Allow "today not logged yet" to not zero out the streak.
  if (!days.has(cursor.toISOString().slice(0, 10))) {
    cursor.setDate(cursor.getDate() - 1);
  }
  while (days.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export async function getDashboardData(userId: string) {
  const [profile, latestEvaluationRow, vocabDueCount, streak, submissionCount] = await Promise.all([
    db.query.onboardingProfiles.findFirst({ where: eq(onboardingProfiles.userId, userId) }),
    // The dashboard shows the latest *evaluation*, together with the name of the
    // evaluator that produced it. Teacher feedback is a separate track and is
    // not mixed into this card.
    db
      .select()
      .from(evaluations)
      .where(eq(evaluations.userId, userId))
      .orderBy(desc(evaluations.createdAt))
      .limit(1),
    db
      .select({ id: userVocabulary.id })
      .from(userVocabulary)
      .where(and(eq(userVocabulary.userId, userId), lte(userVocabulary.nextReviewAt, new Date()))),
    computeStreak(userId),
    db
      .select({ id: writingSubmissions.id })
      .from(writingSubmissions)
      .where(and(eq(writingSubmissions.userId, userId), gt(writingSubmissions.wordCount, 0))),
  ]);

  return {
    profile: profile ?? null,
    latestEvaluation: latestEvaluationRow[0] ?? null,
    vocabDueCount: vocabDueCount.length,
    streak,
    writingAttempts: submissionCount.length,
  };
}
