import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, grammarAttempts, grammarExercises, grammarTopics } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { evaluateGrammarProduction } from "@/lib/services/coach";

/**
 * POST /api/grammar/exercises/:id/produce
 *
 * Grades a *written* answer. Multiple-choice items stay on deterministic
 * objective grading (POST /api/grammar/topics/:id/submit) — comparing an option
 * is exact, cheap and correct. A produced sentence cannot be graded that way: a
 * perfectly good answer may share no words with the sample answer, which is
 * exactly the case GrammarEvaluationService exists for.
 *
 * The attempt row is written first so the evaluation can point at it, and is
 * removed again if no evaluation could be produced — no orphaned "attempt" with
 * a made-up result.
 */
const schema = z.object({ answer: z.string().min(1).max(2000) });

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const exercise = await db.query.grammarExercises.findFirst({
    where: eq(grammarExercises.id, id),
  });
  if (!exercise) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const topic = await db.query.grammarTopics.findFirst({
    where: eq(grammarTopics.id, exercise.topicId),
  });

  const [attempt] = await db
    .insert(grammarAttempts)
    .values({
      userId: user.id,
      exerciseId: exercise.id,
      selectedOption: parsed.data.answer,
      isCorrect: false,
    })
    .returning();
  if (!attempt) return NextResponse.json({ error: "attempt_write_failed" }, { status: 500 });

  const outcome = await evaluateGrammarProduction({
    userId: user.id,
    attemptId: attempt.id,
    promptText: exercise.promptText,
    studentAnswer: parsed.data.answer,
    targetStructure: topic?.title ?? null,
    sampleAnswer: exercise.correctOption,
    language: await getLocale(),
  });

  if (!outcome.ok) {
    // No evaluation, no attempt: a row with isCorrect=false would misreport the
    // student's work.
    await db.delete(grammarAttempts).where(eq(grammarAttempts.id, attempt.id));
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  await db
    .update(grammarAttempts)
    .set({ isCorrect: outcome.evaluation.verdict === "correct" })
    .where(eq(grammarAttempts.id, attempt.id));

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "GRAMMAR_PRODUCTION_SUBMITTED",
    payload: { exerciseId: exercise.id, verdict: outcome.evaluation.verdict },
  });

  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    verdict: outcome.evaluation.verdict,
    checkedBy: outcome.evaluation.checkedBy.displayName,
    // Released only after the student has committed an answer, so the sample
    // never leaks into the page before an attempt is made.
    sampleAnswer: exercise.correctOption,
    explanation: exercise.explanation,
    issues: outcome.evaluation.issues.map((issue) => issue.message),
  });
}
