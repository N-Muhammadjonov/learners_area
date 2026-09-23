import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, assignments } from "@/db/schema";
import { getSession } from "@/lib/auth/session";

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
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const isStaff = session.role === "teacher" || session.role === "admin";
  const rows = isStaff
    ? await db
        .select()
        .from(assignments)
        .where(eq(assignments.createdByUserId, session.sub))
        .orderBy(desc(assignments.createdAt))
    : await db
        .select()
        .from(assignments)
        .where(eq(assignments.targetUserId, session.sub))
        .orderBy(desc(assignments.createdAt));

  return NextResponse.json({ ok: true, assignments: rows });
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (session.role !== "teacher" && session.role !== "admin") {
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
      createdByUserId: session.sub,
      targetUserId: parsed.data.targetUserId,
      relatedWritingPromptId: parsed.data.relatedWritingPromptId ?? null,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    })
    .returning();

  await db.insert(activityEvents).values({
    userId: parsed.data.targetUserId,
    type: "ASSIGNMENT_CREATED",
    payload: { assignmentId: created?.id, teacherId: session.sub },
  });

  return NextResponse.json({ ok: true, assignment: created });
}
