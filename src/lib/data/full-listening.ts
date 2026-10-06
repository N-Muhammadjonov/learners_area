import "server-only";
import { listeningSchemaReady } from "./listening-schema-ready";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  listeningActivityRuns,
  listeningAttempts,
  listeningPackages,
  listeningTests,
} from "@/db/schema";
import { liveWhere, isLive } from "@/lib/services/cms/publication";
import { isStaff, type Role } from "@/lib/auth/roles";
/**
 * `database` is an optional executor, so a test can drive the same read against a real
 * PostgreSQL it owns (the repository-wide convention for pglite/Q2 tests) instead of being
 * re-implemented by the test.
 */
export async function fullListeningDetail(testId: string, role: Role, database: typeof db = db) {
  if (!(await listeningSchemaReady(database))) return null;
  const rows = await database
    .select({ test: listeningTests, pkg: listeningPackages })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(eq(listeningTests.id, testId));
  const row = rows[0];
  return row && (isStaff(role) || isLive(row.test)) ? row : null;
}
export async function fullListeningProgress(userId: string, testId: string, database: typeof db = db) {
  const exec = database;
  const [exam, runs, completed] = await Promise.all([
    exec
      .select({
        id: listeningAttempts.id,
        score: listeningAttempts.score,
        total: listeningAttempts.totalQuestions,
      })
      .from(listeningAttempts)
      .where(
        and(
          eq(listeningAttempts.userId, userId),
          eq(listeningAttempts.testId, testId),
          eq(listeningAttempts.status, "completed"),
        ),
      )
      .orderBy(desc(listeningAttempts.submittedAt))
      .limit(1),
    exec
      .selectDistinctOn([listeningActivityRuns.activity])
      .from(listeningActivityRuns)
      .where(
        and(
          eq(listeningActivityRuns.userId, userId),
          eq(listeningActivityRuns.testId, testId),
          isNull(listeningActivityRuns.speedRate),
        ),
      )
      .orderBy(
        listeningActivityRuns.activity,
        desc(listeningActivityRuns.createdAt),
      ),

    exec
      .selectDistinctOn([listeningActivityRuns.activity], {
        activity: listeningActivityRuns.activity,
      })
      .from(listeningActivityRuns)
      .where(
        and(
          eq(listeningActivityRuns.userId, userId),
          eq(listeningActivityRuns.testId, testId),
          eq(listeningActivityRuns.completed, true),
          isNull(listeningActivityRuns.speedRate),
        ),
      ),
  ]);
  return {
    exam: exam[0] ?? null,
    activities: [1, 2, 3, 4, 5].map((activity) => ({
      activity,
      complete:
        activity === 1
          ? !!exam[0]
          : completed.some((x) => x.activity === activity),
      latest: runs.find((x) => x.activity === activity) ?? null,
    })),
  };
}
/** Only small card metadata and SQL aggregate progress are loaded. No MP3 or full source payload. */
export async function fullListeningCards(userId: string, page = 1, management = false) {
  if (!(await listeningSchemaReady())) return { rows: [], hasMore: false, unavailable: true };
  const rows = await db
    .select({
      id: listeningTests.id,
      title: listeningTests.title,
      sourceId: listeningPackages.sourceId,
      authoredRuntime: sql<boolean>`${listeningPackages.payload}->'authoredRuntime' is not null`,
      collection: sql<string>`coalesce(${listeningPackages.payload}->>'collection', 'academic')`,
      activityCount: sql<number>`case when ${listeningPackages.payload}->'studyPack'->'activities' is not null then jsonb_array_length(${listeningPackages.payload}->'studyPack'->'activities') when ${listeningPackages.payload}->'studyPack' is not null then 6 else 2 + case when jsonb_array_length(${listeningPackages.payload}->'keyword1') > 0 then 1 else 0 end + case when jsonb_array_length(${listeningPackages.payload}->'keyword2') > 0 then 1 else 0 end + case when jsonb_array_length(${listeningPackages.payload}->'vocabulary') > 0 then 1 else 0 end end`,
      sectionNumbers: sql<number[]>`(select jsonb_agg((s->>'number')::integer) from jsonb_array_elements(${listeningPackages.payload}->'sections') s)`,
      duration: sql<number>`(${listeningPackages.payload}->'audio'->>'durationSec')::real`,
      createdAt: listeningTests.createdAt,
      completed: sql<number>`(case when exists(select 1 from listening_attempts a where a.test_id=${listeningTests.id} and a.user_id=${userId} and a.status='completed') then 1 else 0 end) + (select count(distinct (r.activity::text || coalesce(r.answers->>'_practice','')))::integer from listening_activity_runs r where r.test_id=${listeningTests.id} and r.user_id=${userId} and r.completed=true and r.speed_rate is null) + (case when ${listeningPackages.payload}->'studyPack' is not null and exists(select 1 from listening_questions q where q.test_id=${listeningTests.id} and q.type='multiple_choice') and not exists(select 1 from listening_questions q where q.test_id=${listeningTests.id} and q.type='multiple_choice' and not exists(select 1 from listening_mcq_sessions s where s.question_id=q.id and s.user_id=${userId} and s.stage='reasoned')) then 1 else 0 end)`,
      started: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id=${listeningTests.id} and a.user_id=${userId})`,
    })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(management ? sql`${listeningTests.publicationState} <> 'archived'` : liveWhere(listeningTests))
    .orderBy(desc(listeningTests.createdAt))
    .limit(101)
    .offset((page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100, unavailable: false };
}
export async function hasFullExam(userId: string, testId: string) {
  const rows = await db
    .select({ id: listeningAttempts.id })
    .from(listeningAttempts)
    .where(
      and(
        eq(listeningAttempts.userId, userId),
        eq(listeningAttempts.testId, testId),
        eq(listeningAttempts.status, "completed"),
      ),
    )
    .limit(1);
  return !!rows[0];
}
export async function completedActivityCount(
  userId: string,
  testIds: string[],
) {
  if (!testIds.length) return [];
  return db
    .select()
    .from(listeningActivityRuns)
    .where(
      and(
        eq(listeningActivityRuns.userId, userId),
        inArray(listeningActivityRuns.testId, testIds),
      ),
    );
}

export async function allowedListeningSpeeds(userId: string, testId: string) {
  const exams = await db
    .select({
      score: listeningAttempts.score,
      total: listeningAttempts.totalQuestions,
    })
    .from(listeningAttempts)
    .where(
      and(
        eq(listeningAttempts.userId, userId),
        eq(listeningAttempts.testId, testId),
        eq(listeningAttempts.status, "completed"),
      ),
    );
  const runs = await db
    .select()
    .from(listeningActivityRuns)
    .where(
      and(
        eq(listeningActivityRuns.userId, userId),
        eq(listeningActivityRuns.testId, testId),
        eq(listeningActivityRuns.activity, 2),
      ),
    );
  const rates = [1, 1.25, 1.5, 1.75, 2];
  const allowed = [1];
  const { SPEED_UNLOCK_RATIO } = await import(
    "@/lib/services/listening/speed-training"
  );
  for (let i = 1; i < rates.length; i++) {
    const prior = rates[i - 1]!;
    const passed =
      prior === 1
        ? exams.some(
            (a) =>
              a.total &&
              a.score !== null &&
              a.score / a.total >= SPEED_UNLOCK_RATIO,
          )
        : runs.some(
            (r) =>
              r.speedRate === prior &&
              r.completed &&
              r.total &&
              r.score !== null &&
              r.score / r.total >= SPEED_UNLOCK_RATIO,
          );
    if (!passed) break;
    allowed.push(rates[i]!);
  }
  return allowed;
}

/** Exam state the Listening lexical policy needs (src/lib/listening/lexical-policy.ts). */
export async function listeningExamState(user: { id: string; role: Role }, testId: string) {
  const rows = await db
    .select({ status: listeningAttempts.status })
    .from(listeningAttempts)
    .where(and(eq(listeningAttempts.userId, user.id), eq(listeningAttempts.testId, testId)));
  return {
    submitted: rows.some((row) => row.status === "completed"),
    examInProgress: rows.some((row) => row.status === "in_progress"),
    staff: isStaff(user.role),
  };
}

/** Trainer progress shares the existing practice-run table with an explicit scoped discriminator. */
export async function listeningPracticeProgress(userId: string, testId: string, database: typeof db = db) {
  const runs = await database.select().from(listeningActivityRuns).where(and(eq(listeningActivityRuns.userId,userId),eq(listeningActivityRuns.testId,testId),eq(listeningActivityRuns.activity,4),sql`${listeningActivityRuns.answers}->>'_practice' is not null`)).orderBy(desc(listeningActivityRuns.createdAt)).limit(200);
  const progress: Record<string, { complete: boolean; latest: typeof listeningActivityRuns.$inferSelect }> = {};
  for (const run of runs) { const kind = run.answers._practice; if (!kind) continue; if (!progress[kind]) progress[kind] = { complete: false, latest: run }; if (run.completed) progress[kind]!.complete = true; }
  return progress;
}
