import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions, readingAnswers, activityEvents } from "@/db/schema";
import { readingAttemptExpired } from "@/lib/reading/timer";
import { readingAnswersForSubmission } from "@/lib/reading/submission";
import { gradeAnswer } from "@/lib/services/reading/grading";
import { objectiveAssessmentEvidence } from "@/lib/services/coach/contracts/objective-runtime";

/** Owned row lock, deadline/draft rule and deterministic grading stay authoritative. */
export async function submitReadingAttempt(userId: string, id: string, answers: { questionId: string; answer: string }[], database = db) {
  return database.transaction(async (tx) => {
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
      .where(and(eq(readingAttempts.id, id), eq(readingAttempts.userId, userId)))
      .limit(1)
      .for("update", { of: readingAttempts });
    if (!attempt) return { ok: false as const, status: 404 as const, error: "not_found" as const };
    if (attempt.status !== "in_progress") {
      return { ok: false as const, status: 409 as const, error: "already_submitted" as const };
    }

    // This is the server-accepted submit time, captured only after acquiring the
    // lock. If the deadline passed while waiting for another write, drafts win.
    const submittedAt = new Date();
    const questions = await tx.query.readingQuestions.findMany({
      where: eq(readingQuestions.passageId, attempt.passageId),
    });
    const timedOut = readingAttemptExpired(attempt.startedAt, attempt.suggestedMinutes, submittedAt.getTime());
    const savedDrafts = timedOut
      ? await tx
          .select({ questionId: readingAnswers.questionId, answer: readingAnswers.userAnswer })
          .from(readingAnswers)
          .where(and(eq(readingAnswers.attemptId, attempt.id), isNull(readingAnswers.isCorrect)))
      : [];
    const answerByQuestion = readingAnswersForSubmission(timedOut, answers, savedDrafts);

    let assessmentContracts;
    try { assessmentContracts = questions.map(question => ({ questionId: question.id, ...objectiveAssessmentEvidence("reading", question) })); }
    catch { return { ok: false as const, status: 409 as const, error: "assessment_metadata_unsupported" as const }; }
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
      userId: userId,
      type: "READING_ATTEMPT_COMPLETED",
      payload: { attemptId: attempt.id, score, totalQuestions: questions.length, assessmentContracts },
    });
    return { ok: true as const, score, totalQuestions: questions.length };
  });

}
