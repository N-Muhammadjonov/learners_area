import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  listeningTests,
  listeningQuestions,
  listeningAttempts,
  listeningAnswers,
  listeningMcqSessions,
} from "@/db/schema";
import { isLive, liveWhere } from "@/lib/services/cms/publication";
import { collectionTabSql } from "@/lib/listening/product";

export async function listActiveTests() {
  const { listeningSchemaReady } = await import("./listening-schema-ready");
  const ready = await listeningSchemaReady();
  return db.select({
    id: listeningTests.id,
    title: listeningTests.title,
    difficultyLevel: listeningTests.difficultyLevel,
  })
    .from(listeningTests)
    .where(and(liveWhere({
      publicationState: listeningTests.publicationState,
      publishAt: listeningTests.publishAt,
    }), ready ? sql`not exists(select 1 from listening_packages p where p.test_id=${listeningTests.id})` : undefined))
    .orderBy(asc(listeningTests.createdAt));
}

/** As with Reading: a test a student may begin, and only that. */
export async function getStartableTest(testId: string) {
  const test = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, testId) });
  if (!test || !isLive(test)) return null;
  const question = await db.query.listeningQuestions.findFirst({ where: eq(listeningQuestions.testId, testId) });
  if (!question) return null;
  return test;
}

export async function getTestWithQuestions(testId: string) {
  const test = await db.query.listeningTests.findFirst({ where: eq(listeningTests.id, testId) });
  if (!test) return null;
  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, testId),
    orderBy: asc(listeningQuestions.order),
  });
  return { test, questions };
}

export async function getAttemptDetail(attemptId: string, userId: string) {
  const attempt = await db.query.listeningAttempts.findFirst({
    where: and(eq(listeningAttempts.id, attemptId), eq(listeningAttempts.userId, userId)),
  });
  if (!attempt) return null;

  const [testData, answers] = await Promise.all([
    getTestWithQuestions(attempt.testId),
    db.query.listeningAnswers.findMany({ where: eq(listeningAnswers.attemptId, attemptId) }),
  ]);
  if (!testData) return null;

  return { attempt, test: testData.test, questions: testData.questions, answers };
}

export function listUserAttempts(userId: string) {
  return db
    .select({ attempt: listeningAttempts, test: listeningTests })
    .from(listeningAttempts)
    .innerJoin(listeningTests, eq(listeningAttempts.testId, listeningTests.id))
    .where(eq(listeningAttempts.userId, userId))
    .orderBy(desc(listeningAttempts.startedAt));
}

/**
 * The keywords and audio→question paraphrase pairs that were authored for a
 * test's questions. Nothing is inferred from the transcript: a question with no
 * authored keywords simply does not appear, and the panel shows an empty state.
 */
export async function getTestKeywordTable(testId: string) {
  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, testId),
    orderBy: asc(listeningQuestions.order),
  });

  return questions
    .filter((q) => (q.keywords && q.keywords.trim()) || (q.paraphrases && q.paraphrases.length > 0))
    .map((q) => ({
      id: q.id,
      order: q.order,
      questionText: q.questionText,
      keywords: (q.keywords ?? "")
        .split("·")
        .map((k) => k.trim())
        .filter(Boolean),
      paraphrases: q.paraphrases ?? [],
    }));
}

/**
 * The mistake map: what this student actually got wrong, taken from their own
 * graded answers only. Two views of the same rows:
 *
 * - `byType` — accuracy per question type, so a pattern ("I lose marks on
 *   short answers") is visible;
 * - `recent` — the individual misses, with the student's answer next to the key,
 *   so it is actionable.
 */
export async function getListeningMistakeMap(userId: string) {
  const rows = await db
    .select({
      questionId: listeningQuestions.id,
      type: listeningQuestions.type,
      questionText: listeningQuestions.questionText,
      correctAnswer: listeningQuestions.correctAnswer,
      explanation: listeningQuestions.explanation,
      isCorrect: listeningAnswers.isCorrect,
      userAnswer: listeningAnswers.userAnswer,
      testId: listeningTests.id,
      testTitle: listeningTests.title,
      submittedAt: listeningAttempts.submittedAt,
    })
    .from(listeningAnswers)
    .innerJoin(listeningAttempts, eq(listeningAnswers.attemptId, listeningAttempts.id))
    .innerJoin(listeningQuestions, eq(listeningAnswers.questionId, listeningQuestions.id))
    .innerJoin(listeningTests, eq(listeningAttempts.testId, listeningTests.id))
    .where(eq(listeningAttempts.userId, userId))
    .orderBy(desc(listeningAttempts.submittedAt));

  const byType = new Map<string, { type: string; total: number; correct: number }>();
  for (const row of rows) {
    const entry = byType.get(row.type) ?? { type: row.type, total: 0, correct: 0 };
    entry.total += 1;
    if (row.isCorrect) entry.correct += 1;
    byType.set(row.type, entry);
  }

  const types = [...byType.values()]
    .map((entry) => ({
      ...entry,
      accuracy: entry.total ? entry.correct / entry.total : 0,
    }))
    .sort((a, b) => a.accuracy - b.accuracy);

  return {
    byType: types,
    /** The weakest type with at least one graded answer — null when there is no history. */
    weakest: types[0] ?? null,
    recent: rows
      .filter((row) => row.isCorrect === false)
      .slice(0, 12)
      .map((row) => ({
        questionId: row.questionId,
        type: row.type,
        testId: row.testId,
        testTitle: row.testTitle,
        questionText: row.questionText,
        userAnswer: row.userAnswer,
        correctAnswer: row.correctAnswer,
        explanation: row.explanation,
      })),
  };
}

/** This student's submitted attempts for one test, for the Speed Training gate. */
export function listSubmittedAttempts(userId: string, testId: string) {
  return db
    .select({ score: listeningAttempts.score, total: listeningAttempts.totalQuestions })
    .from(listeningAttempts)
    .where(
      and(
        eq(listeningAttempts.userId, userId),
        eq(listeningAttempts.testId, testId),
        eq(listeningAttempts.status, "completed")
      )
    );
}

/** The multiple-choice questions of a test, in order — used by MCQ Mastery. */
export function listMcqQuestions(testId: string) {
  return db.query.listeningQuestions.findMany({
    where: and(eq(listeningQuestions.testId, testId), eq(listeningQuestions.type, "multiple_choice")),
    orderBy: asc(listeningQuestions.order),
  });
}

/**
 * A student's own MCQ sessions for one test, keyed by question, so the drill
 * resumes where it was left instead of restarting (or, worse, jumping straight
 * to the options).
 */
export async function listMcqSessions(userId: string, testId: string) {
  const rows = await db.query.listeningMcqSessions.findMany({
    where: and(eq(listeningMcqSessions.userId, userId), eq(listeningMcqSessions.testId, testId)),
  });
  return new Map(rows.map((row) => [row.questionId, row]));
}

export async function getOwnedMcqSession(userId: string, sessionId: string) {
  return (
    (await db.query.listeningMcqSessions.findFirst({
      where: and(eq(listeningMcqSessions.id, sessionId), eq(listeningMcqSessions.userId, userId)),
    })) ?? null
  );
}

/**
 * Tests that carry NO canonical package, shown beside the packages in the shared library.
 *
 * Two corrections live here, both the same mistake in a second place — a card must never STATE
 * something untrue about its content:
 *
 *   1. The collection was hard-coded `'academic'`, so a Listening SECTION authored through the
 *      CMS was presented as Academic Listening. It is now read from the ONE classifier the
 *      catalogues use, which files a package-less row by the revision the CMS authored
 *      (`listening:full_test` → academic, `listening:section` → general) and leaves anything
 *      unprovable honestly `uncatalogued`.
 *   2. Every row claimed `40 questions`. A row with no package has whatever questions its
 *      canonical rows hold, so the card now states the REAL count.
 *
 * The attempt flags were also silently broken: the fragments interpolated a bare column, which
 * the database resolves INSIDE the subquery (`a.test_id = a.id`, i.e. never true), so a learner
 * with a finished attempt on a package-less test was never shown as having started it. The
 * references are qualified now.
 */
export async function legacyListeningCards(userId:string,management=false,database:typeof db=db) {
 const { listeningSchemaReady } = await import("./listening-schema-ready");
 const ready=await listeningSchemaReady(database);
 // Qualified on purpose: an unqualified `id` inside the subqueries binds to the ATTEMPT row.
 const testId=sql.raw('"listening_tests"."id"');
 return database.select({
  id:listeningTests.id,
  title:listeningTests.title,
  duration:sql<number>`0`,
  activityCount:sql<number>`1`,
  completed:sql<number>`case when exists(select 1 from listening_attempts a where a.test_id=${testId} and a.user_id=${userId} and a.status='completed') then 1 else 0 end`,
  started:sql<boolean>`exists(select 1 from listening_attempts a where a.test_id=${testId} and a.user_id=${userId})`,
  collection:collectionTabSql({testId,payload:sql`null::jsonb`,payloadIsNull:sql`true`}),
  questions:sql<number>`(select count(*)::int from listening_questions q where q.test_id=${testId})`,
  legacy:sql<boolean>`true`,
 }).from(listeningTests).where(and(management?sql`${listeningTests.publicationState} <> 'archived'`:liveWhere(listeningTests),ready?sql`not exists(select 1 from listening_packages p where p.test_id=${testId})`:undefined)).orderBy(asc(listeningTests.createdAt)).limit(200);
}
