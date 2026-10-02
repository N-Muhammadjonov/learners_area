import { tashkentDayKey } from "@/lib/time";
import type { RetentionLevel } from "@/lib/retention/levels";

/**
 * Pure shaping for the Progress trends (N08). Inputs are rows the learner
 * actually produced (graded attempts, stored evaluations, finalized Retention
 * attempts). Nothing is estimated, smoothed or taken from the profile's
 * self-reported band. An empty week stays `null` — never zero.
 */
export const TREND_WEEKS = 8;
export const HEATMAP_WEEKS = 12;
const DAY_MS = 86_400_000;

export type GradedRow = { at: Date; score: number; total: number };
export type BandRow = { at: Date; band: number };
export type RetentionRow = { at: Date; level: RetentionLevel; score: number; textId: string };
export type WeekPoint = { weekStart: string; value: number | null; count: number };

export type AccuracyBucket = {
  weekStart: string;
  score: number;
  total: number;
  count: number;
};

export type BandBucket = {
  weekStart: string;
  sum: number;
  count: number;
};

export type ActivityBucket = {
  day: string;
  count: number;
};

export type RetentionAggregate = {
  level: RetentionLevel;
  attempts: number;
  textsCompleted: number;
  best: number | null;
  /** Newest first, as returned by PostgreSQL array_agg(... ORDER BY completed_at DESC). */
  recentNewestFirst: number[];
};

/** Monday (YYYY-MM-DD, centre timezone) of the week containing `at`. */
export function weekStartKey(at: Date): string {
  const key = tashkentDayKey(at);
  const day = new Date(`${key}T00:00:00Z`);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS).toISOString().slice(0, 10);
}

export function weekKeys(now: Date, weeks: number): string[] {
  const current = new Date(`${weekStartKey(now)}T00:00:00Z`).getTime();
  return Array.from({ length: weeks }, (_, i) => new Date(current - (weeks - 1 - i) * 7 * DAY_MS).toISOString().slice(0, 10));
}

/** Weekly accuracy %, pooled (sum of scores / sum of questions) per week. */
export function weeklyAccuracy(rows: GradedRow[], now: Date, weeks = TREND_WEEKS): WeekPoint[] {
  const keys = weekKeys(now, weeks);
  const buckets = new Map(keys.map((k) => [k, { score: 0, total: 0, count: 0 }]));
  for (const row of rows) {
    const bucket = buckets.get(weekStartKey(row.at));
    if (!bucket || row.total <= 0) continue;
    bucket.score += row.score; bucket.total += row.total; bucket.count += 1;
  }
  return keys.map((weekStart) => {
    const b = buckets.get(weekStart)!;
    return { weekStart, count: b.count, value: b.total > 0 ? Math.round((b.score / b.total) * 100) : null };
  });
}

/**
 * Same calculation as weeklyAccuracy, but consumes database-side weekly
 * aggregates. This prevents large 12-week histories from being silently
 * truncated or transferred row-by-row.
 */
export function weeklyAccuracyFromBuckets(rows: AccuracyBucket[], now: Date, weeks = TREND_WEEKS): WeekPoint[] {
  const keys = weekKeys(now, weeks);
  const byWeek = new Map(rows.map((row) => [row.weekStart, row]));
  return keys.map((weekStart) => {
    const row = byWeek.get(weekStart);
    if (!row || row.total <= 0) return { weekStart, value: null, count: row?.count ?? 0 };
    return {
      weekStart,
      count: row.count,
      value: Math.round((row.score / row.total) * 100),
    };
  });
}

/** Weekly mean of stored band estimates, to one decimal. */
export function weeklyBand(rows: BandRow[], now: Date, weeks = TREND_WEEKS): WeekPoint[] {
  const keys = weekKeys(now, weeks);
  const buckets = new Map(keys.map((k) => [k, { sum: 0, count: 0 }]));
  for (const row of rows) {
    const bucket = buckets.get(weekStartKey(row.at));
    if (!bucket || !Number.isFinite(row.band)) continue;
    bucket.sum += row.band; bucket.count += 1;
  }
  return keys.map((weekStart) => {
    const b = buckets.get(weekStart)!;
    return { weekStart, count: b.count, value: b.count > 0 ? Math.round((b.sum / b.count) * 10) / 10 : null };
  });
}

/** Weekly band trend from database-side sum/count buckets. */
export function weeklyBandFromBuckets(rows: BandBucket[], now: Date, weeks = TREND_WEEKS): WeekPoint[] {
  const keys = weekKeys(now, weeks);
  const byWeek = new Map(rows.map((row) => [row.weekStart, row]));
  return keys.map((weekStart) => {
    const row = byWeek.get(weekStart);
    if (!row || row.count <= 0) return { weekStart, value: null, count: 0 };
    return {
      weekStart,
      count: row.count,
      value: Math.round((row.sum / row.count) * 10) / 10,
    };
  });
}

export type HeatmapDay = { day: string; count: number };
/** Activity per calendar day for the last HEATMAP_WEEKS full weeks (Mon-first). */
export function activityHeatmap(times: Date[], now: Date, weeks = HEATMAP_WEEKS): HeatmapDay[][] {
  const counts = new Map<string, number>();
  for (const at of times) { const k = tashkentDayKey(at); counts.set(k, (counts.get(k) ?? 0) + 1); }
  return activityHeatmapFromBuckets([...counts].map(([day, count]) => ({ day, count })), now, weeks);
}

/** Heatmap from SQL daily counts; combines duplicate day buckets safely. */
export function activityHeatmapFromBuckets(rows: ActivityBucket[], now: Date, weeks = HEATMAP_WEEKS): HeatmapDay[][] {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.day, (counts.get(row.day) ?? 0) + row.count);
  return weekKeys(now, weeks).map((weekStart) => {
    const start = new Date(`${weekStart}T00:00:00Z`).getTime();
    return Array.from({ length: 7 }, (_, d) => {
      const day = new Date(start + d * DAY_MS).toISOString().slice(0, 10);
      return { day, count: counts.get(day) ?? 0 };
    });
  });
}

export function heatLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  return count <= 0 ? 0 : count === 1 ? 1 : count <= 3 ? 2 : count <= 5 ? 3 : 4;
}

export type RetentionLevelTrend = { level: RetentionLevel; attempts: number; textsCompleted: number; best: number | null; recent: number[]; average: number | null; change: number | null };
/** Per level: best score, distinct texts completed, last five finalized scores (oldest→newest), their mean, and newest−oldest change. */
export function retentionLevelTrends(rows: RetentionRow[], levels: readonly RetentionLevel[]): RetentionLevelTrend[] {
  return levels.map((level) => {
    const mine = rows.filter((r) => r.level === level);
    const scores = mine.sort((a, b) => a.at.getTime() - b.at.getTime()).map((r) => r.score);
    const recent = scores.slice(-5);
    const average = recent.length ? Math.round(recent.reduce((s, n) => s + n, 0) / recent.length) : null;
    const change = recent.length >= 2 ? recent[recent.length - 1]! - recent[0]! : null;
    return { level, attempts: scores.length, textsCompleted: new Set(mine.map((r) => r.textId)).size, best: scores.length ? Math.max(...scores) : null, recent, average, change };
  });
}

/** Retention summary from SQL aggregates plus the newest five scores per level. */
export function retentionLevelTrendsFromAggregates(rows: RetentionAggregate[], levels: readonly RetentionLevel[]): RetentionLevelTrend[] {
  const byLevel = new Map(rows.map((row) => [row.level, row]));
  return levels.map((level) => {
    const row = byLevel.get(level);
    if (!row) return { level, attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null };
    const recent = row.recentNewestFirst.slice(0, 5).reverse();
    const average = recent.length ? Math.round(recent.reduce((sum, score) => sum + score, 0) / recent.length) : null;
    const change = recent.length >= 2 ? recent[recent.length - 1]! - recent[0]! : null;
    return {
      level,
      attempts: row.attempts,
      textsCompleted: row.textsCompleted,
      best: row.best,
      recent,
      average,
      change,
    };
  });
}
