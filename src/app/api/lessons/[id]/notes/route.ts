import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { isUuid } from "@/lib/validation/ids";
import { requireActiveUser } from "@/lib/auth/current-user";
import { LESSON_NOTE_MAX, lessonOpenForNotes, readLessonNote, saveLessonNote } from "@/lib/services/notes/lesson-notes";

/**
 * A learner's PRIVATE note on one lesson ("Xulosangiz" / "My notes").
 *
 *   GET  /api/lessons/:id/notes   → the caller's own note (or null)
 *   POST /api/lessons/:id/notes   → upsert it; an empty body clears it
 *
 * The storage is `lesson_notes` (migration 0049) keyed by (user, lesson): private
 * by construction, never part of a progress payload, never searched, and never
 * readable by a teacher, admin or owner route. Authorization is the session user
 * only — the service never accepts another learner's id, so a forged id has
 * nothing to forge, and a lesson the learner cannot open answers exactly like a
 * lesson that does not exist.
 *
 * `{ notes }` is the historical field name and `{ body }` the schema's; both are
 * accepted so no existing client breaks.
 */
const schema = z.object({
  notes: z.string().max(LESSON_NOTE_MAX).optional(),
  body: z.string().max(LESSON_NOTE_MAX).optional(),
});

export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!(await lessonOpenForNotes(id))) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const note = await readLessonNote(user.id, id);
  return NextResponse.json({
    notes: note?.body ?? null,
    updatedAt: note?.updatedAt ?? null,
  });
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const body = parsed.data.notes ?? parsed.data.body;
  if (body === undefined) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const result = await saveLessonNote({ userId: user.id, lessonId: id, body });
  if (!result.ok) {
    const status = result.error === "invalid_body" ? 400 : result.error === "lesson_not_open" ? 403 : 404;
    return NextResponse.json({ error: result.error }, { status });
  }

  // The learner asked for exactly this outcome — saving nothing means the note is
  // gone — so clearing is a success, not an error.
  return NextResponse.json({ ok: true, notes: result.note?.body ?? null, updatedAt: result.note?.updatedAt ?? null });
}
