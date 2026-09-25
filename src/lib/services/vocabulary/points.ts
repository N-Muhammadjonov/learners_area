/**
 * Vocabulary points, the private leaderboard and the streak.
 *
 * Everything here is server-side and idempotent. A browser cannot post a score:
 * the only way to earn a point is for the server to observe the thing that earns
 * it. Each award carries a dedupe key, and the ledger's unique index makes a
 * replay a no-op rather than a farm.
 *
 * The timezone is fixed at Asia/Tashkent (UTC+5, no daylight saving): one centre,
 * one definition of "today", so a streak cannot be gamed by changing a clock.
 */

export const VOCAB_POINTS = {
  /** A genuinely new word enters the library (dedup applies). */
  newWord: 2,
  /** A word recalled in a scheduled revision — the only official progress. */
  revision: 1,
  /** An eligible correct answer in a game set the student was due to practise. */
  gameAnswer: 1,
  /** A sentence the RIWI evaluator accepted as real active use. */
  sentence: 5,
} as const;

export type PointKind = "new_word" | "revision" | "game_answer" | "sentence";

/**
 * The kind stored in the ledger, mapped to its value.
 *
 * The engine awards points by kind only — `awardPoints` looks the value up here,
 * so no request body, query string or client payload can choose how many points
 * an action is worth.
 */
export const POINT_VALUES: Record<PointKind, number> = {
  new_word: VOCAB_POINTS.newWord,
  revision: VOCAB_POINTS.revision,
  game_answer: VOCAB_POINTS.gameAnswer,
  sentence: VOCAB_POINTS.sentence,
};

export const TIMEZONE = "Asia/Tashkent";
const TIMEZONE_OFFSET_MS = 5 * 60 * 60 * 1000;

/** The calendar day (Asia/Tashkent) a moment belongs to, as `YYYY-MM-DD`. */
export function dayKey(instant: Date): string {
  return new Date(instant.getTime() + TIMEZONE_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Streak in days, counting back from today.
 *
 * A streak that has not been used today survives if it was used yesterday —
 * otherwise every student would watch their streak die at midnight and before
 * they had a chance to study.
 */
export function streakFromDays(days: string[], today: Date): number {
  const unique = [...new Set(days)].sort().reverse();
  if (unique.length === 0) return 0;

  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(new Date(today.getTime() - 24 * 60 * 60 * 1000));
  const first = unique[0];
  if (first !== todayKey && first !== yesterdayKey) return 0;

  let streak = 1;
  for (let i = 1; i < unique.length; i += 1) {
    const previous = new Date(`${unique[i - 1]}T00:00:00.000Z`);
    const candidate = new Date(`${unique[i]}T00:00:00.000Z`);
    const gap = Math.round((previous.getTime() - candidate.getTime()) / (24 * 60 * 60 * 1000));
    if (gap !== 1) break;
    streak += 1;
  }
  return streak;
}

/** The dedupe keys — one place, so a caller cannot invent its own. */
export const dedupeKeys = {
  newWord: (userId: string, vocabularyId: string) => `new_word:${userId}:${vocabularyId}`,
  revision: (userId: string, vocabularyId: string, stage: number) =>
    `revision:${userId}:${vocabularyId}:${stage}`,
  gameAnswer: (userId: string, setKey: string, vocabularyId: string) =>
    `game:${userId}:${setKey}:${vocabularyId}`,
  sentence: (userId: string, usageId: string) => `sentence:${userId}:${usageId}`,
} as const;
