import { isUuid } from "@/lib/validation/ids";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions, readingAnswers, activityEvents } from "@/db/schema";
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

  const [attempt] = await db
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
    .limit(1);
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.status !== "in_progress") {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }

  const questions = await db.query.readingQuestions.findMany({
    where: eq(readingQuestions.passageId, attempt.passageId),
  });
  const timedOut = readingAttemptExpired(attempt.startedAt, attempt.suggestedMinutes);
  // Once the deadline has passed, the browser payload is untrusted and ignored.
  // Grade only the latest server-saved draft so a clock change cannot extend a test.
  const savedDrafts = timedOut
    ? await db
        .select({ questionId: readingAnswers.questionId, answer: readingAnswers.userAnswer })
        .from(readingAnswers)
        .where(and(eq(readingAnswers.attemptId, attempt.id), isNull(readingAnswers.isCorrect)))
    : [];
  const answerByQuestion = readingAnswersForSubmission(timedOut, parsed.data.answers, savedDrafts);

  let score = 0;
  const rows = questions.map((q) => {
    const userAnswer = answerByQuestion.get(q.id) ?? "";
    // The answer key, plus every alternative the source itself accepts.
    const isCorrect = gradeAnswer(userAnswer, q.correctAnswer, q.acceptedAnswers);
    if (isCorrect) score += 1;
    return { attemptId: attempt.id, questionId: q.id, userAnswer, isCorrect };
  });

  await db.transaction(async (tx) => {
    await tx.delete(readingAnswers).where(and(eq(readingAnswers.attemptId, attempt.id), isNull(readingAnswers.isCorrect)));
    if (rows.length > 0) await tx.insert(readingAnswers).values(rows);
    await tx
      .update(readingAttempts)
      .set({ status: "completed", score, totalQuestions: questions.length, submittedAt: new Date() })
      .where(eq(readingAttempts.id, attempt.id));
    await tx.insert(activityEvents).values({
      userId: user.id,
      type: "READING_ATTEMPT_COMPLETED",
      payload: { attemptId: attempt.id, score, totalQuestions: questions.length },
    });
  });

  await touchMeaningfulActivity(user.id);

  return NextResponse.json({ ok: true, score, totalQuestions: questions.length });
}
