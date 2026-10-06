/**
 * The canonical LEARNING AREA of a lesson — what a lesson is ABOUT.
 *
 * Why this exists: before it, a "listening lesson" could only be guessed from its
 * media (an audio block) or its words (a title containing "Listening"). Both are
 * heuristics: an MCQ-strategy lesson whose teaching video is a YouTube clip is a
 * Listening lesson, and an audio lesson about note-taking for Reading is not. The
 * subject of a lesson is AUTHORED, so it is stored, not inferred.
 *
 * The vocabulary is deliberately generic and shared: Listening and Reading (and any
 * later surface) read the same field, so `Reading → Lessons` reuses the lesson layer
 * instead of growing a second one.
 *
 * `null` in the database means **not classified yet** — a historical lesson nobody
 * has labelled. It is not a synonym for "general": `general` is an explicit choice
 * ("general English, not one skill"). Nothing ever converts a null into an area by
 * looking at a title, a slug, a course name or a media type.
 *
 * Pure data + pure functions: safe on the client, safe in a script, no database.
 */

export const LEARNING_AREAS = [
  "listening",
  "reading",
  "writing",
  "speaking",
  "grammar",
  "vocabulary",
  "general",
] as const;

export type LearningArea = (typeof LEARNING_AREAS)[number];

export function isLearningArea(value: unknown): value is LearningArea {
  return typeof value === "string" && (LEARNING_AREAS as readonly string[]).includes(value);
}

/** The editor label for each area, in the two shipping locales. */
export const LEARNING_AREA_LABELS: Record<LearningArea, { en: string; uz: string }> = {
  listening: { en: "Listening", uz: "Listening" },
  reading: { en: "Reading", uz: "Reading" },
  writing: { en: "Writing", uz: "Writing" },
  speaking: { en: "Speaking", uz: "Speaking" },
  grammar: { en: "Grammar", uz: "Grammatika" },
  vocabulary: { en: "Vocabulary", uz: "Lug'at" },
  general: { en: "General English", uz: "Umumiy ingliz tili" },
};

/**
 * Areas a learner-facing lesson library can be opened for. `general` is included on
 * purpose: it is a real choice an author can make, not a bucket for unclassified rows.
 */
export const LEARNABLE_AREAS: LearningArea[] = [...LEARNING_AREAS];
