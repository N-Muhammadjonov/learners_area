import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, assignmentTargets, assignments, writingPrompts } from "@/db/schema";
import { assignRefusalIssue, listAssignmentsCreatedBy, listAssignmentsForStudent, mayAssignTo } from "@/lib/content/assignments";
import { isStaff, requireActiveUser } from "@/lib/auth/current-user";
import { createAssignment } from "@/lib/content/assignments";
import { liveWhere } from "@/lib/services/cms/publication";

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
    // ATOMICITY (B3). The `ASSIGNMENT_CREATED` event used to be written AFTER this
    // transaction committed. That made the API's answer disagree with the database
    // whenever the event write failed: the assignment and its target were committed,
    // the request still threw, the teacher saw a 500 — and a retry, which is exactly
    // what a 500 invites, created a SECOND assignment for the same work. Assigned work
    // is not idempotent under a client-generated key, so "committed but reported as
    // failed" is a duplicate-creation defect, not a logging gap.
    //
    // The event is part of creating the assignment (it is what puts the work in the
    // learner's activity feed), so it belongs in the same transaction: either the
    // whole operation lands or none of it does, and a retry after a failure is safe
    // because there is nothing to duplicate.
    const result = await db.transaction(async (tx) => {
      const created = await createAssignment(tx, {
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
      });
      // A validation refusal is not a failure: it commits nothing and must keep its
      // 403/422 answer rather than being flattened into a 500.
      if (!created.ok) return created;
      await tx.insert(activityEvents).values({
        userId: parsed.data.targetUserId,
        type: "ASSIGNMENT_CREATED",
        payload: { assignmentId: created.assignmentId, teacherId: user.id, contentVersionId: created.versionId },
      });
      return created;
    });
    if (!result.ok) {
      const forbidden = result.issues.some((issue) => issue.code.startsWith("assign_forbidden"));
      return NextResponse.json({ ok: false, issues: result.issues }, { status: forbidden ? 403 : 422 });
    }
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
    /*
     * THE SAME AUTHORITY RULE AS THE CANONICAL PATH.
     *
     * This branch used to check nothing but `isStaff(user.role)`, which the route already checked
     * before branching. So it never asked the question the canonical path asks through
     * `mayAssignTo()` — may THIS actor set work for THIS learner — and the answer differed by path
     * alone:
     *
     *   a teacher with no roster link to the student   canonical 403 outside_roster, legacy 200 + rows
     *   a targetUserId that is not a student at all    canonical 403 not_a_student,  legacy 200 + rows
     *
     * Both wrote the assignment, the target and the ASSIGNMENT_CREATED event, so this was not a
     * harmless difference in status code: an off-roster teacher could put work into a learner's feed,
     * and a teacher could "assign" work to another teacher. The transaction was never the problem —
     * it committed exactly what it was told to.
     *
     * The check runs INSIDE the transaction, on the same `tx`, so authorization is evaluated against
     * the rows this transaction can see and a refusal commits nothing.
     */
    const verdict = await mayAssignTo({ id: user.id, role: user.role }, parsed.data.targetUserId, tx as never);
    if (!verdict.allowed) return { ok: false as const, issues: [assignRefusalIssue(verdict)] };

    /*
     * AND THE SAME CONTENT RULE. `relatedWritingPromptId` was validated only as a UUID shape, so a
     * request could name a prompt that does not exist — which reached the insert and answered 500 on
     * a foreign-key violation — or one that is a draft, which succeeded and handed the learner work
     * they cannot open. The canonical path refuses both ("you cannot set work nobody can open"), so
     * the legacy path applies the same liveness rule the learner read applies.
     */
    const [prompt] = await tx
      .select({ id: writingPrompts.id })
      .from(writingPrompts)
      .where(and(
        eq(writingPrompts.id, parsed.data.relatedWritingPromptId!),
        liveWhere({
          publicationState: writingPrompts.publicationState,
          publishAt: writingPrompts.publishAt,
        }),
      ))
      .limit(1);
    if (!prompt)
      return {
        ok: false as const,
        issues: [{
          code: "content_not_live",
          message: "That writing prompt does not exist or is not open to learners, so it cannot be set as work.",
          field: "relatedWritingPromptId",
        }],
      };

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

    // Same atomicity rule as the canonical path (B3), and the same reason: an event
    // written after commit could fail and leave a committed assignment behind a 500,
    // so the teacher's retry created a second one.
    await tx.insert(activityEvents).values({
      userId: parsed.data.targetUserId,
      type: "ASSIGNMENT_CREATED",
      payload: { assignmentId: row!.id, teacherId: user.id },
    });

    return { ok: true as const, assignment: row };
  });

  // A refusal keeps the canonical path's answer shape and status, so a caller cannot tell which
  // branch it reached — which is the point: the two paths now enforce one rule.
  if (!created.ok) {
    const forbidden = created.issues.some((issue) => issue.code.startsWith("assign_forbidden"));
    return NextResponse.json({ ok: false, issues: created.issues }, { status: forbidden ? 403 : 422 });
  }
  return NextResponse.json({ ok: true, assignment: created.assignment });
}
