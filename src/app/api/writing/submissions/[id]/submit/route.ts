import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { writingSubmissions, writingPrompts, writingFeedback, activityEvents } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { getWritingEvaluationService } from "@/lib/services/writing-evaluation";
import { countWords } from "@/lib/services/writing-evaluation/heuristics";

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

  const prompt = await db.query.writingPrompts.findFirst({ where: eq(writingPrompts.id, submission.promptId) });
  if (!prompt) return NextResponse.json({ error: "prompt_missing" }, { status: 500 });

  const evaluator = getWritingEvaluationService();
  const result = await evaluator.evaluate({
    taskType: prompt.taskType,
    prompt: prompt.prompt,
    content: submission.content,
    targetWordCount: prompt.targetWordCount,
  });

  await db.transaction(async (tx) => {
    await tx
      .update(writingSubmissions)
      .set({ status: "evaluated", submittedAt: new Date(), updatedAt: new Date() })
      .where(eq(writingSubmissions.id, submission.id));

    await tx.insert(writingFeedback).values({
      submissionId: submission.id,
      source: "demo_ai",
      taskResponseBand: result.taskResponseBand,
      coherenceBand: result.coherenceBand,
      lexicalBand: result.lexicalBand,
      grammarBand: result.grammarBand,
      overallBand: result.overallBand,
      strengths: result.strengths,
      weaknesses: result.weaknesses,
      suggestions: result.suggestions,
    });

    await tx.insert(activityEvents).values({
      userId: session.sub,
      type: "WRITING_SUBMITTED",
      payload: { submissionId: submission.id, overallBand: result.overallBand },
    });
  });

  return NextResponse.json({ ok: true });
}
