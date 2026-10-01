import "server-only";
import { and, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { evaluations, listeningAttempts, readingAttempts, retentionAttempts, writingSubmissions } from "@/db/schema";
import { RETENTION_LEVELS } from "@/lib/retention/levels";
import {
  HEATMAP_WEEKS,
  activityHeatmap,
  retentionLevelTrends,
  weeklyAccuracy,
  weeklyBand,
} from "@/lib/progress/trends";

/** Hard row bound per source; the window is 12 weeks so this is generous. */
const ROW_CAP = 1_000;

export type ProgressTrends = Awaited<ReturnType<typeof getProgressTrends>>;

/**
 * N08 — trends from real rows only, user-scoped, bounded, uncached. Each source
 * fails independently: a failed source is `null` (shown as unavailable), never
 * zeros. Retention reads only finalized attempts' score/level/time — never the
 * source text, rubric or recall.
 */
export async function getProgressTrends(userId: string, now = new Date()) {
  const since = new Date(now.getTime() - (HEATMAP_WEEKS * 7 + 1) * 86_400_000);
  const [reading, listening, writingBands, writingSubmitted, retention] = await Promise.allSettled([
    db.select({ at: readingAttempts.submittedAt, score: readingAttempts.score, total: readingAttempts.totalQuestions })
      .from(readingAttempts)
      .where(and(eq(readingAttempts.userId, userId), eq(readingAttempts.status, "completed"), gte(readingAttempts.submittedAt, since)))
      .limit(ROW_CAP),
    db.select({ at: listeningAttempts.submittedAt, score: listeningAttempts.score, total: listeningAttempts.totalQuestions })
      .from(listeningAttempts)
      .where(and(eq(listeningAttempts.userId, userId), eq(listeningAttempts.status, "completed"), gte(listeningAttempts.submittedAt, since)))
      .limit(ROW_CAP),
    db.select({ at: evaluations.createdAt, band: evaluations.overallEstimate })
      .from(evaluations)
      .where(and(eq(evaluations.userId, userId), eq(evaluations.sourceType, "writing_submission"), isNotNull(evaluations.overallEstimate), gte(evaluations.createdAt, since)))
      .limit(ROW_CAP),
    db.select({ at: writingSubmissions.submittedAt })
      .from(writingSubmissions)
      .where(and(eq(writingSubmissions.userId, userId), isNotNull(writingSubmissions.submittedAt), gte(writingSubmissions.submittedAt, since)))
      .limit(ROW_CAP),
    db.select({ at: retentionAttempts.completedAt, level: retentionAttempts.level, score: retentionAttempts.score })
      .from(retentionAttempts)
      .where(and(eq(retentionAttempts.userId, userId), inArray(retentionAttempts.status, ["completed", "timed_out"]), isNotNull(retentionAttempts.score), gte(retentionAttempts.completedAt, since)))
      .limit(ROW_CAP),
  ]);

  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const graded = (rows: { at: Date | null; score: number | null; total: number | null }[] | null) =>
    rows?.flatMap((r) => (r.at && r.score !== null && r.total ? [{ at: r.at, score: r.score, total: r.total }] : [])) ?? null;

  const readingRows = graded(ok(reading));
  const listeningRows = graded(ok(listening));
  const bandRows = ok(writingBands)?.flatMap((r) => (r.band === null ? [] : [{ at: r.at, band: r.band }])) ?? null;
  const submittedRows = ok(writingSubmitted);
  const retentionRows = ok(retention)?.flatMap((r) => (r.at && r.score !== null ? [{ at: r.at, level: r.level, score: r.score }] : [])) ?? null;

  const sources = [readingRows, listeningRows, submittedRows, retentionRows];
  const activity = sources.every((s) => s !== null)
    ? [...readingRows!.map((r) => r.at), ...listeningRows!.map((r) => r.at), ...submittedRows!.flatMap((r) => (r.at ? [r.at] : [])), ...retentionRows!.map((r) => r.at)]
    : null;

  return {
    reading: readingRows && weeklyAccuracy(readingRows, now),
    listening: listeningRows && weeklyAccuracy(listeningRows, now),
    writing: bandRows && weeklyBand(bandRows, now),
    heatmap: activity && activityHeatmap(activity, now),
    retention: retentionRows && retentionLevelTrends(retentionRows, RETENTION_LEVELS),
  };
}
