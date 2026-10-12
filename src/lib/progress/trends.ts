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

/** One attempt, or — with `count` — a pre-aggregated day: `score`/`total` are sums over `count` attempts. */
export type GradedRow = { at: Date; score: number; total: number; count?: number };
/** One estimate, or — with `count` — a pre-aggregated day where `band` is the SUM of `count` estimates. */
export type BandRow = { at: Date; band: number; count?: number };
export type RetentionRow = { at: Date; level: RetentionLevel; score: number; textId: string };
export type WeekPoint = { weekStart: string; value: number | null; count: number };

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
    bucket.score += row.score; bucket.total += row.total; bucket.count += row.count ?? 1;
  }
  return keys.map((weekStart) => {
    const b = buckets.get(weekStart)!;
    return { weekStart, count: b.count, value: b.total > 0 ? Math.round((b.score / b.total) * 100) : null };
  });
}

/** Weekly mean of stored band estimates, to one decimal. */
export function weeklyBand(rows: BandRow[], now: Date, weeks = TREND_WEEKS): WeekPoint[] {
  const keys = weekKeys(now, weeks);
  const buckets = new Map(keys.map((k) => [k, { sum: 0, count: 0 }]));
  for (const row of rows) {
    const bucket = buckets.get(weekStartKey(row.at));
    if (!bucket || !Number.isFinite(row.band)) continue;
    bucket.sum += row.band; bucket.count += row.count ?? 1;
  }
  return keys.map((weekStart) => {
    const b = buckets.get(weekStart)!;
    return { weekStart, count: b.count, value: b.count > 0 ? Math.round((b.sum / b.count) * 10) / 10 : null };
  });
}

export type HeatmapDay = { day: string; count: number };
/** Activity per calendar day for the last HEATMAP_WEEKS full weeks (Mon-first). */
export function activityHeatmap(times: (Date | { at: Date; count: number })[], now: Date, weeks = HEATMAP_WEEKS): HeatmapDay[][] {
  const counts = new Map<string, number>();
  for (const t of times) {
    const [at, n] = t instanceof Date ? [t, 1] : [t.at, t.count];
    const k = tashkentDayKey(at);
    counts.set(k, (counts.get(k) ?? 0) + n);
  }
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
