import { isUuid } from "@/lib/validation/ids";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, grammarAttempts, grammarExercises, grammarTopics } from "@/db/schema";
import { requireActiveUser } from "@/lib/auth/current-user";
import { getLocale } from "@/lib/i18n";
import { checkStructures, structureVerdict } from "@/lib/services/grammar/mastery";
import { evaluateGrammarProduction } from "@/lib/services/coach";

/**
 * POST /api/grammar/exercises/:id/practice
 *
 * The two written activities of a grammar topic:
 *
 *   - `translate_it` — a sentence in the student's own language to render in
 *     English. Graded by a *structure checklist*, not by comparing whole
 *     sentences: two correct translations rarely share their words, so string
 *     equality would mark good work wrong. The student is told exactly which
 *     structure did not appear.
 *   - `activate_it` — free writing that forces the structure out of the student,
 *     judged by the text evaluator (RIWI), whose name is reported back.
 *
 * The attempt row is written first so the evaluation can point at it, and is
 * removed if nothing could be produced — no attempt with an invented result.
 */
const schema = z.object({
  activity: z.enum(["translate_it", "activate_it"]),
  answer: z.string().min(2).max(2000),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const exercise = await db.query.grammarExercises.findFirst({
    where: eq(grammarExercises.id, id),
  });
  if (!exercise) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const topic = await db.query.grammarTopics.findFirst({
    where: eq(grammarTopics.id, exercise.topicId),
  });

  const structures = exercise.targetStructures ?? [];
  const check = checkStructures(parsed.data.answer, structures);
  const verdict = structureVerdict(check, structures.length > 0);

  const [attempt] = await db
    .insert(grammarAttempts)
    .values({
      userId: user.id,
      exerciseId: exercise.id,
      activity: parsed.data.activity,
      selectedOption: "",
      responseText: parsed.data.answer,
      // The structure checklist is deterministic, so it can decide. When no
      // structures were authored the row is provisional and only the evaluator's
      // verdict may set it — until then it is not counted as correct.
      isCorrect: verdict === "correct",
    })
    .returning();
  if (!attempt) return NextResponse.json({ error: "attempt_write_failed" }, { status: 500 });

  // Activate It is about production, which no checklist can judge: the text
  // evaluator reads the whole response. Translate It stays deterministic unless
  // the topic has no authored structures to check against.
  const needsEvaluator = parsed.data.activity === "activate_it" || verdict === "undetermined";

  if (!needsEvaluator) {
    await db.insert(activityEvents).values({
      userId: user.id,
      type: "GRAMMAR_PRACTICE_SUBMITTED",
      payload: { exerciseId: exercise.id, activity: parsed.data.activity, verdict },
    });

    return NextResponse.json({
      ok: true,
      attemptId: attempt.id,
      activity: parsed.data.activity,
      verdict,
      checkedBy: null,
      structures: check,
      sampleAnswer: exercise.correctOption,
      explanation: exercise.explanation,
      issues: [],
    });
  }

  const outcome = await evaluateGrammarProduction({
    userId: user.id,
    attemptId: attempt.id,
    promptText:
      parsed.data.activity === "translate_it"
        ? exercise.translatePromptUz ?? exercise.promptText
        : exercise.activationPrompt ?? exercise.promptText,
    studentAnswer: parsed.data.answer,
    targetStructure: topic?.title ?? null,
    sampleAnswer: exercise.correctOption,
    language: await getLocale(),
  });

  if (!outcome.ok) {
    // No evaluation, no attempt: `isCorrect: false` would misreport good work.
    await db.delete(grammarAttempts).where(eq(grammarAttempts.id, attempt.id));
    return NextResponse.json({ error: outcome.error }, { status: 502 });
  }

  const finalVerdict = outcome.evaluation.verdict;
  await db
    .update(grammarAttempts)
    .set({ isCorrect: finalVerdict === "correct" })
    .where(eq(grammarAttempts.id, attempt.id));

  await db.insert(activityEvents).values({
    userId: user.id,
    type: "GRAMMAR_PRACTICE_SUBMITTED",
    payload: { exerciseId: exercise.id, activity: parsed.data.activity, verdict: finalVerdict },
  });

  return NextResponse.json({
    ok: true,
    attemptId: attempt.id,
    activity: parsed.data.activity,
    verdict: finalVerdict,
    checkedBy: outcome.evaluation.checkedBy.displayName,
    structures: check,
    sampleAnswer: exercise.correctOption,
    explanation: exercise.explanation,
    issues: outcome.evaluation.issues.map((issue) => issue.message),
  });
}
