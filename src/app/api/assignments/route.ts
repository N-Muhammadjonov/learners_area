import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, assignments } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";

/**
 * GET  /api/assignments  — the caller's own assignments (students), or the ones
 *                          they created (teachers/admin).
 * POST /api/assignments  — a teacher/admin assigning work to a student.
 *
 * Creating an assignment requires a teacher or admin role *and* is recorded with
 * the creator, so ownership rules later (who may evaluate it) have something to
 * check. A student can never assign work to anyone, including themselves.
 */
const createSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(2000).nullish(),
  targetUserId: z.string().uuid(),
  relatedWritingPromptId: z.string().uuid().nullish(),
  dueAt: z.string().datetime().nullish(),
});

export async function GET() {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const staffView = isStaff(user.role);
  const rows = staffView
    ? await db
        .select()
        .from(assignments)
        .where(eq(assignments.createdByUserId, user.id))
        .orderBy(desc(assignments.createdAt))
    : await db
        .select()
        .from(assignments)
        .where(eq(assignments.targetUserId, user.id))
        .orderBy(desc(assignments.createdAt));

  return NextResponse.json({ ok: true, assignments: rows });
}

export async function POST(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!isStaff(user.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const [created] = await db
    .insert(assignments)
    .values({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      createdByUserId: user.id,
      targetUserId: parsed.data.targetUserId,
      relatedWritingPromptId: parsed.data.relatedWritingPromptId ?? null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    })
    .returning();

  await db.insert(activityEvents).values({
    userId: parsed.data.targetUserId,
    type: "ASSIGNMENT_CREATED",
    payload: { assignmentId: created?.id, teacherId: user.id },
  });

  return NextResponse.json({ ok: true, assignment: created });
}
