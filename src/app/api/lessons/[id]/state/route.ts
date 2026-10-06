import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lessons, lessonProgress, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { resolveState, transition, type LessonState } from "@/lib/services/lessons/state";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { saveLessonNote } from "@/lib/services/notes/lesson-notes";

const schema = z.object({
  state: z.enum(["in_progress", "completed"]),
  notes: z.string().max(4000).optional(),
});

/**
 * POST /api/lessons/:id/state
 *
 * Progress is the student's own row; the *rules* are the server's. A locked or
 * scheduled lesson cannot be started or completed from here, and a completed
 * lesson cannot be completed twice — so `completedAt` always means the moment the
 * work was actually finished.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, id) });
  if (!lesson) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const row = await db.query.lessonProgress.findFirst({
    where: and(eq(lessonProgress.lessonId, lesson.id), eq(lessonProgress.userId, user.id)),
  });

  const current = resolveState(row?.state as LessonState | undefined, lesson.defaultState as LessonState);
  const result = transition(current, parsed.data.state);
  if (!result.ok) {
    const status = result.error === "locked" ? 403 : 409;
    return NextResponse.json({ error: result.error, state: current }, { status });
  }

  const values = {
    // `scheduled` exists on the lesson's default state, never on a progress row.
    state: result.state as "in_progress" | "completed" | "available" | "assigned",
    completedAt: result.state === "completed" ? new Date() : null,
    updatedAt: new Date(),
  };

  if (row) {
    await db.update(lessonProgress).set(values).where(eq(lessonProgress.id, row.id));
  } else {
    await db.insert(lessonProgress).values({ userId: user.id, lessonId: lesson.id, ...values });
  }

  // A client may still send notes with the state change. They belong to the private
  // note table, never to this progress row: writing them here would put learner
  // text back into a payload that ordinary progress reads enumerate.
  if (parsed.data.notes !== undefined) {
    await saveLessonNote({ userId: user.id, lessonId: lesson.id, body: parsed.data.notes });
  }

  // Finishing a lesson is real work; merely opening it is not.
  if (result.state === "completed") await touchMeaningfulActivity(user.id);

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "LESSON_PROGRESS_UPDATED",
    payload: { lessonId: lesson.id, state: result.state },
  });

  return NextResponse.json({ ok: true, state: result.state });
}
