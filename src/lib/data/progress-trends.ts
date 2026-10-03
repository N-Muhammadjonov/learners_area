import "server-only";
import { and, eq, gte, inArray, isNotNull, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { db } from "@/db/client";
import { evaluations, listeningAttempts, readingAttempts, retentionAttempts, writingSubmissions } from "@/db/schema";
import { RETENTION_LEVELS, type RetentionLevel } from "@/lib/retention/levels";
import { TIMEZONE } from "@/lib/time";
import {
  HEATMAP_WEEKS,
  activityHeatmap,
  retentionLevelTrends,
  weeklyAccuracy,
  weeklyBand,
} from "@/lib/progress/trends";

export type ProgressTrends = Awaited<ReturnType<typeof getProgressTrends>>;

/**
 * Calendar day in the product timezone, as text (never a driver-parsed Date).
 * The zone is a fixed server constant inlined as a literal so SELECT and GROUP BY
 * are the identical expression (a bound parameter would differ per position).
 */
const ZONE = sql.raw(`'${TIMEZONE.replace(/'/g, "")}'`);
const dayOf = (column: AnyPgColumn): SQL<string> => sql<string>`to_char((${column} at time zone ${ZONE})::date, 'YYYY-MM-DD')`;
/** Midday UTC of a calendar day: maps back to the same day key for any offset within ±11h. */
const dayAt = (day: string) => new Date(`${day}T12:00:00Z`);

/**
 * N08 — trends from real rows only, user-scoped, uncached. Every source is
 * aggregated per calendar day IN THE DATABASE, so the result is exact for any
 * number of attempts (no row cap, no silent truncation) and the transfer is
 * bounded by days in the window, not by activity volume. Each source fails
 * independently: a failed source is `null` (shown as unavailable), never zeros.
 * Retention reads only finalized attempts' score/level/time — never the source
 * text, rubric or recall.
 */
export async function getProgressTrends(userId: string, now = new Date()) {
  const since = new Date(now.getTime() - (HEATMAP_WEEKS * 7 + 1) * 86_400_000);

  const gradedDays = (
    table: typeof readingAttempts | typeof listeningAttempts,
  ) => {
    const day = dayOf(table.submittedAt);
    return db
      .select({
        day,
        score: sql<number>`coalesce(sum(${table.score}), 0)::int`,
        total: sql<number>`coalesce(sum(${table.totalQuestions}), 0)::int`,
        count: sql<number>`count(*)::int`,
      })
      .from(table)
      .where(and(eq(table.userId, userId), eq(table.status, "completed"), gte(table.submittedAt, since), isNotNull(table.score), sql`${table.totalQuestions} > 0`))
      .groupBy(day);
  };
  const bandDays = (sourceType: string) => {
    const day = dayOf(evaluations.createdAt);
    return db
      .select({ day, band: sql<number>`sum(${evaluations.overallEstimate})::float8`, count: sql<number>`count(*)::int` })
      .from(evaluations)
      .where(and(eq(evaluations.userId, userId), eq(evaluations.sourceType, sourceType), isNotNull(evaluations.overallEstimate), gte(evaluations.createdAt, since)))
      .groupBy(day);
  };
  const submittedDay = dayOf(writingSubmissions.submittedAt);
  const retentionDay = dayOf(retentionAttempts.completedAt);
  const retentionWhere = and(
    eq(retentionAttempts.userId, userId),
    inArray(retentionAttempts.status, ["completed", "timed_out"]),
    isNotNull(retentionAttempts.score),
    gte(retentionAttempts.completedAt, since),
  );

  const [reading, listening, writingBands, writingSubmitted, retentionAgg, retentionRecent, retentionActivity, speakingBands] =
    await Promise.allSettled([
      gradedDays(readingAttempts),
      gradedDays(listeningAttempts),
      bandDays("writing_submission"),
      db.select({ day: submittedDay, count: sql<number>`count(*)::int` })
        .from(writingSubmissions)
        .where(and(eq(writingSubmissions.userId, userId), isNotNull(writingSubmissions.submittedAt), gte(writingSubmissions.submittedAt, since)))
        .groupBy(submittedDay),
      db.select({
        level: retentionAttempts.level,
        attempts: sql<number>`count(*)::int`,
        texts: sql<number>`count(distinct ${retentionAttempts.retentionTextId})::int`,
        best: sql<number>`max(${retentionAttempts.score})::int`,
      })
        .from(retentionAttempts)
        .where(retentionWhere)
        .groupBy(retentionAttempts.level),
      // Last five finalized scores per level, newest first, via a window (bounded: 5 × levels).
      db.execute(sql`
        select level, score, to_char(completed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at, retention_text_id as text_id
        from (
          select level, score, completed_at, retention_text_id,
                 row_number() over (partition by level order by completed_at desc, id desc) as rn
          from ${retentionAttempts}
          where ${retentionWhere}
        ) ranked
        where rn <= 5`),
      db.select({ day: retentionDay, count: sql<number>`count(*)::int` })
        .from(retentionAttempts)
        .where(retentionWhere)
        .groupBy(retentionDay),
      // Speaking: only stored evaluation estimates; never the self-reported profile bands.
      bandDays("speaking_attempt"),
    ]);

  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const graded = (rows: { day: string; score: number; total: number; count: number }[] | null) =>
    rows?.map((r) => ({ at: dayAt(r.day), score: Number(r.score), total: Number(r.total), count: Number(r.count) })) ?? null;
  const bands = (rows: { day: string; band: number; count: number }[] | null) =>
    rows?.map((r) => ({ at: dayAt(r.day), band: Number(r.band), count: Number(r.count) })) ?? null;
  const days = (rows: { day: string; count: number }[] | null) =>
    rows?.flatMap((r) => (r.day ? [{ at: dayAt(r.day), count: Number(r.count) }] : [])) ?? null;

  const readingRows = graded(ok(reading));
  const listeningRows = graded(ok(listening));
  const bandRows = bands(ok(writingBands));
  const speakingRows = bands(ok(speakingBands));
  const submittedDays = days(ok(writingSubmitted));
  const retentionDays = days(ok(retentionActivity));

  const agg = ok(retentionAgg);
  const recentResult = ok(retentionRecent);
  type RecentRow = { level: RetentionLevel; score: number; at: string; text_id: string };
  // node-postgres and PGlite both return `{ rows }` from execute().
  const recentRows = recentResult ? (recentResult as unknown as { rows: RecentRow[] }).rows : null;
  const retention =
    agg && recentRows
      ? retentionLevelTrends(
          recentRows.map((r) => ({ at: new Date(r.at), level: r.level, score: Number(r.score), textId: r.text_id })),
          RETENTION_LEVELS,
        ).map((trend) => {
          // Series fields come from the last five; totals come from the full aggregate.
          const full = agg.find((a) => a.level === trend.level);
          return { ...trend, attempts: full?.attempts ?? 0, textsCompleted: full?.texts ?? 0, best: full ? full.best : null };
        })
      : null;

  const sources = [readingRows, listeningRows, submittedDays, retentionDays];
  const activity = sources.every((s) => s !== null)
    ? [...readingRows!, ...listeningRows!, ...submittedDays!, ...retentionDays!].map((r) => ({ at: r.at, count: r.count }))
    : null;

  return {
    reading: readingRows && weeklyAccuracy(readingRows, now),
    listening: listeningRows && weeklyAccuracy(listeningRows, now),
    writing: bandRows && weeklyBand(bandRows, now),
    speaking: speakingRows && weeklyBand(speakingRows, now),
    heatmap: activity && activityHeatmap(activity, now),
    retention,
  };
}
