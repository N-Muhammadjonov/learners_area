import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lessonNotes, lessons } from "@/db/schema";
import { isLive } from "@/lib/services/cms/publication";

/**
 * Private lesson notes — the "Xulosangiz" the learner writes on ONE lesson.
 *
 * The privacy contract, stated once and enforced here:
 *
 *   1. A note belongs to exactly one learner and one lesson: identity is
 *      `(user_id, lesson_id)`. `lessons.id` is the stable logical lesson, so a new
 *      revision of the same lesson keeps the note.
 *   2. **Every** statement in this module filters on the caller's own user id.
 *      There is deliberately no function that accepts another learner's id, and no
 *      teacher/admin/owner read path exists — staff screens cannot list notes even
 *      if they ask for them, because there is nothing here to ask with.
 *   3. A note is never progress: it does not set a lesson state, does not complete a
 *      lesson, and does not appear in Progress, assignments, reports, global search
 *      or analytics. Nothing in this module writes to any other table.
 *   4. Bounded text, never HTML. 1..4000 characters; whitespace-only input clears
 *      the note (the row is deleted) so "a row exists" always means "there is
 *      something to read".
 *   5. Notes may only be written on a lesson the learner can actually open: a
 *      draft, archived or unpublishable lesson fails closed.
 *
 * The save is a single `insert … on conflict do update`, so concurrent autosaves
 * cannot produce two rows or lose the later write.
 */

/** The same bound the API and the database CHECK constraint enforce. */
export const LESSON_NOTE_MAX = 4000;

export type LessonNote = { body: string; updatedAt: Date };

export type SaveLessonNoteResult =
  | { ok: true; note: LessonNote | null }
  | { ok: false; error: "invalid_body" | "lesson_not_found" | "lesson_not_open" };

export type NoteExecutor = Pick<typeof db, "select" | "insert" | "delete">;

/**
 * What a READ needs. Kept separate from `NoteExecutor` so a read-only caller (a page
 * that only renders the learner's own note) does not have to pass write capabilities
 * it never uses.
 */
export type NoteReadExecutor = Pick<typeof db, "select">;

/** Is this lesson readable by a learner at all? Drafts and archives are not. */
export async function lessonOpenForNotes(lessonId: string, executor: NoteExecutor = db): Promise<boolean> {
  const [lesson] = await executor
    .select({ publicationState: lessons.publicationState, publishAt: lessons.publishAt })
    .from(lessons)
    .where(eq(lessons.id, lessonId))
    .limit(1);
  if (!lesson) return false;
  return isLive({ publicationState: lesson.publicationState, publishAt: lesson.publishAt });
}

/**
 * The caller's own note, or null. A learner never receives another learner's row:
 * the user id is a required parameter and always part of the WHERE clause.
 */
export async function readLessonNote(
  userId: string,
  lessonId: string,
  executor: NoteReadExecutor = db,
): Promise<LessonNote | null> {
  const [row] = await executor
    .select({ body: lessonNotes.body, updatedAt: lessonNotes.updatedAt })
    .from(lessonNotes)
    .where(and(eq(lessonNotes.userId, userId), eq(lessonNotes.lessonId, lessonId)))
    .limit(1);
  return row ? { body: row.body, updatedAt: row.updatedAt } : null;
}

/**
 * Upsert the caller's note on one lesson.
 *
 * An empty or whitespace-only body CLEARS the note (the row is removed) — the UI
 * shows "Saved" either way, because both outcomes are what the learner asked for.
 * A body over the limit is refused rather than truncated: silently dropping the end
 * of someone's writing is worse than asking them to shorten it.
 */
export async function saveLessonNote(input: {
  userId: string;
  lessonId: string;
  body: string;
  executor?: NoteExecutor;
}): Promise<SaveLessonNoteResult> {
  const executor = input.executor ?? db;
  const body = input.body;

  if (typeof body !== "string" || body.length > LESSON_NOTE_MAX) {
    return { ok: false, error: "invalid_body" };
  }

  if (!(await lessonOpenForNotes(input.lessonId, executor))) {
    // Distinguish "no such lesson" from "not open" so the API can answer 404 vs 403
    // without ever confirming the existence of a lesson the learner cannot open.
    const [lesson] = await executor.select({ id: lessons.id }).from(lessons).where(eq(lessons.id, input.lessonId)).limit(1);
    return { ok: false, error: lesson ? "lesson_not_open" : "lesson_not_found" };
  }

  if (body.trim().length === 0) {
    await executor
      .delete(lessonNotes)
      .where(and(eq(lessonNotes.userId, input.userId), eq(lessonNotes.lessonId, input.lessonId)));
    return { ok: true, note: null };
  }

  const now = new Date();
  const [row] = await executor
    .insert(lessonNotes)
    .values({ userId: input.userId, lessonId: input.lessonId, body, updatedAt: now })
    .onConflictDoUpdate({
      target: [lessonNotes.userId, lessonNotes.lessonId],
      set: { body, updatedAt: now },
    })
    .returning({ body: lessonNotes.body, updatedAt: lessonNotes.updatedAt });

  return { ok: true, note: row ? { body: row.body, updatedAt: row.updatedAt } : null };
}
