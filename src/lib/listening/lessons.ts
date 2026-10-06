import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { lessonBlocks, lessons, videoLessons } from "@/db/schema";
import { loadLessonForLearner, type ResolvedLessonBlock } from "@/lib/content/lessons";
import { isLive, liveWhere } from "@/lib/services/cms/publication";
import { readLessonNote } from "@/lib/services/notes/lesson-notes";

/**
 * Listening → Lessons.
 *
 * A **Listening Lesson** is a canonical Content OS lesson (the lesson layer:
 * `lessons` + `lesson_blocks`, authored through the ordinary lesson author) that
 * carries listening material. Nothing here is invented: the classification is
 * DERIVED from what staff actually authored, and it lives in this one module so the
 * list, the detail page and the tests cannot disagree.
 *
 * A lesson counts as listening when at least one of these authored facts is true:
 *
 *   1. it has an `audio` block (the lesson's own uploaded listening material,
 *      served from private storage);
 *   2. it references a listening media content type — `ted:audio_lesson` (the media
 *      layer's audio lesson, i.e. a Podcast episode);
 *   3. an audio media item is attached to it (`video_lessons.lesson_id` with
 *      `media_kind = 'audio'`).
 *
 * Consequences, stated so the surface cannot drift into a lie:
 *   • a lesson whose body is text only is NOT a listening lesson and is never listed;
 *   • a draft / scheduled / archived lesson is invisible, because the lesson layer's
 *     own publication gate decides (`isLive`), not this module;
 *   • an empty catalogue stays empty — there is no seed data here and no placeholder
 *     card. The learner sees a truthful empty state and staff get the authoring path.
 *
 * The three learner-facing controls reuse canonical sources only:
 *   • **Description**  → the authored `lessons.summary` and, when a media item is
 *     attached, its authored focus text (`before_you_watch`);
 *   • **Teacher Notes** → the centre's authored notes on the attached media item
 *     (`video_lessons.notes`), the canonical "notes the learner can reveal" field;
 *   • **Xulosangiz**   → the learner's PRIVATE note, read through
 *     `readLessonNote(userId, lessonId)` — identity is the stable lesson id, the same
 *     contract migration 0049 established for course lessons.
 */

export type ListeningLessonCard = {
  id: string;
  title: string;
  summary: string | null;
  estimatedMinutes: number | null;
  /** Where the listening material comes from, for an honest label on the card. */
  source: "audio_block" | "audio_reference" | "attached_media";
  hasTeacherNotes: boolean;
};

/** Content types whose referenced content IS listening material. */
const LISTENING_REFERENCE_TYPES = new Set(["ted:audio_lesson"]);

type BlockRow = {
  lessonId: string;
  type: string;
  refModule: string | null;
  refContentType: string | null;
};

/**
 * Which of these lessons are listening lessons, and why. Bounded by the caller's
 * lesson list, never a table scan of the whole block table.
 */
export function classifyListeningLessons(
  lessonIds: string[],
  blocks: BlockRow[],
  attachedAudioLessonIds: Set<string>,
): Map<string, ListeningLessonCard["source"]> {
  const found = new Map<string, ListeningLessonCard["source"]>();
  for (const block of blocks) {
    if (found.has(block.lessonId)) continue;
    if (block.type === "audio") found.set(block.lessonId, "audio_block");
    else if (block.type === "content_reference" && block.refModule && block.refContentType) {
      if (LISTENING_REFERENCE_TYPES.has(`${block.refModule}:${block.refContentType}`)) found.set(block.lessonId, "audio_reference");
    }
  }
  for (const id of lessonIds) if (!found.has(id) && attachedAudioLessonIds.has(id)) found.set(id, "attached_media");
  return found;
}

/** How many cards the library shows; a bounded page, oldest catalogue included by recency. */
const LIBRARY_LIMIT = 60;

/** The read surface these functions need. Injected so tests run the real queries. */
export type ListeningLessonExecutor = { select: typeof db.select; query?: typeof db.query };

/**
 * The learner-facing library. Published lessons only; an empty array is a valid,
 * honest answer (it renders the empty state, not a fabricated card).
 */
export async function listListeningLessons(executor: ListeningLessonExecutor = db): Promise<ListeningLessonCard[]> {
  const rows = await executor
    .select({
      id: lessons.id,
      title: lessons.title,
      summary: lessons.summary,
      estimatedMinutes: lessons.estimatedMinutes,
      publicationState: lessons.publicationState,
      publishAt: lessons.publishAt,
      updatedAt: lessons.updatedAt,
    })
    .from(lessons)
    .orderBy(desc(lessons.updatedAt))
    .limit(LIBRARY_LIMIT);

  const live = rows.filter((row) => isLive({ publicationState: row.publicationState, publishAt: row.publishAt }));
  if (live.length === 0) return [];
  const ids = live.map((row) => row.id);

  const [blocks, attached] = await Promise.all([
    executor
      .select({ lessonId: lessonBlocks.lessonId, type: lessonBlocks.type, refModule: lessonBlocks.refModule, refContentType: lessonBlocks.refContentType })
      .from(lessonBlocks)
      .where(inArray(lessonBlocks.lessonId, ids))
      .orderBy(asc(lessonBlocks.lessonId), asc(lessonBlocks.position)),
    executor
      .select({ lessonId: videoLessons.lessonId, notes: videoLessons.notes })
      .from(videoLessons)
      .where(and(inArray(videoLessons.lessonId, ids), eq(videoLessons.mediaKind, "audio"))),
  ]);

  const classification = classifyListeningLessons(ids, blocks, new Set(attached.map((row) => row.lessonId!).filter(Boolean)));
  const notesByLesson = new Set(attached.filter((row) => row.notes && row.notes.trim().length > 0).map((row) => row.lessonId!));

  return live
    .filter((row) => classification.has(row.id))
    .map((row) => ({
      id: row.id,
      title: row.title,
      summary: row.summary,
      estimatedMinutes: row.estimatedMinutes,
      source: classification.get(row.id)!,
      hasTeacherNotes: notesByLesson.has(row.id),
    }));
}

export type ListeningLessonDetail = {
  lesson: { id: string; title: string; summary: string | null; estimatedMinutes: number | null };
  blocks: ResolvedLessonBlock[];
  media: {
    id: string;
    title: string;
    mediaKind: string;
    provider: string;
    videoId: string;
    focus: string | null;
    notes: string | null;
    durationSeconds: number | null;
  } | null;
  /** The caller's own private note; never anybody else's. */
  note: string;
  source: ListeningLessonCard["source"];
};

/**
 * One listening lesson for one learner.
 *
 * Returns null when the lesson is not live, does not exist, or is not a listening
 * lesson — the same answer for "no such lesson" and "not for you", so the page can
 * never confirm the existence of content the learner may not open.
 */
export async function loadListeningLesson(
  lessonId: string,
  userId: string,
  executor: ListeningLessonExecutor & { query: NonNullable<ListeningLessonExecutor["query"]> } = db,
): Promise<ListeningLessonDetail | null> {
  const loaded = await loadLessonForLearner(lessonId, userId, executor);
  if (!loaded) return null;

  const [blocks, media, note] = await Promise.all([
    Promise.resolve(loaded.blocks),
    executor.query.videoLessons.findFirst({
      where: and(
        eq(videoLessons.lessonId, lessonId),
        liveWhere({ publicationState: videoLessons.publicationState, publishAt: videoLessons.publishAt }),
      ),
    }),
    readLessonNote(userId, lessonId, executor),
  ]);

  const audioMedia = media && media.mediaKind === "audio" ? media : null;
  const classification = classifyListeningLessons(
    [lessonId],
    blocks.map((block) => ({ lessonId, type: block.type, refModule: block.ref?.module ?? null, refContentType: block.ref?.contentType ?? null })),
    new Set(audioMedia ? [lessonId] : []),
  );
  const source = classification.get(lessonId);
  if (!source) return null;

  return {
    lesson: {
      id: loaded.lesson.id,
      title: loaded.lesson.title,
      summary: loaded.lesson.summary,
      estimatedMinutes: loaded.lesson.estimatedMinutes,
    },
    blocks,
    media: media
      ? {
          id: media.id,
          title: media.title,
          mediaKind: media.mediaKind,
          provider: media.provider,
          videoId: media.videoId,
          focus: media.beforeYouWatch ?? null,
          notes: media.notes ?? null,
          durationSeconds: media.durationSeconds ?? null,
        }
      : null,
    note: note?.body ?? "",
    source,
  };
}
