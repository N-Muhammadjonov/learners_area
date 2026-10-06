import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, assignments } from "@/db/schema";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createAssignment } from "@/lib/content/assignments";

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
  instructions: z.string().max(4000).nullish(),
  targetUserId: z.string().uuid(),
  /** Canonical content reference (§24): module + content type + source ref (+ optional revision). */
  module: z.string().min(2).max(20).optional(),
  contentType: z.string().min(2).max(40).optional(),
  sourceRef: z.string().min(1).max(80).optional(),
  contentVersionId: z.string().uuid().nullish(),
  /** COMPATIBILITY ONLY: still accepted, still stored, no longer the reference. */
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

  const canonical = parsed.data.module && parsed.data.contentType && parsed.data.sourceRef;
  if (!canonical && !parsed.data.relatedWritingPromptId) {
    return NextResponse.json({ error: "missing_content_reference" }, { status: 400 });
  }

  // A canonical reference goes through the content service: the revision is
  // resolved against the version store, the roster rule is enforced, and the
  // assignment records exactly what the learner will be given.
  if (canonical) {
    const result = await db.transaction((tx) =>
      createAssignment(tx, {
        actor: { id: user.id, role: user.role },
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        instructions: parsed.data.instructions ?? null,
        reference: {
          module: parsed.data.module!,
          contentType: parsed.data.contentType!,
          sourceRef: parsed.data.sourceRef!,
          versionId: parsed.data.contentVersionId ?? null,
        },
        studentIds: [parsed.data.targetUserId],
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      }),
    );
    if (!result.ok) {
      const forbidden = result.issues.some((issue) => issue.code.startsWith("assign_forbidden"));
      return NextResponse.json({ ok: false, issues: result.issues }, { status: forbidden ? 403 : 422 });
    }
    await db.insert(activityEvents).values({
      userId: parsed.data.targetUserId,
      type: "ASSIGNMENT_CREATED",
      payload: { assignmentId: result.assignmentId, teacherId: user.id, contentVersionId: result.versionId },
    });
    return NextResponse.json({ ok: true, assignment: { id: result.assignmentId } , contentVersionId: result.versionId }, { status: 201 });
  }

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
