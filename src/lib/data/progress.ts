import { and, count, desc, eq, lte, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  assignments,
  lessonProgress,
  lessons,
  listeningAttempts,
  evaluations,
  mockAttempts,
  readingAttempts,
  speakingAttempts,
  userVocabulary,
  writingSubmissions,
} from "@/db/schema";

export type ProgressData = Awaited<ReturnType<typeof getProgressData>>;

type AttemptStats = { attempts: number; submitted: number; score: number; total: number };

function ratio(stats: AttemptStats): number | null {
  return stats.submitted > 0 && stats.total > 0 ? Math.round((stats.score / stats.total) * 100) : null;
}

/**
 * Progress, from rows that exist.
 *
 * Every figure here is a count or an average of what the student has actually
 * submitted. Where a module cannot honestly produce a number — Speaking has no
 * acoustic score, by design — the page reports the count and says what the score
 * would need, instead of inventing one.
 */
export async function getProgressData(userId: string) {
  // Only aggregates are needed for this screen. Reading every historical attempt
  // row made route entry payload grow with a learner's history unnecessarily.
  // All widgets are independent, so issue the bounded aggregate reads in one
  // parallel batch and represent a failed widget as unavailable rather than zero.
  const [
    readingResult,
    listeningResult,
    speakingResult,
    writingResult,
    vocabularyResult,
    lessonStatesResult,
    assignmentsResult,
    mocksResult,
    lessonTotalsResult,
    dueVocabularyResult,
    writingEvaluationResult,
  ] = await Promise.allSettled([
    db.select({
      attempts: count(),
      submitted: sql<number>`count(*) filter (where ${readingAttempts.status} = 'completed')`,
      score: sql<number>`coalesce(sum(${readingAttempts.score}) filter (where ${readingAttempts.status} = 'completed'), 0)`,
      total: sql<number>`coalesce(sum(${readingAttempts.totalQuestions}) filter (where ${readingAttempts.status} = 'completed'), 0)`,
    }).from(readingAttempts).where(eq(readingAttempts.userId, userId)),
    db.select({
      attempts: count(),
      submitted: sql<number>`count(*) filter (where ${listeningAttempts.status} = 'completed')`,
      score: sql<number>`coalesce(sum(${listeningAttempts.score}) filter (where ${listeningAttempts.status} = 'completed'), 0)`,
      total: sql<number>`coalesce(sum(${listeningAttempts.totalQuestions}) filter (where ${listeningAttempts.status} = 'completed'), 0)`,
    }).from(listeningAttempts).where(eq(listeningAttempts.userId, userId)),
    db.select({
      attempts: count(),
      submitted: sql<number>`count(*) filter (where ${speakingAttempts.status} <> 'recording')`,
      transcribed: sql<number>`count(*) filter (where ${speakingAttempts.transcriptProvider} is not null)`,
    }).from(speakingAttempts).where(eq(speakingAttempts.userId, userId)),
    // A writing "band" is never computed here: it is shown only when an
    // evaluation exists, and the evaluation is where the estimate comes from.
    db
      .select({ submissions: count(), lastSubmittedAt: sql<Date | null>`max(${writingSubmissions.submittedAt})` })
      .from(writingSubmissions)
      .where(eq(writingSubmissions.userId, userId)),
    db
      .select({ state: userVocabulary.state, total: count() })
      .from(userVocabulary)
      .where(eq(userVocabulary.userId, userId))
      .groupBy(userVocabulary.state),
    db
      .select({ state: lessonProgress.state, total: count() })
      .from(lessonProgress)
      .where(eq(lessonProgress.userId, userId))
      .groupBy(lessonProgress.state),
    db
      .select({ status: assignments.status, total: count() })
      .from(assignments)
      .where(eq(assignments.targetUserId, userId))
      .groupBy(assignments.status),
    db
      .select({ finishedAt: mockAttempts.finishedAt, band: mockAttempts.estimatedBand })
      .from(mockAttempts)
      .where(eq(mockAttempts.userId, userId))
      .orderBy(desc(mockAttempts.startedAt))
      .limit(20),
    db.select({
      total: count(),
      open: sql<number>`count(*) filter (where ${lessons.defaultState} <> 'locked')`,
    }).from(lessons),
    db
      .select({ total: count() })
      .from(userVocabulary)
      .where(and(
        eq(userVocabulary.userId, userId),
        lte(userVocabulary.nextReviewAt, new Date()),
        ne(userVocabulary.state, "mastered"),
      )),
    db
      .select({ overallEstimate: evaluations.overallEstimate, createdAt: evaluations.createdAt })
      .from(evaluations)
      .where(and(eq(evaluations.userId, userId), eq(evaluations.sourceType, "writing_submission")))
      .orderBy(desc(evaluations.createdAt))
      .limit(1),
  ]);

  const readingRows = readingResult.status === "fulfilled" ? readingResult.value : null;
  const listeningRows = listeningResult.status === "fulfilled" ? listeningResult.value : null;
  const speakingRows = speakingResult.status === "fulfilled" ? speakingResult.value : null;
  const writingRows = writingResult.status === "fulfilled" ? writingResult.value : null;
  const vocabularyRows = vocabularyResult.status === "fulfilled" ? vocabularyResult.value : null;
  const lessonStateRows = lessonStatesResult.status === "fulfilled" ? lessonStatesResult.value : null;
  const assignmentRows = assignmentsResult.status === "fulfilled" ? assignmentsResult.value : null;
  const mockRows = mocksResult.status === "fulfilled" ? mocksResult.value : null;
  const lessonTotalsRows = lessonTotalsResult.status === "fulfilled" ? lessonTotalsResult.value : null;
  const dueVocabularyRows = dueVocabularyResult.status === "fulfilled" ? dueVocabularyResult.value : null;
  const writingEvaluationRows = writingEvaluationResult.status === "fulfilled" ? writingEvaluationResult.value : null;

  const reading: AttemptStats | null = readingRows ? {
    attempts: Number(readingRows[0]?.attempts ?? 0),
    submitted: Number(readingRows[0]?.submitted ?? 0),
    score: Number(readingRows[0]?.score ?? 0),
    total: Number(readingRows[0]?.total ?? 0),
  } : null;
  const listening: AttemptStats | null = listeningRows ? {
    attempts: Number(listeningRows[0]?.attempts ?? 0),
    submitted: Number(listeningRows[0]?.submitted ?? 0),
    score: Number(listeningRows[0]?.score ?? 0),
    total: Number(listeningRows[0]?.total ?? 0),
  } : null;

  const vocabByState = new Map((vocabularyRows ?? []).map((row) => [row.state, Number(row.total)]));
  const lessonByState = new Map((lessonStateRows ?? []).map((row) => [row.state, Number(row.total)]));
  const assignmentByStatus = new Map((assignmentRows ?? []).map((row) => [row.status, Number(row.total)]));
  const finishedMocks = (mockRows ?? []).filter((attempt) => attempt.finishedAt);
  const bands = finishedMocks.map((attempt) => attempt.band).filter((band): band is number => typeof band === "number");
  const submissions = writingRows?.[0]?.submissions;
  const latestWritingEvaluation = writingEvaluationRows?.[0];

  const unavailableRegions = [
    readingResult.status === "rejected" && "progress-reading",
    listeningResult.status === "rejected" && "progress-listening",
    speakingResult.status === "rejected" && "progress-speaking",
    writingResult.status === "rejected" && "progress-writing-submissions",
    writingEvaluationResult.status === "rejected" && "progress-writing-evaluation",
    vocabularyResult.status === "rejected" && "progress-vocabulary",
    dueVocabularyResult.status === "rejected" && "progress-vocabulary-due",
    lessonTotalsResult.status === "rejected" && "progress-lesson-catalogue",
    lessonStatesResult.status === "rejected" && "progress-lesson-state",
    assignmentsResult.status === "rejected" && "progress-assignments",
    mocksResult.status === "rejected" && "progress-mocks",
  ].filter((region): region is string => Boolean(region));

  return {
    reading: reading ? { ...reading, accuracy: ratio(reading) } : null,
    listening: listening ? { ...listening, accuracy: ratio(listening) } : null,
    speaking: speakingRows ? {
      attempts: Number(speakingRows[0]?.attempts ?? 0),
      submitted: Number(speakingRows[0]?.submitted ?? 0),
      /** Text that came from the browser or a human — never an acoustic score. */
      transcribed: Number(speakingRows[0]?.transcribed ?? 0),
    } : null,
    writing: {
      submissions: submissions == null ? null : Number(submissions),
      latestBand: latestWritingEvaluation?.overallEstimate ?? null,
      latestEvaluationAt: latestWritingEvaluation?.createdAt ?? null,
      lastSubmittedAt: writingRows?.[0]?.lastSubmittedAt ?? null,
      evaluationUnavailable: writingEvaluationResult.status === "rejected",
    },
    vocabulary: vocabularyRows ? {
      total: [...vocabByState.values()].reduce((sum, total) => sum + total, 0),
      due: dueVocabularyRows ? Number(dueVocabularyRows[0]?.total ?? 0) : null,
      byState: {
        new: vocabByState.get("new") ?? 0,
        learning: vocabByState.get("learning") ?? 0,
        review: vocabByState.get("review") ?? 0,
        known: vocabByState.get("known") ?? 0,
        mastered: vocabByState.get("mastered") ?? 0,
        activated: vocabByState.get("activated") ?? 0,
      },
    } : null,
    lessons: {
      total: lessonTotalsRows ? Number(lessonTotalsRows[0]?.total ?? 0) : null,
      open: lessonTotalsRows ? Number(lessonTotalsRows[0]?.open ?? 0) : null,
      inProgress: lessonStateRows ? lessonByState.get("in_progress") ?? 0 : null,
      completed: lessonStateRows ? lessonByState.get("completed") ?? 0 : null,
    },
    assignments: assignmentRows ? {
      total: [...assignmentByStatus.values()].reduce((sum, total) => sum + total, 0),
      open: [...assignmentByStatus.entries()].filter(([status]) => status !== "completed").reduce((sum, [, total]) => sum + total, 0),
      completed: assignmentByStatus.get("completed") ?? 0,
    } : null,
    mocks: mockRows ? {
      attempts: mockRows.length,
      finished: finishedMocks.length,
      bestBand: bands.length ? Math.max(...bands) : null,
    } : null,
    unavailableRegions,
  };
}
