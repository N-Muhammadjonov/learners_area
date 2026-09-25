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
  const [readingRows, listeningRows, speakingRows] = await Promise.all([
    db
      .select({ status: readingAttempts.status, score: readingAttempts.score, total: readingAttempts.totalQuestions })
      .from(readingAttempts)
      .where(eq(readingAttempts.userId, userId)),
    db
      .select({ status: listeningAttempts.status, score: listeningAttempts.score, total: listeningAttempts.totalQuestions })
      .from(listeningAttempts)
      .where(eq(listeningAttempts.userId, userId)),
    db
      .select({ status: speakingAttempts.status, provider: speakingAttempts.transcriptProvider })
      .from(speakingAttempts)
      .where(eq(speakingAttempts.userId, userId)),
  ]);

  const reading: AttemptStats = { attempts: readingRows.length, submitted: 0, score: 0, total: 0 };
  for (const row of readingRows) {
    if (row.status === "completed") {
      reading.submitted += 1;
      reading.score += row.score ?? 0;
      reading.total += row.total ?? 0;
    }
  }

  const listening: AttemptStats = { attempts: listeningRows.length, submitted: 0, score: 0, total: 0 };
  for (const row of listeningRows) {
    if (row.status === "completed") {
      listening.submitted += 1;
      listening.score += row.score ?? 0;
      listening.total += row.total ?? 0;
    }
  }

  const [writing, vocab, lessonStats, assignmentRows, mocks] = await Promise.all([
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
  ]);

  const totalLessons = await db.select({ total: count() }).from(lessons);
  const openLessons = await db
    .select({ total: count() })
    .from(lessons)
    .where(ne(lessons.defaultState, "locked"));

  const vocabByState = new Map(vocab.map((row) => [row.state, Number(row.total)]));
  const lessonByState = new Map(lessonStats.map((row) => [row.state, Number(row.total)]));
  const assignmentByStatus = new Map(assignmentRows.map((row) => [row.status, Number(row.total)]));

  const dueVocab = await db
    .select({ total: count() })
    .from(userVocabulary)
    .where(
      and(
        eq(userVocabulary.userId, userId),
        lte(userVocabulary.nextReviewAt, new Date()),
        ne(userVocabulary.state, "mastered")
      )
    );

  const latestWritingEvaluation = await db
    .select({ overallEstimate: evaluations.overallEstimate, createdAt: evaluations.createdAt })
    .from(evaluations)
    .where(and(eq(evaluations.userId, userId), eq(evaluations.sourceType, "writing_submission")))
    .orderBy(desc(evaluations.createdAt))
    .limit(1);

  const finishedMocks = mocks.filter((m) => m.finishedAt);
  const bands = finishedMocks.map((m) => m.band).filter((b): b is number => typeof b === "number");

  return {
    reading: { ...reading, accuracy: ratio(reading) },
    listening: { ...listening, accuracy: ratio(listening) },
    speaking: {
      attempts: speakingRows.length,
      submitted: speakingRows.filter((r) => r.status !== "recording").length,
      /** Text that came from the browser or a human — never an acoustic score. */
      transcribed: speakingRows.filter((r) => r.provider !== null).length,
    },
    writing: {
      submissions: Number(writing[0]?.submissions ?? 0),
      latestBand: latestWritingEvaluation[0]?.overallEstimate ?? null,
      latestEvaluationAt: latestWritingEvaluation[0]?.createdAt ?? null,
      lastSubmittedAt: writing[0]?.lastSubmittedAt ?? null,
    },
    vocabulary: {
      total: [...vocabByState.values()].reduce((a, b) => a + b, 0),
      due: Number(dueVocab[0]?.total ?? 0),
      byState: {
        new: vocabByState.get("new") ?? 0,
        learning: vocabByState.get("learning") ?? 0,
        review: vocabByState.get("review") ?? 0,
        known: vocabByState.get("known") ?? 0,
        mastered: vocabByState.get("mastered") ?? 0,
        activated: vocabByState.get("activated") ?? 0,
      },
    },
    lessons: {
      total: Number(totalLessons[0]?.total ?? 0),
      open: Number(openLessons[0]?.total ?? 0),
      inProgress: lessonByState.get("in_progress") ?? 0,
      completed: lessonByState.get("completed") ?? 0,
    },
    assignments: {
      total: [...assignmentByStatus.values()].reduce((a, b) => a + b, 0),
      open: [...assignmentByStatus.entries()].filter(([status]) => status !== "completed").reduce((sum, [, n]) => sum + n, 0),
      completed: assignmentByStatus.get("completed") ?? 0,
    },
    mocks: {
      attempts: mocks.length,
      finished: finishedMocks.length,
      bestBand: bands.length ? Math.max(...bands) : null,
    },
  };
}
