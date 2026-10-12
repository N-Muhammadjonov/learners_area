import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { assignmentTargets, assignments, writingPrompts, writingSubmissions } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { canManageContent } from "@/lib/auth/ownership";
import { getLocale } from "@/lib/i18n";
import { saveAssignmentResponse } from "@/lib/data/coach-artifacts";
import { setAssignmentTargetStatus } from "@/lib/content/assignments";
import { classifyAssignment, evaluateAssignment, evaluateWritingSubmission } from "@/lib/services/coach";

/**
 * POST /api/assignments/:id/evaluate
 *
 * AssignmentEvaluationService is an orchestrator, not an evaluator. It inspects
 * the assignment and dispatches to the service that owns that kind of work:
 *
 *   writing task (linked prompt) -> WritingEvaluationService, using the
 *                                   student's own submission for that prompt
 *   free-form                    -> the resolver with an assignment request
 *
 * Multiple-choice assignments never reach a provider at all: exact grading is
 * already correct, and sending it to a model would only add cost and error.
 */
const schema = z.object({ response: z.string().min(20).max(20000).optional() });

/**
 * Completion is TWO facts and they have to move together.
 *
 * `assignments.status` is the assignment-level record. `assignment_targets.status` is the per-learner
 * record — and it is the one people actually read: /app/assignments builds every learner's card from
 * the TARGETS table ("one assignment can be set for several students: reading
 * assignments.target_user_id would hide every task from everyone except the first student it was set
 * for"), and the teacher's view of who has finished comes from the same rows.
 *
 * This route used to write only the first one. So a learner who typed a response, submitted it, and
 * got `ok: true` with an evaluation id still had a card reading "Not started" — forever — and the
 * teacher never saw the work as done. `setAssignmentTargetStatus` existed for exactly this and had no
 * callers anywhere in src. Both writes are in one transaction so the two statuses cannot diverge.
 *
 * A missing target row is not an error: rows created before the targets table existed have none, and
 * such an assignment is invisible to every learner anyway (the board reads the targets table), so
 * failing the evaluation would strand work nobody can see. The return value says which happened.
 */
async function markCompleted(assignmentId: string, studentUserId: string): Promise<{ targetMoved: boolean }> {
  return db.transaction(async (tx) => {
    await tx.update(assignments).set({ status: "completed" }).where(eq(assignments.id, assignmentId));
    const targetMoved = await setAssignmentTargetStatus(tx as never, {
      assignmentId, studentUserId, status: "completed",
    });
    return { targetMoved };
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, id),
  });
  if (!assignment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  /*
   * §11 — AUTHORIZE AND ATTRIBUTE AGAINST THE CALLER, NOT AGAINST "THE FIRST TARGET".
   *
   * `createAssignment` writes an `assignment_targets` row for EVERY student it is given, but
   * `assignments.targetUserId` is a single column that only ever holds `studentIds[0]`. The read path
   * already knows this — `mayReadAssignment` accepts any id present in the target rows — while this route
   * accepted only `targetUserId`. So a second target could open work that was set for them and then be
   * refused when submitting it: the read and write paths disagreed about who the assignment belongs to.
   *
   * Taking the union cannot remove anyone's access (`targetUserId` is still accepted), so it is strictly
   * safe. Under the single-target contract every shipped caller uses, the two sets are identical and
   * behaviour is unchanged — this is not multi-target support being invented, it is the two authorization
   * paths being made to agree.
   */
  const targetRows = await db
    .select({ studentUserId: assignmentTargets.studentUserId })
    .from(assignmentTargets)
    .where(eq(assignmentTargets.assignmentId, assignment.id));
  const isTargetStudent = assignment.targetUserId === user.id || targetRows.some((row) => row.studentUserId === user.id);
  const isManager =
    isAdministrator(user.role) || canManageContent(user, assignment.createdByUserId);
  /*
   * The learner whose work is actually being evaluated. A student caller evaluates THEIR OWN work; a
   * manager (teacher/admin) evaluates on behalf of the assignment's target, which is the existing
   * behaviour and is preserved. Resolving the subject from the caller is what stops a second target's
   * submission from being looked up, evaluated, marked complete and reported as the first target's —
   * cross-learner attribution, and the reason `assignment.targetUserId` is no longer read directly below.
   */
  const subjectUserId = isTargetStudent ? user.id : assignment.targetUserId;

  if (!isTargetStudent && !isManager) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  if (isTargetStudent && parsed.data.response) {
    await saveAssignmentResponse({
      assignmentId: assignment.id,
      userId: user.id,
      content: parsed.data.response,
    });
  }

  const dispatch = classifyAssignment({
    relatedWritingPromptId: assignment.relatedWritingPromptId,
    description: assignment.description,
  });

  if (dispatch.kind === "writing_task") {
    const submission = await db.query.writingSubmissions.findFirst({
      where: and(
        eq(writingSubmissions.userId, subjectUserId),
        eq(writingSubmissions.promptId, dispatch.writingPromptId)
      ),
      orderBy: desc(writingSubmissions.updatedAt),
    });
    if (!submission) {
      return NextResponse.json({ error: "no_submission", reason: dispatch.reason }, { status: 409 });
    }
    if (submission.status === "draft" || submission.content.trim().length === 0) {
      return NextResponse.json({ error: "submission_not_written" }, { status: 409 });
    }

    const prompt = await db.query.writingPrompts.findFirst({
      where: (p, { eq: eqOp }) => eqOp(p.id, submission.promptId),
    });
    if (!prompt) return NextResponse.json({ error: "prompt_missing" }, { status: 500 });

    // Delegate — do not re-implement writing evaluation here.
    const outcome = await evaluateWritingSubmission({
      userId: subjectUserId,
      submissionId: submission.id,
      taskType: prompt.taskType,
      prompt: prompt.prompt,
      content: submission.content,
      targetWordCount: prompt.targetWordCount,
      language: await getLocale(),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

    await markCompleted(assignment.id, subjectUserId);

    return NextResponse.json({
      ok: true,
      dispatchedTo: "writing",
      evaluationId: outcome.evaluation.id,
      checkedBy: PUBLIC_CHECKED_BY,
      reason: dispatch.reason,
    });
  }

  // Free-form: only the student's own response can be evaluated.
  const responseText = parsed.data.response;
  if (!responseText) {
    return NextResponse.json({ error: "response_required" }, { status: 400 });
  }
  if (!isTargetStudent) {
    return NextResponse.json({ error: "student_response_required" }, { status: 400 });
  }

  const outcome = await evaluateAssignment({
    userId: user.id,
    assignmentId: assignment.id,
    title: assignment.title,
    description: assignment.description,
    studentResponse: responseText,
    language: await getLocale(),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

  await markCompleted(assignment.id, subjectUserId);

  return NextResponse.json({
    ok: true,
    dispatchedTo: "free_form",
    evaluationId: outcome.evaluation.id,
    checkedBy: PUBLIC_CHECKED_BY,
    verdict: outcome.evaluation.verdict,
    reason: dispatch.reason,
  });
}
