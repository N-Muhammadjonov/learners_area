/** Reading test duration is authored on the passage (5–90 minutes in Management). */
export const DEFAULT_READING_MINUTES = 20;

type StartedAt = Date | number | string;

export function readingDurationSeconds(suggestedMinutes: number | null | undefined): number {
  const minutes = Number(suggestedMinutes);
  if (!Number.isInteger(minutes) || minutes < 5 || minutes > 90) {
    return DEFAULT_READING_MINUTES * 60;
  }
  return minutes * 60;
}

/** A fixed deadline derived from persisted start time; refreshing never restarts it. */
export function readingRemainingSeconds(
  startedAt: StartedAt,
  durationSeconds: number,
  now = Date.now()
): number {
  const startedAtMs = startedAt instanceof Date
    ? startedAt.getTime()
    : typeof startedAt === "string"
      ? Date.parse(startedAt)
      : startedAt;
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(durationSeconds) || durationSeconds <= 0) return 0;
  return Math.max(0, Math.ceil((startedAtMs + durationSeconds * 1000 - now) / 1000));
}

export function readingAttemptExpired(
  startedAt: Date | number,
  suggestedMinutes: number | null | undefined,
  now = Date.now()
): boolean {
  return readingRemainingSeconds(startedAt, readingDurationSeconds(suggestedMinutes), now) === 0;
}
