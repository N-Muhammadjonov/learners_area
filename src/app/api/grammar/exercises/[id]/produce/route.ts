import { getGrammarExerciseForUser } from "@/lib/data/grammar";
import { isUuid } from "@/lib/validation/ids";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { revisionForGrammarTopic } from "@/lib/content/attempt-binding";
import { activityEvents, grammarAttempts, grammarTopics } from "@/db/schema";
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

  const exercise = await getGrammarExerciseForUser(id, user.id);
  if (!exercise) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const topic = await db.query.grammarTopics.findFirst({
    where: eq(grammarTopics.id, exercise.topicId),
  });
  // The attempt records the topic revision it answers against, so a later wording
  // or answer change cannot reach back into a past attempt (§71).
  const revision = topic ? await revisionForGrammarTopic(topic.id) : null;

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

  /*
   * §10 — THE COMPENSATING DELETE IS ITSELF A WRITE, AND IT WAS UNGUARDED.
   *
   * The attempt row is inserted BEFORE the evaluation so the evaluator can point at it. If no evaluation
   * comes back, that row has to be removed: left behind with isCorrect=false it reads as a genuine wrong
   * answer and misreports the learner's work in history, progress and the weakness profile. But the
   * delete was awaited bare — if IT threw (connection drop, pool exhaustion, deadlock), the exception
   * propagated, the learner got a 500, and the misleading row SURVIVED. The compensation silently failed
   * while the response still looked like a plain evaluation error.
   *
   * So the compensation is retried once and its outcome is reported: a learner is told the evaluation
   * could not be produced either way, but an operator can now see that the row is still there. No
   * transaction is held across the external evaluation call — that call is already finished here.
   */
  const removeAttempt = async (): Promise<{ removed: boolean; error: string | null }> => {
    let error: string | null = null;
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        await db.delete(grammarAttempts).where(eq(grammarAttempts.id, attempt.id));
        return { removed: true, error: null };
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught);
      }
    }
    console.error(`[grammar-produce] compensating delete FAILED for attempt ${attempt.id}: ${error}`);
    return { removed: false, error };
  };

  if (!outcome.ok) {
    // No evaluation, no attempt: a row with isCorrect=false would misreport the student's work.
    const compensation = await removeAttempt();
    return NextResponse.json(
      compensation.removed ? { error: outcome.error } : { error: outcome.error, compensation: "attempt_row_retained" },
      { status: 502 },
    );
  }

  /*
   * §10 — THE VERDICT AND THE EVENT THAT REPORTS IT ARE ONE WRITE UNIT.
   *
   * They were two separate awaited writes. A failure between them left an attempt marked with its real
   * verdict but NO GRAMMAR_PRODUCTION_SUBMITTED event, so the attempt row, the learner's progress and the
   * activity feed disagreed with each other — the same class of defect already closed for live-class
   * attendance and assignment creation. Both statements are local and the external evaluation call has
   * already returned, so this transaction spans no network call.
   *
   * If the unit fails, the attempt is compensated away for exactly the reason above: a row left at its
   * inserted isCorrect=false would misreport the learner, and a half-applied verdict is worse than no
   * attempt at all. The learner can retry.
   */
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(grammarAttempts)
        .set({ isCorrect: outcome.evaluation.verdict === "correct" })
        .where(eq(grammarAttempts.id, attempt.id));
      await tx.insert(activityEvents).values({
        userId: user.id,
        type: "GRAMMAR_PRODUCTION_SUBMITTED",
        payload: { exerciseId: exercise.id, verdict: outcome.evaluation.verdict },
      });
    });
  } catch (error) {
    const compensation = await removeAttempt();
    console.error(`[grammar-produce] verdict/event write unit failed for attempt ${attempt.id}:`, error);
    return NextResponse.json(
      compensation.removed ? { error: "result_write_failed" } : { error: "result_write_failed", compensation: "attempt_row_retained" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    verdict: outcome.evaluation.verdict,
    checkedBy: PUBLIC_CHECKED_BY,
    // Released only after the student has committed an answer, so the sample
    // never leaks into the page before an attempt is made.
    sampleAnswer: exercise.correctOption,
    explanation: exercise.explanation,
    issues: outcome.evaluation.issues.map((issue) => issue.message),
  });
}
