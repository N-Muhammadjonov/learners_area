import { and, asc, count, desc, eq, gt, lte, ne, sql } from "drizzle-orm";
import { streakFromDays } from "@/lib/progress/streak";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { TIMEZONE, tashkentDayKey } from "@/lib/time";
import { getCourseRoadmap } from "@/lib/data/roadmap";
import { isOpen, resolveState, type LessonState } from "@/lib/services/lessons/state";
import { db } from "@/db/client";
import { getAttemptTimeline } from "@/lib/data/attempt-timeline";
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

const STREAK_ZONE = sql.raw(`'${TIMEZONE.replace(/'/g, "")}'`);

async function computeStreak(userId: string): Promise<number> {
  // Distinct active days in the centre's timezone, computed in SQL: a busy learner's
  // many events per day can no longer push older streak days out of a row window.
  const days = await db
    .selectDistinct({ day: sql<string>`to_char((${activityEvents.createdAt} at time zone ${STREAK_ZONE})::date, 'YYYY-MM-DD')` })
    .from(activityEvents)
    .where(eq(activityEvents.userId, userId));
  return streakFromDays(days.map((d) => d.day), tashkentDayKey(new Date()));
}

/**
 * Where the student actually stopped.
 *
 * The dashboard's "continue" card used to be a guess based on a writing count.
 * This reads the newest row the student owns across the modules and points at
 * that exact place — and when there is no history at all it says so instead of
 * inventing a suggestion.
 */
export function getActivityStreak(userId: string): Promise<number> {
  return computeStreak(userId);
}

/**
 * Where the student actually stopped.
 *
 * The cross-skill enumeration lives in ONE place — `getAttemptTimeline` (§AD) — so the
 * dashboard cannot drift from the learner's history page: both ask the same projection,
 * which reads the real attempt rows. Vocabulary is not an attempt, so it keeps its own
 * probe and the two candidates are compared by when they happened.
 */
async function lastActivity(userId: string) {
  const [attempts, vocabulary] = await Promise.all([
    getAttemptTimeline(userId, { kinds: ["writing", "reading", "listening", "speaking"], limit: 1 }),
    db
      .select({ at: userVocabulary.createdAt, id: userVocabulary.id })
      .from(userVocabulary)
      .where(eq(userVocabulary.userId, userId))
      .orderBy(desc(userVocabulary.createdAt))
      .limit(1),
  ]);

  const candidates = [
    ...attempts.map((entry) => ({ module: entry.kind, at: entry.occurredAt, href: entry.href })),
    vocabulary[0] && { module: "vocabulary" as const, at: vocabulary[0].at, href: "/vocabulary" },
  ].filter(Boolean) as { module: string; at: Date; href: string }[];

  if (candidates.length === 0) return null;
  return candidates.sort((a, b) => b.at.getTime() - a.at.getTime())[0]!;
}

/** Dashboard summary regions are independent; one failed widget must not erase the others. */
export async function getDashboardData(userId: string) {
  const [
    profileResult,
    latestEvaluationResult,
    vocabDueResult,
    streakResult,
    submissionCountResult,
    readingCountResult,
    listeningCountResult,
    speakingCountResult,
    assignmentsResult,
    upcomingResult,
    lastActivityResult,
  ] = await Promise.allSettled([
    db.select({ targetBand: onboardingProfiles.targetBand })
      .from(onboardingProfiles)
      .where(eq(onboardingProfiles.userId, userId))
      .limit(1),
    // The dashboard shows the latest *evaluation*, together with the name of the
    // evaluator that produced it. Teacher feedback is a separate track and is
    // not mixed into this card.
    db
      .select({
        overallEstimate: evaluations.overallEstimate,
        weaknesses: evaluations.weaknesses,
      })
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
      .select({
        id: assignments.id,
        title: assignments.title,
        status: assignments.status,
        dueAt: assignments.dueAt,
      })
      .from(assignments)
      .where(and(eq(assignments.targetUserId, userId), ne(assignments.status, "completed")))
      .orderBy(asc(assignments.dueAt)),
    db
      .select({ id: liveClasses.id, title: liveClasses.title, scheduledAt: liveClasses.scheduledAt })
      .from(liveClasses)
      .innerJoin(courses, eq(liveClasses.courseId, courses.id))
      .where(and(eq(courses.slug, "ielts"), eq(liveClasses.status, "upcoming")))
      .orderBy(asc(liveClasses.scheduledAt))
      .limit(1),
    lastActivity(userId),
  ]);

  const countValue = (result: typeof vocabDueResult) =>
    result.status === "fulfilled" ? Number(result.value[0]?.value ?? 0) : null;
  const upcomingClass = upcomingResult.status === "fulfilled" ? upcomingResult.value[0] : null;

  return {
    profile: profileResult.status === "fulfilled" ? profileResult.value[0] ?? null : null,
    // Learner surface: public attribution only, never the stored provider identity.
    latestEvaluation: latestEvaluationResult.status === "fulfilled" && latestEvaluationResult.value[0]
      ? { ...latestEvaluationResult.value[0], checkedByName: PUBLIC_CHECKED_BY }
      : null,
    vocabDueCount: countValue(vocabDueResult),
    streak: streakResult.status === "fulfilled" ? streakResult.value : null,
    writingAttempts: countValue(submissionCountResult),
    skillCounts: {
      reading: countValue(readingCountResult),
      listening: countValue(listeningCountResult),
      speaking: countValue(speakingCountResult),
      writing: countValue(submissionCountResult),
    },
    openAssignments: assignmentsResult.status === "fulfilled"
      ? assignmentsResult.value.map((row) => ({
          id: row.id,
          title: row.title,
          status: row.status,
          dueAt: row.dueAt ? row.dueAt.toISOString() : null,
        }))
      : null,
    nextLiveClass: upcomingClass
      ? {
          id: upcomingClass.id,
          title: upcomingClass.title,
          scheduledAt: upcomingClass.scheduledAt.toISOString(),
        }
      : null,
    lastActivity: lastActivityResult.status === "fulfilled" ? lastActivityResult.value : null,
    unavailable: {
      profile: profileResult.status === "rejected",
      latestEvaluation: latestEvaluationResult.status === "rejected",
      vocabDue: vocabDueResult.status === "rejected",
      streak: streakResult.status === "rejected",
      writingAttempts: submissionCountResult.status === "rejected",
      readingAttempts: readingCountResult.status === "rejected",
      listeningAttempts: listeningCountResult.status === "rejected",
      speakingAttempts: speakingCountResult.status === "rejected",
      assignments: assignmentsResult.status === "rejected",
      nextLiveClass: upcomingResult.status === "rejected",
      lastActivity: lastActivityResult.status === "rejected",
    },
  };
}

/** The independently streamed "What's open now" roadmap region on Dashboard. */
export async function getDashboardOpenLessons(userId: string) {
  const roadmap = await getCourseRoadmap("ielts", userId);
  return (roadmap?.modules ?? [])
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
}
