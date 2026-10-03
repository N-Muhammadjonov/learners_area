/**
 * Consecutive active calendar days ending today (or yesterday, so a learner who has
 * not logged today yet keeps the streak). Day keys are `YYYY-MM-DD` in the centre's
 * timezone; arithmetic is on the calendar date, never on a wall-clock offset.
 */
export function streakFromDays(days: Iterable<string>, todayKey: string): number {
  const set = new Set(days);
  const prev = (key: string) => {
    const d = new Date(`${key}T12:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };
  let cursor = set.has(todayKey) ? todayKey : prev(todayKey);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = prev(cursor);
  }
  return streak;
}
