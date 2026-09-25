import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  writingPrompts,
  writingSubmissions,
  writingFeedback,
  typingRuns,
} from "@/db/schema";

export function listActivePrompts() {
  return db.query.writingPrompts.findMany({
    where: eq(writingPrompts.isActive, true),
    orderBy: (p, { asc }) => [asc(p.taskType), asc(p.category)],
  });
}

export async function getSubmissionDetail(submissionId: string, userId: string) {
  const submission = await db.query.writingSubmissions.findFirst({
    where: and(eq(writingSubmissions.id, submissionId), eq(writingSubmissions.userId, userId)),
  });
  if (!submission) return null;

  const [prompt, feedback] = await Promise.all([
    db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, submission.promptId) }),
    db.query.writingFeedback.findFirst({
      where: eq(writingFeedback.submissionId, submissionId),
      orderBy: desc(writingFeedback.createdAt),
    }),
  ]);

  return { submission, prompt: prompt!, feedback: feedback ?? null };
}

export function listUserSubmissions(userId: string) {
  return db
    .select({ submission: writingSubmissions, prompt: writingPrompts })
    .from(writingSubmissions)
    .innerJoin(writingPrompts, eq(writingSubmissions.promptId, writingPrompts.id))
    .where(eq(writingSubmissions.userId, userId))
    .orderBy(desc(writingSubmissions.updatedAt));
}

/** A student's timed typing runs, newest first. Aggregates only. */
export function listTypingRuns(userId: string, limit = 10) {
  return db.query.typingRuns.findMany({
    where: eq(typingRuns.userId, userId),
    orderBy: desc(typingRuns.createdAt),
    limit,
  });
}

/**
 * Typing statistics from the student's own runs. `numeric` columns come back as
 * strings from the driver, so they are parsed here once instead of at every
 * call site.
 */
export async function typingSummary(userId: string) {
  const rows = await db.query.typingRuns.findMany({ where: eq(typingRuns.userId, userId) });
  const runs = rows.map((row) => ({
    id: row.id,
    wpm: Number(row.wpm),
    accuracy: Number(row.accuracy),
    durationMs: row.durationMs,
    createdAt: row.createdAt,
  }));

  if (runs.length === 0) {
    return { count: 0, bestWpm: null as number | null, bestAccuracy: null as number | null, runs };
  }

  return {
    count: runs.length,
    bestWpm: Math.max(...runs.map((r) => r.wpm)),
    bestAccuracy: Math.max(...runs.map((r) => r.accuracy)),
    runs,
  };
}
