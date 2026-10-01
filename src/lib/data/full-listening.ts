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
export async function fullListeningDetail(testId: string, role: Role) {
  if (!(await listeningSchemaReady())) return null;
  const rows = await db
    .select({ test: listeningTests, pkg: listeningPackages })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(eq(listeningTests.id, testId));
  const row = rows[0];
  return row && (isStaff(role) || isLive(row.test)) ? row : null;
}
export async function fullListeningProgress(userId: string, testId: string) {
  const [exam, runs, completed] = await Promise.all([
    db
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
    db
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

    db
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
export async function fullListeningCards(userId: string, page = 1) {
  if (!(await listeningSchemaReady())) return { rows: [], hasMore: false };
  const rows = await db
    .select({
      id: listeningTests.id,
      title: listeningTests.title,
      sourceId: listeningPackages.sourceId,
      duration: sql<number>`(${listeningPackages.payload}->'audio'->>'durationSec')::real`,
      createdAt: listeningTests.createdAt,
      completed: sql<number>`(case when exists(select 1 from listening_attempts a where a.test_id=${listeningTests.id} and a.user_id=${userId} and a.status='completed') then 1 else 0 end) + (select count(distinct r.activity)::integer from listening_activity_runs r where r.test_id=${listeningTests.id} and r.user_id=${userId} and r.completed=true and r.speed_rate is null)`,
      started: sql<boolean>`exists(select 1 from listening_attempts a where a.test_id=${listeningTests.id} and a.user_id=${userId})`,
    })
    .from(listeningPackages)
    .innerJoin(listeningTests, eq(listeningTests.id, listeningPackages.testId))
    .where(liveWhere(listeningTests))
    .orderBy(desc(listeningTests.createdAt))
    .limit(101)
    .offset((page - 1) * 100);
  return { rows: rows.slice(0, 100), hasMore: rows.length > 100 };
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
