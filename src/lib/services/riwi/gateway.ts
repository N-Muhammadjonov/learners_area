import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { users } from "@/db/schema";
import { db } from "@/db/client";
import { requireActiveUser, type CurrentUser } from "@/lib/auth/current-user";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n";
import { RULES, accountKey, consume, type RateLimitResult } from "@/lib/http/rate-limit";
import { isOnRoster } from "@/lib/reporter/roster";
import { effectiveCoachConfig } from "@/lib/services/coach/owner-control";
import type { RiwiProviderInput } from "@/lib/services/coach/types";
import { guardExternalPayload, redactExternalText } from "./outbound-guard";
import { providerRegistry } from "@/lib/services/coach/registry";
import {
  appendRiwiTurn,
  getRiwiConversationHistory,
  openRiwiConversation,
  RiwiConversationError,
} from "./conversations";
import { authorizeCapability, resolveUserScope, type RiwiActor, type RiwiCapability, type ScopeDecision } from "./capabilities";
import {
  assessRiwiIntent,
  riwiChatRequestSchema,
  riwiChatResponseSchema,
  type RiwiChatRequest,
  type RiwiChatResponse,
  type RiwiIntent,
} from "./contracts";
import { extractDictionaryTerm, hasOpenExam } from "./dictionary";
import { riwiErrorMessage, type RiwiErrorCode } from "./errors";
import { readRiwiBoundedJson } from "./http";
import { createLearningSignal } from "./learning";
import { retrieveActiveKnowledge, type RetrievedKnowledge } from "./knowledge";
import { recordRiwiAudit, type RiwiAuditAction, type RiwiAuditMetadata } from "./audit";
import { readRiwiRollout, type RiwiRollout } from "./rollout";
import { routeRiwiAnswer, type RoutedRiwiAnswer } from "./provider-router";
import { riwiToolBroker } from "./core-tools";
import type { RiwiRiskClass, ToolCallResult } from "./tool-broker";

const MIN_INTENT_CONFIDENCE = 0.7;
const NO_CITATIONS: RiwiChatResponse["citations"] = [];

const dictionaryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("locked") }).strict(),
  z.object({ status: z.literal("unresolved") }).strict(),
  z.object({
    status: z.literal("resolved"), term: z.string().max(120), definitionEn: z.string().max(4000),
    translationUz: z.string().max(2000).nullable(), partOfSpeech: z.string().max(80).nullable(),
    example: z.string().max(2000).nullable(), collocations: z.string().max(2000).nullable(),
    source: z.string().max(200), verified: z.boolean(), pronunciation: z.string().max(200).nullable(),
    answer: z.string().max(7000), uncertainty: z.string().max(500).nullable(),
  }).strict(),
]);
const progressResultSchema = z.object({
  weaknesses: z.array(z.object({
    category: z.string().max(80), label: z.string().max(160), area: z.string().max(80),
    occurrenceCount: z.number().int().nonnegative(), recentSeverity: z.string().max(40),
    status: z.enum(["open", "improving", "resolved"]), lastSeenAt: z.string().datetime(),
  }).strict()).max(100),
  dueVocabulary: z.array(z.object({
    term: z.string().max(160), definition: z.string().max(1500), state: z.string().max(40), nextReviewAt: z.string().datetime(),
  }).strict()).max(20),
}).strict();
const reportResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("ready"), scope: z.enum(["owner", "teacher", "student"]),
    period: z.object({ kind: z.string().max(40), fromDate: z.string().max(30), toDate: z.string().max(30), timezone: z.string().max(80) }).strict(),
    metrics: z.array(z.object({ key: z.string().max(100), section: z.enum(["learning", "results", "people", "operations"]),
      label: z.string().max(200), unit: z.enum(["count", "ratio", "band", "score"]), value: z.number().finite().nullable() }).strict()).max(100),
    narrative: z.array(z.string().max(500)).max(30),
  }).strict(),
  z.object({ status: z.literal("unavailable"), reason: z.enum(["not_available", "invalid_period", "generation_failed"]) }).strict(),
]);
const providerStatusResultSchema = z.object({
  deploymentCeiling: z.boolean(), externalEnabled: z.boolean(), providerId: z.string().max(100),
  providerIsExternal: z.boolean(), ready: z.boolean(), model: z.string().max(160).nullable(), fallback: z.enum(["riwi", "none"]),
  providers: z.array(z.object({
    id: z.string().max(100), displayName: z.string().max(120), type: z.enum(["internal", "external"]),
    model: z.string().max(160).nullable(), capabilities: z.array(z.string().max(100)).max(50),
    secretsPresent: z.boolean(), missingSecretNames: z.array(z.string().max(100)).max(20),
  }).strict()).max(50),
  configIssues: z.array(z.object({ index: z.number().int().nonnegative(), reason: z.string().max(120) }).strict()).max(100),
}).strict();
const routedAnswerSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("external_success"), answer: z.string().min(1).max(6000), uncertainty: z.string().max(600).nullable(),
    citations: z.array(z.string().regex(/^K[1-5]$/)).max(5), providerId: z.string().max(60),
    model: z.string().max(120).nullable(), durationMs: z.number().int().nonnegative(),
  }).strict(),
  z.object({
    status: z.literal("external_unavailable"),
    reason: z.enum(["disabled", "policy_unavailable", "not_configured", "capability_missing", "invalid_request", "timeout", "cancelled", "invalid_response", "provider_error"]),
    providerId: z.string().max(60).nullable(), model: z.string().max(120).nullable(), durationMs: z.number().int().nonnegative(),
  }).strict(),
]);

export type RiwiGatewayBody = RiwiChatResponse | { error: { code: string }; correlationId?: string; retryAfterSeconds?: number };
export type RiwiGatewayResult = { status: number; body: RiwiGatewayBody; headers?: Record<string, string> };
export type RiwiGatewayAuditInput = {
  actorUserId: string | null;
  action: RiwiAuditAction;
  targetType?: string;
  targetId?: string;
  metadata: RiwiAuditMetadata;
};

export type RiwiGatewayDependencies = {
  authenticate: () => Promise<CurrentUser | null>;
  newCorrelationId: () => string;
  rollout: () => RiwiRollout;
  consumeAccountLimit: (userId: string) => RateLimitResult;
  writeAudit: (input: RiwiGatewayAuditInput) => Promise<void>;
  hasOpenExam: (actor: RiwiActor) => Promise<boolean>;
  resolveScope: (actor: RiwiActor, capability: RiwiCapability, targetUserId?: string) => Promise<ScopeDecision>;
  hasRegisteredTool: (name: string) => boolean;
  isRegisteredProvider: (providerId: string) => boolean;
  callTool: (name: string, input: unknown, actor: RiwiActor, correlationId: string, signal: AbortSignal) => Promise<ToolCallResult>;
  openConversation: typeof openRiwiConversation;
  getHistory: typeof getRiwiConversationHistory;
  appendTurn: typeof appendRiwiTurn;
  retrieveKnowledge: (query: string, actor: RiwiActor) => Promise<RetrievedKnowledge[]>;
  routeProvider: (input: { actor: { id: string; role: Role }; correlationId: string; payload: RiwiProviderInput; profile: "riwi_chat"; signal?: AbortSignal }) => Promise<RoutedRiwiAnswer>;
  createCandidateSignal: typeof createLearningSignal;
  externalEnabled: () => Promise<boolean>;
};

const scopeDependencies = {
  subjectRole: async (userId: string): Promise<Role | null> => {
    const subject = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true, accountStatus: true } });
    return subject?.accountStatus === "active" ? subject.role as Role : null;
  },
  isAssigned: (teacherId: string, studentId: string) => isOnRoster(teacherId, studentId),
};

async function defaultResolveScope(actor: RiwiActor, capability: RiwiCapability, targetUserId?: string): Promise<ScopeDecision> {
  if (capability === "riwi.provider.read_status" || capability === "riwi.provider.live_test") {
    return actor.role === "owner" && authorizeCapability(actor, capability).allowed
      ? { allowed: true, kind: "global", userIds: null }
      : { allowed: false, reason: "scope_denied" };
  }
  if (capability === "riwi.report.read_assigned" && !targetUserId && actor.role === "teacher") {
    return authorizeCapability(actor, capability).allowed
      ? { allowed: true, kind: "roster", userIds: [actor.id] }
      : { allowed: false, reason: "scope_denied" };
  }
  return resolveUserScope(actor, capability, targetUserId, scopeDependencies);
}

const defaultDependencies: RiwiGatewayDependencies = {
  authenticate: requireActiveUser,
  newCorrelationId: randomUUID,
  rollout: readRiwiRollout,
  consumeAccountLimit: (userId) => consume(RULES.riwiChatByAccount, accountKey(userId)),
  writeAudit: (input) => recordRiwiAudit(input),
  hasOpenExam: (actor) => hasOpenExam({ id: actor.id, role: actor.role }),
  resolveScope: defaultResolveScope,
  hasRegisteredTool: (name) => riwiToolBroker.contract(name) !== null,
  isRegisteredProvider: (providerId) => {
    const provider = providerRegistry.get(providerId)?.provider;
    return Boolean(provider && provider.type === "external" && provider.capabilities.includes("riwi-assistant") && provider.respondToRiwi);
  },
  callTool: (name, input, actor, correlationId, signal) => riwiToolBroker.call(name, input, { actor, correlationId, signal }),
  openConversation: openRiwiConversation,
  getHistory: getRiwiConversationHistory,
  appendTurn: appendRiwiTurn,
  retrieveKnowledge: retrieveActiveKnowledge,
  routeProvider: routeRiwiAnswer,
  createCandidateSignal: createLearningSignal,
  externalEnabled: async () => (await effectiveCoachConfig()).externalEnabled,
};

function actorOf(user: CurrentUser): RiwiActor {
  return { id: user.id, role: user.role, accountStatus: user.accountStatus };
}

function localeFor(user: CurrentUser): Locale {
  return user.locale === "en" ? "en" : "uz";
}

function clean(value: string, max: number): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim().slice(0, max);
}

/** Redact direct identifiers before clipping text to the outbound DTO limit. */
function minimizeExternalText(value: string, max: number): string {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " ").trim();
  return redactExternalText(normalized, max);
}

function answerBody(input: {
  ok: boolean;
  correlationId: string;
  conversationId?: string | null;
  intent: RiwiIntent;
  answer: string;
  uncertainty?: string | null;
  citations?: RiwiChatResponse["citations"];
  provenance: RiwiChatResponse["provenance"];
  provider?: RiwiChatResponse["provider"];
  errorCode?: RiwiErrorCode | null;
}): RiwiChatResponse {
  return riwiChatResponseSchema.parse({
    ok: input.ok,
    correlationId: input.correlationId,
    conversationId: input.conversationId ?? null,
    intent: input.intent,
    answer: clean(input.answer, 6000),
    uncertainty: input.uncertainty ? clean(input.uncertainty, 600) : null,
    citations: input.citations ?? NO_CITATIONS,
    attribution: "RIWI",
    provenance: input.provenance,
    provider: input.provider ?? null,
    errorCode: input.errorCode ?? null,
  });
}

function failedAnswer(input: { correlationId: string; locale: Locale; intent: RiwiIntent; code: RiwiErrorCode; conversationId?: string | null }): RiwiChatResponse {
  return answerBody({
    ok: false, correlationId: input.correlationId, conversationId: input.conversationId,
    intent: input.intent, answer: riwiErrorMessage(input.code, input.locale),
    provenance: input.code === "riwi_security_denial" || input.code === "riwi_exam_help_locked" ? "policy_refusal" : "unavailable",
    errorCode: input.code,
  });
}

function chatFailure(input: { correlationId: string; locale: Locale; intent: RiwiIntent; code: RiwiErrorCode; conversationId?: string | null; status?: number }): RiwiGatewayResult {
  return { status: input.status ?? 200, body: failedAnswer(input) };
}

function wireFailure(status: number, code: string, retryAfterSeconds?: number, correlationId?: string): RiwiGatewayResult {
  return {
    status,
    body: {
      error: { code },
      ...(correlationId ? { correlationId } : {}),
      ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
    },
    headers: retryAfterSeconds === undefined ? undefined : { "Retry-After": String(retryAfterSeconds) },
  };
}

async function denyAudit(deps: RiwiGatewayDependencies, actor: RiwiActor, correlationId: string, status: string) {
  await deps.writeAudit({
    actorUserId: actor.id, action: "riwi.request.denied", targetType: "riwi_request", targetId: correlationId,
    metadata: { correlationId, role: actor.role, status },
  }).catch(() => {});
}

function formatProgress(value: z.infer<typeof progressResultSchema>, locale: Locale): string {
  const lines: string[] = [];
  if (value.weaknesses.length) {
    lines.push(locale === "uz" ? "E'tibor berish kerak bo'lgan yo'nalishlar:" : "Areas to focus on:");
    for (const item of value.weaknesses.slice(0, 8)) {
      lines.push(`• ${item.label} — ${item.occurrenceCount} ${locale === "uz" ? "holat" : "recorded item(s)"} (${item.status}; ${item.recentSeverity}).`);
    }
  }
  if (value.dueVocabulary.length) {
    lines.push(locale === "uz" ? "Bugun takrorlash uchun:" : "Due for review:");
    for (const item of value.dueVocabulary.slice(0, 8)) lines.push(`• ${item.term}: ${item.definition}`);
  }
  if (!lines.length) return locale === "uz"
    ? "Hozircha RIWI shaxsiy progress bo'yicha yetarli qayd topmadi. Mashq bajarilgach, bu yerda ko'rinadi."
    : "There is not enough recorded activity for a personal summary yet. Complete a practice activity and check again.";
  return lines.join("\n");
}

function formatReport(value: z.infer<typeof reportResultSchema>, actor: RiwiActor, targeted: boolean, locale: Locale): string | null {
  if (value.status !== "ready") return null;
  const expectedScope = actor.role === "student" ? "student"
    : actor.role === "owner" && !targeted ? "owner"
      : targeted ? "student" : "teacher";
  if (value.scope !== expectedScope) return null;
  const lines = [...value.narrative];
  lines.push(`${locale === "uz" ? "Davr" : "Period"}: ${value.period.fromDate} — ${value.period.toDate}`);
  for (const metric of value.metrics) {
    const display = metric.value === null ? "—" : metric.unit === "ratio" ? `${(metric.value * 100).toFixed(1)}%`
      : metric.unit === "count" ? String(Math.round(metric.value)) : metric.value.toFixed(2);
    lines.push(`${metric.label}: ${display}`);
  }
  return lines.join("\n");
}

function formatProviderStatus(value: z.infer<typeof providerStatusResultSchema>): string {
  const providers = value.providers.slice(0, 20).map((provider) =>
    `${provider.displayName} (${provider.id}): ${provider.secretsPresent ? "credential configured" : "credential missing"}`);
  return [
    `External AI: ${value.externalEnabled ? "enabled" : "disabled"}.`,
    `Selected provider: ${value.providerId}.`,
    `Selected provider readiness: ${value.ready ? "ready" : "not ready"}.`,
    ...providers,
    ...(value.configIssues.length ? [`Configuration issues: ${value.configIssues.length}.`] : []),
  ].join("\n");
}

function buildPlan(actor: RiwiActor, request: RiwiChatRequest, locale: Locale) {
  const target = request.targetUserId;
  const language = locale;
  switch (assessRiwiIntent(request.message).intent) {
    case "dictionary_lookup":
      return { kind: "tool" as const, toolName: "riwi.dictionary.lookup", capability: "riwi.dictionary.lookup" as const,
        input: { term: extractDictionaryTerm(request.message) ?? request.message, language }, targetUserId: actor.id, riskClass: "read-only" as const };
    case "progress_self":
      if (actor.role === "student") return { kind: "tool" as const, toolName: "riwi.learning.progress.readSelf", capability: "riwi.progress.read_self" as const,
        input: {}, targetUserId: target ?? actor.id, riskClass: "read-only" as const };
      if ((actor.role === "teacher" || actor.role === "owner") && target) return { kind: "tool" as const,
        toolName: "riwi.learning.progress.readAssigned", capability: "riwi.progress.read_assigned" as const,
        input: { targetUserId: target }, targetUserId: target, riskClass: "read-only" as const };
      return { kind: "safe" as const, code: target ? "riwi_permission_denied" as const : "riwi_request_invalid" as const,
        answer: target ? riwiErrorMessage("riwi_permission_denied", locale) : (locale === "uz" ? "O'quvchini tanlash uchun ruxsatli nishon kerak." : "Select an authorized learner before requesting assigned progress."),
        errorCode: target ? "riwi_permission_denied" as const : "riwi_request_invalid" as const, riskClass: "read-only" as const };
    case "report_self":
      if (actor.role === "student") return { kind: "tool" as const, toolName: "riwi.report.readSelf", capability: "riwi.report.read_self" as const,
        input: { language }, targetUserId: target ?? actor.id, riskClass: "read-only" as const };
      if (actor.role === "teacher") return { kind: "tool" as const, toolName: "riwi.report.readAssigned", capability: "riwi.report.read_assigned" as const,
        input: { language, ...(target ? { targetUserId: target } : {}) }, targetUserId: target, riskClass: "read-only" as const };
      if (actor.role === "admin") return { kind: "tool" as const, toolName: "riwi.report.readAdminScope", capability: "riwi.report.read_admin_scope" as const,
        input: { language, ...(target ? { targetUserId: target } : {}) }, targetUserId: target, riskClass: "read-only" as const };
      if (target) return { kind: "tool" as const, toolName: "riwi.report.readAdminScope", capability: "riwi.report.read_admin_scope" as const,
        input: { language, targetUserId: target }, targetUserId: target, riskClass: "read-only" as const };
      return { kind: "tool" as const, toolName: "riwi.report.readGlobal", capability: "riwi.report.read_global" as const,
        input: { language }, targetUserId: undefined, riskClass: "read-only" as const };
    case "provider_status":
      return { kind: "tool" as const, toolName: "riwi.provider.status", capability: "riwi.provider.read_status" as const,
        input: {}, targetUserId: undefined, riskClass: "read-only" as const };
    case "provider_benchmark":
      return { kind: "handoff" as const, capability: "riwi.provider.live_test" as const,
        answer: locale === "uz" ? "Cheklangan provayder sinovlari uchun egasi RIWI boshqaruv xonasidagi tayyor namunadan foydalanishi kerak." : "Use the owner RIWI control room to run a bounded, fixed-fixture provider experiment.",
        riskClass: "outbound" as const };
    case "owner_action":
      return { kind: "handoff" as const, capability: "riwi.knowledge.review" as const,
        answer: locale === "uz" ? "Bu amal chat orqali bajarilmaydi. Egasi ko'rib chiqish boshqaruv panelidan foydalanishi kerak." : "This action is not executed from chat. Use the owner review controls to inspect and confirm a bounded action.",
        riskClass: "high-impact-write" as const };
    case "dictionary_explain":
    case "knowledge_query":
    case "educational_explanation":
      return { kind: "provider" as const, capability: "riwi.chat.self" as const, riskClass: "outbound" as const };
    case "security_denial":
      return { kind: "safe" as const, code: "riwi_security_denial" as const,
        answer: riwiErrorMessage("riwi_security_denial", locale), errorCode: "riwi_security_denial" as const, riskClass: "read-only" as const };
    case "evaluate_writing":
    case "evaluate_speaking":
    case "evaluate_grammar":
    case "evaluate_vocabulary":
    case "unsupported":
    case "unknown":
      return { kind: "safe" as const, code: "riwi_tool_not_found" as const,
        answer: locale === "uz" ? "Bu so'rov uchun aniq yordam turini aniqlay olmadim. Qisqaroq va aniqroq so'rab ko'ring yoki tegishli mashq bo'limidan foydalaning." : "I could not confidently map that request to a supported RIWI action. Please clarify, or use the relevant practice area.",
        errorCode: "riwi_tool_not_found" as const, riskClass: "read-only" as const };
  }
}

async function candidateFailureSignal(
  deps: RiwiGatewayDependencies,
  actor: RiwiActor,
  correlationId: string,
  intent: RiwiIntent,
  type: "tool_failure" | "retrieval_failure" | "provider_failure",
  status: string,
  targetUserId?: string,
) {
  if (!authorizeCapability(actor, "riwi.knowledge.submit_candidate").allowed) return;
  if (actor.role === "teacher" && !targetUserId) return;
  const claim = type === "retrieval_failure" ? "RIWI could not find an active knowledge source for a supported query."
    : type === "provider_failure" ? "RIWI did not receive a validated external-provider answer."
      : "A bounded RIWI tool handler did not complete successfully.";
  try {
    await deps.createCandidateSignal({
      actor, type, producer: "gateway", sourceId: correlationId,
      targetUserId: actor.role === "student" ? actor.id : targetUserId ?? null,
      scope: actor.role === "owner" && !targetUserId ? "global" : "user",
      candidateClaim: claim,
      evidenceSummary: `correlation=${correlationId}; status=${status.slice(0, 40)}; intent=${intent}; input=omitted`,
    });
  } catch {
    // Candidate evidence is best-effort and can never replace the bounded request result.
  }
}

async function executeToolPlan(input: {
  deps: RiwiGatewayDependencies;
  plan: ReturnType<typeof buildPlan>;
  actor: RiwiActor;
  correlationId: string;
  signal: AbortSignal;
  locale: Locale;
  intent: RiwiIntent;
  conversationId: string;
}) {
  if (input.plan.kind !== "tool") throw new Error("riwi_gateway_invalid_tool_plan");
  if (!input.deps.hasRegisteredTool(input.plan.toolName)) {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "registered_tool_missing", input.plan.targetUserId);
    return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      conversationId: input.conversationId, code: "riwi_tool_not_found" });
  }
  let result: ToolCallResult;
  try {
    result = await input.deps.callTool(input.plan.toolName, input.plan.input, input.actor, input.correlationId, input.signal);
  } catch {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "handler_error", input.plan.targetUserId);
    return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      conversationId: input.conversationId, code: "riwi_tool_failed" });
  }
  if (!result.ok) {
    if (result.code === "riwi_tool_failed" || result.code === "riwi_tool_timeout") {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", result.code, input.plan.targetUserId);
    }
    const errorCode: RiwiErrorCode = result.code === "riwi_permission_denied" ? "riwi_permission_denied"
      : result.code === "riwi_scope_denied" ? "riwi_scope_denied"
        : result.code === "riwi_tool_invalid_input" ? "riwi_tool_invalid_input"
          : result.code === "riwi_tool_timeout" ? "riwi_tool_timeout" : "riwi_tool_failed";
    return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      conversationId: input.conversationId, code: errorCode });
  }

  if (input.plan.toolName === "riwi.dictionary.lookup") {
    const parsed = dictionaryResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_tool_failed" });
    }
    if (parsed.data.status === "locked") return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_dictionary_locked" });
    if (parsed.data.status !== "resolved") return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_dictionary_unresolved" });
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: parsed.data.answer, uncertainty: parsed.data.uncertainty,
      citations: parsed.data.source ? [{ source: parsed.data.source.slice(0, 120), version: null }] : [], provenance: "canonical_dictionary" });
  }

  if (input.plan.toolName === "riwi.learning.progress.readSelf" || input.plan.toolName === "riwi.learning.progress.readAssigned") {
    const parsed = progressResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_tool_failed" });
    }
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: formatProgress(parsed.data, input.locale), provenance: "deterministic_learning_data" });
  }

  if (["riwi.report.readSelf", "riwi.report.readAssigned", "riwi.report.readAdminScope", "riwi.report.readGlobal"].includes(input.plan.toolName)) {
    const parsed = reportResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_tool_failed" });
    }
    if (parsed.data.status === "unavailable") {
      const code = parsed.data.reason === "invalid_period" ? "riwi_request_invalid" : "riwi_tool_failed";
      if (parsed.data.reason === "generation_failed") {
        await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "report_generation_failed", input.plan.targetUserId);
      }
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code });
    }
    const report = formatReport(parsed.data, input.actor, Boolean(input.plan.targetUserId), input.locale);
    if (!report) return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_scope_denied" });
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent, answer: report, provenance: "deterministic_report" });
  }

  if (input.plan.toolName === "riwi.provider.status") {
    const parsed = providerStatusResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_tool_failed" });
    }
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: formatProviderStatus(parsed.data), provenance: "deterministic_report" });
  }

  return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
    conversationId: input.conversationId, code: "riwi_tool_not_found" });
}

/**
 * The authenticated RIWI request gateway. The HTTP route only applies origin/IP
 * controls and delegates the body here; identity, role, locale, intent, policy,
 * scope, plans, provider minimization, result validation, response composition,
 * auditing and candidate-signal routing all stay on this server boundary.
 */
export async function runRiwiGateway(request: Request, overrides: Partial<RiwiGatewayDependencies> = {}): Promise<RiwiGatewayResult> {
  const deps = { ...defaultDependencies, ...overrides };
  let user: CurrentUser | null;
  try { user = await deps.authenticate(); }
  catch { return wireFailure(503, "riwi_auth_unavailable"); }
  if (!user || user.accountStatus !== "active") return wireFailure(401, "unauthorized");

  const correlationId = deps.newCorrelationId();
  const actor = actorOf(user);
  const locale = localeFor(user);
  let accountLimit: RateLimitResult;
  try { accountLimit = deps.consumeAccountLimit(actor.id); }
  catch {
    await denyAudit(deps, actor, correlationId, "rate_limit_unavailable");
    return wireFailure(503, "riwi_rate_limit_unavailable", undefined, correlationId);
  }
  if (!accountLimit.ok) {
    await denyAudit(deps, actor, correlationId, "rate_limited");
    const limited = wireFailure(429, "riwi_rate_limited", accountLimit.retryAfterSeconds, correlationId);
    return { ...limited, headers: { ...(limited.headers ?? {}), "Cache-Control": "private, no-store" } };
  }

  const body = await readRiwiBoundedJson(request);
  if (!body.ok) {
    await denyAudit(deps, actor, correlationId, body.reason);
    return wireFailure(body.reason === "too_large" ? 413 : 400, "riwi_request_invalid", undefined, correlationId);
  }
  const parsed = riwiChatRequestSchema.safeParse(body.value);
  if (!parsed.success) {
    await denyAudit(deps, actor, correlationId, "invalid_request");
    return wireFailure(400, "riwi_request_invalid", undefined, correlationId);
  }

  const assessment = assessRiwiIntent(parsed.data.message);
  const intent = assessment.intent;
  let rollout: RiwiRollout;
  try { rollout = deps.rollout(); }
  catch {
    await denyAudit(deps, actor, correlationId, "rollout_policy_unavailable");
    return wireFailure(503, "riwi_policy_unavailable", undefined, correlationId);
  }
  const baseCapability = "riwi.chat.self" as const;
  const basePolicy = authorizeCapability(actor, baseCapability);
  if (!rollout.enabled || !rollout.roles[actor.role] || !basePolicy.allowed) {
    const disabled = !rollout.enabled || !rollout.roles[actor.role];
    await denyAudit(deps, actor, correlationId, disabled ? "riwi_role_disabled" : "riwi_chat_capability_denied");
    return chatFailure({ correlationId, locale, intent, code: disabled ? "riwi_not_enabled" : "riwi_permission_denied", status: disabled ? 404 : 403 });
  }

  const plan = buildPlan(actor, parsed.data, locale);
  try {
    await deps.writeAudit({ actorUserId: actor.id, action: "riwi.request.started", targetType: "riwi_request", targetId: correlationId,
      metadata: { correlationId, role: actor.role, intent, capability: "capability" in plan ? plan.capability : baseCapability,
        riskClass: plan.riskClass, status: assessment.confidence < MIN_INTENT_CONFIDENCE ? "low_confidence_clarification" : "started" } });
  } catch { return chatFailure({ correlationId, locale, intent, code: "riwi_tool_failed", status: 503 }); }

  let response: RiwiChatResponse;
  let conversationId: string | null = null;
  let externalEligible = false;
  let scopeKind: Extract<ScopeDecision, { allowed: true }>["kind"] | undefined;
  try {
    if (intent === "security_denial") {
      response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_security_denial", locale),
        errorCode: "riwi_security_denial", provenance: "policy_refusal" });
    } else if (parsed.data.targetUserId && !["progress_self", "report_self"].includes(intent)) {
      response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_request_invalid", locale), errorCode: "riwi_request_invalid", provenance: "unavailable" });
    } else if (actor.role === "student" && await deps.hasOpenExam(actor)) {
      await denyAudit(deps, actor, correlationId, "active_exam");
      response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_exam_help_locked", locale), errorCode: "riwi_exam_help_locked", provenance: "policy_refusal" });
    } else if (assessment.confidence < MIN_INTENT_CONFIDENCE || intent === "unknown") {
      const opened = await deps.openConversation({ actor: { id: actor.id, role: actor.role }, locale,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}) });
      conversationId = opened.id;
      response = answerBody({ ok: false, correlationId, conversationId, intent: "unknown",
        answer: locale === "uz" ? "Iltimos, qanday o'quv yordami kerakligini aniqroq yozing." : "Please clarify what learning help you need.",
        errorCode: "riwi_tool_not_found", provenance: "unavailable" });
    } else if (plan.kind === "safe") {
      const opened = await deps.openConversation({ actor: { id: actor.id, role: actor.role }, locale,
        ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}) });
      conversationId = opened.id;
      response = answerBody({ ok: false, correlationId, conversationId, intent, answer: plan.answer,
        errorCode: plan.errorCode, provenance: plan.code === "riwi_security_denial" ? "policy_refusal" : "unavailable" });
    } else {
      const planCapability: RiwiCapability = plan.capability;
      if (!authorizeCapability(actor, planCapability).allowed) {
        response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_permission_denied", locale), errorCode: "riwi_permission_denied", provenance: "unavailable" });
      } else {
        const scope = await deps.resolveScope(actor, planCapability, "targetUserId" in plan ? plan.targetUserId : undefined);
        if (!scope.allowed) {
          response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_scope_denied", locale), errorCode: "riwi_scope_denied", provenance: "unavailable" });
        } else {
          scopeKind = scope.kind;
          const opened = await deps.openConversation({ actor: { id: actor.id, role: actor.role }, locale,
            ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}) });
          conversationId = opened.id;
          if (plan.kind === "tool") {
            response = await executeToolPlan({ deps, plan, actor, correlationId, signal: request.signal, locale, intent, conversationId });
          } else if (plan.kind === "provider") {
            if (intent === "knowledge_query" && !rollout.knowledgeLearning) {
              response = answerBody({ ok: false, correlationId, conversationId, intent, answer: riwiErrorMessage("riwi_knowledge_unavailable", locale), errorCode: "riwi_knowledge_unavailable", provenance: "unavailable" });
            } else {
              const externalEnabled = rollout.externalAi && await deps.externalEnabled();
              let retrievalFailed = false;
              const [history, knowledge] = await Promise.all([
                externalEnabled ? deps.getHistory({ actor: { id: actor.id, role: actor.role }, conversationId }) : Promise.resolve([]),
                rollout.knowledgeLearning
                  ? Promise.resolve().then(() => deps.retrieveKnowledge(parsed.data.message, actor)).catch(() => {
                      retrievalFailed = true;
                      return [] as RetrievedKnowledge[];
                    })
                  : Promise.resolve([] as RetrievedKnowledge[]),
              ]);
              if (retrievalFailed) {
                await candidateFailureSignal(deps, actor, correlationId, intent, "retrieval_failure", "retrieval_error", parsed.data.targetUserId);
              }
              if (intent === "knowledge_query" && knowledge.length === 0) {
                if (!retrievalFailed) await candidateFailureSignal(deps, actor, correlationId, intent, "retrieval_failure", "no_active_source", parsed.data.targetUserId);
                response = answerBody({ ok: false, correlationId, conversationId, intent, answer: riwiErrorMessage("riwi_knowledge_unavailable", locale), errorCode: "riwi_knowledge_unavailable", provenance: "unavailable" });
              } else if (!externalEnabled) {
                response = answerBody({ ok: false, correlationId, conversationId, intent, answer: riwiErrorMessage("riwi_provider_unavailable", locale), errorCode: "riwi_provider_unavailable", provenance: "unavailable" });
              } else {
                const payload: RiwiProviderInput = {
                  language: locale,
                  message: parsed.data.message,
                  history: history.slice(-6).map((turn) => ({ role: turn.role, content: minimizeExternalText(turn.content, 2000) })),
                  knowledge: knowledge.slice(0, 5).map((item, index) => ({
                    ref: `K${index + 1}`, text: minimizeExternalText(item.text, 1800), authority: Math.max(0, Math.min(100, item.authority)), version: item.version,
                  })),

                };
                const guarded = guardExternalPayload("chat", payload);
                if (!guarded.ok) {
                  response = answerBody({ ok: false, correlationId, conversationId, intent, answer: riwiErrorMessage("riwi_provider_invalid_response", locale), errorCode: "riwi_provider_invalid_response", provenance: "unavailable" });
                } else {
                  externalEligible = true;
                  let routed: RoutedRiwiAnswer;
                  try {
                    routed = await deps.routeProvider({ actor: { id: actor.id, role: actor.role }, correlationId,
                      payload: guarded.payload, profile: "riwi_chat", signal: request.signal });
                  } catch { routed = { status: "external_unavailable", reason: "provider_error", providerId: null, model: null, durationMs: 0 }; }
                  const parsedRoute = routedAnswerSchema.safeParse(routed);
                  if (!parsedRoute.success) {
                    await candidateFailureSignal(deps, actor, correlationId, intent, "provider_failure", "invalid_response");
                    response = answerBody({ ok: false, correlationId, conversationId, intent,
                      answer: riwiErrorMessage("riwi_provider_invalid_response", locale), errorCode: "riwi_provider_invalid_response", provenance: "unavailable" });
                  } else if (parsedRoute.data.status === "external_unavailable") {
                    const reason = parsedRoute.data.reason;
                    if (["timeout", "provider_error", "invalid_response"].includes(reason)) {
                      await candidateFailureSignal(deps, actor, correlationId, intent, "provider_failure", reason);
                    }
                    const code = reason === "timeout" ? "riwi_provider_timeout"
                      : reason === "invalid_response" || reason === "invalid_request" ? "riwi_provider_invalid_response" : "riwi_provider_unavailable";
                    response = answerBody({ ok: false, correlationId, conversationId, intent,
                      answer: riwiErrorMessage(code, locale), errorCode: code, provenance: "unavailable" });
                  } else {
                    let registeredProvider = false;
                    try { registeredProvider = deps.isRegisteredProvider(parsedRoute.data.providerId); } catch { /* Fail closed. */ }
                    if (!registeredProvider) {
                      await candidateFailureSignal(deps, actor, correlationId, intent, "provider_failure", "unregistered_provider");
                      response = answerBody({ ok: false, correlationId, conversationId, intent,
                        answer: riwiErrorMessage("riwi_provider_invalid_response", locale), errorCode: "riwi_provider_invalid_response", provenance: "unavailable" });
                    } else {
                      const sourceByRef = new Map(knowledge.slice(0, 5).map((item, index) => [`K${index + 1}`, item]));
                      const citations = parsedRoute.data.citations.flatMap((ref) => {
                        const source = sourceByRef.get(ref);
                        return source ? [{ source: clean(source.title, 120), version: source.version }] : [];
                      });
                      if (citations.length !== parsedRoute.data.citations.length) {
                        await candidateFailureSignal(deps, actor, correlationId, intent, "provider_failure", "invalid_citation");
                        response = answerBody({ ok: false, correlationId, conversationId, intent,
                          answer: riwiErrorMessage("riwi_provider_invalid_response", locale), errorCode: "riwi_provider_invalid_response", provenance: "unavailable" });
                      } else {
                        response = answerBody({ ok: true, correlationId, conversationId, intent,
                          answer: parsedRoute.data.answer, uncertainty: parsedRoute.data.uncertainty,
                          citations, provenance: "external_provider", provider: { id: parsedRoute.data.providerId, model: parsedRoute.data.model } });
                      }
                    }
                  }
                }
              }
            }
          } else {
            response = answerBody({ ok: intent !== "owner_action", correlationId, conversationId, intent,
              answer: plan.answer, errorCode: intent === "owner_action" ? "riwi_action_confirmation_required" : null,
              provenance: intent === "owner_action" ? "policy_refusal" : "deterministic_report" });
          }
        }
      }
    }

    if (conversationId) await deps.appendTurn({ actor: { id: actor.id, role: actor.role }, conversationId,
      userMessage: parsed.data.message, assistantMessage: response.answer,
      metadata: { correlationId, intent, providerId: response.provider?.id ?? null, model: response.provider?.model ?? null,
        fallbackUsed: false, externalEligible, provenance: response.provenance, citations: response.citations } });
    // Record success only after every required transcript write has completed, so feedback cannot attach to a failed delivery path.
    await deps.writeAudit({ actorUserId: actor.id, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
      metadata: { correlationId, role: actor.role, intent, capability: "capability" in plan ? plan.capability : baseCapability,
        riskClass: plan.riskClass, ...(scopeKind ? { scopeKind: scopeKind as RiwiAuditMetadata["scopeKind"] } : {}),
        answerSource: response.provenance, providerId: response.provider?.id, model: response.provider?.model ?? undefined,
        status: response.ok ? "succeeded" : "refused", resultCount: response.citations.length } });
    return { status: 200, body: riwiChatResponseSchema.parse(response), headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } };
  } catch (error) {
    const code: RiwiErrorCode = error instanceof RiwiConversationError && error.code === "not_found" ? "riwi_scope_denied" : "riwi_tool_failed";
    await denyAudit(deps, actor, correlationId, error instanceof RiwiConversationError ? error.code : "request_failed");
    return chatFailure({ correlationId, locale, intent, code, conversationId, status: 503 });
  }
}
