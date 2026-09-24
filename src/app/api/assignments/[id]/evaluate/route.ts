import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { assignments, writingPrompts, writingSubmissions } from "@/db/schema";
import { isAdministrator, requireActiveUser } from "@/lib/auth/current-user";
import { canManageContent } from "@/lib/auth/ownership";
import { getLocale } from "@/lib/i18n";
import { saveAssignmentResponse } from "@/lib/data/coach-artifacts";
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

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const assignment = await db.query.assignments.findFirst({
    where: eq(assignments.id, params.id),
  });
  if (!assignment) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const isTargetStudent = assignment.targetUserId === user.id;
  const isManager =
    isAdministrator(user.role) || canManageContent(user, assignment.createdByUserId);
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
        eq(writingSubmissions.userId, assignment.targetUserId),
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
      userId: assignment.targetUserId,
      submissionId: submission.id,
      taskType: prompt.taskType,
      prompt: prompt.prompt,
      content: submission.content,
      targetWordCount: prompt.targetWordCount,
      language: getLocale(),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

    await db
      .update(assignments)
      .set({ status: "completed" })
      .where(eq(assignments.id, assignment.id));

    return NextResponse.json({
      ok: true,
      dispatchedTo: "writing",
      evaluationId: outcome.evaluation.id,
      checkedBy: outcome.evaluation.checkedBy.displayName,
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
    language: getLocale(),
  });
  if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: 502 });

  await db.update(assignments).set({ status: "completed" }).where(eq(assignments.id, assignment.id));

  return NextResponse.json({
    ok: true,
    dispatchedTo: "free_form",
    evaluationId: outcome.evaluation.id,
    checkedBy: outcome.evaluation.checkedBy.displayName,
    verdict: outcome.evaluation.verdict,
    reason: dispatch.reason,
  });
}
