import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, assignmentTargets, assignments } from "@/db/schema";
import { listAssignmentsCreatedBy, listAssignmentsForStudent } from "@/lib/content/assignments";
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

  // The read path uses the same service as the write path, so a multi-student
  // assignment reaches EVERY target (not only the first) and each learner sees the
  // revision they were given.
  if (isStaff(user.role)) {
    const created = await listAssignmentsCreatedBy(user.id);
    return NextResponse.json({ ok: true, assignments: created }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const mine = await listAssignmentsForStudent(user.id);
  return NextResponse.json({ ok: true, assignments: mine }, { headers: { "Cache-Control": "private, no-store" } });
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

  // DEFECT FIXED HERE. This legacy path wrote the `assignments` row and nothing
  // else, but the learner's list (listAssignmentsForStudent) reads through an INNER
  // JOIN on `assignment_targets`. A writing-prompt assignment therefore returned 200
  // to the teacher and was never visible to the student — assigned work that
  // silently reached nobody. The target row is part of creating an assignment, not
  // an extra the canonical path happens to do, so both paths now write it, and both
  // do it in ONE transaction so an assignment can never exist without its target.
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(assignments)
      .values({
        title: parsed.data.title,
        description: parsed.data.description ?? null,
        instructions: parsed.data.instructions ?? null,
        createdByUserId: user.id,
        targetUserId: parsed.data.targetUserId,
        relatedWritingPromptId: parsed.data.relatedWritingPromptId ?? null,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
      })
      .returning();

    await tx.insert(assignmentTargets).values({
      assignmentId: row!.id,
      studentUserId: parsed.data.targetUserId,
      dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
    });

    return row;
  });

  await db.insert(activityEvents).values({
    userId: parsed.data.targetUserId,
    type: "ASSIGNMENT_CREATED",
    payload: { assignmentId: created?.id, teacherId: user.id },
  });

  return NextResponse.json({ ok: true, assignment: created });
}
