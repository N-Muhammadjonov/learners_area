import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningAttempts, listeningQuestions, listeningAnswers, activityEvents } from "@/db/schema";
import { getSession } from "@/lib/auth/session";
import { gradeAnswer } from "@/lib/services/listening/grading";

const schema = z.object({
  answers: z.array(z.object({ questionId: z.string().uuid(), answer: z.string().max(500) })),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_input" }, { status: 400 });

  const attempt = await db.query.listeningAttempts.findFirst({
    where: and(eq(listeningAttempts.id, params.id), eq(listeningAttempts.userId, session.sub)),
  });
  if (!attempt) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (attempt.status !== "in_progress") {
    return NextResponse.json({ error: "already_submitted" }, { status: 409 });
  }

  const questions = await db.query.listeningQuestions.findMany({
    where: eq(listeningQuestions.testId, attempt.testId),
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
    if (rows.length > 0) await tx.insert(listeningAnswers).values(rows);
    await tx
      .update(listeningAttempts)
      .set({ status: "completed", score, totalQuestions: questions.length, submittedAt: new Date() })
      .where(eq(listeningAttempts.id, attempt.id));
    await tx.insert(activityEvents).values({
      userId: session.sub,
      type: "LISTENING_ATTEMPT_COMPLETED",
      payload: { attemptId: attempt.id, score, totalQuestions: questions.length },
    });
  });

  return NextResponse.json({ ok: true, score, totalQuestions: questions.length });
}
