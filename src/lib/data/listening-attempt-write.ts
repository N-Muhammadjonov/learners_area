import { backendAction } from "@/lib/backend/server";
import { sql } from "drizzle-orm";
import "server-only";
import { and, eq } from "drizzle-orm";
import { db, FRONTEND_DATABASE } from "@/db/client";
import { listeningPackages, activityEvents, listeningAnswers, listeningAttempts, listeningQuestions, users } from "@/db/schema";
import { gradePackage } from "@/lib/listening/package";
import { gradeAnswer } from "@/lib/services/listening/grading";
import { gradeForType, questionType, resolveQuestionType } from "@/lib/content/question-types";
import { revisionForListeningTest } from "@/lib/content/attempt-binding";
import { listeningQuestionsForAttempt } from "@/lib/listening/question-set";

/** Serialize starts for one authenticated account; retries resume an existing attempt. */
export async function startListeningAttempt(userId: string, testId: string, database = db) {
  if (FRONTEND_DATABASE && database === db) return backendAction<string | null>("listening.start", { id: testId });
  return database.transaction(async (tx) => {
    const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update");
    if (!user) return null;
    const existing = await tx.query.listeningAttempts.findFirst({ where: and(eq(listeningAttempts.userId, userId), eq(listeningAttempts.testId, testId), eq(listeningAttempts.status, "in_progress")) });
    if (existing) return existing.id;
    // Bind the attempt to the revision the learner is given (§71). A test with no
    // published revision is recorded unbound rather than guessed at.
    const revision = await revisionForListeningTest(testId, tx as never);
    const [created] = await tx
      .insert(listeningAttempts)
      .values({ userId, testId, ...(revision ? { contentVersionId: revision.id } : {}) })
      .returning({ id: listeningAttempts.id });
    return created!.id;
  });
}

/**
 * Grade one canonical Listening row.
 *
 * When the row states its canonical type code, the REGISTRY grades it (`gradeByTypeId`), so a
 * choice answer accepts the label or the option text, a completion answer honours the type's word
 * limit, and a choose-two question requires both — one model for the importer, the renderer, the
 * review and the score. A row written before type codes existed keeps the historical
 * normalised-exact rule, so no historical result changes meaning.
 */
function gradeListeningQuestion(
  question: { type: "multiple_choice" | "short_answer"; typeCode: string | null; correctAnswer: string; options: string[] | null },
  userAnswer: string,
): boolean {
  if (question.typeCode) {
    const descriptor = questionType(question.typeCode, "listening") ?? resolveQuestionType(question.typeCode, "listening");
    if (descriptor) {
      /*
       * A choose-two/three question is stored as ONE comma-joined key ("A,B") because that is what
       * the canonical package format carries, while the registry's `multi_all` rule expects the
       * individual keys. Splitting them here — driven by the registry's own answer model — is what
       * lets a two-part answer be graded by the same rule the importer and the review use.
       */
      const multi = descriptor.answerModel.kind === "choice_multi";
      const graded = gradeForType(descriptor, {
        answer: userAnswer,
        key: question.correctAnswer,
        ...(multi ? { keys: question.correctAnswer.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean) } : {}),
        options: question.options ?? [],
      });
      return graded.correct;
    }
  }
  return gradeAnswer(question.type, userAnswer, question.correctAnswer);
}

/** No answer key leaves this writer. The locked owned attempt is the write authority. */
export async function submitListeningAttempt(userId: string, id: string, answers: { questionId: string; answer: string }[], database = db) {
  return database.transaction(async (tx) => {
    const [attempt] = await tx.select().from(listeningAttempts).where(and(eq(listeningAttempts.id, id), eq(listeningAttempts.userId, userId))).for("update");
    if (!attempt) return { error: "not_found" as const };
    if (attempt.status !== "in_progress") return { error: "already_submitted" as const };
    // The SAME set the learner was given. Grading against another revision's questions would
    // mark a correct answer wrong (or leak a later key) the moment an item is revised.
    const questions = await listeningQuestionsForAttempt(attempt, tx as never);
    const allowed = new Set(questions.map((q) => q.id));
    const answerByQuestion = new Map(answers.map((a) => [a.questionId, a.answer]));
    if (answerByQuestion.size !== answers.length || answers.some((a) => !allowed.has(a.questionId))) return { error: "invalid_input" as const };
    const ready = await tx.execute(sql`select to_regclass('public.listening_packages') is not null as ready`);
    const pkg = ready.rows[0]?.ready ? await tx.query.listeningPackages.findFirst({ where: eq(listeningPackages.testId, attempt.testId) }) : null;
    const fullResults = pkg ? gradePackage(pkg.payload, Object.fromEntries(questions.map(q => [q.order, answerByQuestion.get(q.id) ?? ""]))) : null;
    let score = 0;
    const rows = questions.map((q) => {
      const userAnswer = answerByQuestion.get(q.id) ?? "";
      const isCorrect = fullResults
        ? fullResults.find(r => r.number === q.order)!.correct
        : gradeListeningQuestion(q, userAnswer);
      if (isCorrect) score++;
      return { attemptId: id, questionId: q.id, userAnswer, isCorrect };
    });
    if (rows.length) await tx.insert(listeningAnswers).values(rows);
    await tx.update(listeningAttempts).set({ status: "completed", score, totalQuestions: questions.length, submittedAt: new Date() }).where(eq(listeningAttempts.id, id));
    await tx.insert(activityEvents).values({ userId, type: "LISTENING_ATTEMPT_COMPLETED", payload: { attemptId: id, score, totalQuestions: questions.length } });
    return { score, totalQuestions: questions.length };
  });
}
