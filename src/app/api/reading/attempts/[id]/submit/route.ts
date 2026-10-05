import { isUuid } from "@/lib/validation/ids";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions, readingAnswers, activityEvents } from "@/db/schema";
import { assessmentScope } from "@/lib/data/reading-assessments";
import { readingAttemptExpired } from "@/lib/reading/timer";
import { readingAnswersForSubmission } from "@/lib/reading/submission";
import { requireActiveUser } from "@/lib/auth/current-user";
import { gradeAnswer } from "@/lib/services/reading/grading";

const schema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().max(500) })),
});

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  // Autosave and submission serialize on the attempt row. A concurrent late
  // autosave must not overwrite a score after a submit has committed, and two
  // submit clicks cannot both grade the same in-progress attempt.
  const result = await db.transaction(async (tx) => {
    const [attempt] = await tx
      .select({
        id: readingAttempts.id,
        passageId: readingAttempts.passageId,
        startedAt: readingAttempts.startedAt,
        status: readingAttempts.status,
        suggestedMinutes: readingPassages.suggestedMinutes,
      })
      .from(readingAttempts)
      .innerJoin(readingPassages, eq(readingAttempts.passageId, readingPassages.id))
      .where(and(eq(readingAttempts.id, id), eq(readingAttempts.userId, user.id)))
      .limit(1)
      .for("update", { of: readingAttempts });
    if (!attempt) return { ok: false as const, status: 404 as const, error: "not_found" as const };
    if (attempt.status !== "in_progress") {
      return { ok: false as const, status: 409 as const, error: "already_submitted" as const };
    }

    // This is the server-accepted submit time, captured only after acquiring the
    // lock. If the deadline passed while waiting for another write, drafts win.
    const scope = await assessmentScope(id, attempt.passageId, tx);
    const submittedAt = new Date();
    const questions = await tx.query.readingQuestions.findMany({
      where: inArray(readingQuestions.passageId, scope.passageIds),
    });
    const timedOut = readingAttemptExpired(attempt.startedAt, scope.durationMinutes ?? attempt.suggestedMinutes, submittedAt.getTime());
    const savedDrafts = timedOut
      ? await tx
          .select({ questionId: readingAnswers.questionId, answer: readingAnswers.userAnswer })
          .from(readingAnswers)
          .where(and(eq(readingAnswers.attemptId, attempt.id), isNull(readingAnswers.isCorrect)))
      : [];
    const answerByQuestion = readingAnswersForSubmission(timedOut, parsed.data.answers, savedDrafts);

    let score = 0;
    const rows = questions.map((question) => {
      const userAnswer = answerByQuestion.get(question.id) ?? "";
      const isCorrect = gradeAnswer(userAnswer, question.correctAnswer, question.acceptedAnswers);
      if (isCorrect) score += 1;
      return { attemptId: attempt.id, questionId: question.id, userAnswer, isCorrect };
    });

    await tx.delete(readingAnswers).where(and(eq(readingAnswers.attemptId, attempt.id), isNull(readingAnswers.isCorrect)));
    if (rows.length > 0) await tx.insert(readingAnswers).values(rows);
    await tx
      .update(readingAttempts)
      .set({ status: "completed", score, totalQuestions: questions.length, submittedAt })
      .where(and(eq(readingAttempts.id, attempt.id), eq(readingAttempts.status, "in_progress")));
    await tx.insert(activityEvents).values({
      userId: user.id,
      type: "READING_ATTEMPT_COMPLETED",
      payload: { attemptId: attempt.id, score, totalQuestions: questions.length },
    });
    return { ok: true as const, score, totalQuestions: questions.length };
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
  await touchMeaningfulActivity(user.id);
  return NextResponse.json({ ok: true, score: result.score, totalQuestions: result.totalQuestions });
}
