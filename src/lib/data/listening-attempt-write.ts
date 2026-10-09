import { sql } from "drizzle-orm";
import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { listeningPackages, activityEvents, listeningAnswers, listeningAttempts, listeningQuestions, users } from "@/db/schema";
import { gradePackage } from "@/lib/listening/package";
import { objectiveAssessmentEvidence } from "@/lib/services/coach/contracts/objective-runtime";
import { gradeAnswer } from "@/lib/services/listening/grading";

/** Serialize starts for one authenticated account; retries resume an existing attempt. */
export async function startListeningAttempt(userId: string, testId: string, database = db) {
  return database.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!user) return null;
    const existing = await tx.query.listeningAttempts.findFirst({ where: and(eq(listeningAttempts.userId, userId), eq(listeningAttempts.testId, testId), eq(listeningAttempts.status, "in_progress")) });
    if (existing) return existing.id;
    const [created] = await tx.insert(listeningAttempts).values({ userId, testId }).returning({ id: listeningAttempts.id });
    return created!.id;
  });
}

/** No answer key leaves this writer. The locked owned attempt is the write authority. */
export async function submitListeningAttempt(userId: string, id: string, answers: { questionId: string; answer: string }[], database = db) {
  return database.transaction(async (tx) => {
    const [attempt] = await tx.select().from(listeningAttempts).where(and(eq(listeningAttempts.id, id), eq(listeningAttempts.userId, userId))).for("update");
    if (!attempt) return { error: "not_found" as const };
    if (attempt.status !== "in_progress") return { error: "already_submitted" as const };
    const questions = await tx.query.listeningQuestions.findMany({ where: eq(listeningQuestions.testId, attempt.testId) });
    const allowed = new Set(questions.map((q) => q.id));
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a.answer]));
    if (answerByQuestion.size !== answers.length || answers.some((a) => !allowed.has(a.questionId))) return { error: "invalid_input" as const };
    const ready = await tx.execute(sql`select to_regclass('public.listening_packages') is not null as ready`);
    const pkg = ready.rows[0]?.ready ? await tx.query.listeningPackages.findFirst({ where: eq(listeningPackages.testId, attempt.testId) }) : null;
    const fullResults = pkg ? gradePackage(pkg.payload, Object.fromEntries(questions.map(q => [q.order, answerByQuestion.get(q.id) ?? ""]))) : null;
    let assessmentContracts;
    try {
      assessmentContracts = questions.map(q => {
        const canonical = pkg?.payload.questions.find(question => question.number === q.order);
        return { questionId: q.id, ...objectiveAssessmentEvidence("listening", {
          type: canonical ? (canonical.options.length ? "multiple_choice" : "short_answer") : q.type,
          requiredSelections: canonical?.options.length ? canonical.pair.length + 1 : undefined,
        }) };
      });
    } catch { return { error: "assessment_metadata_unsupported" as const }; }
    let score = 0;
    const rows = questions.map((q) => {
      const userAnswer = answerByQuestion.get(q.id) ?? "";
      const isCorrect = fullResults ? fullResults.find(r => r.number === q.order)!.correct : gradeAnswer(q.type, userAnswer, q.correctAnswer);
      if (isCorrect) score++;
      return { attemptId: id, questionId: q.id, userAnswer, isCorrect };
    });
    if (rows.length) await tx.insert(listeningAnswers).values(rows);
    await tx.update(listeningAttempts).set({ status: "completed", score, totalQuestions: questions.length, submittedAt: new Date() }).where(eq(listeningAttempts.id, id));
    await tx.insert(activityEvents).values({ userId, type: "LISTENING_ATTEMPT_COMPLETED", payload: { attemptId: id, score, totalQuestions: questions.length, assessmentContracts } });
    return { score, totalQuestions: questions.length };
  });
}
