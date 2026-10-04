import "server-only";
import { and, desc, eq, gte, like } from "drizzle-orm";
import { z, type ZodTypeAny } from "zod";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { getDueVocabulary, getWeaknessSummary } from "@/lib/data/coach-dashboard";
import { ownerAiStatus } from "@/lib/services/coach/owner-control";
import { isOnRoster } from "@/lib/reporter/roster";
import { PERIOD_KINDS } from "@/lib/reporter/period";
import { resolveUserScope, ROLE_CAPABILITIES, authorizeCapability, type RiwiActor, type RiwiCapability, type ScopeDecision, type ScopeDependencies } from "./capabilities";
import { formatDictionaryAnswer, lookupCanonicalDictionary } from "./dictionary";
import { buildRiwiReport, riwiReportResultSchema, type RiwiReportRequest } from "./reports";
import { RiwiToolBroker, type RiwiRiskClass, type RiwiToolHandler } from "./tool-broker";
import { RIWI_AUDIT_ACTIONS, recordRiwiAudit } from "./audit";

const UUID = z.string().uuid();
const actorRoles: readonly Role[] = ["student", "teacher", "admin", "owner"];

export function createRiwiCoreTools(database: typeof db = db): RiwiToolBroker {
  const scopeDependencies: ScopeDependencies = {
    subjectRole: async (userId) => {
      const subject = await database.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { role: true, accountStatus: true },
      });
      return subject?.accountStatus === "active" ? subject.role as Role : null;
    },
    isAssigned: (teacherId, studentId) => isOnRoster(teacherId, studentId, database),
  };

  function rolesFor(capability: RiwiCapability): Role[] {
    return actorRoles.filter((role) => ROLE_CAPABILITIES[role].includes(capability));
  }

  const broker = new RiwiToolBroker((input) => recordRiwiAudit(input, database));

function register<I extends ZodTypeAny, O extends ZodTypeAny>(input: {
  name: string;
  description: string;
  capability: RiwiCapability;
  inputSchema: I;
  outputSchema: O;
  timeoutMs?: number;
  roles?: readonly Role[];
  scope: (actor: RiwiActor, value: z.infer<I>) => Promise<ScopeDecision>;
}, handler: RiwiToolHandler<I, O>) {
  const riskClass: RiwiRiskClass = "read-only";
  broker.register({
    name: input.name,
    version: "1.0.0",
    description: input.description,
    capability: input.capability,
    riskClass,
    inputSchema: input.inputSchema,
    outputSchema: input.outputSchema,
    timeoutMs: input.timeoutMs ?? 10_000,
    idempotencyMode: "none",
    auditMode: "required",
    externalDataClass: "none",
    allowedRoles: input.roles ?? rolesFor(input.capability),
    rowScopeResolver: input.scope,
    confirmationRequired: false,
  }, handler);
}

const emptyInput = z.object({}).strict();
const dictionaryInput = z.object({ term: z.string().trim().min(1).max(120), language: z.enum(["en", "uz"]).default("en") }).strict();
const dictionaryOutput = z.discriminatedUnion("status", [
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

register({
  name: "riwi.dictionary.lookup",
  description: "Look up a word in the canonical Learners Area dictionary; exam-time locks are enforced server-side.",
  capability: "riwi.dictionary.lookup", inputSchema: dictionaryInput, outputSchema: dictionaryOutput, timeoutMs: 8_000,
  scope: (actor) => resolveUserScope(actor, "riwi.dictionary.lookup", actor.id, scopeDependencies),
}, async (input, { actor }) => {
  const entry = await lookupCanonicalDictionary(input.term, actor, database);
  if (entry.status !== "resolved") return entry;
  return { ...entry, ...formatDictionaryAnswer(entry, input.language) };
});

const weaknessSchema = z.object({
  category: z.string().max(80), label: z.string().max(160), area: z.string().max(80),
  occurrenceCount: z.number().int().nonnegative(), recentSeverity: z.string().max(40),
  status: z.enum(["open", "improving", "resolved"]), lastSeenAt: z.string().datetime(),
}).strict();
const vocabularySchema = z.object({
  term: z.string().max(160), definition: z.string().max(1500), state: z.string().max(40), nextReviewAt: z.string().datetime(),
}).strict();
const progressOutput = z.object({ weaknesses: z.array(weaknessSchema).max(100), dueVocabulary: z.array(vocabularySchema).max(20) }).strict();
const assignedProgressInput = z.object({ targetUserId: UUID }).strict();

async function progressFor(userId: string, limit: number) {
  const [weaknesses, vocabulary] = await Promise.all([getWeaknessSummary(userId, database), getDueVocabulary(userId, limit, database)]);
  return {
    weaknesses: weaknesses.slice(0, 100).map((item) => ({
      category: item.category, label: item.label, area: item.area,
      occurrenceCount: item.occurrenceCount, recentSeverity: item.recentSeverity,
      status: item.status, lastSeenAt: item.lastSeenAt.toISOString(),
    })),
    dueVocabulary: vocabulary.map((item) => ({
      term: item.term, definition: item.definitionEn, state: item.state, nextReviewAt: item.nextReviewAt.toISOString(),
    })),
  };
}

register({
  name: "riwi.learning.progress.readSelf",
  description: "Read the authenticated student's own weakness and due-vocabulary summary.",
  capability: "riwi.progress.read_self", inputSchema: emptyInput, outputSchema: progressOutput, timeoutMs: 10_000,
  roles: ["student"],
  scope: (actor) => resolveUserScope(actor, "riwi.progress.read_self", actor.id, scopeDependencies),
}, async (_input, { actor }) => progressFor(actor.id, 10));

register({
  name: "riwi.learning.progress.readAssigned",
  description: "Read one active student's learning summary only when that student is on the authenticated teacher's explicit roster.",
  capability: "riwi.progress.read_assigned", inputSchema: assignedProgressInput, outputSchema: progressOutput, timeoutMs: 10_000,
  roles: ["teacher", "owner"],
  scope: (actor, input) => resolveUserScope(actor, "riwi.progress.read_assigned", input.targetUserId, scopeDependencies),
}, async (_input, { actor, scope }) => {
  if (!scope.allowed || scope.kind !== "assigned") throw new Error("riwi_scope_denied");
  const targetUserId = scope.userIds[0];
  // Re-check after capability resolution to narrow the roster-change TOCTOU window.
  if ((actor.role !== "teacher" && actor.role !== "owner")
    || (actor.role === "teacher" && !(await isOnRoster(actor.id, targetUserId, database)))
    || await scopeDependencies.subjectRole(targetUserId) !== "student") {
    throw new Error("riwi_scope_denied");
  }
  return progressFor(targetUserId, 10);
});

const periodFields = {
  period: z.enum(PERIOD_KINDS).default("on_demand"),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  language: z.enum(["en", "uz"]).default("en"),
};
const reportSelfInput = z.object(periodFields).strict();
const reportAssignedInput = z.object({ ...periodFields, targetUserId: UUID.optional() }).strict();
const reportAdminInput = z.object({ ...periodFields, targetUserId: UUID.optional() }).strict();
const reportResultSchema = riwiReportResultSchema;

function reportRequest(input: { period: (typeof PERIOD_KINDS)[number]; from?: string; to?: string }, scope: ScopeKind, subjectId?: string): RiwiReportRequest {
  return { scope, subjectId, period: input.period, from: input.from, to: input.to };
}

type ScopeKind = "owner" | "teacher" | "student";

async function reportOutput(input: { actor: RiwiActor; request: RiwiReportRequest; language: "en" | "uz" }) {
  const result = await buildRiwiReport({ actor: input.actor, request: input.request }, database);
  if (!result.ok) return { status: "unavailable" as const, reason: result.code === "invalid_period" ? "invalid_period" as const : result.code === "generation_failed" ? "generation_failed" as const : "not_available" as const };
  return riwiReportResultSchema.parse({ status: "ready", snapshot: result.snapshot });
}

register({
  name: "riwi.report.readSelf",
  description: "Build the student's deterministic, on-demand personal learning report from the canonical Reporter SQL snapshot.",
  capability: "riwi.report.read_self", inputSchema: reportSelfInput, outputSchema: reportResultSchema, timeoutMs: 25_000,
  roles: ["student"],
  scope: (actor) => resolveUserScope(actor, "riwi.report.read_self", actor.id, scopeDependencies),
}, async (input, { actor }) => reportOutput({ actor, request: reportRequest(input, "student"), language: input.language }));

register({
  name: "riwi.report.readAssigned",
  description: "Build a deterministic report for one explicitly assigned student or for the authenticated teacher's own roster.",
  capability: "riwi.report.read_assigned", inputSchema: reportAssignedInput, outputSchema: reportResultSchema, timeoutMs: 30_000,
  roles: ["teacher", "owner"],
  scope: async (actor, input) => {
    if (input.targetUserId) return resolveUserScope(actor, "riwi.report.read_assigned", input.targetUserId, scopeDependencies);
    if (actor.role === "teacher" && authorizeCapability(actor, "riwi.report.read_assigned").allowed) {
      return { allowed: true, kind: "roster", userIds: [actor.id] };
    }
    return { allowed: false, reason: "not_found" };
  },
}, async (input, { actor }) => reportOutput({
  actor,
  request: input.targetUserId ? reportRequest(input, "student", input.targetUserId) : reportRequest(input, "teacher"),
  language: input.language,
}));

register({
  name: "riwi.report.readAdminScope",
  description: "Build the admin-policy cohort report or an authorized single-student report; never exposes the owner-only centre report.",
  capability: "riwi.report.read_admin_scope", inputSchema: reportAdminInput, outputSchema: reportResultSchema, timeoutMs: 30_000,
  roles: ["admin", "owner"],
  scope: async (actor, input) => {
    if (!authorizeCapability(actor, "riwi.report.read_admin_scope").allowed) return { allowed: false, reason: "scope_denied" };
    if (!input.targetUserId) return { allowed: true, kind: "admin", userIds: null };
    const role = await scopeDependencies.subjectRole(input.targetUserId);
    return role === "student"
      ? { allowed: true, kind: "admin-subject", userIds: [input.targetUserId] }
      : { allowed: false, reason: "not_found" };
  },
}, async (input, { actor }) => reportOutput({
  actor,
  request: input.targetUserId ? reportRequest(input, "student", input.targetUserId) : reportRequest(input, "teacher"),
  language: input.language,
}));

register({
  name: "riwi.report.readGlobal",
  description: "Build the owner-only deterministic centre report with operational metrics.",
  capability: "riwi.report.read_global", inputSchema: reportSelfInput, outputSchema: reportResultSchema, timeoutMs: 30_000,
  roles: ["owner"],
  scope: (actor) => resolveUserScope(actor, "riwi.report.read_global", undefined, scopeDependencies),
}, async (input, { actor }) => reportOutput({ actor, request: reportRequest(input, "owner"), language: input.language }));

const providerStatusOutput = z.object({
  deploymentCeiling: z.boolean(), externalEnabled: z.boolean(), providerId: z.string().max(100),
  providerIsExternal: z.boolean(), ready: z.boolean(), model: z.string().max(160).nullable(), fallback: z.enum(["riwi", "none"]),
  providers: z.array(z.object({
    id: z.string().max(100), displayName: z.string().max(120), type: z.enum(["internal", "external"]),
    model: z.string().max(160).nullable(), capabilities: z.array(z.string().max(100)).max(50),
    secretsPresent: z.boolean(), missingSecretNames: z.array(z.string().max(100)).max(20),
  }).strict()).max(50),
  configIssues: z.array(z.object({ index: z.number().int().nonnegative(), reason: z.string().max(120) }).strict()).max(100),
}).strict();

register({
  name: "riwi.provider.status",
  description: "Read owner-only RIWI provider readiness and configuration diagnostics; never returns credentials or endpoint URLs.",
  capability: "riwi.provider.read_status", inputSchema: emptyInput, outputSchema: providerStatusOutput, timeoutMs: 10_000,
  roles: ["owner"],
  scope: async (actor) => actor.role === "owner" && authorizeCapability(actor, "riwi.provider.read_status").allowed
    ? { allowed: true, kind: "global", userIds: null }
    : { allowed: false, reason: "scope_denied" },
}, async () => {
  const status = await ownerAiStatus(undefined, database);
  return {
    deploymentCeiling: status.deploymentCeiling,
    externalEnabled: status.effective.externalEnabled,
    providerId: status.effective.providerId,
    providerIsExternal: status.effective.providerIsExternal,
    ready: status.effective.ready,
    model: status.effective.model,
    fallback: status.effective.fallback,
    providers: status.providers.map(({ id, displayName, type, model, capabilities, secretsPresent, missingSecretNames }) => ({
      id, displayName, type, model, capabilities, secretsPresent, missingSecretNames,
    })),
    configIssues: status.configIssues,
  };
});

const auditInput = z.object({
  action: z.enum(RIWI_AUDIT_ACTIONS).optional(),
  days: z.number().int().min(1).max(90).default(30),
  limit: z.number().int().min(1).max(100).default(25),
}).strict();
const auditOutput = z.object({
  events: z.array(z.object({
    id: z.string().uuid(), actorUserId: z.string().uuid().nullable(), action: z.string().max(80),
    targetType: z.string().max(40).nullable(), targetId: z.string().max(80).nullable(), createdAt: z.string().datetime(),
    role: z.string().max(20).nullable(), capability: z.string().max(80).nullable(), toolName: z.string().max(80).nullable(),
    status: z.string().max(40).nullable(), providerId: z.string().max(60).nullable(), taskProfile: z.string().max(60).nullable(),
    scopeKind: z.string().max(20).nullable(), correlationId: z.string().uuid().nullable(), durationMs: z.number().int().nullable(),
  }).strict()).max(100),
}).strict();

register({
  name: "riwi.audit.search",
  description: "Search recent RIWI audit metadata only; owner-only and bounded to 90 days and 100 events.",
  capability: "riwi.audit.read_owner", inputSchema: auditInput, outputSchema: auditOutput, timeoutMs: 10_000,
  roles: ["owner"],
  scope: async (actor) => actor.role === "owner" && authorizeCapability(actor, "riwi.audit.read_owner").allowed
    ? { allowed: true, kind: "global", userIds: null }
    : { allowed: false, reason: "scope_denied" },
}, async (input) => {
  const filters = [like(auditLog.action, "riwi.%"), gte(auditLog.createdAt, new Date(Date.now() - input.days * 86_400_000))];
  if (input.action) filters.push(eq(auditLog.action, input.action));
  const rows = await database.select({
    id: auditLog.id, actorUserId: auditLog.actorUserId, action: auditLog.action,
    targetType: auditLog.targetType, targetId: auditLog.targetId, metadata: auditLog.metadata, createdAt: auditLog.createdAt,
  }).from(auditLog).where(and(...filters)).orderBy(desc(auditLog.createdAt)).limit(input.limit);
  return {
    events: rows.map((row) => {
      const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const text = (key: string, max: number) => typeof metadata[key] === "string" ? (metadata[key] as string).slice(0, max) : null;
      const integer = (key: string) => typeof metadata[key] === "number" && Number.isInteger(metadata[key]) ? metadata[key] as number : null;
      return {
        id: row.id, actorUserId: row.actorUserId, action: row.action,
        targetType: row.targetType, targetId: row.targetId, createdAt: row.createdAt.toISOString(),
        role: text("role", 20), capability: text("capability", 80), toolName: text("toolName", 80),
        status: text("status", 40), providerId: text("providerId", 60), taskProfile: text("taskProfile", 60),
        scopeKind: text("scopeKind", 20), correlationId: text("correlationId", 36), durationMs: integer("durationMs"),
      };
    }),
  };
});
  return broker;
}

export const riwiToolBroker = createRiwiCoreTools();
