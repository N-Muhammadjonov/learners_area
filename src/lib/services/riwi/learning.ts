import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import type { AccountStatus } from "@/lib/auth/account-status";
import { isOnRoster } from "@/lib/reporter/roster";
import { db } from "@/db/client";
import { riwiLearningReviews, riwiLearningSignals, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { isRiwiCapability, authorizeCapability } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { isRiwiRegressionFixture, runRiwiRegressionSuite } from "./golden/fixtures";
import { redactExternalText } from "./outbound-guard";

export type LearningSignalType = "owner_correction" | "teacher_correction" | "provider_disagreement" | "provider_agreement" | "student_outcome" | "rubric_reference" | "known_good_example" | "known_bad_example" | "retrieval_failure" | "hallucination_report" | "tool_failure" | "user_feedback" | "manual_qa_finding";
const LEARNING_SIGNAL_TYPES: readonly LearningSignalType[] = [
  "owner_correction", "teacher_correction", "provider_disagreement", "provider_agreement", "student_outcome",
  "rubric_reference", "known_good_example", "known_bad_example", "retrieval_failure", "hallucination_report",
  "tool_failure", "user_feedback", "manual_qa_finding",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class LearningServiceError extends Error {
  constructor(public readonly code: "forbidden" | "invalid_input" | "not_found" | "invalid_state" | "regression_required" | "write_failed") { super(code); }
}

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }

async function isActiveStudent(userId: string, database: typeof db = db): Promise<boolean> {
  const subject = await database.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true, accountStatus: true } });
  return subject?.role === "student" && subject.accountStatus === "active";
}

export async function createLearningSignal(input: {
  actor: { id: string; role: Role; accountStatus: AccountStatus };
  type: LearningSignalType;
  targetUserId?: string | null;
  sourceId?: string | null;
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
  if ((input.targetUserId && !UUID.test(input.targetUserId)) || (input.sourceId && !UUID.test(input.sourceId))) throw new LearningServiceError("invalid_input");
  if ((input.type === "owner_correction" || input.type === "manual_qa_finding") && input.actor.role !== "owner") throw new LearningServiceError("forbidden");
  if (input.type === "teacher_correction" && input.actor.role !== "teacher") throw new LearningServiceError("forbidden");
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

  const rawClaim = input.candidateClaim.trim();
  const rawEvidence = input.evidenceSummary.trim();
  if (!rawClaim || rawClaim.length > 4000 || !rawEvidence || rawEvidence.length > 1200) throw new LearningServiceError("invalid_input");
  const claim = redactExternalText(rawClaim, 4000).trim();
  const evidence = redactExternalText(rawEvidence, 1200).trim();
  if (!claim || !evidence) throw new LearningServiceError("invalid_input");
  const created = await database.transaction(async (tx) => {
    const [row] = await tx.insert(riwiLearningSignals).values({
      signalType: input.type, state: "candidate", actorUserId: input.actor.id,
      actorRole: input.actor.role, targetUserId, sourceId: input.sourceId ?? null,
      providerId: input.providerId?.slice(0, 60) ?? null, model: input.model?.slice(0, 120) ?? null,
      promptVersion: input.promptVersion?.slice(0, 60) ?? null, rubricVersion: input.rubricVersion?.slice(0, 60) ?? null,
      candidateClaim: claim, evidenceSummary: evidence, evidenceHash: digest(`${claim}\n${evidence}`), scope: signalScope,
    }).returning({ id: riwiLearningSignals.id, state: riwiLearningSignals.state, signalType: riwiLearningSignals.signalType });
    if (!row) throw new LearningServiceError("write_failed");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.learning.signal.created", targetType: "riwi_learning_signal", targetId: row.id,
      metadata: { signalId: row.id, role: input.actor.role, status: row.state } }, tx as never);
    return row;
  });
  return created;
}

export async function reviewLearningSignal(input: {
  actor: { id: string; role: Role; accountStatus: AccountStatus };
  signalId: string;
  decision: "approve" | "reject" | "request_changes";
  reason: string;
  regressionFixtureId?: string | null;
}, database: typeof db = db) {
  if (!authorizeCapability(input.actor, "riwi.knowledge.review").allowed) throw new LearningServiceError("forbidden");
  if (!UUID.test(input.signalId) || !["approve", "reject", "request_changes"].includes(input.decision) || typeof input.reason !== "string" || input.reason.trim().length > 1000) {
    throw new LearningServiceError("invalid_input");
  }
  const reason = redactExternalText(input.reason.trim(), 1000).trim();
  if (!reason) throw new LearningServiceError("invalid_input");
  if (input.decision === "approve" && (!input.regressionFixtureId || !isRiwiRegressionFixture(input.regressionFixtureId))) {
    throw new LearningServiceError("regression_required");
  }
  return database.transaction(async (tx) => {
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
    await recordRiwiAudit({ actorUserId: input.actor.id, action: input.decision === "reject" ? "riwi.learning.promotion.rejected" : "riwi.learning.reviewed",
      targetType: "riwi_learning_signal", targetId: signal.id,
      metadata: { signalId: signal.id, role: input.actor.role, status: state, decision: input.decision,
        regressionFixtureId: input.regressionFixtureId ?? undefined, inputHash: regression?.evidenceHash } }, tx as never);
    return { signalId: signal.id, reviewId: review.id, state };
  });
}

/** Owner-only metadata view. Candidate claim/evidence are deliberately omitted from aggregate health. */
export async function listLearningSignals(actor: { id: string; role: Role; accountStatus: AccountStatus }, limit = 100, database: typeof db = db) {
  if (!authorizeCapability(actor, "riwi.knowledge.review").allowed || actor.role !== "owner") throw new LearningServiceError("forbidden");
  const safeLimit = Math.max(1, Math.min(200, Math.floor(limit) || 100));
  return database.select({
    id: riwiLearningSignals.id, type: riwiLearningSignals.signalType, state: riwiLearningSignals.state,
    actorRole: riwiLearningSignals.actorRole, providerId: riwiLearningSignals.providerId,
    model: riwiLearningSignals.model, promptVersion: riwiLearningSignals.promptVersion,
    rubricVersion: riwiLearningSignals.rubricVersion, evidenceHash: riwiLearningSignals.evidenceHash,
    scope: riwiLearningSignals.scope, createdAt: riwiLearningSignals.createdAt,
  }).from(riwiLearningSignals).orderBy(desc(riwiLearningSignals.createdAt)).limit(safeLimit);
}

export async function listLearningCandidateForOwner(actor: { id: string; role: Role; accountStatus: AccountStatus }, signalId: string, database: typeof db = db) {
  if (!authorizeCapability(actor, "riwi.knowledge.review").allowed || actor.role !== "owner") throw new LearningServiceError("forbidden");
  if (!UUID.test(signalId)) throw new LearningServiceError("invalid_input");
  return database.query.riwiLearningSignals.findFirst({
    where: and(eq(riwiLearningSignals.id, signalId), eq(riwiLearningSignals.state, "candidate")),
    columns: { id: true, signalType: true, candidateClaim: true, evidenceSummary: true, evidenceHash: true, providerId: true, model: true, promptVersion: true, rubricVersion: true, targetUserId: true, scope: true, createdAt: true },
  });
}
