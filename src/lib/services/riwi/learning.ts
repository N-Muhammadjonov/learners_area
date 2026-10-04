import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { AccountStatus } from "@/lib/auth/account-status";
import { isOnRoster } from "@/lib/reporter/roster";
import { db } from "@/db/client";
import { auditLog, evaluations, riwiKnowledgeSources, riwiLearningReviews, riwiLearningSignals, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { MODEL_ID } from "@/lib/services/coach/owner-control";
import { isRiwiCapability, authorizeCapability } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { isRiwiRegressionFixture, runRiwiRegressionSuite } from "./golden/fixtures";
import { redactExternalText } from "./outbound-guard";
import { createKnowledgeCandidate, KnowledgeServiceError, type KnowledgePublicationScope, type KnowledgeSourceType } from "./knowledge";
import {
  decodeOwnerHistoryCursor,
  encodeOwnerHistoryCursor,
  ownerHistoryPageLimit,
  RiwiOwnerHistoryCursorError,
  type RiwiOwnerHistoryPosition,
} from "./owner-history-cursor";

export type LearningSignalType = "owner_correction" | "teacher_correction" | "provider_disagreement" | "provider_agreement" | "student_outcome" | "rubric_reference" | "known_good_example" | "known_bad_example" | "retrieval_failure" | "hallucination_report" | "tool_failure" | "provider_failure" | "user_feedback" | "manual_qa_finding";
export type LearningSignalProducer = "gateway" | "provider_lab" | "evaluation";
export type StudentFeedbackRating = "helpful" | "not_helpful";
const LEARNING_SIGNAL_TYPES: readonly LearningSignalType[] = [
  "owner_correction", "teacher_correction", "provider_disagreement", "provider_agreement", "student_outcome",
  "rubric_reference", "known_good_example", "known_bad_example", "retrieval_failure", "hallucination_report",
  "tool_failure", "provider_failure", "user_feedback", "manual_qa_finding",
];
const PROVIDER_ID = /^[a-z][a-z0-9-]{1,31}$/;
const VERSION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUCCESSFUL_RESPONSE_SOURCES = new Set([
  "canonical_dictionary", "canonical_grammar", "approved_knowledge", "deterministic_learning_data", "deterministic_report", "external_provider",
]);

export class LearningServiceError extends Error {
  constructor(public readonly code: "forbidden" | "invalid_input" | "not_found" | "invalid_state" | "idempotency_conflict" | "regression_required" | "promotion_blocked" | "write_failed") { super(code); }
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

async function isActiveStudent(userId: string, database: typeof db = db): Promise<boolean> {
  const subject = await database.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true, accountStatus: true } });
  return subject?.role === "student" && subject.accountStatus === "active";
}

async function isActiveActor(actor: { id: string; role: Role }, database: typeof db): Promise<boolean> {
  const subject = await database.query.users.findFirst({ where: eq(users.id, actor.id), columns: { role: true, accountStatus: true } });
  return subject?.role === actor.role && subject.accountStatus === "active";
}

/**
 * Persist a bounded candidate only. Trusted producers label machine observations;
 * learner/teacher/owner supplied text is never treated as active knowledge.
 */
export async function createLearningSignal(input: {
  actor: { id: string; role: Role; accountStatus: AccountStatus };
  type: LearningSignalType;
  producer?: LearningSignalProducer;
  targetUserId?: string | null;
  sourceId: string;
  providerId?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  rubricVersion?: string | null;
  candidateClaim: string;
  evidenceSummary: string;
  scope?: "global" | "user";
}, database: typeof db = db) {
  const capability = input.type === "teacher_correction" ? "riwi.feedback.teacher" : "riwi.knowledge.submit_candidate";
  if (!LEARNING_SIGNAL_TYPES.includes(input.type) || !isRiwiCapability(capability) || !authorizeCapability(input.actor, capability).allowed) {
    throw new LearningServiceError("forbidden");
  }
  if (!(await isActiveActor(input.actor, database))) throw new LearningServiceError("forbidden");
  if ((input.targetUserId != null && !UUID.test(input.targetUserId)) || !UUID.test(input.sourceId)) throw new LearningServiceError("invalid_input");
  if (input.providerId && !PROVIDER_ID.test(input.providerId)) throw new LearningServiceError("invalid_input");
  if (input.model && !MODEL_ID.test(input.model)) throw new LearningServiceError("invalid_input");
  if ((input.promptVersion && !VERSION_ID.test(input.promptVersion)) || (input.rubricVersion && !VERSION_ID.test(input.rubricVersion))) throw new LearningServiceError("invalid_input");
  if (input.producer !== undefined && !["gateway", "provider_lab", "evaluation"].includes(input.producer)) throw new LearningServiceError("forbidden");
  if ((input.type === "owner_correction" || input.type === "manual_qa_finding" || input.type === "rubric_reference"
    || input.type === "known_good_example" || input.type === "known_bad_example") && input.actor.role !== "owner") throw new LearningServiceError("forbidden");
  if ((input.type === "user_feedback" || input.type === "hallucination_report") && input.actor.role !== "student") throw new LearningServiceError("forbidden");
  if (input.type === "teacher_correction" && input.actor.role !== "teacher") throw new LearningServiceError("forbidden");

  const producerRequired: Partial<Record<LearningSignalType, LearningSignalProducer>> = {
    tool_failure: "gateway", retrieval_failure: "gateway", provider_failure: "gateway",
    provider_agreement: "provider_lab", provider_disagreement: "provider_lab", student_outcome: "evaluation",
  };
  const requiredProducer = producerRequired[input.type];
  if ((requiredProducer && input.producer !== requiredProducer) || (input.producer && requiredProducer !== input.producer)) {
    throw new LearningServiceError("forbidden");
  }
  if (input.producer === "provider_lab" && input.actor.role !== "owner") throw new LearningServiceError("forbidden");
  if (input.actor.role === "teacher" && (!input.targetUserId || input.scope === "global")) {
    throw new LearningServiceError("invalid_input");
  }
  if (input.type === "teacher_correction" && input.scope && input.scope !== "user") throw new LearningServiceError("invalid_input");
  if (input.targetUserId && input.actor.role !== "teacher" && input.actor.role !== "owner" && input.targetUserId !== input.actor.id) throw new LearningServiceError("forbidden");
  if (input.actor.role === "student" && input.scope && input.scope !== "user") throw new LearningServiceError("forbidden");
  if (input.targetUserId && input.scope === "global") throw new LearningServiceError("invalid_input");
  if (input.scope !== undefined && input.scope !== "global" && input.scope !== "user") throw new LearningServiceError("invalid_input");

  const targetUserId = input.actor.role === "student" ? input.actor.id : input.targetUserId ?? null;
  if (targetUserId && !(await isActiveStudent(targetUserId, database))) throw new LearningServiceError("forbidden");
  if (targetUserId && input.actor.role === "teacher" && !(await isOnRoster(input.actor.id, targetUserId, database))) throw new LearningServiceError("forbidden");
  const signalScope = input.actor.role === "student" ? "user" : input.scope ?? (targetUserId ? "user" : "global");
  if ((signalScope === "user" && !targetUserId) || (signalScope === "global" && targetUserId)) throw new LearningServiceError("invalid_input");

  const rawClaim = typeof input.candidateClaim === "string" ? input.candidateClaim.trim() : "";
  const rawEvidence = typeof input.evidenceSummary === "string" ? input.evidenceSummary.trim() : "";
  if (!rawClaim || rawClaim.length > 4000 || !rawEvidence || rawEvidence.length > 1200) throw new LearningServiceError("invalid_input");
  const claim = redactExternalText(rawClaim, 4000).trim();
  const evidence = redactExternalText(rawEvidence, 1200).trim();
  if (!claim || !evidence) throw new LearningServiceError("invalid_input");
  // A source/correlation reference is mandatory even for manually entered QA evidence.
  const sourceId = input.sourceId;
  const expected = {
    actorRole: input.actor.role,
    targetUserId,
    sourceId,
    providerId: input.providerId ?? null,
    model: input.model ?? null,
    promptVersion: input.promptVersion ?? null,
    rubricVersion: input.rubricVersion ?? null,
    evidenceHash: digest(JSON.stringify([claim, evidence])),
    scope: signalScope,
  };
  const existingColumns = {
    id: riwiLearningSignals.id, state: riwiLearningSignals.state, signalType: riwiLearningSignals.signalType,
    actorRole: riwiLearningSignals.actorRole, targetUserId: riwiLearningSignals.targetUserId,
    sourceId: riwiLearningSignals.sourceId, providerId: riwiLearningSignals.providerId,
    model: riwiLearningSignals.model, promptVersion: riwiLearningSignals.promptVersion,
    rubricVersion: riwiLearningSignals.rubricVersion, evidenceHash: riwiLearningSignals.evidenceHash,
    scope: riwiLearningSignals.scope,
  };
  const existingResult = (stored: Omit<typeof expected, "scope"> & {
    id: string; state: typeof riwiLearningSignals.$inferSelect["state"];
    signalType: LearningSignalType; scope: typeof riwiLearningSignals.$inferSelect["scope"];
  }) => {
    if (Object.entries(expected).some(([key, value]) => stored[key as keyof typeof expected] !== value)) {
      throw new LearningServiceError("idempotency_conflict");
    }
    return { id: stored.id, state: stored.state, signalType: stored.signalType };
  };

  return database.transaction(async (tx) => {
    const [storedActor] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.actor.id)).limit(1).for("update");
    if (storedActor?.role !== input.actor.role || storedActor.accountStatus !== "active") throw new LearningServiceError("forbidden");
    if (targetUserId) {
      const [target] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
        .from(users).where(eq(users.id, targetUserId)).limit(1).for("share");
      if (target?.role !== "student" || target.accountStatus !== "active") throw new LearningServiceError("forbidden");
      if (input.actor.role === "teacher" && !(await isOnRoster(input.actor.id, targetUserId, tx))) throw new LearningServiceError("forbidden");
    }
    const lockKey = `${input.actor.id}:${input.type}:${sourceId}`;
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${lockKey}, 0::bigint))`);
    const [existing] = await tx.select(existingColumns)
      .from(riwiLearningSignals).where(and(
        eq(riwiLearningSignals.actorUserId, input.actor.id),
        eq(riwiLearningSignals.signalType, input.type),
        eq(riwiLearningSignals.sourceId, sourceId),
      )).limit(1);
    if (existing) return existingResult(existing);

    const [row] = await tx.insert(riwiLearningSignals).values({
      signalType: input.type, state: "candidate", actorUserId: input.actor.id,
      actorRole: input.actor.role, targetUserId, sourceId,
      providerId: input.providerId ?? null, model: input.model ?? null,
      promptVersion: input.promptVersion ?? null, rubricVersion: input.rubricVersion ?? null,
      candidateClaim: claim, evidenceSummary: evidence, evidenceHash: expected.evidenceHash, scope: signalScope,
    }).onConflictDoNothing().returning({ id: riwiLearningSignals.id, state: riwiLearningSignals.state, signalType: riwiLearningSignals.signalType });
    if (!row) {
      const [existing] = await tx.select(existingColumns)
        .from(riwiLearningSignals).where(and(
          eq(riwiLearningSignals.actorUserId, input.actor.id),
          eq(riwiLearningSignals.signalType, input.type),
          eq(riwiLearningSignals.sourceId, sourceId),
        )).limit(1);
      if (existing) return existingResult(existing);
    }
    if (!row) throw new LearningServiceError("write_failed");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.signal.created", targetType: "riwi_learning_signal", targetId: row.id,
      metadata: { signalId: row.id, role: input.actor.role, status: row.state } }, tx as never);
    return row;
  });
}

/** A student may rate only their own successfully delivered RIWI answer; free text is not accepted. */
export async function submitRiwiStudentFeedback(input: {
  actor: { id: string; role: Role; accountStatus: AccountStatus };
  correlationId: string;
  rating: StudentFeedbackRating;
}, database: typeof db = db) {
  if (input.actor.role !== "student" || !authorizeCapability(input.actor, "riwi.feedback.student").allowed) {
    throw new LearningServiceError("forbidden");
  }
  if (!UUID.test(input.correlationId) || !["helpful", "not_helpful"].includes(input.rating)) throw new LearningServiceError("invalid_input");
  if (!(await isActiveStudent(input.actor.id, database))) throw new LearningServiceError("forbidden");

  const [request] = await database.select({ metadata: auditLog.metadata }).from(auditLog).where(and(
    eq(auditLog.actorUserId, input.actor.id),
    eq(auditLog.action, "riwi.request.completed"),
    eq(auditLog.targetType, "riwi_request"),
    eq(auditLog.targetId, input.correlationId),
  )).limit(1);
  const metadata = request?.metadata;
  const answerSource = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).answerSource
    : null;
  const status = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>).status
    : null;
  if (status !== "succeeded" || typeof answerSource !== "string" || !SUCCESSFUL_RESPONSE_SOURCES.has(answerSource)) {
    throw new LearningServiceError("not_found");
  }

  await createLearningSignal({
    actor: input.actor,
    type: "user_feedback",
    targetUserId: input.actor.id,
    sourceId: input.correlationId,
    scope: "user",
    candidateClaim: `Student marked a RIWI answer as ${input.rating.replace("_", " ")}.`,
    evidenceSummary: `rating=${input.rating}; answer_source=${answerSource}; correlation=${input.correlationId}; answer_text=omitted`,
  }, database);
  return { recorded: true as const };
}

/**
 * Convert an already-persisted Coach evaluation into candidate outcome evidence.
 * Only safe result metadata is copied; learner work, issues, excerpts, and prose are omitted.
 * Any database/audit failure is reported as `false` and must not change evaluation delivery.
 */
export async function recordEvaluationOutcomeSignal(
  evaluationId: string,
  database: typeof db = db,
  persist: typeof createLearningSignal = createLearningSignal,
): Promise<boolean> {
  if (!UUID.test(evaluationId)) return false;
  try {
    const evaluation = await database.query.evaluations.findFirst({
      where: eq(evaluations.id, evaluationId),
      columns: {
        id: true, userId: true, evaluationType: true, providerId: true, model: true,
        promptVersion: true, rubricVersion: true, overallEstimate: true, confidence: true,
        verdict: true, fallbackUsed: true,
      },
    });
    if (!evaluation) return false;
    const subject = await database.query.users.findFirst({
      where: eq(users.id, evaluation.userId), columns: { role: true, accountStatus: true },
    });
    if (subject?.role !== "student" || subject.accountStatus !== "active") return false;
    const score = typeof evaluation.overallEstimate === "number" && Number.isFinite(evaluation.overallEstimate)
      ? evaluation.overallEstimate.toFixed(1) : "unknown";
    const confidence = typeof evaluation.confidence === "number" && Number.isFinite(evaluation.confidence)
      ? evaluation.confidence : 0;
    const confidenceBucket = confidence >= 0.8 ? "high" : confidence >= 0.5 ? "medium" : "low";
    await persist({
      actor: { id: evaluation.userId, role: "student", accountStatus: "active" },
      type: "student_outcome", producer: "evaluation", targetUserId: evaluation.userId,
      sourceId: evaluation.id, scope: "user", providerId: evaluation.providerId, model: evaluation.model,
      promptVersion: evaluation.promptVersion, rubricVersion: evaluation.rubricVersion,
      candidateClaim: "A Coach evaluation was recorded as learner outcome evidence; this is not an endorsed knowledge claim.",
      evidenceSummary: `source=coach_evaluation; type=${evaluation.evaluationType}; evaluation=${evaluation.id}; score=${score}; verdict=${evaluation.verdict ?? "unscored"}; confidence=${confidenceBucket}; provider=${evaluation.providerId}; fallback=${evaluation.fallbackUsed}; learner_work=omitted`,
    }, database);
    return true;
  } catch {
    return false;
  }
}

export async function reviewLearningSignal(input: {
  actor: { id: string; role: Role; accountStatus: AccountStatus };
  signalId: string;
  decision: "approve" | "reject" | "request_changes";
  reason: string;
  regressionFixtureId?: string | null;
}, database: typeof db = db) {
  if (input.actor.role !== "owner" || !authorizeCapability(input.actor, "riwi.knowledge.review").allowed
    || !(await isActiveActor(input.actor, database))) throw new LearningServiceError("forbidden");
  if (!UUID.test(input.signalId) || !["approve", "reject", "request_changes"].includes(input.decision) || typeof input.reason !== "string" || input.reason.trim().length > 1000) {
    throw new LearningServiceError("invalid_input");
  }
  const reason = redactExternalText(input.reason.trim(), 1000).trim();
  if (!reason) throw new LearningServiceError("invalid_input");
  if (input.decision === "approve" && (!input.regressionFixtureId || !isRiwiRegressionFixture(input.regressionFixtureId))) {
    throw new LearningServiceError("regression_required");
  }
  return database.transaction(async (tx) => {
    const [reviewer] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.actor.id)).limit(1).for("update");
    if (reviewer?.role !== "owner" || reviewer.accountStatus !== "active") throw new LearningServiceError("forbidden");
    const [signal] = await tx.select({ id: riwiLearningSignals.id, state: riwiLearningSignals.state, evidenceHash: riwiLearningSignals.evidenceHash })
      .from(riwiLearningSignals).where(eq(riwiLearningSignals.id, input.signalId)).limit(1).for("update");
    if (!signal) throw new LearningServiceError("not_found");
    if (signal.state !== "candidate" && signal.state !== "in_review") throw new LearningServiceError("invalid_state");
    const regression = input.decision === "approve" ? runRiwiRegressionSuite(signal.evidenceHash) : null;
    if (input.decision === "approve" && !regression?.passed) throw new LearningServiceError("regression_required");
    const regressionPassedAt = regression ? new Date() : null;
    const [review] = await tx.insert(riwiLearningReviews).values({
      signalId: signal.id, reviewerUserId: input.actor.id, decision: input.decision, reason,
      regressionFixtureId: input.decision === "approve" ? input.regressionFixtureId! : null,
      regressionEvidenceHash: regression?.evidenceHash ?? null, regressionPassedAt,
    }).returning({ id: riwiLearningReviews.id });
    if (!review) throw new LearningServiceError("write_failed");
    const state = input.decision === "approve" ? "accepted" : input.decision === "reject" ? "rejected" : "in_review";
    await tx.update(riwiLearningSignals).set({ state }).where(eq(riwiLearningSignals.id, signal.id));
    if (regression) await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.regression.passed",
      targetType: "riwi_learning_signal", targetId: signal.id,
      metadata: { signalId: signal.id, role: input.actor.role, status: "passed",
        regressionFixtureId: input.regressionFixtureId!, inputHash: regression.evidenceHash } }, tx as never);
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.reviewed",
      targetType: "riwi_learning_signal", targetId: signal.id,
      metadata: { signalId: signal.id, role: input.actor.role, status: state, decision: input.decision,
        regressionFixtureId: input.decision === "approve" ? input.regressionFixtureId! : undefined, inputHash: regression?.evidenceHash } }, tx as never);
    return { signalId: signal.id, reviewId: review.id, state };
  });
}

/** Owner-only explicit conversion of accepted, eligible evidence into an inert knowledge candidate. */
export async function createKnowledgeCandidateFromLearningSignal(
  input: { actor: { id: string; role: Role; accountStatus: AccountStatus }; signalId: string },
  database: typeof db = db,
) {
  if (input.actor.role !== "owner" || !authorizeCapability(input.actor, "riwi.knowledge.promote").allowed
    || !(await isActiveActor(input.actor, database))) throw new LearningServiceError("forbidden");
  if (!UUID.test(input.signalId)) throw new LearningServiceError("invalid_input");

  const result = await database.transaction(async (tx) => {
    const [owner] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.actor.id)).limit(1).for("update");
    if (owner?.role !== "owner" || owner.accountStatus !== "active") throw new LearningServiceError("forbidden");
    const [signal] = await tx.select({
      id: riwiLearningSignals.id, type: riwiLearningSignals.signalType, state: riwiLearningSignals.state,
      actorRole: riwiLearningSignals.actorRole, targetUserId: riwiLearningSignals.targetUserId,
      sourceId: riwiLearningSignals.sourceId, candidateClaim: riwiLearningSignals.candidateClaim,
      evidenceHash: riwiLearningSignals.evidenceHash, scope: riwiLearningSignals.scope,
    }).from(riwiLearningSignals).where(eq(riwiLearningSignals.id, input.signalId)).limit(1).for("update");
    if (!signal) throw new LearningServiceError("not_found");
    if (signal.state !== "accepted") throw new LearningServiceError("invalid_state");
    const [approval] = await tx.select({ id: riwiLearningReviews.id, resultingSourceId: riwiLearningReviews.resultingSourceId })
      .from(riwiLearningReviews).where(and(
        eq(riwiLearningReviews.signalId, signal.id), eq(riwiLearningReviews.decision, "approve"),
      )).orderBy(desc(riwiLearningReviews.createdAt), desc(riwiLearningReviews.id)).limit(1).for("update");
    if (!approval) throw new LearningServiceError("invalid_state");
    if (approval.resultingSourceId) {
      const [source] = await tx.select({
        id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, version: riwiKnowledgeSources.version,
        unitCount: riwiKnowledgeSources.unitCount, scope: riwiKnowledgeSources.scope,
        scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
      }).from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, approval.resultingSourceId)).limit(1);
      if (!source) throw new LearningServiceError("write_failed");
      return { blocked: false as const, replayed: true, signalId: signal.id, ...source };
    }

    const sourceType: KnowledgeSourceType | null = signal.type === "teacher_correction" ? "teacher_correction"
      : signal.type === "owner_correction" || signal.type === "manual_qa_finding" ? "owner_correction" : null;
    if (!sourceType) {
      await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.promotion.rejected",
        targetType: "riwi_learning_signal", targetId: signal.id,
        metadata: { signalId: signal.id, role: input.actor.role, status: "evidence_only", code: "riwi_learning_evidence_only", inputHash: signal.evidenceHash } }, tx as never);
      return { blocked: true as const };
    }
    let scope: KnowledgePublicationScope;
    if (signal.scope === "global") scope = { kind: "global" };
    else if (signal.targetUserId) scope = { kind: "user", userId: signal.targetUserId };
    else {
      await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.promotion.rejected",
        targetType: "riwi_learning_signal", targetId: signal.id,
        metadata: { signalId: signal.id, role: input.actor.role, status: "anonymized_subject", code: "riwi_learning_target_unavailable", inputHash: signal.evidenceHash } }, tx as never);
      return { blocked: true as const };
    }
    if (scope.kind === "user") {
      const [subject] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
        .from(users).where(eq(users.id, scope.userId)).limit(1).for("share");
      if (subject?.role !== "student" || subject.accountStatus !== "active") {
        await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.promotion.rejected",
          targetType: "riwi_learning_signal", targetId: signal.id,
          metadata: { signalId: signal.id, role: input.actor.role, status: "inactive_subject", code: "riwi_learning_target_unavailable", inputHash: signal.evidenceHash } }, tx as never);
        return { blocked: true as const };
      }
    }

    let candidate: Awaited<ReturnType<typeof createKnowledgeCandidate>>;
    try {
      candidate = await createKnowledgeCandidate({
        actor: input.actor,
        sourceType,
        title: `Accepted ${signal.type.replace(/_/g, " ")} learning signal`,
        provenance: `RIWI accepted ${signal.type.replace(/_/g, " ")} correction; owner-reviewed learning evidence; private identifiers retained only in linked database and audit records`,
        rightsClass: "internal_permission",
        scope,
        content: signal.candidateClaim,
      }, tx as never);
    } catch (error) {
      if (error instanceof KnowledgeServiceError && error.code === "duplicate_source") throw new LearningServiceError("idempotency_conflict");
      throw error;
    }
    const [linked] = await tx.update(riwiLearningReviews).set({ resultingSourceId: candidate.id })
      .where(and(eq(riwiLearningReviews.id, approval.id), isNull(riwiLearningReviews.resultingSourceId)))
      .returning({ id: riwiLearningReviews.id });
    if (!linked) throw new LearningServiceError("idempotency_conflict");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.signal.materialized",
      targetType: "riwi_learning_signal", targetId: signal.id,
      metadata: { signalId: signal.id, sourceId: candidate.id, role: input.actor.role, status: "candidate",
        sourceType, inputHash: signal.evidenceHash, unitCount: candidate.unitCount } }, tx as never);
    return { blocked: false as const, replayed: false, signalId: signal.id, ...candidate, scope: scope.kind,
      scopeRole: null, scopeUserId: scope.kind === "user" ? scope.userId : null };
  });
  if (result.blocked) throw new LearningServiceError("promotion_blocked");
  return result;
}

export async function listLearningSignals(actor: { id: string; role: Role; accountStatus: AccountStatus }, limit = 100, database: typeof db = db) {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.knowledge.review").allowed || !(await isActiveActor(actor, database))) {
    throw new LearningServiceError("forbidden");
  }
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  return database.select({
    id: riwiLearningSignals.id, type: riwiLearningSignals.signalType, state: riwiLearningSignals.state,
    actorRole: riwiLearningSignals.actorRole, sourceId: riwiLearningSignals.sourceId, providerId: riwiLearningSignals.providerId,
    model: riwiLearningSignals.model, promptVersion: riwiLearningSignals.promptVersion,
    rubricVersion: riwiLearningSignals.rubricVersion, evidenceHash: riwiLearningSignals.evidenceHash,
    scope: riwiLearningSignals.scope, createdAt: riwiLearningSignals.createdAt,
  }).from(riwiLearningSignals).orderBy(desc(riwiLearningSignals.createdAt)).limit(safeLimit);
}

export async function listLearningSignalPage(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  options: { cursor?: string | null; limit?: number } = {},
  database: typeof db = db,
) {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.knowledge.review").allowed || !(await isActiveActor(actor, database))) {
    throw new LearningServiceError("forbidden");
  }
  let limit: number;
  let after: RiwiOwnerHistoryPosition | null;
  try {
    limit = ownerHistoryPageLimit(options.limit);
    after = decodeOwnerHistoryCursor(options.cursor, actor, "learning_signals");
  } catch (error) {
    if (error instanceof RiwiOwnerHistoryCursorError) throw new LearningServiceError("invalid_input");
    throw error;
  }
  const rows = await database.select({
    id: riwiLearningSignals.id, type: riwiLearningSignals.signalType, state: riwiLearningSignals.state,
    actorRole: riwiLearningSignals.actorRole, sourceId: riwiLearningSignals.sourceId, providerId: riwiLearningSignals.providerId,
    model: riwiLearningSignals.model, promptVersion: riwiLearningSignals.promptVersion,
    rubricVersion: riwiLearningSignals.rubricVersion, evidenceHash: riwiLearningSignals.evidenceHash,
    scope: riwiLearningSignals.scope, createdAt: riwiLearningSignals.createdAt,
  }).from(riwiLearningSignals).where(after
    ? or(
      lt(riwiLearningSignals.createdAt, after.sortAt),
      and(eq(riwiLearningSignals.createdAt, after.sortAt), lt(riwiLearningSignals.id, after.id)),
    )
    : undefined)
    .orderBy(desc(riwiLearningSignals.createdAt), desc(riwiLearningSignals.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items.at(-1);
  return {
    signals: items,
    nextCursor: hasMore && last
      ? encodeOwnerHistoryCursor({ actor, collection: "learning_signals", after: { sortAt: last.createdAt, id: last.id } })
      : null,
  };
}

export async function countLearningSignalsForOwner(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  database: typeof db = db,
) {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.knowledge.review").allowed || !(await isActiveActor(actor, database))) {
    throw new LearningServiceError("forbidden");
  }
  const [counts] = await database.select({
    total: sql<number>`count(*)::int`,
    pending: sql<number>`count(*) filter (where ${riwiLearningSignals.state} in ('candidate', 'in_review'))::int`,
  }).from(riwiLearningSignals);
  return { total: Number(counts?.total ?? 0), pending: Number(counts?.pending ?? 0) };
}

export async function listLearningCandidateForOwner(actor: { id: string; role: Role; accountStatus: AccountStatus }, signalId: string, database: typeof db = db) {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.knowledge.review").allowed || !(await isActiveActor(actor, database))) {
    throw new LearningServiceError("forbidden");
  }
  if (!UUID.test(signalId)) throw new LearningServiceError("invalid_input");
  return database.query.riwiLearningSignals.findFirst({
    where: eq(riwiLearningSignals.id, signalId),
    columns: { id: true, signalType: true, state: true, candidateClaim: true, evidenceSummary: true, evidenceHash: true, sourceId: true, providerId: true, model: true, promptVersion: true, rubricVersion: true, actorUserId: true, actorRole: true, targetUserId: true, scope: true, createdAt: true },
  });
}

/** Owner-only immutable review history, including linked regression evidence. */
export async function listLearningReviewsForOwner(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  signalId: string,
  database: typeof db = db,
) {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.knowledge.review").allowed || !(await isActiveActor(actor, database))) {
    throw new LearningServiceError("forbidden");
  }
  if (!UUID.test(signalId)) throw new LearningServiceError("invalid_input");
  return database.select({
    id: riwiLearningReviews.id, reviewerUserId: riwiLearningReviews.reviewerUserId,
    decision: riwiLearningReviews.decision, reason: riwiLearningReviews.reason,
    regressionFixtureId: riwiLearningReviews.regressionFixtureId,
    regressionEvidenceHash: riwiLearningReviews.regressionEvidenceHash,
    regressionPassedAt: riwiLearningReviews.regressionPassedAt,
    resultingSourceId: riwiLearningReviews.resultingSourceId,
    createdAt: riwiLearningReviews.createdAt,
  }).from(riwiLearningReviews).where(eq(riwiLearningReviews.signalId, signalId))
    .orderBy(asc(riwiLearningReviews.createdAt), asc(riwiLearningReviews.id)).limit(100);
}
