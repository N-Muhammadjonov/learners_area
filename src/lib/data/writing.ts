import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingPrompts, writingSubmissions, writingFeedback } from "@/db/schema";

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
