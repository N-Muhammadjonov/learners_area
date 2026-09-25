import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lessons, lessonProgress, activityEvents } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { resolveState, transition, type LessonState } from "@/lib/services/lessons/state";

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
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const lesson = await db.query.lessons.findFirst({ where: eq(lessons.id, params.id) });
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
    notes: parsed.data.notes ?? row?.notes ?? null,
    completedAt: result.state === "completed" ? new Date() : null,
    updatedAt: new Date(),
  };

  if (row) {
    await db.update(lessonProgress).set(values).where(eq(lessonProgress.id, row.id));
  } else {
    await db.insert(lessonProgress).values({ userId: user.id, lessonId: lesson.id, ...values });
  }

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "LESSON_PROGRESS_UPDATED",
    payload: { lessonId: lesson.id, state: result.state },
  });

  return NextResponse.json({ ok: true, state: result.state });
}
