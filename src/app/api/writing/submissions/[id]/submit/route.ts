import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, writingPrompts, writingSubmissions } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
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
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const submission = await db.query.writingSubmissions.findFirst({
    where: and(eq(writingSubmissions.id, params.id), eq(writingSubmissions.userId, session.sub)),
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
    userId: session.sub,
    submissionId: submission.id,
    taskType: prompt.taskType,
    prompt: prompt.prompt,
    content: submission.content,
    targetWordCount: prompt.targetWordCount,
    language: getLocale(),
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
      userId: session.sub,
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
    checkedBy: outcome.evaluation.checkedBy.displayName,
    providerId: outcome.evaluation.providerId,
    fallbackUsed: outcome.evaluation.fallbackUsed,
  });
}
