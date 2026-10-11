import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { activityEvents, auditLog, grammarAttempts, grammarExercises, grammarTopics, users } from "@/db/schema";
import { recordAudit } from "./audit";
import { grammarVisibleTo } from "./grammar";
import { findEvaluation, saveEvaluation, type EvaluationRecord } from "./evaluations";
import { evaluateGrammarProduction, type GrammarEvaluationRequest } from "@/lib/services/coach/grammar";
import { type ServiceOutcome } from "@/lib/services/coach/service";
import { grammarPracticeEvidence } from "@/lib/services/grammar/production";
import { checkStructures } from "@/lib/services/grammar/mastery";
import { grammarContractKey, getAssessmentContractOrThrow } from "@/lib/services/coach/contracts/registry";
import { validateAssessmentOutput } from "@/lib/services/coach/contracts/compose";
import { evaluationResultSchema, type EvaluationResult } from "@/lib/services/coach/schema";

const inputSchema = z.object({
  activity: z.enum(["correct_it", "translate_it", "activate_it"]),
  answer: z.string().trim().min(1).max(2000),
}).strict().refine(value => value.activity === "correct_it" || value.answer.length >= 2);
type Prepared = {
  userId: string; attemptId: string; exerciseId: string;
  activity: z.infer<typeof inputSchema>["activity"]; answer: string;
  sourceHash: string; request: GrammarEvaluationRequest;
  explanation: string; sampleAnswer: string | null;
  structures: ReturnType<typeof checkStructures>;
};
const fail = (error: string, status: number) => ({ ok: false as const, error, status });
export class GrammarProductionChanged extends Error {
  constructor() { super("grammar_production_source_changed"); }
}

function sourceHash(exercise: typeof grammarExercises.$inferSelect, title: string) {
  // Include feedback released after submission as well as provider input. A
  // changed owner, item, key, topic or authored prompt invalidates this result.
  return createHash("sha256").update(JSON.stringify({ exercise, title })).digest("hex");
}

const answerHash = (answer: string) => createHash("sha256").update(answer).digest("hex");
function preparedReceiptWhere(prepared: Prepared) {
  const contract = getAssessmentContractOrThrow(grammarContractKey(prepared.activity));
  return and(eq(auditLog.actorUserId, prepared.userId), eq(auditLog.action, "grammar.production.prepared"),
    eq(auditLog.targetType, "grammar_attempt"), eq(auditLog.targetId, prepared.attemptId),
    sql`${auditLog.metadata}->>'sourceChecksum' = ${prepared.sourceHash}`,
    sql`${auditLog.metadata}->>'inputHash' = ${answerHash(prepared.answer)}`,
    sql`${auditLog.metadata}->>'assessmentContractKey' = ${contract.key}`,
    sql`${auditLog.metadata}->>'promptVersion' = ${contract.version}`,
    sql`${auditLog.metadata}->>'rubricVersion' = ${contract.rubricVersion}`);
}

/** Authorize the source and save explicitly unassessed writing before dispatch.
 * No transaction/connection is held while a provider runs. */
export async function prepareGrammarProduction(userId: string, exerciseId: string, input: unknown,
  language: "en" | "uz", database = db) {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return fail("invalid_input", 400);
  return database.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), eq(users.accountStatus, "active"))).for("share");
    if (!user) return fail("unauthenticated", 401);
    const [row] = await tx.select({ exercise: grammarExercises, title: grammarTopics.title })
      .from(grammarExercises).innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(and(eq(grammarExercises.id, exerciseId), grammarVisibleTo(userId))).for("share");
    if (!row) return fail("not_found", 404);
    const { activity, answer } = parsed.data;
    const evidence = activity === "correct_it"
      ? { promptText: row.exercise.promptText.trim(), targetStructure: row.title, sampleAnswer: row.exercise.correctOption }
      : grammarPracticeEvidence(row.exercise, activity, row.title);
    if (!evidence?.promptText.trim()) return fail("assessment_metadata_unsupported", 409);
    const [attempt] = await tx.insert(grammarAttempts).values({
      userId, exerciseId, activity, selectedOption: "", responseText: answer, isCorrect: false,
    }).returning({ id: grammarAttempts.id });
    if (!attempt) throw new Error("grammar_attempt_write_failed");
    const prepared: Prepared = { userId, exerciseId, activity, answer, attemptId: attempt.id,
      sourceHash: sourceHash(row.exercise, row.title),
      request: { userId, attemptId: attempt.id, activity, ...evidence, studentAnswer: answer, language },
      explanation: row.exercise.explanation, sampleAnswer: activity === "correct_it" ? row.exercise.correctOption : null,
      structures: checkStructures(answer, row.exercise.targetStructures ?? []) };
    const contract = getAssessmentContractOrThrow(grammarContractKey(activity));
    await recordAudit({ actorUserId: userId, action: "grammar.production.prepared", targetType: "grammar_attempt",
      targetId: attempt.id, metadata: { sourceChecksum: prepared.sourceHash, inputHash: answerHash(answer),
        assessmentContractKey: contract.key, promptVersion: contract.version, rubricVersion: contract.rubricVersion } }, tx);
    return { ok: true as const, prepared };
  });
}

/** Revalidate live authority and the exact canonical source in the same
 * transaction as verdict, evaluation and the domain activity event. */
export async function persistGrammarProduction(prepared: Prepared, result: EvaluationResult, database = db) {
  const parsed = evaluationResultSchema.safeParse(result);
  const key = grammarContractKey(prepared.activity);
  const contract = getAssessmentContractOrThrow(key);
  if (!parsed.success || parsed.data.evaluationType !== "grammar" || parsed.data.assessmentContractKey !== key
    || parsed.data.promptVersion !== contract.version || parsed.data.rubricVersion !== contract.rubricVersion
    || (prepared.activity === "translate_it" && parsed.data.providerType !== "external")
    || !validateAssessmentOutput(contract, "grammar", prepared.request, parsed.data))
    throw new Error("grammar_production_invalid_evaluation");
  return database.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, prepared.userId), eq(users.accountStatus, "active"))).for("share");
    if (!user) throw new GrammarProductionChanged();
    const [row] = await tx.select({ exercise: grammarExercises, title: grammarTopics.title })
      .from(grammarExercises).innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(and(eq(grammarExercises.id, prepared.exerciseId), grammarVisibleTo(prepared.userId))).for("share");
    if (!row || sourceHash(row.exercise, row.title) !== prepared.sourceHash) throw new GrammarProductionChanged();
    const [attempt] = await tx.select().from(grammarAttempts)
      .where(and(eq(grammarAttempts.id, prepared.attemptId), eq(grammarAttempts.userId, prepared.userId))).for("update");
    if (!attempt || attempt.exerciseId !== prepared.exerciseId || attempt.activity !== prepared.activity
      || attempt.responseText !== prepared.answer || attempt.selectedOption !== "") throw new GrammarProductionChanged();
    const [origin] = await tx.select({ id: auditLog.id }).from(auditLog).where(preparedReceiptWhere(prepared)).for("share");
    if (!origin) throw new GrammarProductionChanged();
    const saved = await saveEvaluation({ userId: prepared.userId, evaluationType: "grammar",
      sourceType: "grammar_attempt", sourceId: prepared.attemptId, result: parsed.data }, tx);
    if (!evaluationMatches(prepared, saved.record)) throw new Error("grammar_production_invalid_evaluation");
    if (saved.created) {
      await tx.update(grammarAttempts).set({ isCorrect: saved.record.verdict === "correct" })
        .where(eq(grammarAttempts.id, prepared.attemptId));
      await tx.insert(activityEvents).values({ userId: prepared.userId,
        type: prepared.activity === "correct_it" ? "GRAMMAR_PRODUCTION_SUBMITTED" : "GRAMMAR_PRACTICE_SUBMITTED",
        payload: { exerciseId: prepared.exerciseId, activity: prepared.activity, attemptId: prepared.attemptId,
          evaluationId: saved.record.id, sourceHash: prepared.sourceHash, verdict: saved.record.verdict } });
    }
    return saved;
  });
}

function evaluationMatches(prepared: Prepared, record: EvaluationRecord) {
  return record.userId === prepared.userId && record.sourceId === prepared.attemptId && record.sourceType === "grammar_attempt"
    && record.evaluationType === "grammar" && record.assessmentContractKey === grammarContractKey(prepared.activity)
    && record.overallEstimate === null && record.verdict !== null;
}

/** Never remove an accepted source because later Coach bookkeeping failed. */
async function removeUnassessed(prepared: Prepared, database: typeof db) {
  await database.transaction(async tx => {
    // Lock first, then read in a fresh statement. A DELETE/NOT EXISTS snapshot
    // taken before a concurrent finalizer commits can otherwise miss its result.
    const [attempt] = await tx.select({ id: grammarAttempts.id }).from(grammarAttempts)
      .where(and(eq(grammarAttempts.id, prepared.attemptId), eq(grammarAttempts.userId, prepared.userId))).for("update");
    if (!attempt || await findEvaluation({ sourceType: "grammar_attempt", sourceId: prepared.attemptId }, tx)) return;
    await tx.delete(grammarAttempts).where(eq(grammarAttempts.id, prepared.attemptId));
  });
}

async function readCommitted(prepared: Prepared, database: typeof db) {
  return database.transaction(async tx => {
    const record = await findEvaluation({ sourceType: "grammar_attempt", sourceId: prepared.attemptId }, tx);
    if (!record || !evaluationMatches(prepared, record)) return null;
    const [allowed] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, prepared.userId), eq(users.accountStatus, "active"))).for("share");
    const [source] = await tx.select({ exercise: grammarExercises, title: grammarTopics.title })
      .from(grammarExercises).innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(and(eq(grammarExercises.id, prepared.exerciseId), grammarVisibleTo(prepared.userId))).for("share");
    const [attempt] = await tx.select().from(grammarAttempts)
      .where(and(eq(grammarAttempts.id, prepared.attemptId), eq(grammarAttempts.userId, prepared.userId))).for("share");
    const [origin] = await tx.select({ id: auditLog.id }).from(auditLog).where(preparedReceiptWhere(prepared)).for("share");
    const [receipt] = await tx.select({ id: activityEvents.id }).from(activityEvents).where(and(eq(activityEvents.userId, prepared.userId),
      eq(activityEvents.type, prepared.activity === "correct_it" ? "GRAMMAR_PRODUCTION_SUBMITTED" : "GRAMMAR_PRACTICE_SUBMITTED"),
      sql`${activityEvents.payload}->>'attemptId' = ${prepared.attemptId}`,
      sql`${activityEvents.payload}->>'evaluationId' = ${record.id}`,
      sql`${activityEvents.payload}->>'sourceHash' = ${prepared.sourceHash}`)).limit(1);
    return allowed && source && sourceHash(source.exercise, source.title) === prepared.sourceHash && receipt && origin
      && attempt?.exerciseId === prepared.exerciseId && attempt.activity === prepared.activity
      && attempt.responseText === prepared.answer && attempt.isCorrect === (record.verdict === "correct") ? record : null;
  });
}

export async function submitGrammarProduction(userId: string, exerciseId: string, input: unknown, language: "en" | "uz",
  database = db, evaluate: typeof evaluateGrammarProduction = evaluateGrammarProduction) {
  const start = await prepareGrammarProduction(userId, exerciseId, input, language, database);
  if (!start.ok) return start;
  return evaluatePrepared(start.prepared, database, evaluate, true);
}

/** A RIWI handoff resumes an owned saved activation without creating another
 * attempt. It uses the same atomic fence, and never deletes earlier saved work. */
export async function resumeGrammarProduction(userId: string, attemptId: string, language: "en" | "uz", database = db,
  evaluate: typeof evaluateGrammarProduction = evaluateGrammarProduction) {
  const start = await database.transaction(async tx => {
    const [user] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, userId), eq(users.accountStatus, "active"))).for("share");
    if (!user) return fail("unauthenticated", 401);
    const [row] = await tx.select({ attempt: grammarAttempts, exercise: grammarExercises, title: grammarTopics.title })
      .from(grammarAttempts).innerJoin(grammarExercises, eq(grammarExercises.id, grammarAttempts.exerciseId))
      .innerJoin(grammarTopics, eq(grammarTopics.id, grammarExercises.topicId))
      .where(and(eq(grammarAttempts.id, attemptId), eq(grammarAttempts.userId, userId),
        inArray(grammarAttempts.activity, ["correct_it", "translate_it", "activate_it"]), grammarVisibleTo(userId))).for("share");
    if (!row?.attempt.responseText?.trim() || row.attempt.selectedOption !== "") return fail("no_saved_work", 404);
    const activity = row.attempt.activity;
    if (activity !== "correct_it" && activity !== "translate_it" && activity !== "activate_it") return fail("no_saved_work", 404);
    const evidence = activity === "correct_it"
      ? { promptText: row.exercise.promptText.trim(), targetStructure: row.title, sampleAnswer: row.exercise.correctOption }
      : grammarPracticeEvidence(row.exercise, activity, row.title);
    if (!evidence?.promptText.trim()) return fail("source_unavailable", 409);
    const prepared: Prepared = { userId, exerciseId: row.exercise.id, activity, attemptId,
      answer: row.attempt.responseText, sourceHash: sourceHash(row.exercise, row.title),
      request: { userId, attemptId, activity, ...evidence, studentAnswer: row.attempt.responseText, language },
      sampleAnswer: activity === "correct_it" ? row.exercise.correctOption : null, explanation: row.exercise.explanation,
      structures: checkStructures(row.attempt.responseText, row.exercise.targetStructures ?? []) };
    // A mutable current prompt does not prove the task the learner originally
    // answered. Never backfill a made-up checksum for legacy saved attempts.
    const [origin] = await tx.select({ id: auditLog.id }).from(auditLog).where(preparedReceiptWhere(prepared)).for("share");
    if (!origin) return fail("source_unavailable", 409);
    return { ok: true as const, prepared };
  });
  if (!start.ok) return start;
  return evaluatePrepared(start.prepared, database, evaluate, false);
}

async function evaluatePrepared(prepared: Prepared, database: typeof db, evaluate: typeof evaluateGrammarProduction, discardOnFailure: boolean) {
  let outcome: ServiceOutcome;
  try {
    outcome = await evaluate({ ...prepared.request, persist: result => persistGrammarProduction(prepared, result, database) });
  } catch (error) {
    // An authoritative commit may precede a failure in best-effort downstream
    // bookkeeping. Preserve it, but do not release feedback after revocation.
    const recovered = await readCommitted(prepared, database);
    if (!recovered) {
      if (discardOnFailure) await removeUnassessed(prepared, database);
      return fail(error instanceof GrammarProductionChanged ? "assessment_source_changed" : "evaluation_unavailable",
        error instanceof GrammarProductionChanged ? 409 : 502);
    }
    outcome = { ok: true, evaluation: recovered, reused: true };
  }
  if (!outcome.ok) {
    if (discardOnFailure) await removeUnassessed(prepared, database);
    return fail(outcome.error, 502);
  }
  // A service/test dependency cannot return an unsaved or foreign verdict.
  const persisted = await readCommitted(prepared, database);
  if (!persisted || !evaluationMatches(prepared, persisted) || persisted.id !== outcome.evaluation.id) {
    if (discardOnFailure) await removeUnassessed(prepared, database);
    return fail("evaluation_unavailable", 502);
  }
  return { ok: true as const, attemptId: prepared.attemptId, activity: prepared.activity,
    evaluation: persisted, sampleAnswer: prepared.sampleAnswer, explanation: prepared.explanation, structures: prepared.structures };
}
