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
import { scopeLabel as reportScopeLabel, specsFor as reportSpecsFor, type ReportScope } from "@/lib/reporter/snapshot";
import { effectiveCoachConfig } from "@/lib/services/coach/owner-control";
import type { RiwiProviderInput } from "@/lib/services/coach/types";
import { guardExternalPayload, redactExternalText } from "./outbound-guard";
import { providerRegistry } from "@/lib/services/coach/registry";
import {
  appendRiwiTurn,
  getRiwiConversationHistory,
  openRiwiConversation,
  RiwiConversationError,
  type RiwiCourseLessonScope,
  type RiwiDictionaryConversationScope,
} from "./conversations";
import { authorizeCapability, resolveUserScope, type RiwiActor, type RiwiCapability, type ScopeDecision, type ScopeDependencies } from "./capabilities";
import {
  assessRiwiIntent,
  riwiChatRequestSchema,
  riwiChatResponseSchema,
  riwiDictionaryResultSchema,
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
import { createRiwiCoreTools, riwiToolBroker } from "./core-tools";
import { formatRiwiEvaluation, riwiEvaluationToolResultSchema } from "./evaluation-tools";
import { riwiReportResultSchema } from "./reports";
import type { ValidatedReportSnapshot } from "@/lib/reporter/snapshot-schema";
import type { RiwiRiskClass, RiwiToolBroker, ToolCallResult } from "./tool-broker";

const MIN_INTENT_CONFIDENCE = 0.7;
const NO_CITATIONS: RiwiChatResponse["citations"] = [];

const dictionaryResolvedResultSchema = riwiDictionaryResultSchema.extend({
  status: z.literal("resolved"),
  example: z.string().max(2000).nullable(),
  collocations: z.string().max(2000).nullable(),
  pronunciation: z.string().max(200).nullable(),
  answer: z.string().max(7000),
  uncertainty: z.string().max(500).nullable(),
}).strict();
const dictionaryResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("locked") }).strict(),
  z.object({ status: z.literal("unresolved") }).strict(),
  dictionaryResolvedResultSchema,
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
const reportResultSchema = riwiReportResultSchema;
const grammarTopicResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved") }).strict(),
  z.object({
    status: z.literal("resolved"), topicId: z.string().uuid(), title: z.string().max(200),
    explanation: z.string().min(1).max(6000), visibleExerciseCount: z.number().int().nonnegative().max(1_000_000),
  }).strict(),
]);
const courseLessonResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("unresolved") }).strict(),
  z.object({
    status: z.literal("resolved"), courseId: z.string().uuid(), lessonId: z.string().uuid(),
    sourceTitle: z.string().min(1).max(200), excerpt: z.string().min(1).max(1800),
  }).strict(),
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

function createScopeDependencies(database: typeof db): ScopeDependencies {
  return {
    subjectRole: async (userId) => {
      const subject = await database.query.users.findFirst({ where: eq(users.id, userId), columns: { role: true, accountStatus: true } });
      return subject?.accountStatus === "active" ? subject.role as Role : null;
    },
    isAssigned: (teacherId, studentId) => isOnRoster(teacherId, studentId, database),
  };
}

async function defaultResolveScope(
  actor: RiwiActor,
  capability: RiwiCapability,
  targetUserId: string | undefined,
  scopeDependencies: ScopeDependencies,
): Promise<ScopeDecision> {
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

/** Bind every gateway persistence/scope path to one canonical database connection. */
export function createRiwiGatewayDependencies(
  database: typeof db = db,
  toolBroker: RiwiToolBroker = database === db ? riwiToolBroker : createRiwiCoreTools(database),
): RiwiGatewayDependencies {
  const scopeDependencies = createScopeDependencies(database);
  return {
    authenticate: requireActiveUser,
    newCorrelationId: randomUUID,
    rollout: readRiwiRollout,
    consumeAccountLimit: (userId) => consume(RULES.riwiChatByAccount, accountKey(userId)),
    writeAudit: (input) => recordRiwiAudit(input, database),
    hasOpenExam: (actor) => hasOpenExam({ id: actor.id, role: actor.role }, database),
    resolveScope: (actor, capability, targetUserId) => defaultResolveScope(actor, capability, targetUserId, scopeDependencies),
    hasRegisteredTool: (name) => toolBroker.contract(name) !== null,
    isRegisteredProvider: (providerId) => {
      const provider = providerRegistry.get(providerId)?.provider;
      return Boolean(provider && provider.type === "external" && provider.capabilities.includes("riwi-assistant") && provider.respondToRiwi);
    },
    callTool: (name, input, actor, correlationId, signal) => toolBroker.call(name, input, { actor, correlationId, signal }),
    openConversation: (input) => openRiwiConversation(input, database),
    getHistory: (input) => getRiwiConversationHistory(input, database),
    appendTurn: (input) => appendRiwiTurn(input, database),
    retrieveKnowledge: (query, actor) => retrieveActiveKnowledge(query, actor, database),
    routeProvider: routeRiwiAnswer,
    createCandidateSignal: (input) => createLearningSignal(input, database),
    externalEnabled: async () => (await effectiveCoachConfig(database)).externalEnabled,
  };
}

const defaultDependencies: RiwiGatewayDependencies = createRiwiGatewayDependencies();

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
  reportSnapshot?: RiwiChatResponse["reportSnapshot"];
  evaluation?: RiwiChatResponse["evaluation"];
  dictionaryEntry?: RiwiChatResponse["dictionaryEntry"];
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
    ...(input.reportSnapshot ? { reportSnapshot: input.reportSnapshot } : {}),
    ...(input.evaluation ? { evaluation: input.evaluation } : {}),
    ...(input.dictionaryEntry ? { dictionaryEntry: input.dictionaryEntry } : {}),
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

function formatReport(snapshot: ValidatedReportSnapshot, actor: RiwiActor, targetUserId: string | undefined, locale: Locale) {
  const expectedScope = actor.role === "student" ? { kind: "student", subjectId: actor.id }
    : targetUserId ? { kind: "student", subjectId: targetUserId }
      : actor.role === "teacher" ? { kind: "teacher", teacherId: actor.id }
        : actor.role === "admin" ? { kind: "teacher", teacherId: null }
          : { kind: "owner" };
  const scopeMatches = snapshot.scope.kind === expectedScope.kind
    && (snapshot.scope.kind === "student" && expectedScope.kind === "student" ? snapshot.scope.subjectId === expectedScope.subjectId
      : snapshot.scope.kind === "teacher" && expectedScope.kind === "teacher" ? snapshot.scope.teacherId === expectedScope.teacherId
        : snapshot.scope.kind === "owner" && expectedScope.kind === "owner");
  if (!scopeMatches || snapshot.generatedBy.userId !== actor.id || snapshot.generatedBy.role !== actor.role
    || snapshot.timezone !== snapshot.period.timezone || snapshot.period.from >= snapshot.period.to) return null;

  // The snapshot schema is structural only. Bind every metric back to the
  // Reporter-owned spec so a handler cannot forge a plausible key while
  // changing SQL, parameters, labels, window basis, order, or scope metadata.
  const canonicalScope = snapshot.scope as ReportScope;
  const canonicalMetrics = reportSpecsFor(canonicalScope);
  const reportedScope = reportScopeLabel(canonicalScope);
  const metricsMatchCanonical = snapshot.metrics.length === canonicalMetrics.length && snapshot.metrics.every((metric, index) => {
    const spec = canonicalMetrics[index];
    if (!spec) return false;
    const expectedParameters: Record<string, string> = { from: snapshot.period.from, to: snapshot.period.to };
    if (spec.compiledText.includes(":subject") && canonicalScope.kind === "student") expectedParameters.subject = canonicalScope.subjectId;
    if (spec.compiledText.includes(":teacher") && canonicalScope.kind === "teacher" && canonicalScope.teacherId) expectedParameters.teacher = canonicalScope.teacherId;
    const parameterKeys = Object.keys(metric.source.parameters).sort();
    const expectedParameterKeys = Object.keys(expectedParameters).sort();
    return metric.key === spec.key
      && metric.section === spec.section
      && metric.unit === spec.unit
      && metric.label.en === spec.label.en && metric.label.uz === spec.label.uz
      && metric.source.queryId === `riwi.${spec.key}`
      && metric.source.sql === spec.compiledText
      && parameterKeys.length === expectedParameterKeys.length
      && expectedParameterKeys.every((key) => metric.source.parameters[key] === expectedParameters[key])
      && metric.window.from === snapshot.period.from && metric.window.to === snapshot.period.to
      && metric.window.basis === (spec.basis ?? "window")
      && metric.scope === reportedScope && metric.generatedAt === snapshot.generatedAt;
  });
  if (!metricsMatchCanonical) return null;

  const uz = locale === "uz";
  const scopeText = snapshot.scope.kind === "student"
    ? (snapshot.scope.subjectId === actor.id ? (uz ? "shaxsiy o'quvchi qamrovi" : "personal student scope") : (uz ? "tanlangan o'quvchi" : "selected student scope"))
    : snapshot.scope.kind === "teacher"
      ? snapshot.scope.teacherId
        ? (uz ? "o'qituvchining biriktirilgan ro'yxati" : "teacher's assigned roster")
        : (uz ? "barcha o'quvchilar guruhi" : "all-students cohort")
      : (uz ? "markaz bo'yicha" : "centre-wide");
  const sourceQueryIds = [...new Set(snapshot.metrics.map((metric) => metric.source.queryId))].sort();
  const lines = [...snapshot.narrative[locale]];
  lines.push(`${uz ? "Qamrov" : "Scope"}: ${scopeText}`);
  lines.push(`${uz ? "Davr" : "Period"}: ${snapshot.period.fromDate} — ${snapshot.period.toDate} (${snapshot.period.timezone})`);
  lines.push(`${uz ? "Aniq vaqt oralig'i" : "Exact window"}: [${snapshot.period.from}, ${snapshot.period.to})`);
  lines.push(`${uz ? "Hisobot snapshot" : "Reporter snapshot"}: ${snapshot.schemaVersion}, ${snapshot.reportId}`);
  lines.push(`${uz ? "Yaratilgan" : "Generated"}: ${snapshot.generatedAt}`);
  lines.push(`${uz ? "Manba so'rovlari" : "Source query IDs"}: ${sourceQueryIds.length ? sourceQueryIds.join(", ") : "—"}`);
  for (const metric of snapshot.metrics) {
    const display = metric.value === null ? "—" : metric.unit === "ratio" ? `${(metric.value * 100).toFixed(1)}%`
      : metric.unit === "count" ? String(Math.round(metric.value)) : metric.value.toFixed(2);
    lines.push(`${metric.label[locale]}: ${display}`);
  }
  return { answer: lines.join("\n"), snapshot };
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

function isCourseLessonRequest(message: string): boolean {
  return /\b(?:course|lesson|unit|module|coursework|class notes?|course notes?|learning material|uploaded (?:file|document|notes?))\b/i.test(message)
    || /(?:kurs|dars|bo'lim|modul|o'quv materiali|yuklangan (?:fayl|hujjat|konspekt)|курс|урок|модул|учебн(?:ый|ого) материал|загруженн(?:ый|ого) документ)/i.test(message);
}

function isGrammarTopicRequest(message: string): boolean {
  return /\b(grammar|grammatical|articles?|tenses?|present (?:simple|continuous|perfect)|past (?:simple|continuous|perfect)|future (?:simple|continuous|perfect)|verb forms?|prepositions?|subject[- ]verb|agreement|clauses?|conditionals?|passive voice|relative clause|reported speech|punctuation)\b/i.test(message)
    || /(?:grammatika|artikl|zamon|fe'l|gap tuzilishi|predlog|shart mayli|грамматик|артикл|времен[а-я]*|предлог|согласован|пассив)/i.test(message);
}

function grammarTopicQuery(message: string): string {
  return message.normalize("NFKC")
    .replace(/\b(?:can you|could you|would you|please|explain|teach me|what is|what are|how do i use|how does|why|grammar|grammatical|topic|topics|rule|rules|lesson|lessons|simply|in simple terms|tushuntiring|tushuntir|izohlang|izohla|grammatika|mavzusini|mavzu|qanday|объясни|объясните|грамматика|грамматику|тему|тема)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 120);
}

function isCanonicalVocabularyExplanation(message: string): boolean {
  return /\b(vocabulary|collocations?|lexical|word famil(?:y|ies)|phrasal verbs?|idioms?)\b/i.test(message)
    || /(?:lug'at|so'z boyligi|iboralar|коллокац|словарн)/i.test(message);
}

function buildPlan(actor: RiwiActor, request: RiwiChatRequest, locale: Locale) {
  const target = request.targetUserId;
  const language = locale;
  const intent = assessRiwiIntent(request.message).intent;
  switch (intent) {
    case "dictionary_lookup": {
      const term = extractDictionaryTerm(request.message) ?? (request.dictionaryOccurrence ? undefined : request.message);
      return { kind: "tool" as const, toolName: "riwi.dictionary.lookup", capability: "riwi.dictionary.lookup" as const,
        input: { ...(term ? { term } : {}), language, ...(request.dictionaryOccurrence ? { occurrence: request.dictionaryOccurrence } : {}) },
        targetUserId: actor.id, riskClass: "read-only" as const };
    }
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
    case "course_lesson":
      return { kind: "course_lesson" as const, capability: "riwi.content.read" as const,
        query: request.message, riskClass: "read-only" as const };
    case "dictionary_explain":
      if (isCourseLessonRequest(request.message)) return { kind: "course_lesson" as const,
        capability: "riwi.content.read" as const, query: request.message, riskClass: "read-only" as const };
      if (isGrammarTopicRequest(request.message)) return { kind: "grammar_explanation" as const,
        capability: "riwi.chat.self" as const, query: grammarTopicQuery(request.message), riskClass: "read-only" as const };
      if (isCanonicalVocabularyExplanation(request.message)) return { kind: "approved_knowledge" as const,
        capability: "riwi.chat.self" as const, query: request.message, riskClass: "read-only" as const };
      return { kind: "provider" as const, capability: "riwi.chat.self" as const, riskClass: "outbound" as const };
    case "knowledge_query":
      return { kind: "approved_knowledge" as const, capability: "riwi.chat.self" as const, query: request.message, riskClass: "read-only" as const };
    case "educational_explanation":
      if (isCourseLessonRequest(request.message)) return { kind: "course_lesson" as const,
        capability: "riwi.content.read" as const, query: request.message, riskClass: "read-only" as const };
      return { kind: "provider" as const, capability: "riwi.chat.self" as const, riskClass: "outbound" as const };
    case "security_denial":
      return { kind: "safe" as const, code: "riwi_security_denial" as const,
        answer: riwiErrorMessage("riwi_security_denial", locale), errorCode: "riwi_security_denial" as const, riskClass: "read-only" as const };
    case "evaluate_writing":
      return { kind: "tool" as const, toolName: "riwi.coach.writing.evaluateLatestSelf", capability: "riwi.chat.self" as const,
        input: { language }, targetUserId: actor.id, riskClass: "outbound" as const };
    case "evaluate_speaking":
      return { kind: "tool" as const, toolName: "riwi.coach.speaking.evaluateLatestSelf", capability: "riwi.chat.self" as const,
        input: { language }, targetUserId: actor.id, riskClass: "outbound" as const };
    case "evaluate_grammar":
      return { kind: "tool" as const, toolName: "riwi.coach.grammar.evaluateLatestSelf", capability: "riwi.chat.self" as const,
        input: { language }, targetUserId: actor.id, riskClass: "outbound" as const };
    case "evaluate_vocabulary":
      return { kind: "tool" as const, toolName: "riwi.coach.vocabulary.evaluateLatestSelf", capability: "riwi.chat.self" as const,
        input: { language }, targetUserId: actor.id, riskClass: "outbound" as const };
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

type RiwiGrammarToolPlan = {
  kind: "tool";
  toolName: "riwi.grammar.topic.lookup";
  capability: "riwi.content.read";
  input: { query: string; language: Locale };
  targetUserId: string;
  riskClass: "read-only";
};
type RiwiExecutableToolPlan = Extract<ReturnType<typeof buildPlan>, { kind: "tool" }> | RiwiGrammarToolPlan;

async function executeToolPlan(input: {
  deps: RiwiGatewayDependencies;
  plan: RiwiExecutableToolPlan;
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
    const dictionaryEntry = riwiDictionaryResultSchema.parse({
      canonicalLexemeId: parsed.data.canonicalLexemeId, senseId: parsed.data.senseId, term: parsed.data.term,
      definitionEn: parsed.data.definitionEn, translationUz: parsed.data.translationUz, partOfSpeech: parsed.data.partOfSpeech,
      lexicalType: parsed.data.lexicalType, source: parsed.data.source, verified: parsed.data.verified,
      occurrence: parsed.data.occurrence,
    });
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: parsed.data.answer, uncertainty: parsed.data.uncertainty, dictionaryEntry,
      citations: [{ source: parsed.data.source.slice(0, 120), version: null }], provenance: "canonical_dictionary" });
  }

  if (input.plan.toolName.startsWith("riwi.coach.") && input.plan.toolName.endsWith(".evaluateLatestSelf")) {
    const parsed = riwiEvaluationToolResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_evaluation_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
        conversationId: input.conversationId, code: "riwi_evaluation_unavailable" });
    }
    if (parsed.data.status === "unavailable") {
      const code = parsed.data.reason === "no_saved_work" || parsed.data.reason === "input_too_short" || parsed.data.reason === "source_unavailable"
        ? "riwi_evaluation_source_missing" : "riwi_evaluation_unavailable";
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
        conversationId: input.conversationId, code });
    }
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: formatRiwiEvaluation(parsed.data.evaluation, parsed.data.sourceLabel, input.locale),
      citations: [{ source: parsed.data.sourceLabel.slice(0, 120), version: null }],
      provenance: "canonical_evaluation", evaluation: parsed.data.evaluation });
  }

  if (input.plan.toolName === "riwi.grammar.topic.lookup") {
    const parsed = grammarTopicResultSchema.safeParse(result.value);
    if (!parsed.success) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result", input.plan.targetUserId);
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_tool_failed" });
    }
    if (parsed.data.status === "unresolved") {
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
        conversationId: input.conversationId, code: "riwi_grammar_unavailable" });
    }
    const exerciseNote = input.locale === "uz"
      ? `\n\nGrammatika bo'limida sizga ko'rinadigan mashqlar: ${parsed.data.visibleExerciseCount}.`
      : `\n\nExercises visible to you in Grammar: ${parsed.data.visibleExerciseCount}.`;
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: `${parsed.data.title}\n${parsed.data.explanation}${exerciseNote}`,
      citations: [{ source: `Grammar topic: ${parsed.data.title}`, version: null }], provenance: "canonical_grammar" });
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
    const targetUserId = typeof input.plan.targetUserId === "string" ? input.plan.targetUserId : undefined;
    const report = formatReport(parsed.data.snapshot, input.actor, targetUserId, input.locale);
    if (!report) return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent, conversationId: input.conversationId, code: "riwi_scope_denied" });
    return answerBody({ ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
      answer: report.answer, reportSnapshot: report.snapshot, provenance: "deterministic_report" });
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

function answerFromApprovedKnowledge(input: {
  items: RetrievedKnowledge[];
  correlationId: string;
  conversationId: string;
  intent: RiwiIntent;
  locale: Locale;
}): RiwiChatResponse {
  const shown = input.items.slice(0, 3);
  const blocks = shown.map((item) => `${clean(item.title, 200)} (v${item.version})\n${clean(item.text, 1600)}`);
  const moreMatches = input.items.length > shown.length
    ? (input.locale === "uz" ? "\n\nYana tasdiqlangan manbalar mos keldi; aniqroq savol berib toraytiring." : "\n\nMore approved sources matched; ask a narrower question to focus the excerpts.")
    : "";
  return answerBody({
    ok: true, correlationId: input.correlationId, conversationId: input.conversationId, intent: input.intent,
    answer: [input.locale === "uz" ? "Tasdiqlangan o'quv materialidan:" : "Excerpt from approved learning material:", ...blocks].join("\n\n") + moreMatches,
    citations: shown.map((item) => ({ source: clean(item.title, 120), version: item.version })),
    provenance: "approved_knowledge",
  });
}

function directCourseLessonExcerpt(lesson: z.infer<typeof courseLessonResultSchema> & { status: "resolved" }, locale: Locale): string {
  return `${lesson.sourceTitle}\n\n${locale === "uz" ? "Ruxsat berilgan kurs darsidan parcha:" : "Excerpt from your authorized course lesson:"}\n${lesson.excerpt}`;
}

async function executeCourseLessonPlan(input: {
  deps: RiwiGatewayDependencies;
  plan: Extract<ReturnType<typeof buildPlan>, { kind: "course_lesson" }>;
  actor: RiwiActor;
  correlationId: string;
  signal: AbortSignal;
  locale: Locale;
  intent: RiwiIntent;
  requestMessage: string;
  conversationId?: string;
  rollout: RiwiRollout;
}): Promise<{ response: RiwiChatResponse; conversationId: string | null; scope: RiwiCourseLessonScope | null }> {
  const toolResult = await input.deps.callTool("riwi.course.lesson.read", { query: input.plan.query }, input.actor, input.correlationId, input.signal);
  if (!toolResult.ok) {
    return { response: failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      code: toolResult.code === "riwi_scope_denied" || toolResult.code === "riwi_permission_denied" ? "riwi_scope_denied" : "riwi_tool_failed" }),
      conversationId: null, scope: null };
  }
  const parsedLesson = courseLessonResultSchema.safeParse(toolResult.value);
  if (!parsedLesson.success) {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "tool_failure", "invalid_tool_result");
    return { response: failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      code: "riwi_tool_failed" }), conversationId: null, scope: null };
  }
  if (parsedLesson.data.status === "unresolved") {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "retrieval_failure", "no_authorized_course_match");
    return { response: failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      code: "riwi_knowledge_unavailable" }), conversationId: null, scope: null };
  }

  const lesson = parsedLesson.data;
  const scope: RiwiCourseLessonScope = { courseId: lesson.courseId, lessonId: lesson.lessonId };
  const opened = await input.deps.openConversation({ actor: { id: input.actor.id, role: input.actor.role }, locale: input.locale,
    courseLessonScope: scope, ...(input.conversationId ? { conversationId: input.conversationId } : {}) });
  const citation = [{ source: clean(lesson.sourceTitle, 120), version: null }];
  const fallback = (uncertainty: string | null = null) => answerBody({
    ok: true, correlationId: input.correlationId, conversationId: opened.id, intent: input.intent,
    answer: directCourseLessonExcerpt(lesson, input.locale), uncertainty, citations: citation, provenance: "course_lesson",
  });

  let externalEnabled = false;
  try { externalEnabled = input.rollout.externalAi && await input.deps.externalEnabled(); } catch { /* Direct excerpt remains safe. */ }
  if (!externalEnabled) {
    return { response: fallback(input.locale === "uz"
      ? "Avtomatik izoh mavjud emas; faqat ruxsatli dars manbasi ko'rsatildi."
      : "Automated explanation is unavailable; only the authorized lesson excerpt is shown."), conversationId: opened.id, scope };
  }

  const guarded = guardExternalPayload("chat", {
    language: input.locale,
    message: minimizeExternalText(input.requestMessage, 600),
    history: [],
    // Course source ids, actor ids, progress, notes, answer keys and unrelated
    // lessons never cross the provider boundary. Only one bounded relevant excerpt does.
    knowledge: [{ ref: "K1", text: minimizeExternalText(lesson.excerpt, 1800), authority: 100, version: null }],
  });
  if (!guarded.ok) {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "provider_failure", "invalid_request");
    return { response: fallback(input.locale === "uz" ? "Avtomatik izoh uchun matn xavfsiz tarzda uzatilmadi." : "The excerpt was not sent because the outbound privacy check rejected it."),
      conversationId: opened.id, scope };
  }

  let routed: RoutedRiwiAnswer;
  try {
    routed = await input.deps.routeProvider({ actor: { id: input.actor.id, role: input.actor.role }, correlationId: input.correlationId,
      payload: guarded.payload, profile: "riwi_chat", signal: input.signal });
  } catch { routed = { status: "external_unavailable", reason: "provider_error", providerId: null, model: null, durationMs: 0 }; }
  const parsedRoute = routedAnswerSchema.safeParse(routed);
  if (!parsedRoute.success) {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "provider_failure", "invalid_response");
    return { response: fallback(input.locale === "uz" ? "Tekshirilgan avtomatik izoh olinmadi; manba parchasi ko'rsatildi." : "No validated automated explanation was returned; the source excerpt is shown."),
      conversationId: opened.id, scope };
  }
  if (parsedRoute.data.status === "external_unavailable") {
    const reason = parsedRoute.data.reason;
    if (["timeout", "provider_error", "invalid_response"].includes(reason)) {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "provider_failure", reason);
    }
    return { response: fallback(input.locale === "uz" ? "Avtomatik izoh hozir mavjud emas; manba parchasi ko'rsatildi." : "Automated explanation is currently unavailable; the source excerpt is shown."),
      conversationId: opened.id, scope };
  }

  let registeredProvider = false;
  try { registeredProvider = input.deps.isRegisteredProvider(parsedRoute.data.providerId); } catch { /* Fail closed. */ }
  const citationsValid = parsedRoute.data.citations.length === 1 && parsedRoute.data.citations[0] === "K1";
  if (!registeredProvider || !citationsValid) {
    await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent, "provider_failure",
      registeredProvider ? "invalid_citation" : "unregistered_provider");
    return { response: fallback(input.locale === "uz" ? "Avtomatik javobning manba doirasi tekshirilmadi; manba parchasi ko'rsatildi." : "The automated answer did not stay within the authorized lesson citation; the source excerpt is shown."),
      conversationId: opened.id, scope };
  }
  return {
    response: answerBody({ ok: true, correlationId: input.correlationId, conversationId: opened.id, intent: input.intent,
      answer: minimizeExternalText(parsedRoute.data.answer, 6000), uncertainty: parsedRoute.data.uncertainty,
      citations: citation, provenance: "course_lesson", provider: { id: parsedRoute.data.providerId, model: parsedRoute.data.model } }),
    conversationId: opened.id, scope,
  };
}

async function executeApprovedLearningPlan(input: {
  deps: RiwiGatewayDependencies;
  plan: Extract<ReturnType<typeof buildPlan>, { kind: "approved_knowledge" | "grammar_explanation" }>;
  actor: RiwiActor;
  correlationId: string;
  signal: AbortSignal;
  locale: Locale;
  intent: RiwiIntent;
  conversationId: string;
  rollout: RiwiRollout;
}): Promise<RiwiChatResponse> {
  if (input.plan.kind === "approved_knowledge" && !input.rollout.knowledgeLearning) {
    return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      conversationId: input.conversationId, code: "riwi_knowledge_unavailable" });
  }
  if (input.rollout.knowledgeLearning) {
    let knowledge: RetrievedKnowledge[] = [];
    let retrievalFailed = false;
    try { knowledge = await input.deps.retrieveKnowledge(input.plan.query, input.actor); }
    catch { retrievalFailed = true; }
    if (knowledge.length > 0) return answerFromApprovedKnowledge({ items: knowledge, correlationId: input.correlationId,
      conversationId: input.conversationId, intent: input.intent, locale: input.locale });
    if (input.plan.kind === "approved_knowledge") {
      await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent,
        "retrieval_failure", retrievalFailed ? "retrieval_error" : "no_active_source");
      return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
        conversationId: input.conversationId, code: "riwi_knowledge_unavailable" });
    }
    if (retrievalFailed) await candidateFailureSignal(input.deps, input.actor, input.correlationId, input.intent,
      "retrieval_failure", "retrieval_error");
  }
  if (input.plan.kind === "approved_knowledge") {
    return failedAnswer({ correlationId: input.correlationId, locale: input.locale, intent: input.intent,
      conversationId: input.conversationId, code: "riwi_knowledge_unavailable" });
  }
  const grammarPlan: RiwiGrammarToolPlan = {
    kind: "tool", toolName: "riwi.grammar.topic.lookup", capability: "riwi.content.read",
    input: { query: input.plan.query, language: input.locale }, targetUserId: input.actor.id, riskClass: "read-only",
  };
  return executeToolPlan({ ...input, plan: grammarPlan });
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
  let courseLessonScope: RiwiCourseLessonScope | null = null;
  let dictionaryScope: RiwiDictionaryConversationScope | null = null;
  try {
    if (intent === "security_denial") {
      response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_security_denial", locale),
        errorCode: "riwi_security_denial", provenance: "policy_refusal" });
    } else if (parsed.data.targetUserId && !["progress_self", "report_self"].includes(intent)) {
      response = answerBody({ ok: false, correlationId, intent, answer: riwiErrorMessage("riwi_request_invalid", locale), errorCode: "riwi_request_invalid", provenance: "unavailable" });
    } else if (parsed.data.dictionaryOccurrence && intent !== "dictionary_lookup") {
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
          if (plan.kind === "course_lesson") {
            const course = await executeCourseLessonPlan({ deps, plan, actor, correlationId, signal: request.signal, locale, intent,
              requestMessage: parsed.data.message, ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}), rollout });
            response = course.response;
            conversationId = course.conversationId;
            courseLessonScope = course.scope;
          } else {
            const requestedDictionaryScope: RiwiDictionaryConversationScope | undefined = plan.kind === "tool" && plan.toolName === "riwi.dictionary.lookup"
              ? parsed.data.dictionaryOccurrence
                ? { kind: "occurrence", ...parsed.data.dictionaryOccurrence }
                : { kind: "canonical_term" }
              : undefined;
            const opened = await deps.openConversation({ actor: { id: actor.id, role: actor.role }, locale,
              ...(parsed.data.conversationId ? { conversationId: parsed.data.conversationId } : {}),
              ...(requestedDictionaryScope ? { dictionaryScope: requestedDictionaryScope } : {}) });
            conversationId = opened.id;
            if (plan.kind === "tool") {
            response = await executeToolPlan({ deps, plan, actor, correlationId, signal: request.signal, locale, intent, conversationId });
            if (requestedDictionaryScope && response.ok && response.provenance === "canonical_dictionary") dictionaryScope = requestedDictionaryScope;
          } else if (plan.kind === "approved_knowledge" || plan.kind === "grammar_explanation") {
            response = await executeApprovedLearningPlan({ deps, plan, actor, correlationId, signal: request.signal,
              locale, intent, conversationId, rollout });
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
    }

    if (conversationId) await deps.appendTurn({ actor: { id: actor.id, role: actor.role }, conversationId,
      userMessage: parsed.data.message, assistantMessage: response.answer,
      metadata: { correlationId, intent, providerId: response.provider?.id ?? null, model: response.provider?.model ?? null,
        fallbackUsed: response.evaluation?.fallbackUsed ?? false, externalEligible, provenance: response.provenance, citations: response.citations,
        ...(response.evaluation ? { evaluationId: response.evaluation.evaluationId,
          evaluationType: response.evaluation.evaluationType, evaluationValidationStatus: "validated" as const } : {}),
        reportSnapshot: response.reportSnapshot ?? null,
        scopeKind: courseLessonScope ? "course_lesson" : scopeKind ?? null,
        scopeTargetUserId: courseLessonScope ? null : scopeKind === "self" ? actor.id
          : "targetUserId" in plan && typeof plan.targetUserId === "string" ? plan.targetUserId : null,
        scopeCourseId: courseLessonScope?.courseId ?? null,
        scopeLessonId: courseLessonScope?.lessonId ?? null,
        dictionaryScope } });
    // Record success only after every required transcript write has completed, so feedback cannot attach to a failed delivery path.
    await deps.writeAudit({ actorUserId: actor.id, action: "riwi.request.completed", targetType: "riwi_request", targetId: correlationId,
      metadata: { correlationId, role: actor.role, intent, capability: "capability" in plan ? plan.capability : baseCapability,
        riskClass: plan.riskClass, ...(courseLessonScope ? { scopeKind: "course_lesson" as const }
          : scopeKind ? { scopeKind: scopeKind as RiwiAuditMetadata["scopeKind"] } : {}),
        answerSource: response.provenance, providerId: response.provider?.id, model: response.provider?.model ?? undefined,
        ...(response.evaluation ? { evaluationId: response.evaluation.evaluationId,
          evaluationType: response.evaluation.evaluationType, validationStatus: "validated" as const,
          fallbackUsed: response.evaluation.fallbackUsed } : {}),
        status: response.ok ? "succeeded" : "refused", resultCount: response.citations.length } });
    return { status: 200, body: riwiChatResponseSchema.parse(response), headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" } };
  } catch (error) {
    const code: RiwiErrorCode = error instanceof RiwiConversationError && error.code === "not_found" ? "riwi_scope_denied" : "riwi_tool_failed";
    await denyAudit(deps, actor, correlationId, error instanceof RiwiConversationError ? error.code : "request_failed");
    return chatFailure({ correlationId, locale, intent, code, conversationId, status: 503 });
  }
}
