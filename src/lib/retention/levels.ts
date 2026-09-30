/**
 * The Retention level contract — one place, importable from anywhere.
 *
 * Retention is a memory system with five CEFR buckets. The bucket is declared by
 * the owner; neither this module nor the server can prove that a text "is B2".
 * What the system *does* enforce is the part that can be checked: the level is
 * one of five, and the text's canonical word count falls inside that level's
 * authored range.
 *
 * The ranges and the launch target come from the owner's content contract:
 *
 *   A2   ~110 words   100–125
 *   B1   ~175 words   160–195
 *   B2   ~260 words   240–285
 *   C1   ~300 words   280–330
 *   C2   ~415 words   390–450
 *
 * 15 active texts per level is a launch TARGET, not a ceiling: the architecture,
 * the database and the rotation engine have no maximum.
 *
 * This module is pure (no database, no `server-only`) because the admin editor
 * shows the same ranges in the browser that the server enforces on save.
 */

export const RETENTION_LEVELS = ["A2", "B1", "B2", "C1", "C2"] as const;
export type RetentionLevel = (typeof RETENTION_LEVELS)[number];

export type RetentionLevelConfig = {
  level: RetentionLevel;
  /** Inclusive lower bound of the authored word range. */
  minWords: number;
  /** Inclusive upper bound of the authored word range. */
  maxWords: number;
  /** The target length the owner authors for. */
  targetWords: number;
};

export const RETENTION_LEVEL_CONFIG: Record<RetentionLevel, RetentionLevelConfig> = {
  A2: { level: "A2", minWords: 100, maxWords: 125, targetWords: 110 },
  B1: { level: "B1", minWords: 160, maxWords: 195, targetWords: 175 },
  B2: { level: "B2", minWords: 240, maxWords: 285, targetWords: 260 },
  C1: { level: "C1", minWords: 280, maxWords: 330, targetWords: 300 },
  C2: { level: "C2", minWords: 390, maxWords: 450, targetWords: 415 },
};

/** The launch target per level. Not a maximum — 16, 20, 100 are all legal. */
export const RETENTION_TARGET_PER_LEVEL = 15;

/** Reading phase: exactly two minutes. */
export const RETENTION_READ_SECONDS = 120;
/** Recall (write) phase: exactly three minutes. */
export const RETENTION_WRITE_SECONDS = 180;
export const RETENTION_TOTAL_SECONDS = RETENTION_READ_SECONDS + RETENTION_WRITE_SECONDS;

export function isRetentionLevel(value: unknown): value is RetentionLevel {
  return typeof value === "string" && (RETENTION_LEVELS as readonly string[]).includes(value);
}

/** Levels with no active content still get a card; the learner sees the truth. */
export function retentionLevelConfig(level: RetentionLevel): RetentionLevelConfig {
  return RETENTION_LEVEL_CONFIG[level];
}

export function wordRangeFor(level: RetentionLevel): { min: number; max: number } {
  const config = RETENTION_LEVEL_CONFIG[level];
  return { min: config.minWords, max: config.maxWords };
}

export function isWordCountInRange(level: RetentionLevel, wordCount: number): boolean {
  const { min, max } = wordRangeFor(level);
  return Number.isInteger(wordCount) && wordCount >= min && wordCount <= max;
}
