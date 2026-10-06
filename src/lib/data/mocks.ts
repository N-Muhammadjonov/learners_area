import { asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { courses, mockAttempts, mockTests } from "@/db/schema";
import { timed } from "@/lib/observability/timing";

/**
 * Mock tests, from the record. Catalogue and learner attempts are independent
 * regions: either can fail without erasing the other. Historic test titles are
 * fetched for the learner's attempt ids, even if those tests are no longer in
 * the current IELTS catalogue.
 */
export async function getMockOverview(userId: string, courseSlug = "ielts") {
  const [courseResult, attemptsResult] = await Promise.allSettled([
    timed("mocks.entry.course", () => db.query.courses.findFirst({ where: eq(courses.slug, courseSlug) })),
    timed("mocks.entry.attempts", () => db
      .select({
        id: mockAttempts.id,
        mockTestId: mockAttempts.mockTestId,
        startedAt: mockAttempts.startedAt,
        finishedAt: mockAttempts.finishedAt,
        rawScore: mockAttempts.rawScore,
        estimatedBand: mockAttempts.estimatedBand,
        // Copied into the attempt when it started, so history survives the mock.
        snapshot: mockAttempts.mockSnapshot,
        mockVersion: mockAttempts.mockVersion,
      })
      .from(mockAttempts)
      .where(eq(mockAttempts.userId, userId))
      .orderBy(desc(mockAttempts.startedAt))),
  ]);

  const course = courseResult.status === "fulfilled" ? courseResult.value : null;
  const attempts = attemptsResult.status === "fulfilled" ? attemptsResult.value : [];
  const courseUnavailable = courseResult.status === "rejected";
  const attemptsUnavailable = attemptsResult.status === "rejected";

  const attemptTestIds = [...new Set(attempts.map((attempt) => attempt.mockTestId).filter((id): id is string => id !== null))];
  const [testsResult, titlesResult] = await Promise.allSettled([
    course
      ? timed("mocks.entry.catalogue", () => db.query.mockTests.findMany({
          where: eq(mockTests.courseId, course.id),
          orderBy: asc(mockTests.title),
        }))
      : Promise.resolve([]),
    attemptTestIds.length
      ? timed("mocks.entry.attemptTitles", () => db
          .select({ id: mockTests.id, title: mockTests.title, skill: mockTests.skill })
          .from(mockTests)
          .where(inArray(mockTests.id, attemptTestIds)))
      : Promise.resolve([]),
  ]);

  const tests = testsResult.status === "fulfilled" ? testsResult.value : [];
  const titles = titlesResult.status === "fulfilled" ? titlesResult.value : [];
  const titleById = new Map(titles.map((test) => [test.id, test]));
  const finishedCount = attempts.filter((attempt) => attempt.finishedAt).length;

  return {
    tests,
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      mockTestId: attempt.mockTestId,
      mockVersion: attempt.mockVersion,
      /**
       * A mock that has since been removed leaves the attempt readable through its
       * own snapshot rather than blanking the learner's history (§57).
       */
      skill: attempt.mockTestId ? titleById.get(attempt.mockTestId)?.skill ?? null : attempt.snapshot?.kind ?? null,
      title: (attempt.mockTestId ? titleById.get(attempt.mockTestId)?.title : null) ?? attempt.snapshot?.title ?? null,
      startedAt: attempt.startedAt,
      finishedAt: attempt.finishedAt,
      rawScore: attempt.finishedAt ? attempt.rawScore : null,
      estimatedBand: attempt.finishedAt ? attempt.estimatedBand : null,
    })),
    finishedCount,
    catalogueUnavailable: courseUnavailable || testsResult.status === "rejected",
    attemptsUnavailable,
    attemptTitlesUnavailable: titlesResult.status === "rejected",
  };
}
