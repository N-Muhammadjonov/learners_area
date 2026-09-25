import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { lessons, lessonProgress } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { resolveState, type LessonState } from "@/lib/services/lessons/state";

const schema = z.object({ notes: z.string().max(4000) });

/**
 * POST /api/lessons/:id/notes
 *
 * Notes are private to the student who wrote them. They can be written on any
 * lesson that is not locked — taking notes on something you cannot open makes no
 * sense — and they never change the lesson state.
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
  if (current === "locked" || current === "scheduled") {
    return NextResponse.json({ error: "locked" }, { status: 403 });
  }

  if (row) {
    await db
      .update(lessonProgress)
      .set({ notes: parsed.data.notes, updatedAt: new Date() })
      .where(eq(lessonProgress.id, row.id));
  } else {
    await db.insert(lessonProgress).values({
      userId: user.id,
      lessonId: lesson.id,
      state: current === "completed" ? "completed" : "available",
      notes: parsed.data.notes,
    });
  }

  return NextResponse.json({ ok: true });
}
