import { dayKey } from "@/lib/services/vocabulary/points";

/**
 * Grammar mastery: Correct It → Translate With It → Activate It.
 *
 * One topic is "mastered" when a student has
 *
 *   - practised all three activities (not just the multiple choice, which is the
 *     easy one),
 *   - reached ~80% accuracy, counted from the *latest* attempt per exercise, so
 *     a retry replaces an old mistake instead of adding to it, and
 *   - come back on three separate days (Asia/Tashkent).
 *
 * The three-session rule is the point: a single good evening is a good evening,
 * not mastery. Nothing here is stored — the numbers are derived from the attempt
 * rows every time, so they cannot drift from the history that produced them.
 */

export const MASTERY_THRESHOLD = 0.8;
export const MASTERY_SESSIONS = 3;

export const GRAMMAR_ACTIVITIES = ["correct_it", "translate_it", "activate_it"] as const;

export type GrammarActivity = (typeof GRAMMAR_ACTIVITIES)[number];

export type AttemptRow = {
  exerciseId: string;
  activity: GrammarActivity;
  isCorrect: boolean;
  attemptedAt: Date;
};

export type ActivitySummary = {
  activity: GrammarActivity;
  attempted: number;
  correct: number;
  percent: number;
};

export type TopicMastery = {
  scorePercent: number;
  attempted: number;
  correct: number;
  byActivity: ActivitySummary[];
  /** Distinct days (Asia/Tashkent) with at least one attempt on this topic. */
  sessions: number;
  sessionsRemaining: number;
  allActivitiesPractised: boolean;
  mastered: boolean;
};

/** Per exercise and activity, only the most recent attempt counts. */
function latestByExerciseAndActivity(rows: AttemptRow[]): Map<string, AttemptRow> {
  const latest = new Map<string, AttemptRow>();
  for (const row of rows) {
    const key = `${row.exerciseId}::${row.activity}`;
    const existing = latest.get(key);
    if (!existing || row.attemptedAt.getTime() > existing.attemptedAt.getTime()) {
      latest.set(key, row);
    }
  }
  return latest;
}

export function summarizeTopicMastery(rows: AttemptRow[]): TopicMastery {
  const latest = [...latestByExerciseAndActivity(rows).values()];

  const byActivity: ActivitySummary[] = GRAMMAR_ACTIVITIES.map((activity) => {
    const forActivity = latest.filter((row) => row.activity === activity);
    const correct = forActivity.filter((row) => row.isCorrect).length;
    const attempted = forActivity.length;
    return {
      activity,
      attempted,
      correct,
      percent: attempted ? Math.round((correct / attempted) * 100) : 0,
    };
  });

  const attempted = latest.length;
  const correct = latest.filter((row) => row.isCorrect).length;
  const scorePercent = attempted ? Math.round((correct / attempted) * 100) : 0;

  const sessions = new Set(rows.map((row) => dayKey(row.attemptedAt))).size;
  const allActivitiesPractised = byActivity.every((entry) => entry.attempted > 0);

  return {
    scorePercent,
    attempted,
    correct,
    byActivity,
    sessions,
    sessionsRemaining: Math.max(0, MASTERY_SESSIONS - sessions),
    allActivitiesPractised,
    mastered:
      allActivitiesPractised &&
      sessions >= MASTERY_SESSIONS &&
      attempted > 0 &&
      scorePercent >= Math.round(MASTERY_THRESHOLD * 100),
  };
}

// ---------------------------------------------------------------------------
// Translate With It — structure checking, never whole-sentence equality
// ---------------------------------------------------------------------------

function normalizeStructures(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export type StructureCheck = {
  used: string[];
  missing: string[];
  complete: boolean;
};

/**
 * Check whether a written answer uses each required structure.
 *
 * The comparison is per *structure*, not per sentence: two correct translations
 * of the same sentence can share almost no words, so comparing the whole string
 * would mark good answers wrong. A structure is matched on its own tokens in
 * order, allowing words between them — "although" + "prefer" matches
 * "Although buses are cheaper, most people still prefer to drive" — and allowing
 * any word to carry a normal English inflection (`prefer` matches `prefers`,
 * `preferred`).
 *
 * If it cannot decide (a structure with no letters at all), it reports it as
 * missing rather than assuming it was used: the checklist is a teaching aid, and
 * "probably fine" is worse than "not found".
 */
export function checkStructures(answer: string, structures: string[]): StructureCheck {
  const haystack = normalizeStructures(answer);
  const used: string[] = [];
  const missing: string[] = [];

  for (const raw of structures) {
    const structure = normalizeStructures(raw);
    if (!structure) {
      missing.push(raw);
      continue;
    }

    // Word-boundary match of the structure as a phrase, with the first token
    // allowed to match a longer word (inflections).
    const tokens = structure.split(" ").map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const pattern = new RegExp(`\\b${tokens[0]}\\w*(?:\\s+\\w+){0,4}\\s+${tokens.slice(1).join("\\s+")}\\b`);
    const simple = new RegExp(`\\b${tokens.join("\\s+")}\\b`);

    if (tokens.length === 1 ? new RegExp(`\\b${tokens[0]}\\w*\\b`).test(haystack) : pattern.test(haystack) || simple.test(haystack)) {
      used.push(raw);
    } else {
      missing.push(raw);
    }
  }

  return { used, missing, complete: missing.length === 0 && used.length > 0 };
}

/**
 * The honest verdict of a translation attempt.
 *
 * The structure checklist is the primary signal because it is explainable: the
 * student is told exactly which structure did not appear. When a topic has no
 * authored structures the check cannot say anything, and the caller falls back to
 * the text evaluator — this function then reports `undetermined` rather than
 * inventing a mark.
 */
export function structureVerdict(check: StructureCheck, structuresAuthored: boolean) {
  if (!structuresAuthored) return "undetermined" as const;
  if (check.complete) return "correct" as const;
  if (check.used.length > 0) return "partial" as const;
  return "incorrect" as const;
}
