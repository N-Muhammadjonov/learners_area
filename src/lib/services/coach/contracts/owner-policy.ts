import "server-only";
import { createHash } from "node:crypto";
import { and, count, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { riwiAssessmentPolicies, riwiAssessmentPolicyVersions, users } from "@/db/schema";
import type { CurrentUser } from "@/lib/auth/current-user";
import { recordRiwiAudit } from "@/lib/services/riwi/audit";
import {
  decodeOwnerHistoryCursor,
  encodeOwnerHistoryCursor,
  ownerHistoryPageLimit,
  RiwiOwnerHistoryCursorError,
  type RiwiOwnerHistoryPosition,
} from "@/lib/services/riwi/owner-history-cursor";
import { providerEvaluationOutputSchema } from "../schema";
import { composeAssessmentPrompt, filterOwnerOverlay, promptInvariantSnapshot } from "./compose";
import { HARD_CORE_RULES, GLOBAL_TEACHING_RULES, STRICT_OUTPUT_RULES } from "./core";
import { ownerOverlayBehaviorFixtures } from "./owner-policy-fixtures";
import { assessmentContracts, ownerPolicyContractsForScope, assessmentPolicyScopeMatches, getAssessmentContract } from "./registry";
import {
  assessmentOwnerOverlaySchema,
  assessmentPolicyCandidateSchema,
  assessmentPolicyScopeSchema,
  nonEmptyAssessmentOwnerOverlaySchema,
} from "./schema";
import {
  ASSESSMENT_POLICY_SCOPES,
  OWNER_OVERLAY_FIELDS_BY_DOMAIN,
  type AssessmentContractKey,
  type AssessmentOwnerOverlay,
  type AssessmentPolicyScope,
} from "./types";

export type AssessmentPolicyState = "candidate" | "approved" | "superseded" | "rejected";
export const ASSESSMENT_POLICY_STATES = ["candidate", "approved", "superseded", "rejected"] as const satisfies readonly AssessmentPolicyState[];
export const ASSESSMENT_POLICY_REGRESSION_FIXTURE = "assessment-owner-overlay-invariants-v3";
const HISTORICAL_REGRESSION_FIXTURE = "assessment-owner-overlay-invariants-v2";

type PolicyActor = Pick<CurrentUser, "id" | "role" | "accountStatus">;
type Database = typeof db;
type PolicyTransaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type AssessmentPolicyErrorCode =
  | "forbidden"
  | "invalid_input"
  | "unsupported_instruction"
  | "not_found"
  | "invalid_state"
  | "regression_required"
  | "regression_failed"
  | "unavailable";

export class AssessmentPolicyError extends Error {
  constructor(public readonly code: AssessmentPolicyErrorCode) { super(code); }
}

export type ParsedAssessmentPolicyMessage = {
  scope: AssessmentPolicyScope;
  overlay: AssessmentOwnerOverlay;
};

export type AssessmentPolicyRegression = {
  fixtureId: string;
  passed: boolean;
  evidenceHash: string;
  checks: {
    scopeContainsOnlyCoachContracts: boolean;
    overlayFieldsAreAllowlisted: boolean;
    immutableCorePreserved: boolean;
    sectionOrderPreserved: boolean;
    outputSchemaUnchanged: boolean;
    taskAndRubricVersionsRetained: boolean;
    noRawMessageOrPolicyTextExecutable: boolean;
    pronunciationLimitationRetained: boolean;
    objectiveAndReporterContractsUnaffected: boolean;
    runtimeGoldenFixturesPassed?: boolean;
  };
  affectedTaskKeys: AssessmentContractKey[];
};

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function digestJson(value: unknown): string {
  return digest(JSON.stringify(value));
}

function stableZodShape(schema: z.ZodTypeAny): unknown {
  const type = schema._def.typeName;
  if (schema instanceof z.ZodObject) {
    const fields = schema.shape as Record<string, z.ZodTypeAny>;
    return {
      type,
      unknownKeys: schema._def.unknownKeys,
      fields: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, stableZodShape(value)])),
    };
  }
  if (schema instanceof z.ZodArray) {
    const definition = schema._def as unknown as { minLength?: { value: number } | null; maxLength?: { value: number } | null; exactLength?: { value: number } | null };
    return {
      type, element: stableZodShape(schema.element),
      minLength: definition.minLength?.value ?? null, maxLength: definition.maxLength?.value ?? null,
      exactLength: definition.exactLength?.value ?? null,
    };
  }
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable || schema instanceof z.ZodDefault) {
    return { type, inner: stableZodShape(schema._def.innerType) };
  }
  if (schema instanceof z.ZodEnum) return { type, values: schema._def.values };
  if (schema instanceof z.ZodNativeEnum) return { type, values: schema._def.values };
  if (schema instanceof z.ZodUnion) return { type, options: schema._def.options.map(stableZodShape) };
  if (schema instanceof z.ZodString || schema instanceof z.ZodNumber) {
    const checks = (schema._def as unknown as { checks: Array<Record<string, unknown>> }).checks.map((check) => ({
      ...check,
      ...(check.regex instanceof RegExp ? { regex: `${check.regex.source}/${check.regex.flags}` } : {}),
    }));
    return { type, checks };
  }
  if (schema instanceof z.ZodLiteral) return { type, value: schema._def.value };
  if (schema instanceof z.ZodEffects) return { type, inner: stableZodShape(schema._def.schema), effect: schema._def.effect.type };
  return { type };
}

function validatePolicyScopeOverlay(scope: AssessmentPolicyScope, overlay: AssessmentOwnerOverlay): boolean {
  const contracts = ownerPolicyContractsForScope(scope);
  if (contracts.length === 0) return false;
  const fields = Object.keys(overlay) as (keyof AssessmentOwnerOverlay)[];
  if (fields.length === 0) return false;
  return contracts.every((contract) =>
    contract.execution === "coach_evaluation"
    && fields.every((field) => contract.ownerOverlayFields.includes(field))
    && fields.every((field) => OWNER_OVERLAY_FIELDS_BY_DOMAIN[contract.domain].includes(field))
    && filterOwnerOverlay(contract, overlay) !== null,
  );
}

/**
 * Deterministic owner-message parser. It recognizes a small set of approved
 * presentation requests; it never asks an LLM to interpret a policy change.
 * Unsupported or mixed instructions create no executable candidate.
 */
export function parseOwnerAssessmentPolicyMessage(message: string): ParsedAssessmentPolicyMessage | null {
  const raw = message.trim();
  if (raw.length < 8 || raw.length > 2000) return null;
  const text = raw.normalize("NFKC").toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/\s+/g, " ");
  const prohibited = /(?:\b(?:ignore|disregard|forget|bypass|disable|override|replace|rewrite|change|redefine)\b.{0,100}\b(?:security|safety|hard core|schema|answer key|official score|band|rubric|pronunciation|reporter|metric|tool|url|endpoint|credential|secret|prompt|instructions?)\b)|(?:\b(?:reveal|expose|print|repeat|leak|execute|run)\b.{0,80}\b(?:hidden|system|developer|prompt|instructions?|secret|credential|password|api[_ -]?key|answer key|sql|shell|filesystem|endpoint|url)\b)|(?:\b(?:system[\s_-]?prompt|prompt\s+(?:field|text|body|override)|raw\s+instructions?)\b)|(?:https?:\/\/|\b(?:api[_ -]?key|password|credential|secret|shell|raw sql|filesystem)\b)/i;
  const prohibitedUz = /(?:xavfsizlik|javob kaliti|rasmiy (?:ball(?:ni|ini)?|baho(?:ni|sini)?)|talaffuz|provayder|maxfiy|parol|tizim prompti|sql|shell).{0,80}(?:o'chir|o'zgartir|chetlab|almashtir|oshkor|ko'rsat|bajar)|(?:o'chir|o'zgartir|chetlab|almashtir|oshkor|bajar).{0,80}(?:xavfsizlik|javob kaliti|rasmiy (?:ball(?:ni|ini)?|baho(?:ni|sini)?)|talaffuz|provayder|maxfiy|parol|tizim prompti|sql|shell)/i;
  if (prohibited.test(text) || prohibitedUz.test(text)) return null;

  const candidates: ParsedAssessmentPolicyMessage[] = [];
  if (
    /\bwriting\s+task\s*2\b/.test(text)
    && /\b(?:three\s+(?:biggest|most important)\s+weakness(?:es)?|uchta eng (?:katta|muhim) zaiflik(?:ni|larni)?)\b/.test(text)
    && /\b(?:(?:quote|cite)\s+(?:the\s+)?evidence|dalil(?:ni)?)\b/.test(text)
    && /\b(?:correction|tuzatish)\b/.test(text)
    && /\b(?:reusable\s+rule|qayta ishlatiladigan qoida)\b/.test(text)
  ) {
    candidates.push({
      scope: "writing.task2.*",
      overlay: {
        maxWeaknesses: 3,
        prioritizeBandLimitingIssues: true,
        evidenceRequired: true,
        includeCorrections: true,
        includeReusableRule: true,
        feedbackStyle: "step_by_step",
      },
    });
  }
  if (
    /\bspeaking\s+part\s*1\b/.test(text)
    && /\b(?:per[- ]answer\s+scores?|har bir javob (?:uchun )?ball(?:ni|ini)?)\b/.test(text)
    && /\b(?:topic\s+summary|mavzu xulosasi)\b/.test(text)
    && /\b(?:three\s+weakness(?:es)?|uchta zaiflik(?:ni|larni)?)\b/.test(text)
  ) {
    candidates.push({
      scope: "speaking.part1",
      overlay: {
        showPerAnswerScore: false,
        topicSummary: true,
        topicSummaryMaxWeaknesses: 3,
        maxWeaknesses: 3,
        feedbackUnit: "per_topic",
        feedbackStyle: "concise",
      },
    });
  }
  if (
    /\b(?:grammar|grammatika)\b/.test(text)
    && /\b(?:two\s+mini[- ]illustrations|ikkita kichik chizma)\b/.test(text)
    && /\b(?:wrong\s+form|why\s+it\s+sounds\s+unnatural|noto'g'ri shakl|nega tabiiy emas)\b/.test(text)
  ) {
    candidates.push({
      scope: "grammar.*",
      overlay: {
        exampleCount: 2,
        useMiniIllustrations: true,
        explanationDepth: "detailed",
        learnerTone: "coach_explanatory",
      },
    });
  }
  if (candidates.length !== 1) return null;
  const parsed = assessmentPolicyCandidateSchema.safeParse(candidates[0]);
  if (!parsed.success || !validatePolicyScopeOverlay(parsed.data.scope, parsed.data.overlay)) return null;
  return parsed.data;
}

function activeOwner(actor: PolicyActor): boolean {
  return actor.role === "owner" && actor.accountStatus === "active";
}

async function requireActiveOwner(actor: PolicyActor, database: Pick<typeof db, "select">): Promise<void> {
  if (!activeOwner(actor)) throw new AssessmentPolicyError("forbidden");
  const [row] = await database.select({ role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, actor.id)).limit(1);
  if (row?.role !== "owner" || row.accountStatus !== "active") throw new AssessmentPolicyError("forbidden");
}

async function requireOwnerInTransaction(actor: PolicyActor, tx: Parameters<Parameters<Database["transaction"]>[0]>[0]): Promise<void> {
  if (!activeOwner(actor)) throw new AssessmentPolicyError("forbidden");
  const [row] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, actor.id)).limit(1).for("update");
  if (row?.role !== "owner" || row.accountStatus !== "active") throw new AssessmentPolicyError("forbidden");
}

/** Every policy writer locks the parent before the version, including different owners. */
async function lockPolicyVersion(candidateId: string, tx: PolicyTransaction) {
  const [reference] = await tx.select({ policyId: riwiAssessmentPolicyVersions.policyId })
    .from(riwiAssessmentPolicyVersions).where(eq(riwiAssessmentPolicyVersions.id, candidateId)).limit(1);
  if (!reference) throw new AssessmentPolicyError("not_found");
  const [policy] = await tx.select().from(riwiAssessmentPolicies)
    .where(eq(riwiAssessmentPolicies.id, reference.policyId)).limit(1).for("update");
  const [version] = await tx.select().from(riwiAssessmentPolicyVersions)
    .where(eq(riwiAssessmentPolicyVersions.id, candidateId)).limit(1).for("update");
  if (!policy || !version || version.policyId !== policy.id) throw new AssessmentPolicyError("not_found");
  return { policy, version };
}

function validateCandidateInput(scopeValue: unknown, overlayValue: unknown) {
  const candidate = assessmentPolicyCandidateSchema.safeParse({ scope: scopeValue, overlay: overlayValue });
  if (!candidate.success || !validatePolicyScopeOverlay(candidate.data.scope, candidate.data.overlay)) {
    throw new AssessmentPolicyError("invalid_input");
  }
  return candidate.data;
}

function safeVersionView(row: typeof riwiAssessmentPolicyVersions.$inferSelect, scope: string, activeVersion: number | null) {
  const overlay = assessmentOwnerOverlaySchema.safeParse(row.overlay);
  return {
    id: row.id,
    policyId: row.policyId,
    scope,
    version: row.version,
    state: row.state,
    overlay: overlay.success ? overlay.data : {},
    sourceMessageHash: row.sourceMessageHash,
    regressionFixtureId: row.regressionFixtureId,
    regressionEvidenceHash: row.regressionEvidenceHash,
    regressionPassedAt: row.regressionPassedAt,
    createdByUserId: row.createdByUserId,
    reviewedByUserId: row.reviewedByUserId,
    createdAt: row.createdAt,
    approvedAt: row.approvedAt,
    active: activeVersion === row.version && row.state === "approved",
  };
}

export async function createAssessmentPolicyCandidate(
  actor: PolicyActor,
  message: string,
  database: Database = db,
): Promise<{ candidate: ReturnType<typeof safeVersionView>; replay: boolean }> {
  await requireActiveOwner(actor, database);
  const parsed = parseOwnerAssessmentPolicyMessage(message);
  if (!parsed) throw new AssessmentPolicyError("unsupported_instruction");
  const candidate = validateCandidateInput(parsed.scope, parsed.overlay);
  const sourceMessageHash = digest(message.normalize("NFKC").trim().replace(/\s+/g, " "));

  return database.transaction(async (tx) => {
    await requireOwnerInTransaction(actor, tx);
    await tx.insert(riwiAssessmentPolicies).values({
      scope: candidate.scope,
      createdByUserId: actor.id,
    }).onConflictDoNothing({ target: riwiAssessmentPolicies.scope });
    const [policy] = await tx.select().from(riwiAssessmentPolicies)
      .where(eq(riwiAssessmentPolicies.scope, candidate.scope)).limit(1).for("update");
    if (!policy) throw new AssessmentPolicyError("unavailable");

    const [existing] = await tx.select().from(riwiAssessmentPolicyVersions).where(and(
      eq(riwiAssessmentPolicyVersions.policyId, policy.id),
      eq(riwiAssessmentPolicyVersions.sourceMessageHash, sourceMessageHash),
    )).limit(1);
    if (existing) return { candidate: safeVersionView(existing, policy.scope, policy.activeVersion), replay: true };

    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${riwiAssessmentPolicyVersions.version}), 0)::int` })
      .from(riwiAssessmentPolicyVersions).where(eq(riwiAssessmentPolicyVersions.policyId, policy.id));
    const version = Number(latest?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000) throw new AssessmentPolicyError("invalid_state");
    const [created] = await tx.insert(riwiAssessmentPolicyVersions).values({
      policyId: policy.id,
      version,
      state: "candidate",
      overlay: candidate.overlay,
      sourceMessageHash,
      createdByUserId: actor.id,
    }).returning();
    if (!created) throw new AssessmentPolicyError("unavailable");
    await tx.update(riwiAssessmentPolicies).set({ updatedAt: new Date() }).where(eq(riwiAssessmentPolicies.id, policy.id));
    await recordRiwiAudit({
      actorUserId: actor.id,
      action: "riwi.assessment.policy.candidate",
      targetType: "riwi_assessment_policy_version",
      targetId: created.id,
      metadata: { taskProfile: candidate.scope, version, decision: "candidate", inputHash: sourceMessageHash, contentHash: digestJson(candidate.overlay) },
    }, tx);
    return { candidate: safeVersionView(created, policy.scope, policy.activeVersion), replay: false };
  });
}

/** Rollback is a fresh candidate copied from a verified historical approval.
 * It never rewrites history or activates an old preview automatically. */
export async function createAssessmentPolicyRollbackCandidate(
  actor: PolicyActor,
  versionId: string,
  database: Database = db,
): Promise<{ candidate: ReturnType<typeof safeVersionView>; replay: boolean }> {
  await requireActiveOwner(actor, database);
  if (!z.string().uuid().safeParse(versionId).success) throw new AssessmentPolicyError("invalid_input");
  return database.transaction(async (tx) => {
    await requireOwnerInTransaction(actor, tx);
    const { policy, version: source } = await lockPolicyVersion(versionId, tx);
    if (source.state !== "superseded" || !source.approvedAt || !policy.activeVersion || source.version >= policy.activeVersion) throw new AssessmentPolicyError("invalid_state");
    const checked = validateCandidateInput(policy.scope, source.overlay);
    const regression = policyRegression(checked.scope, checked.overlay, source.regressionFixtureId === HISTORICAL_REGRESSION_FIXTURE);
    if (!regression.passed || regression.fixtureId !== source.regressionFixtureId || regression.evidenceHash !== source.regressionEvidenceHash) throw new AssessmentPolicyError("regression_required");
    const sourceMessageHash = digestJson({ rollbackVersionId: source.id, activeVersion: policy.activeVersion, overlay: checked.overlay });
    const [existing] = await tx.select().from(riwiAssessmentPolicyVersions).where(and(
      eq(riwiAssessmentPolicyVersions.policyId, policy.id), eq(riwiAssessmentPolicyVersions.sourceMessageHash, sourceMessageHash),
    )).limit(1);
    if (existing) return { candidate: safeVersionView(existing, policy.scope, policy.activeVersion), replay: true };
    const [latest] = await tx.select({ version: sql<number>`coalesce(max(${riwiAssessmentPolicyVersions.version}), 0)::int` })
      .from(riwiAssessmentPolicyVersions).where(eq(riwiAssessmentPolicyVersions.policyId, policy.id));
    const version = Number(latest?.version ?? 0) + 1;
    if (!Number.isSafeInteger(version) || version < 1 || version > 1_000_000) throw new AssessmentPolicyError("invalid_state");
    const [created] = await tx.insert(riwiAssessmentPolicyVersions).values({
      policyId: policy.id, version, state: "candidate", overlay: checked.overlay, sourceMessageHash, createdByUserId: actor.id,
    }).returning();
    if (!created) throw new AssessmentPolicyError("unavailable");
    await tx.update(riwiAssessmentPolicies).set({ updatedAt: new Date() }).where(eq(riwiAssessmentPolicies.id, policy.id));
    await recordRiwiAudit({ actorUserId: actor.id, action: "riwi.assessment.policy.candidate", targetType: "riwi_assessment_policy_version", targetId: created.id,
      metadata: { taskProfile: checked.scope, version, decision: "rollback_candidate", sourceId: source.id, inputHash: sourceMessageHash, contentHash: digestJson(checked.overlay) },
    }, tx);
    return { candidate: safeVersionView(created, policy.scope, policy.activeVersion), replay: false };
  });
}

function scoreScope(scope: AssessmentPolicyScope, key: AssessmentContractKey): number {
  if (scope === key) return 3;
  const parts = key.split(".");
  const taskScope = parts.length > 1 ? `${parts[0]}.${parts[1]}.*` : "";
  if (scope === taskScope) return 2;
  if (scope === `${parts[0]}.*`) return 1;
  return 0;
}

/** Runtime lookup only reads an approved immutable version; candidates and uploads are inert. */
export async function getApprovedOwnerPolicyForContract(
  key: AssessmentContractKey,
  database: Database = db,
): Promise<{ scope: AssessmentPolicyScope; version: number; overlay: AssessmentOwnerOverlay } | null> {
  try {
    const contract = getAssessmentContract(key);
    if (!contract) return null;
    const scopes = ASSESSMENT_POLICY_SCOPES.filter((scope) => assessmentPolicyScopeMatches(scope, key));
    if (scopes.length === 0) return null;
    const policies = await database.select().from(riwiAssessmentPolicies).where(inArray(riwiAssessmentPolicies.scope, [...scopes]));
    policies.sort((a, b) => scoreScope(b.scope as AssessmentPolicyScope, key) - scoreScope(a.scope as AssessmentPolicyScope, key));
    for (const policy of policies) {
      if (!policy.activeVersion) continue;
      const scope = assessmentPolicyScopeSchema.safeParse(policy.scope);
      if (!scope.success || !assessmentPolicyScopeMatches(scope.data, key)) continue;
      const [version] = await database.select().from(riwiAssessmentPolicyVersions).where(and(
        eq(riwiAssessmentPolicyVersions.policyId, policy.id),
        eq(riwiAssessmentPolicyVersions.version, policy.activeVersion),
        eq(riwiAssessmentPolicyVersions.state, "approved"),
      )).limit(1);
      if (!version) continue;
      const overlay = assessmentOwnerOverlaySchema.safeParse(version.overlay);
      if (!overlay.success || !validatePolicyScopeOverlay(scope.data, overlay.data)) continue;
      const integrity = policyRegression(scope.data, overlay.data, version.regressionFixtureId === HISTORICAL_REGRESSION_FIXTURE);
      if (!version.approvedAt || !version.regressionPassedAt || integrity.fixtureId !== version.regressionFixtureId || integrity.evidenceHash !== version.regressionEvidenceHash) continue;
      const filtered = filterOwnerOverlay(contract, overlay.data);
      if (!filtered) continue;
      return { scope: scope.data, version: version.version, overlay: filtered };
    }
    return null;
  } catch {
    // A missing/migrating policy table or malformed historical row means the
    // immutable base contract remains active; it never enables raw instructions.
    return null;
  }
}

function sectionOrderValid(prompt: string): boolean {
  const domainHeader = /\[[A-Z]+ DOMAIN CONTRACT\]/.exec(prompt)?.[0] ?? "";
  const positions = [
    prompt.indexOf("[IMMUTABLE HARD CORE]"),
    prompt.indexOf("[GLOBAL TEACHING AND EVIDENCE]"),
    domainHeader ? prompt.indexOf(domainHeader) : -1,
    prompt.indexOf("[TASK-SPECIFIC CONTRACT]"),
    prompt.indexOf("[APPROVED OWNER PRESENTATION OVERLAY]"),
    prompt.indexOf("[STRICT OUTPUT RULES]"),
  ];
  return positions.every((position) => position >= 0) && positions.every((position, index) => index === 0 || positions[index - 1]! < position);
}

export function runAssessmentPolicyRegression(
  scopeValue: unknown,
  overlayValue: unknown,
): AssessmentPolicyRegression {
  return policyRegression(scopeValue, overlayValue, false);
}

function policyRegression(scopeValue: unknown, overlayValue: unknown, historical: boolean): AssessmentPolicyRegression {
  const candidate = validateCandidateInput(scopeValue, overlayValue);
  const affected = ownerPolicyContractsForScope(candidate.scope);
  const outputKeys = Object.keys(providerEvaluationOutputSchema.shape).sort();
  const filteredOverlays = affected.map((contract) => filterOwnerOverlay(contract, candidate.overlay));
  const snapshots = affected.map((contract) => promptInvariantSnapshot(contract.key, candidate.overlay));
  const prompts = affected.map((contract) => composeAssessmentPrompt({
    contract, overlay: candidate.overlay,
    detailedWritingAnalysis: contract.key.startsWith("writing.grade."),
  }));
  const behavior = ownerOverlayBehaviorFixtures(affected, candidate.overlay);
  if (!behavior.passed) throw new AssessmentPolicyError("regression_failed");
  const fixtureId = historical ? HISTORICAL_REGRESSION_FIXTURE : ASSESSMENT_POLICY_REGRESSION_FIXTURE;
  const checks = {
    scopeContainsOnlyCoachContracts: affected.length > 0 && affected.every((contract) => contract.execution === "coach_evaluation"),
    overlayFieldsAreAllowlisted: filteredOverlays.every((value) => value !== null)
      && affected.every((contract) => Object.keys(candidate.overlay).every((field) => contract.ownerOverlayFields.includes(field as keyof AssessmentOwnerOverlay))),
    immutableCorePreserved: snapshots.every((snapshot) => snapshot.hasHardCore === true && prompts.some((prompt) => prompt.includes(HARD_CORE_RULES))),
    sectionOrderPreserved: prompts.every(sectionOrderValid),
    outputSchemaUnchanged: outputKeys.length > 0 && outputKeys.includes("overallEstimate") && outputKeys.includes("teachingFeedback")
      && !outputKeys.some((field) => /owner|policy|system|prompt/i.test(field)),
    taskAndRubricVersionsRetained: snapshots.every((snapshot) => snapshot.hasTaskRules === true)
      && affected.every((contract) => contract.version.length <= 40 && contract.rubricVersion.length <= 40),
    noRawMessageOrPolicyTextExecutable: Object.values(candidate.overlay).every((value) => typeof value !== "string" || value.length <= 24)
      && !Object.keys(candidate.overlay).some((field) => field !== "showPerAnswerScore"
        && (/prompt|instruction|system|tool|url|rubric|answer|security|pronunciation|score/i.test(field))),
    pronunciationLimitationRetained: HARD_CORE_RULES.includes("Pronunciation, accent, intonation, stress, pauses, and prosody cannot be inferred from a transcript"),
    objectiveAndReporterContractsUnaffected: affected.every((contract) => contract.domain !== "reading" && contract.domain !== "listening" && contract.domain !== "reporting")
      && assessmentContracts.filter((contract) => contract.domain === "reporting").every((contract) => contract.execution === "deterministic_report"),
    ...(!historical ? { runtimeGoldenFixturesPassed: behavior.passed } : {}),
  };
  const fixture = {
    fixtureId,
    scope: candidate.scope,
    overlayHash: digestJson(candidate.overlay),
    affectedTaskKeys: affected.map((contract) => contract.key),
    taskVersions: affected.map(({ key, version, rubricVersion, purpose, taskRules }) => ({
      key, version, rubricVersion, contractTextHash: digestJson({ purpose, taskRules }),
    })),
    promptHashes: prompts.map((prompt) => digest(prompt)),
    hardCoreHash: digest(HARD_CORE_RULES),
    globalTeachingHash: digest(GLOBAL_TEACHING_RULES),
    strictOutputHash: digest(STRICT_OUTPUT_RULES),
    outputSchemaHash: digestJson(stableZodShape(providerEvaluationOutputSchema)),
    outputKeys,
    checks,
    ...(!historical ? { behaviorFixtureDigest: behavior.digest } : {}),
  };
  return {
    fixtureId,
    passed: Object.values(checks).every(Boolean),
    evidenceHash: digestJson(fixture),
    checks,
    affectedTaskKeys: affected.map((contract) => contract.key),
  };
}

export async function previewAssessmentPolicyCandidate(
  actor: PolicyActor,
  candidateId: string,
  database: Database = db,
): Promise<{ candidate: ReturnType<typeof safeVersionView>; regression: AssessmentPolicyRegression }> {
  await requireActiveOwner(actor, database);
  if (!z.string().uuid().safeParse(candidateId).success) throw new AssessmentPolicyError("invalid_input");
  const [joined] = await database.select({ version: riwiAssessmentPolicyVersions, policy: riwiAssessmentPolicies })
    .from(riwiAssessmentPolicyVersions)
    .innerJoin(riwiAssessmentPolicies, eq(riwiAssessmentPolicyVersions.policyId, riwiAssessmentPolicies.id))
    .where(eq(riwiAssessmentPolicyVersions.id, candidateId)).limit(1);
  if (!joined) throw new AssessmentPolicyError("not_found");
  if (joined.version.state !== "candidate") throw new AssessmentPolicyError("invalid_state");
  const regression = runAssessmentPolicyRegression(joined.policy.scope, joined.version.overlay);
  if (!regression.passed) throw new AssessmentPolicyError("regression_failed");

  return database.transaction(async (tx) => {
    await requireOwnerInTransaction(actor, tx);
    const current = await lockPolicyVersion(candidateId, tx);
    if (current.version.state !== "candidate" || current.policy.scope !== joined.policy.scope || current.version.sourceMessageHash !== joined.version.sourceMessageHash || digestJson(current.version.overlay) !== digestJson(joined.version.overlay)) throw new AssessmentPolicyError("invalid_state");
    const now = new Date();
    const [updated] = await tx.update(riwiAssessmentPolicyVersions).set({
      regressionFixtureId: regression.fixtureId,
      regressionEvidenceHash: regression.evidenceHash,
      regressionPassedAt: now,
    }).where(and(eq(riwiAssessmentPolicyVersions.id, candidateId), eq(riwiAssessmentPolicyVersions.state, "candidate"))).returning();
    if (!updated) throw new AssessmentPolicyError("invalid_state");
    await recordRiwiAudit({
      actorUserId: actor.id,
      action: "riwi.assessment.policy.previewed",
      targetType: "riwi_assessment_policy_version",
      targetId: updated.id,
      metadata: { taskProfile: current.policy.scope, version: updated.version, decision: "previewed", contentHash: regression.evidenceHash, regressionFixtureId: regression.fixtureId },
    }, tx);
    await recordRiwiAudit({
      actorUserId: actor.id,
      action: "riwi.assessment.policy.regression.passed",
      targetType: "riwi_assessment_policy_version",
      targetId: updated.id,
      metadata: { taskProfile: current.policy.scope, version: updated.version, decision: "passed", contentHash: regression.evidenceHash, regressionFixtureId: regression.fixtureId },
    }, tx);
    return { candidate: safeVersionView(updated, current.policy.scope, current.policy.activeVersion), regression };
  });
}

export async function approveAssessmentPolicyCandidate(
  actor: PolicyActor,
  candidateId: string,
  expectedEvidenceHash: string,
  database: Database = db,
): Promise<{ candidate: ReturnType<typeof safeVersionView>; replay: boolean }> {
  await requireActiveOwner(actor, database);
  if (!z.string().uuid().safeParse(candidateId).success || !z.string().regex(/^[a-f0-9]{64}$/).safeParse(expectedEvidenceHash).success) throw new AssessmentPolicyError("invalid_input");
  return database.transaction(async (tx) => {
    await requireOwnerInTransaction(actor, tx);
    const candidate = await lockPolicyVersion(candidateId, tx);
    if (candidate.version.regressionEvidenceHash !== expectedEvidenceHash) throw new AssessmentPolicyError("regression_required");
    if (candidate.version.state === "approved" && candidate.policy.activeVersion === candidate.version.version) {
      const integrity = policyRegression(candidate.policy.scope, candidate.version.overlay, candidate.version.regressionFixtureId === HISTORICAL_REGRESSION_FIXTURE);
      if (integrity.fixtureId !== candidate.version.regressionFixtureId || integrity.evidenceHash !== expectedEvidenceHash) throw new AssessmentPolicyError("regression_required");
      return { candidate: safeVersionView(candidate.version, candidate.policy.scope, candidate.policy.activeVersion), replay: true };
    }
    if (candidate.version.state !== "candidate") throw new AssessmentPolicyError("invalid_state");
    if (candidate.policy.activeVersion && candidate.version.version <= candidate.policy.activeVersion) throw new AssessmentPolicyError("invalid_state");
    if (!candidate.version.regressionFixtureId || !candidate.version.regressionEvidenceHash || !candidate.version.regressionPassedAt) {
      throw new AssessmentPolicyError("regression_required");
    }
    const regression = runAssessmentPolicyRegression(candidate.policy.scope, candidate.version.overlay);
    if (!regression.passed || regression.fixtureId !== candidate.version.regressionFixtureId || regression.evidenceHash !== candidate.version.regressionEvidenceHash) {
      throw new AssessmentPolicyError("regression_required");
    }
    if (candidate.policy.activeVersion && candidate.policy.activeVersion !== candidate.version.version) {
      await tx.update(riwiAssessmentPolicyVersions).set({ state: "superseded" }).where(and(
        eq(riwiAssessmentPolicyVersions.policyId, candidate.policy.id),
        eq(riwiAssessmentPolicyVersions.version, candidate.policy.activeVersion),
        eq(riwiAssessmentPolicyVersions.state, "approved"),
      ));
    }
    const now = new Date();
    const [approved] = await tx.update(riwiAssessmentPolicyVersions).set({
      state: "approved",
      reviewedByUserId: actor.id,
      approvedAt: now,
    }).where(and(
      eq(riwiAssessmentPolicyVersions.id, candidate.version.id),
      eq(riwiAssessmentPolicyVersions.state, "candidate"),
    )).returning();
    if (!approved) throw new AssessmentPolicyError("invalid_state");
    await tx.update(riwiAssessmentPolicies).set({ activeVersion: approved.version, updatedAt: now })
      .where(eq(riwiAssessmentPolicies.id, candidate.policy.id));
    await recordRiwiAudit({
      actorUserId: actor.id,
      action: "riwi.assessment.policy.approved",
      targetType: "riwi_assessment_policy_version",
      targetId: approved.id,
      metadata: { taskProfile: candidate.policy.scope, version: approved.version, decision: "approved", contentHash: regression.evidenceHash, regressionFixtureId: regression.fixtureId },
    }, tx);
    return { candidate: safeVersionView(approved, candidate.policy.scope, approved.version), replay: false };
  });
}

export async function rejectAssessmentPolicyCandidate(
  actor: PolicyActor,
  candidateId: string,
  reason: string,
  database: Database = db,
): Promise<{ id: string; scope: string; version: number; state: "rejected" }> {
  await requireActiveOwner(actor, database);
  if (!z.string().uuid().safeParse(candidateId).success || reason.trim().length > 500) throw new AssessmentPolicyError("invalid_input");
  return database.transaction(async (tx) => {
    await requireOwnerInTransaction(actor, tx);
    const locked = await lockPolicyVersion(candidateId, tx);
    if (locked.version.state !== "candidate") throw new AssessmentPolicyError("not_found");
    const joined = { version: locked.version, scope: locked.policy.scope };
    await tx.update(riwiAssessmentPolicyVersions).set({ state: "rejected", reviewedByUserId: actor.id })
      .where(and(eq(riwiAssessmentPolicyVersions.id, candidateId), eq(riwiAssessmentPolicyVersions.state, "candidate")));
    await recordRiwiAudit({
      actorUserId: actor.id,
      action: "riwi.assessment.policy.rejected",
      targetType: "riwi_assessment_policy_version",
      targetId: candidateId,
      metadata: { taskProfile: joined.scope, version: joined.version.version, decision: "rejected", inputHash: joined.version.sourceMessageHash, reason: reason.trim().slice(0, 1000) },
    }, tx);
    return { id: candidateId, scope: joined.scope, version: joined.version.version, state: "rejected" };
  });
}

export async function listAssessmentPolicyVersionPage(
  actor: PolicyActor,
  options: { cursor?: string | null; limit?: number; state?: AssessmentPolicyState } = {},
  database: Database = db,
) {
  await requireActiveOwner(actor, database);
  let limit: number;
  let after: RiwiOwnerHistoryPosition | null;
  try {
    limit = ownerHistoryPageLimit(options.limit);
    after = decodeOwnerHistoryCursor(options.cursor, actor, "assessment_policy_versions", undefined, options.state ?? null);
  } catch (error) {
    if (error instanceof RiwiOwnerHistoryCursorError) throw new AssessmentPolicyError("invalid_input");
    throw error;
  }
  const where = and(
    options.state ? eq(riwiAssessmentPolicyVersions.state, options.state) : undefined,
    after ? or(
      lt(riwiAssessmentPolicyVersions.createdAt, after.sortAt),
      and(eq(riwiAssessmentPolicyVersions.createdAt, after.sortAt), lt(riwiAssessmentPolicyVersions.id, after.id)),
    ) : undefined,
  );
  const [rows, [totalRow]] = await Promise.all([
    database.select({ version: riwiAssessmentPolicyVersions, policy: riwiAssessmentPolicies })
      .from(riwiAssessmentPolicyVersions)
      .innerJoin(riwiAssessmentPolicies, eq(riwiAssessmentPolicyVersions.policyId, riwiAssessmentPolicies.id))
      .where(where).orderBy(desc(riwiAssessmentPolicyVersions.createdAt), desc(riwiAssessmentPolicyVersions.id)).limit(limit + 1),
    database.select({ total: count() }).from(riwiAssessmentPolicyVersions).where(options.state ? eq(riwiAssessmentPolicyVersions.state, options.state) : undefined),
  ]);
  const hasMore = rows.length > limit;
  const selected = rows.slice(0, limit);
  const versions = selected.map(({ version, policy }) => safeVersionView(version, policy.scope, policy.activeVersion));
  const last = selected.at(-1)?.version;
  return {
    versions,
    nextCursor: hasMore && last
      ? encodeOwnerHistoryCursor({ actor, collection: "assessment_policy_versions", filter: options.state ?? null, after: { sortAt: last.createdAt, id: last.id } })
      : null,
    versionCount: Number(totalRow?.total ?? 0),
  };
}
