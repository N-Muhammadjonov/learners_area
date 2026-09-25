import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { courses, mockAttempts, mockTests } from "@/db/schema";

/**
 * Mock tests, from the record.
 *
 * The catalogue and the results are both real rows. An attempt only shows a score
 * once it has been finished — an unfinished attempt is a session the student
 * walked away from, not a zero.
 */
export async function getMockOverview(userId: string, courseSlug = "ielts") {
  const course = await db.query.courses.findFirst({ where: eq(courses.slug, courseSlug) });
  const tests = course
    ? await db.query.mockTests.findMany({
        where: eq(mockTests.courseId, course.id),
        orderBy: asc(mockTests.title),
      })
    : [];

  const attempts = await db
    .select()
    .from(mockAttempts)
    .where(eq(mockAttempts.userId, userId))
    .orderBy(desc(mockAttempts.startedAt));

  const titles = tests.length
    ? await db
        .select({ id: mockTests.id, title: mockTests.title, skill: mockTests.skill })
        .from(mockTests)
        .where(
          inArray(
            mockTests.id,
            [...new Set(attempts.map((a) => a.mockTestId))]
          )
        )
    : [];
  const titleById = new Map(titles.map((t) => [t.id, t]));

  return {
    tests,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      title: titleById.get(attempt.mockTestId)?.title ?? null,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      rawScore: attempt.finishedAt ? attempt.rawScore : null,
      estimatedBand: attempt.finishedAt ? attempt.estimatedBand : null,
    })),
    finishedCount: attempts.filter((a) => a.finishedAt).length,
  };
}
