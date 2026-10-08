import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { readingAttempts, readingPassages, readingQuestions, readingAnswers, readingQuestionGroups, activityEvents } from "@/db/schema";
import { assessmentScope } from "@/lib/data/reading-assessments";
import { readingAttemptExpired } from "@/lib/reading/timer";
import { readingAnswersForSubmission } from "@/lib/reading/submission";
import { gradeReadingQuestion } from "@/lib/reading/question-model";


/** Existing atomic submit, shared by the HTTP adapter and database acceptance tests. */
export async function submitReadingAttempt(id:string,userId:string,entries:{questionId:string;answer:string}[],executor:typeof db=db) {
  // Autosave and submission serialize on the attempt row. A concurrent late
  // autosave must not overwrite a score after a submit has committed, and two
  // submit clicks cannot both grade the same in-progress attempt.
  return executor.transaction(async (tx) => {
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
    const answerByQuestion = readingAnswersForSubmission(timedOut, entries, savedDrafts);

    const groups=await tx.query.readingQuestionGroups.findMany({where:inArray(readingQuestionGroups.passageId,scope.passageIds)});
    let score = 0;
    const rows = questions.map((question) => {
      const userAnswer = answerByQuestion.get(question.id) ?? "";
      const isCorrect = gradeReadingQuestion(userAnswer, question, groups.find(g=>g.id===question.groupId)?.sharedChoices);
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
      payload: { attemptId: attempt.id, score, totalQuestions: questions.length },
    });
    return { ok: true as const, score, totalQuestions: questions.length };
  });

}
