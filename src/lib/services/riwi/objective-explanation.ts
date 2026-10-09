import "server-only";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, activityEvents, readingAttempts, readingPassages, readingQuestions, readingAnswers, listeningAttempts, listeningTests, listeningQuestions, listeningAnswers, listeningPackages } from "@/db/schema";
import { objectiveAssessmentEvidence } from "@/lib/services/coach/contracts/objective-runtime";
import { objectiveSourceFingerprint } from "@/lib/services/coach/contracts/objective-source";
import { getAssessmentContractOrThrow } from "@/lib/services/coach/contracts/registry";
import { gradeAnswer as gradeReading } from "@/lib/services/reading/grading";
import { gradeAnswer as gradeListening } from "@/lib/services/listening/grading";
import { gradePackage } from "@/lib/listening/package";
import { authorizeCapability, type RiwiActor } from "./capabilities";
import { hasOpenExam } from "./dictionary";
import { recordRiwiAudit } from "./audit";
import { objectiveExplanationRequestSchema, objectiveExplanationSchema } from "./objective-explanation-schema";

const proofSchema = z.object({ questionId: z.string().uuid(), key: z.string(), promptVersion: z.string(), rubricVersion: z.string(), sourceHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ObjectiveExplanationFailure = "not_found" | "locked" | "evidence_missing" | "source_changed" | "unsupported_task";

/** Authored explanation, not a new model grading path. All identities, grades,
 * contracts and evidence come from owned persisted rows. No external dispatch.
 * Historical attempts without source proofs fail explicitly, never backfilled
 * with a fabricated submission-time snapshot.
 */
export async function explainObjectiveAttempt(actor: RiwiActor, rawInput: unknown, correlationId: string, database = db) {
  const input = objectiveExplanationRequestSchema.parse(rawInput);
  return database.transaction(async (tx) => {
    const deny = (code: ObjectiveExplanationFailure) => ({ ok: false as const, code });
    const [current] = await tx.select({ id: users.id, role: users.role, accountStatus: users.accountStatus }).from(users).where(eq(users.id, actor.id)).for("share");
    if (actor.accountStatus !== "active" || !current || current.role !== actor.role || !authorizeCapability(current, "riwi.content.read").allowed) return deny("not_found");
    // Account serialization matches Reading/Listening starts and keeps a new exam from
    // opening while its completed explanation is being authorized.
    if (await hasOpenExam({ id: current.id, role: "student" }, tx)) return deny("locked");
    const reading = input.domain === "reading";
    const attemptTable = reading ? readingAttempts : listeningAttempts;
    const [attempt] = await tx.select().from(attemptTable).where(and(eq(attemptTable.id, input.attemptId), eq(attemptTable.userId, current.id))).for("share");
    if (!attempt) return deny("not_found");
    if (attempt.status !== "completed" || !attempt.submittedAt) return deny("locked");
    const eventType = reading ? "READING_ATTEMPT_COMPLETED" : "LISTENING_ATTEMPT_COMPLETED";
    const event = await tx.query.activityEvents.findFirst({ where: and(eq(activityEvents.userId, current.id), eq(activityEvents.type, eventType), sql`${activityEvents.payload}->>'attemptId' = ${attempt.id}`), orderBy: desc(activityEvents.createdAt) });
    const payload = event?.payload as { assessmentContracts?: unknown[] } | undefined;
    const rawProofs = Array.isArray(payload?.assessmentContracts) ? payload.assessmentContracts : [];
    const matching = rawProofs.filter(value => value && typeof value === "object" && (value as {questionId?: unknown}).questionId === input.questionId);
    if (matching.length !== 1) return deny("evidence_missing");
    const proof = proofSchema.safeParse(matching[0]);
    if (!proof.success) return deny("evidence_missing");

    let questionText: string, correctAnswer: string, userAnswer: string, isCorrect: boolean, explanation: string | null, evidence: string | null;
    let sourceHash: string;
    let contractProof: ReturnType<typeof objectiveAssessmentEvidence>;
    if (reading) {
      const owned = attempt as typeof readingAttempts.$inferSelect;
      const [source] = await tx.select().from(readingPassages).where(eq(readingPassages.id, owned.passageId)).for("share");
      const [question] = await tx.select().from(readingQuestions).where(and(eq(readingQuestions.id, input.questionId), eq(readingQuestions.passageId, owned.passageId))).for("share");
      const answers = await tx.select().from(readingAnswers).where(and(eq(readingAnswers.attemptId, owned.id), eq(readingAnswers.questionId, input.questionId))).for("share");
      const answer = answers.length === 1 ? answers[0] : null;
      if (!source || !question || !answer || answer.isCorrect === null) return deny("not_found");
      sourceHash = objectiveSourceFingerprint("reading", question, source.bodyText);
      if (gradeReading(answer.userAnswer, question.correctAnswer, question.acceptedAnswers) !== answer.isCorrect) return deny("source_changed");
      try { contractProof = objectiveAssessmentEvidence("reading", question); } catch { return deny("unsupported_task"); }
      questionText = question.questionText; correctAnswer = question.correctAnswer; userAnswer = answer.userAnswer; isCorrect = answer.isCorrect;
      explanation = question.explanation.trim() || null;
      evidence = question.evidenceQuote && source.bodyText.includes(question.evidenceQuote) ? question.evidenceQuote : null;
    } else {
      const owned = attempt as typeof listeningAttempts.$inferSelect;
      const [source] = await tx.select().from(listeningTests).where(eq(listeningTests.id, owned.testId)).for("share");
      const [question] = await tx.select().from(listeningQuestions).where(and(eq(listeningQuestions.id, input.questionId), eq(listeningQuestions.testId, owned.testId))).for("share");
      const answers = await tx.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId, owned.id)).for("share");
      const matchingAnswers = answers.filter(answer => answer.questionId === input.questionId);
      const answer = matchingAnswers.length === 1 ? matchingAnswers[0] : null;
      if (!source || !question || !answer || answer.isCorrect === null) return deny("not_found");
      const ready = await tx.execute(sql`select to_regclass('public.listening_packages') is not null as ready`);
      const pkg = ready.rows[0]?.ready ? await tx.query.listeningPackages.findFirst({ where: eq(listeningPackages.testId, owned.testId) }) : null;
      const canonical = pkg?.payload.questions.find(item => item.number === question.order);
      if (pkg && !canonical) return deny("unsupported_task");
      sourceHash = objectiveSourceFingerprint("listening", question, source.transcript, pkg?.payload ?? null);
      if (pkg) {
        const allQuestions = await tx.query.listeningQuestions.findMany({ where: eq(listeningQuestions.testId, owned.testId) });
        const byId = new Map(allQuestions.map(item => [item.id, item.order]));
        const result = gradePackage(pkg.payload, Object.fromEntries(answers.map(item => [byId.get(item.questionId), item.userAnswer]))).find(item => item.number === question.order);
        if (!result || result.correct !== answer.isCorrect) return deny("source_changed");
      } else if (gradeListening(question.type, answer.userAnswer, question.correctAnswer) !== answer.isCorrect) return deny("source_changed");
      try { contractProof = objectiveAssessmentEvidence("listening", { type: canonical ? (canonical.options.length ? "multiple_choice" : "short_answer") : question.type, requiredSelections: canonical?.options.length ? canonical.pair.length + 1 : undefined }); } catch { return deny("unsupported_task"); }
      questionText = canonical?.text ?? question.questionText; correctAnswer = canonical && pkg ? [...new Set([canonical.key, ...canonical.pair.flatMap(number => pkg.payload.questions.filter(item => item.number === number).map(item => item.key))])].join(" / ") : question.correctAnswer; userAnswer = answer.userAnswer; isCorrect = answer.isCorrect;
      explanation = (canonical?.evidence.why ?? question.explanation).trim() || null;
      const transcript = canonical ? pkg?.payload.sections.find(item => item.number === canonical.section)?.transcript ?? "" : source.transcript ?? "";
      const quote = canonical ? pkg?.payload.keyword1.find(item => item.q === canonical.number)?.heard : question.paraphrases?.find(item => item.heard && transcript.includes(item.heard))?.heard;
      evidence = quote && transcript.includes(quote) ? quote : null;
    }
    if (sourceHash !== proof.data.sourceHash) return deny("source_changed");
    if (contractProof.key !== proof.data.key || contractProof.promptVersion !== proof.data.promptVersion || contractProof.rubricVersion !== proof.data.rubricVersion) return deny("source_changed");
    const contract = getAssessmentContractOrThrow(contractProof.key);
    const result = objectiveExplanationSchema.parse({
      status: explanation && evidence ? "explained" : "insufficient_evidence", domain: input.domain, attemptId: attempt.id, questionId: input.questionId,
      question: questionText.slice(0, 2000), userAnswer: userAnswer.slice(0, 600), officialAnswer: correctAnswer.slice(0, 600), isCorrect,
      explanation: explanation?.slice(0, 1600) ?? null, evidence: evidence?.slice(0, 1600) ?? null, method: contract.taskRules.slice(0, 3000),
      provenance: { contractKey: contractProof.key, promptVersion: contractProof.promptVersion, rubricVersion: contractProof.rubricVersion, providerId: "authored-source", model: null, sourceHash, sourceBasis: "submission_snapshot" },
    });
    await recordRiwiAudit({ actorUserId: current.id, action: "riwi.tool.succeeded", targetType: "objective_explanation", targetId: attempt.id,
      metadata: { correlationId, role: current.role, status: result.status, inputHash: sourceHash, resultCount: 1 } }, tx);
    return { ok: true as const, value: result };
  });
}
