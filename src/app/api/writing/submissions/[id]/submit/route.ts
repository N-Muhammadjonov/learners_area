import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, writingPrompts, writingSubmissions } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";
import { evaluateWritingSubmission } from "@/lib/services/coach";

/**
 * POST /api/writing/submissions/:id/submit
 *
 * The route owns authorization and the state transition; the *evaluation* is
 * delegated to WritingEvaluationService, which resolves the configured provider
 * and falls back to RIWI on any failure. This handler does not know which
 * provider answered — it returns the normalized result and the label naming the
 * evaluator that produced it.
 *
 * The submission is only marked `evaluated` after an evaluation actually
 * exists, so a provider failure leaves the draft intact and retryable instead
 * of locking the student out of their own work.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const submission = await db.query.writingSubmissions.findFirst({
    where: and(eq(writingSubmissions.id, id), eq(writingSubmissions.userId, user.id)),
  });
  if (!submission) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (submission.status !== "draft") {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }
  if (countWords(submission.content) < 20) {
    return NextResponse.json({ error: "too_short" }, { status: 400 });
  }

  const prompt = await db.query.writingPrompts.findFirst({
    where: eq(writingPrompts.id, submission.promptId),
  });
  if (!prompt) return NextResponse.json({ error: "prompt_missing" }, { status: 500 });

  const outcome = await evaluateWritingSubmission({
    userId: user.id,
    submissionId: submission.id,
    taskType: prompt.taskType,
    prompt: prompt.prompt,
    content: submission.content,
    targetWordCount: prompt.targetWordCount,
    category: prompt.category,
    language: await getLocale(),
  });

  if (!outcome.ok) {
    // Nothing was invented to fill the gap: the student sees a real error and
    // can retry, and their draft is untouched.
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  await db.transaction(async (tx) => {
    await tx
      .update(writingSubmissions)
      .set({ status: "evaluated", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(writingSubmissions.id, submission.id));

    await tx.insert(activityEvents).values({
      userId: user.id,
      type: "WRITING_SUBMITTED",
      payload: {
        submissionId: submission.id,
        overallBand: outcome.evaluation.overallEstimate,
        evaluatedBy: outcome.evaluation.providerId,
      },
    });
  });

  return NextResponse.json({
    ok: true,
    evaluationId: outcome.evaluation.id,
    checkedBy: PUBLIC_CHECKED_BY,
    fallbackUsed: outcome.evaluation.fallbackUsed,
  });
}
