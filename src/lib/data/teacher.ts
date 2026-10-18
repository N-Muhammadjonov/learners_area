import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { users, writingSubmissions, writingPrompts, writingFeedback, teacherStudentLinks } from "@/db/schema";

export function listStudents(teacherId?: string) {
  return db.query.users.findMany({
    where: and(eq(users.role, "student"), teacherId ? inArray(users.id, db.select({ id: teacherStudentLinks.studentUserId }).from(teacherStudentLinks).where(eq(teacherStudentLinks.teacherUserId, teacherId))) : undefined),
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
  const ids = submissions.map(({ submission }) => submission.id);
  const feedback = ids.length ? await db.query.writingFeedback.findMany({
    where: inArray(writingFeedback.submissionId, ids),
    orderBy: desc(writingFeedback.createdAt),
  }) : [];
  for (const id of ids) feedbackBySubmission.set(id, []);
  for (const row of feedback) feedbackBySubmission.get(row.submissionId)!.push(row);

  return { student, submissions, feedbackBySubmission };
}
