import { and, asc, count, desc, eq, gt, lte, ne } from "drizzle-orm";
import { getCourseRoadmap } from "@/lib/data/roadmap";
import { isOpen, resolveState, type LessonState } from "@/lib/services/lessons/state";
import { db } from "@/db/client";
import {
  onboardingProfiles,
  writingSubmissions,
  userVocabulary,
  activityEvents,
  evaluations,
  readingAttempts,
  listeningAttempts,
  speakingAttempts,
  assignments,
  liveClasses,
  courses,
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

/**
 * Where the student actually stopped.
 *
 * The dashboard's "continue" card used to be a guess based on a writing count.
 * This reads the newest row the student owns across the modules and points at
 * that exact place — and when there is no history at all it says so instead of
 * inventing a suggestion.
 */
async function lastActivity(userId: string) {
  const [writing, reading, listening, speaking, vocabulary] = await Promise.all([
    db
      .select({ at: writingSubmissions.updatedAt, id: writingSubmissions.id, promptId: writingSubmissions.promptId })
      .from(writingSubmissions)
      .where(eq(writingSubmissions.userId, userId))
      .orderBy(desc(writingSubmissions.updatedAt))
      .limit(1),
    db
      .select({ at: readingAttempts.startedAt, id: readingAttempts.id })
      .from(readingAttempts)
      .where(eq(readingAttempts.userId, userId))
      .orderBy(desc(readingAttempts.startedAt))
      .limit(1),
    db
      .select({ at: listeningAttempts.startedAt, id: listeningAttempts.id })
      .from(listeningAttempts)
      .where(eq(listeningAttempts.userId, userId))
      .orderBy(desc(listeningAttempts.startedAt))
      .limit(1),
    db
      .select({ at: speakingAttempts.createdAt, id: speakingAttempts.id })
      .from(speakingAttempts)
      .where(eq(speakingAttempts.userId, userId))
      .orderBy(desc(speakingAttempts.createdAt))
      .limit(1),
    db
      .select({ at: userVocabulary.createdAt, id: userVocabulary.id })
      .from(userVocabulary)
      .where(eq(userVocabulary.userId, userId))
      .orderBy(desc(userVocabulary.createdAt))
      .limit(1),
  ]);

  const candidates = [
    writing[0] && { module: "writing" as const, at: writing[0].at, href: `/writing/submissions/${writing[0].id}` },
    reading[0] && { module: "reading" as const, at: reading[0].at, href: `/reading/attempts/${reading[0].id}` },
    listening[0] && {
      module: "listening" as const,
      at: listening[0].at,
      href: `/listening/attempts/${listening[0].id}`,
    },
    speaking[0] && { module: "speaking" as const, at: speaking[0].at, href: "/speaking/history" },
    vocabulary[0] && { module: "vocabulary" as const, at: vocabulary[0].at, href: "/vocabulary" },
  ].filter(Boolean) as { module: string; at: Date; href: string }[];

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0]!;
}

export async function getDashboardData(userId: string) {
  const [
    profile,
    latestEvaluationRow,
    vocabDueCount,
    streak,
    submissionCount,
    readingCount,
    listeningCount,
    speakingCount,
    openAssignments,
    upcoming,
    last,
    roadmap,
  ] = await Promise.all([
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
      .select({ value: count() })
      .from(userVocabulary)
      .where(and(eq(userVocabulary.userId, userId), lte(userVocabulary.nextReviewAt, new Date()))),
    computeStreak(userId),
    db
      .select({ value: count() })
      .from(writingSubmissions)
      .where(and(eq(writingSubmissions.userId, userId), gt(writingSubmissions.wordCount, 0))),
    db.select({ value: count() }).from(readingAttempts).where(eq(readingAttempts.userId, userId)),
    db.select({ value: count() }).from(listeningAttempts).where(eq(listeningAttempts.userId, userId)),
    db.select({ value: count() }).from(speakingAttempts).where(eq(speakingAttempts.userId, userId)),
    // "My Tasks" is the student's own open assignments, with their real due dates.
    db
      .select()
      .from(assignments)
      .where(and(eq(assignments.targetUserId, userId), ne(assignments.status, "completed")))
      .orderBy(asc(assignments.dueAt)),
    db
      .select({ liveClass: liveClasses })
      .from(liveClasses)
      .innerJoin(courses, eq(liveClasses.courseId, courses.id))
      .where(and(eq(courses.slug, "ielts"), eq(liveClasses.status, "upcoming")))
      .orderBy(asc(liveClasses.scheduledAt))
      .limit(1),
    lastActivity(userId),
    // The roadmap call used to wait for the dashboard queries above even though
    // it is independent; overlap it so it does not add another DB round trip to
    // the navigation's critical path.
    getCourseRoadmap("ielts", userId),
  ]);

  // "What's open now": the lessons the student can actually open today, taken from
  // the same roadmap the course page renders.
  const openLessons = (roadmap?.modules ?? [])
    .flatMap((module) => module.units.flatMap((unit) => unit.lessons.map((lesson) => ({ module, unit, lesson }))))
    .filter(({ lesson }) => isOpen(lesson.state as LessonState))
    .slice(0, 4)
    .map(({ module, unit, lesson }) => ({
      id: lesson.id,
      title: lesson.title,
      moduleTitle: module.title,
      unitTitle: unit.title,
      state: resolveState(lesson.state as LessonState, "locked"),
    }));

  return {
    openLessons,
    profile: profile ?? null,
    latestEvaluation: latestEvaluationRow[0] ?? null,
    vocabDueCount: Number(vocabDueCount[0]?.value ?? 0),
    streak,
    writingAttempts: Number(submissionCount[0]?.value ?? 0),
    skillCounts: {
      reading: Number(readingCount[0]?.value ?? 0),
      listening: Number(listeningCount[0]?.value ?? 0),
      speaking: Number(speakingCount[0]?.value ?? 0),
      writing: Number(submissionCount[0]?.value ?? 0),
    },
    openAssignments: openAssignments.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    })),
    nextLiveClass: upcoming[0]?.liveClass
      ? {
          id: upcoming[0].liveClass.id,
          title: upcoming[0].liveClass.title,
          scheduledAt: upcoming[0].liveClass.scheduledAt.toISOString(),
        }
      : null,
    lastActivity: last,
  };
}
