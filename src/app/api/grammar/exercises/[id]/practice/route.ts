import { getGrammarExerciseForUser } from "@/lib/data/grammar";
import { isUuid } from "@/lib/validation/ids";
import { PUBLIC_CHECKED_BY } from "@/lib/services/coach/attribution";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { activityEvents, grammarAttempts, grammarTopics } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { checkStructures } from "@/lib/services/grammar/mastery";
import { grammarPracticeSchema, grammarPracticeEvidence } from "@/lib/services/grammar/production";
import { evaluateGrammarProduction } from "@/lib/services/coach";

/**
 * POST /api/grammar/exercises/:id/practice
 *
 * The two written activities of a grammar topic:
 *
 *   - `translate_it` — translation of the authored Uzbek prompt. The shared
 *     evaluator must check meaning, grammar and the target structure. A phrase
 *     checklist provides diagnostics only; it cannot grant translation credit.
 *   - `activate_it` — free writing that forces the structure out of the student,
 *     judged by the text evaluator (RIWI), whose name is reported back.
 *
 * The attempt row is written first so the evaluation can point at it, and is
 * removed if nothing could be produced — no attempt with an invented result.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = grammarPracticeSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const exercise = await getGrammarExerciseForUser(id, user.id);
  if (!exercise) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const topic = await db.query.grammarTopics.findFirst({
    where: eq(grammarTopics.id, exercise.topicId),
  });

  const structures = exercise.targetStructures ?? [];
  const check = checkStructures(parsed.data.answer, structures);
  const evidence = grammarPracticeEvidence(exercise, parsed.data.activity, topic?.title ?? null);
  if (!evidence) return NextResponse.json({ error: "assessment_metadata_unsupported" }, { status: 409 });

  const [attempt] = await db
    .insert(grammarAttempts)
    .values({
      userId: user.id,
      exerciseId: exercise.id,
      activity: parsed.data.activity,
      selectedOption: "",
      responseText: parsed.data.answer,
      // Only the evaluator's result can grant credit for produced language.
      isCorrect: false,
    })
    .returning();
  if (!attempt) return NextResponse.json({ error: "attempt_write_failed" }, { status: 500 });

  const outcome = await evaluateGrammarProduction({
    userId: user.id,
    attemptId: attempt.id,
    ...evidence,
    studentAnswer: parsed.data.answer,
    activity: parsed.data.activity,
    language: await getLocale(),
  });

  if (!outcome.ok) {
    // No evaluation, no attempt: `isCorrect: false` would misreport good work.
    await db.delete(grammarAttempts).where(eq(grammarAttempts.id, attempt.id));
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  const finalVerdict = outcome.evaluation.verdict;
  await db.transaction(async tx => {
    await tx.update(grammarAttempts).set({ isCorrect: finalVerdict === "correct" })
      .where(eq(grammarAttempts.id, attempt.id));
    await tx.insert(activityEvents).values({
      userId: user.id,
      type: "GRAMMAR_PRACTICE_SUBMITTED",
      payload: { exerciseId: exercise.id, activity: parsed.data.activity, verdict: finalVerdict },
    });
  });

  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    activity: parsed.data.activity,
    verdict: finalVerdict,
    checkedBy: PUBLIC_CHECKED_BY,
    structures: check,
    sampleAnswer: null,
    explanation: exercise.explanation,
    issues: outcome.evaluation.issues.map((issue) => issue.message),
  });
}
