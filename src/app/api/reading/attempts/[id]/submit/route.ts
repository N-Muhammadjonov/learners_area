import { isUuid } from "@/lib/validation/ids";
import { touchMeaningfulActivity } from "@/lib/services/activity";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingQuestions, readingAnswers, activityEvents } from "@/db/schema";
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

  const attempt = await db.query.readingAttempts.findFirst({
    where: and(eq(readingAttempts.id, id), eq(readingAttempts.userId, user.id)),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.status !== "in_progress") {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }

  const questions = await db.query.readingQuestions.findMany({
    where: eq(readingQuestions.passageId, attempt.passageId),
  });
  const answerByQuestion = new Map(parsed.data.answers.map((a) => [a.questionId, a.answer]));

  let score = 0;
  const rows = questions.map((q) => {
    const userAnswer = answerByQuestion.get(q.id) ?? "";
    const isCorrect = gradeAnswer(q.type, userAnswer, q.correctAnswer);
    if (isCorrect) score += 1;
    return { attemptId: attempt.id, questionId: q.id, userAnswer, isCorrect };
  });

  await db.transaction(async (tx) => {
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
