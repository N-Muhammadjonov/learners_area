import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/db/client";
import { lessonBlocks, lessons, videoLessons } from "@/db/schema";
import { loadLessonForLearner, type ResolvedLessonBlock } from "@/lib/content/lessons";
import { isLearningArea, type LearningArea } from "@/lib/content/learning-areas";
import { liveWhere } from "@/lib/services/cms/publication";
import { readLessonNote } from "@/lib/services/notes/lesson-notes";

/**
 * The lesson LIBRARY — one generic, area-driven reader for learner-facing lessons.
 *
 * A lesson appears under `…/lessons` because an author CLASSIFIED it there:
 * `lessons.learning_area = <area>`. It does NOT appear because it happens to contain
 * audio, because its title says "Listening", or because of the course it sits in.
 * Those are heuristics, and they get the product wrong in both directions — a
 * strategy lesson taught by video is a Listening lesson, and an audio lesson about
 * note-taking for Reading is not.
 *
 * The same module serves Listening today and Reading later; there is deliberately no
 * per-skill reader, no per-skill table and no per-skill classification rule.
 *
 * ## Ordering of predicates (this was a real defect, corrected here)
 *
 * The catalogue used to select the 60 most recently updated lessons and only THEN ask
 * which of them were listening lessons. A centre with 61 recently-touched non-listening
 * lessons could therefore hide every legitimate Listening lesson — an untruthful
 * catalogue produced by an unrelated global cap. The area is now a WHERE clause, so the
 * bound applies AFTER the semantic filter:
 *
 *     WHERE learning_area = $area AND (live) ORDER BY updated_at DESC LIMIT $n OFFSET $o
 *
 * Nothing scans an unbounded table: the query is bounded by `limit` (see
 * `LESSON_LIBRARY_PAGE_MAX`) and offset-based paging is bounded by the caller.
 */

/** How many cards one page of a learner library may show. */
export const LESSON_LIBRARY_PAGE_MAX = 60;

export type LessonLibraryCard = {
  id: string;
  title: string;
  summary: string | null;
  estimatedMinutes: number | null;
  /** Canonical lesson-level notes exist. */
  hasTeacherNotes: boolean;
  /** A media item is attached (any kind) — informational, never a classification. */
  hasMedia: boolean;
};

export type LessonLibraryQuery = {
  area: LearningArea;
  limit?: number;
  offset?: number;
};

/**
 * The list of lessons an author classified into this area and the centre has made live.
 *
 * `hasTeacherNotes` is true for canonical lesson-level notes and — for lessons authored
 * before 0050 — for the attached media item's own notes, which stay a documented
 * COMPATIBILITY fallback. The fallback never overrides lesson-level notes; see
 * `teacherNotesFor`.
 */
export async function listLessonLibrary(query: LessonLibraryQuery, executor?: { select: typeof db.select; query: typeof db.query }) {
  const { area } = query;
  if (!isLearningArea(area)) return { rows: [] as LessonLibraryCard[], hasMore: false, area };
  const limit = Math.min(Math.max(1, query.limit ?? LESSON_LIBRARY_PAGE_MAX), LESSON_LIBRARY_PAGE_MAX);
  const offset = Math.max(0, query.offset ?? 0);
  // The executor is called as a METHOD (`exec.select(...)`) so its receiver survives;
  // a destructured Drizzle method loses `this` and the query fails at runtime.
  const exec = executor ?? db;

  // ONE bounded query: the area is a predicate, not a post-filter on an unrelated cap.
  const rows = await exec.select({
    id: lessons.id,
    title: lessons.title,
    summary: lessons.summary,
    estimatedMinutes: lessons.estimatedMinutes,
    teacherNotes: lessons.teacherNotes,
    learningArea: lessons.learningArea,
  })
    .from(lessons)
    .where(and(eq(lessons.learningArea, area), liveWhere({ publicationState: lessons.publicationState, publishAt: lessons.publishAt })))
    .orderBy(desc(lessons.updatedAt))
    .limit(limit + 1)
    .offset(offset);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  if (page.length === 0) return { rows: [] as LessonLibraryCard[], hasMore, area };
  const ids = page.map((row) => row.id);

  const legacyNotes = await exec.select({ lessonId: videoLessons.lessonId, notes: videoLessons.notes })
    .from(videoLessons)
    .where(and(inArray(videoLessons.lessonId, ids), isNotNull(videoLessons.notes)));
  const withLegacyNotes = new Set(legacyNotes.filter((row) => (row.notes ?? "").trim().length > 0).map((row) => row.lessonId!));

  const blocks = await exec.select({ lessonId: lessonBlocks.lessonId, type: lessonBlocks.type })
    .from(lessonBlocks)
    .where(inArray(lessonBlocks.lessonId, ids));
  const withMedia = new Set(blocks.filter((row) => ["audio", "video", "image", "file"].includes(row.type)).map((row) => row.lessonId));

  return {
    hasMore,
    area,
    rows: page.map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      estimatedMinutes: row.estimatedMinutes,
      hasTeacherNotes: Boolean((row.teacherNotes ?? "").trim()) || withLegacyNotes.has(row.id),
      hasMedia: withMedia.has(row.id),
    })),
  };
}

export type LessonLibraryDetail = {
  lesson: { id: string; title: string; summary: string | null; estimatedMinutes: number | null; learningArea: string | null };
  blocks: ResolvedLessonBlock[];
  /** Canonical lesson-level notes, or the documented media compatibility fallback. */
  teacherNotes: string | null;
  /** Where the notes came from — the page shows the same text either way. */
  teacherNotesSource: "lesson" | "media" | null;
  media: {
    id: string;
    title: string;
    mediaKind: string;
    provider: string;
    videoId: string;
    focus: string | null;
    durationSeconds: number | null;
  } | null;
  /** The caller's OWN private note; never anybody else's. */
  note: string;
};

/**
 * The centre's notes for a lesson, with the documented compatibility rule.
 *
 * Lesson-level Teacher Notes WIN. Only when a lesson carries none — i.e. it was
 * authored before 0050, when the only place notes could live was the attached media
 * item — does the media item's own notes field stand in. This is a read-time fallback
 * with a single direction, so it can never make authoring truth ambiguous: a lesson
 * with lesson-level notes is unaffected by whatever its media rows say.
 */
export function teacherNotesFor(lessonNotes: string | null | undefined, mediaNotes: string | null | undefined) {
  if ((lessonNotes ?? "").trim()) return { teacherNotes: lessonNotes!, source: "lesson" as const };
  if ((mediaNotes ?? "").trim()) return { teacherNotes: mediaNotes!, source: "media" as const };
  return { teacherNotes: null, source: null };
}

/**
 * One learner-facing lesson from an area.
 *
 * Returns null — one answer, no information leak — when the lesson does not exist, is
 * not live, or was classified into a different area. The area check is what makes
 * `…/lessons/[id]` unable to serve, say, a Reading lesson under Listening.
 */
export async function loadLessonLibraryDetail(
  lessonId: string,
  userId: string,
  area: LearningArea,
  executor: { select: typeof db.select; query: typeof db.query } = db,
): Promise<LessonLibraryDetail | null> {
  const loaded = await loadLessonForLearner(lessonId, userId, executor);
  if (!loaded) return null;
  if (loaded.lesson.learningArea !== area) return null;

  const [media, note] = await Promise.all([
    executor.query.videoLessons.findFirst({
      where: and(
        eq(videoLessons.lessonId, lessonId),
        liveWhere({ publicationState: videoLessons.publicationState, publishAt: videoLessons.publishAt }),
      ),
    }),
    readLessonNote(userId, lessonId, executor),
  ]);

  const notes = teacherNotesFor(loaded.lesson.teacherNotes, media?.notes);

  return {
    lesson: {
      id: loaded.lesson.id,
      title: loaded.lesson.title,
      summary: loaded.lesson.summary,
      estimatedMinutes: loaded.lesson.estimatedMinutes,
      learningArea: loaded.lesson.learningArea,
    },
    blocks: loaded.blocks,
    teacherNotes: notes.teacherNotes,
    teacherNotesSource: notes.source,
    media: media
      ? {
          id: media.id,
          title: media.title,
          mediaKind: media.mediaKind,
          provider: media.provider,
          videoId: media.videoId,
          focus: media.beforeYouWatch ?? null,
          durationSeconds: media.durationSeconds ?? null,
        }
      : null,
    note: note?.body ?? "",
  };
}
