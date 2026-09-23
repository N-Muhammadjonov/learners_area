import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, writingSubmissions, writingPrompts, writingFeedback } from "@/db/schema";

export function listStudents() {
  return db.query.users.findMany({
    where: eq(users.role, "student"),
    orderBy: desc(users.createdAt),
  });
}

export async function getStudentDetail(studentId: string) {
  const student = await db.query.users.findFirst({
    where: eq(users.id, studentId),
  });
  if (!student || student.role !== "student") return null;

  const submissions = await db
    .select({ submission: writingSubmissions, prompt: writingPrompts })
    .from(writingSubmissions)
    .innerJoin(writingPrompts, eq(writingSubmissions.promptId, writingPrompts.id))
    .where(eq(writingSubmissions.userId, studentId))
    .orderBy(desc(writingSubmissions.updatedAt));

  const feedbackBySubmission = new Map<string, (typeof writingFeedback.$inferSelect)[]>();
  for (const { submission } of submissions) {
    const rows = await db.query.writingFeedback.findMany({
      where: eq(writingFeedback.submissionId, submission.id),
      orderBy: desc(writingFeedback.createdAt),
    });
    feedbackBySubmission.set(submission.id, rows);
  }

  return { student, submissions, feedbackBySubmission };
}
