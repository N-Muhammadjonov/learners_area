import "server-only";
import { db } from "@/db/client";
import { riwiUsageMetrics } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { effectiveCoachConfig } from "@/lib/services/coach/owner-control";
import { providerRegistry } from "@/lib/services/coach/registry";
import { riwiAnswerSchema } from "@/lib/services/coach/schema";
import type { CoachConfig } from "@/lib/services/coach/config";
import type { EvaluationProvider, RiwiProviderInput, RiwiProviderResult } from "@/lib/services/coach/types";
import { guardExternalPayload, redactExternalText } from "./outbound-guard";
import { recordRiwiAudit } from "./audit";
import { readRiwiRollout, type RiwiRollout } from "./rollout";
import { z } from "zod";
import { instructionTaskSchema, instructionTeachingSchema, type InstructionTaskKey, type TeachingContract } from "@/lib/services/coach/contracts/instruction-schema";
import { instructionContractTrace, formatInstructionTeaching } from "@/lib/services/coach/contracts/instruction-runtime";

export const RIWI_TASK_PROFILES = [
  "riwi_chat", "writing_high_stakes", "speaking_feedback", "grammar_feedback", "vocabulary_explanation",
  "translation_explanation", "owner_complex_analysis", "provider_benchmark", "fast_classification",
] as const;
export type RiwiTaskProfile = (typeof RIWI_TASK_PROFILES)[number];
const taskProfileSchema = z.enum(RIWI_TASK_PROFILES);
const ROUTER_SUPPORTED_PROFILES = new Set<RiwiTaskProfile>(["riwi_chat"]);
export const RIWI_ROUTER_TIMEOUT_MS = 25_000;

export type RoutedRiwiAnswer =
  | { status: "external_success"; answer: string; uncertainty: string | null; citations: string[]; providerId: string; model: string | null; durationMs: number; teachingContract?: TeachingContract }
  | { status: "external_unavailable"; reason: "disabled" | "policy_unavailable" | "not_configured" | "capability_missing" | "invalid_request" | "timeout" | "cancelled" | "invalid_response" | "provider_error"; providerId: string | null; model: string | null; durationMs: number };

type UsageInput = {
  actor: { id: string; role: Role };
  correlationId: string;
  taskProfile: RiwiTaskProfile;
  providerId: string | null;
  model: string | null;
  state: string;
  durationMs: number;
};
type AuditInput = Parameters<typeof recordRiwiAudit>[0];

export type RiwiProviderRouterDependencies = {
  readRollout: () => RiwiRollout;
  readConfig: () => Promise<CoachConfig>;
  getProvider: (providerId: string) => EvaluationProvider | null;
  secretPresent: (name: string) => boolean;
  writeAudit: (input: AuditInput) => Promise<void>;
  writeUsage: (input: UsageInput) => Promise<void>;
  now: () => number;
  timeoutMs: number;
};

const usageSchema = z.object({ inputTokens: z.number().int().nonnegative().nullable(), outputTokens: z.number().int().nonnegative().nullable() }).strict();
const providerFailureSchema = z.object({
  ok: z.literal(false),
  failure: z.object({
    reason: z.enum([
      "timeout", "network", "provider_error", "rate_limited", "auth_failed", "quota_exhausted",
      "invalid_response", "capability_missing", "not_configured", "provider_unavailable", "cancelled",
    ]),
    detail: z.string().max(500),
    retryable: z.boolean(),
  }).strict(),
  usage: usageSchema.optional(),
}).strict();
const providerResultSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), answer: riwiAnswerSchema, teaching: instructionTeachingSchema.optional(), usage: usageSchema.optional() }).strict(),
  providerFailureSchema,
]);

async function writeUsage(input: UsageInput): Promise<void> {
  try {
    await db.insert(riwiUsageMetrics).values({
      actorUserId: input.actor.id, actorRole: input.actor.role, taskProfile: input.taskProfile,
      providerId: input.providerId, model: input.model, state: input.state, durationMs: input.durationMs,
      inputTokens: null, outputTokens: null, estimatedCostMicros: null, correlationId: input.correlationId,
    });
  } catch {
    // Metrics are intentionally best-effort; the separately committed audit record remains the trace.
  }
}

function safeAnswer(value: string, maximum = 6000): string {
  return redactExternalText(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, " "), maximum).trim().slice(0, maximum);
}

function elapsed(started: number, now: number): number {
  return Math.max(0, Math.floor(now - started));
}

async function unavailable(input: {
  dependencies: RiwiProviderRouterDependencies;
  actor: { id: string; role: Role };
  correlationId: string;
  profile: RiwiTaskProfile;
  started: number;
  reason: Extract<RoutedRiwiAnswer, { status: "external_unavailable" }>["reason"];
  providerId: string | null;
  model: string | null;
}): Promise<RoutedRiwiAnswer> {
  const durationMs = elapsed(input.started, input.dependencies.now());
  await input.dependencies.writeAudit({ actorUserId: input.actor.id, action: "riwi.external.failed", targetType: "riwi_provider",
    targetId: input.providerId ?? undefined,
    metadata: { correlationId: input.correlationId, role: input.actor.role, providerId: input.providerId ?? undefined,
      model: input.model ?? undefined, taskProfile: input.profile, status: input.reason, durationMs } }).catch(() => {});
  await input.dependencies.writeUsage({ actor: input.actor, correlationId: input.correlationId, taskProfile: input.profile,
    providerId: input.providerId, model: input.model, state: input.reason, durationMs }).catch(() => {});
  return { status: "external_unavailable", reason: input.reason, providerId: input.providerId, model: input.model, durationMs };
}

const defaultDependencies: RiwiProviderRouterDependencies = {
  readRollout: readRiwiRollout,
  readConfig: effectiveCoachConfig,
  getProvider: (providerId) => providerRegistry.get(providerId)?.provider ?? null,
  secretPresent: (name) => Boolean(process.env[name]?.trim()),
  writeAudit: recordRiwiAudit,
  writeUsage,
  now: Date.now,
  timeoutMs: RIWI_ROUTER_TIMEOUT_MS,
};

/**
 * Task-profile boundary. This route accepts only the RIWI chat profile; dedicated
 * evaluation profiles are handled by the typed Coach resolver, never coerced
 * into a generic chat prompt. It never accepts a URL, secret, provider choice,
 * or raw application object from the request.
 */
export async function routeRiwiAnswer(
  input: {
    actor: { id: string; role: Role };
    correlationId: string;
    payload: RiwiProviderInput;
    profile?: RiwiTaskProfile;
    signal?: AbortSignal;
    instructionTask?: InstructionTaskKey;
  },
  overrides: Partial<RiwiProviderRouterDependencies> = {},
): Promise<RoutedRiwiAnswer> {
  const dependencies = { ...defaultDependencies, ...overrides };
  const started = dependencies.now();
  const parsedProfile = taskProfileSchema.safeParse(input.profile ?? "riwi_chat");
  const profile: RiwiTaskProfile = parsedProfile.success ? parsedProfile.data : "riwi_chat";
  if (input.instructionTask !== undefined && !instructionTaskSchema.safeParse(input.instructionTask).success) {
    return unavailable({ dependencies, ...input, started, profile, reason: "capability_missing", providerId: null, model: null });
  }
  if (!parsedProfile.success) {
    return unavailable({ dependencies, ...input, started, profile, reason: "invalid_request", providerId: null, model: null });
  }
  if (!ROUTER_SUPPORTED_PROFILES.has(profile)) {
    return unavailable({ dependencies, ...input, started, profile, reason: "capability_missing", providerId: null, model: null });
  }

  let rollout: RiwiRollout;
  try { rollout = dependencies.readRollout(); }
  catch {
    return unavailable({ dependencies, ...input, started, profile, reason: "policy_unavailable", providerId: null, model: null });
  }
  if (!rollout.enabled || !rollout.roles[input.actor.role] || !rollout.externalAi) {
    return unavailable({ dependencies, ...input, started, profile, reason: "disabled", providerId: null, model: null });
  }
  let config: CoachConfig;
  try { config = await dependencies.readConfig(); }
  catch {
    return unavailable({ dependencies, ...input, started, profile, reason: "policy_unavailable", providerId: null, model: null });
  }
  if (!config.externalEnabled) return unavailable({ dependencies, ...input, started, profile, reason: "disabled", providerId: null, model: null });
  const providerId = config.aiPrimaryProvider;
  const provider = dependencies.getProvider(providerId);
  const model = config.modelOverride ?? provider?.model ?? null;
  if (!provider || provider.type !== "external") {
    return unavailable({ dependencies, ...input, started, profile, reason: "not_configured", providerId, model });
  }
  if (!provider.capabilities.includes("riwi-assistant") || !provider.respondToRiwi) {
    return unavailable({ dependencies, ...input, started, profile, reason: "capability_missing", providerId, model });
  }
  if (input.instructionTask && !provider.capabilities.includes("instruction-teaching")) {
    return unavailable({ dependencies, ...input, started, profile, reason: "capability_missing", providerId, model });
  }
  let secretsReady: boolean;
  try { secretsReady = provider.requiredSecrets.every((name) => dependencies.secretPresent(name)); }
  catch {
    return unavailable({ dependencies, ...input, started, profile, reason: "policy_unavailable", providerId, model });
  }
  if (!secretsReady) return unavailable({ dependencies, ...input, started, profile, reason: "not_configured", providerId, model });
  const guarded = guardExternalPayload("chat", input.payload);
  if (!guarded.ok) return unavailable({ dependencies, ...input, started, profile, reason: "invalid_request", providerId, model });
  if (input.instructionTask === "grammar.explanation" && (guarded.payload.history.length !== 0
    || guarded.payload.knowledge.length !== 1 || guarded.payload.knowledge[0]?.ref !== "K1"))
    return unavailable({ dependencies, ...input, started, profile, reason: "invalid_request", providerId, model });
  if (input.signal?.aborted) return unavailable({ dependencies, ...input, started, profile, reason: "cancelled", providerId, model });

  try {
    await dependencies.writeAudit({ actorUserId: input.actor.id, action: "riwi.external.requested", targetType: "riwi_provider", targetId: providerId,
      metadata: { correlationId: input.correlationId, role: input.actor.role, providerId, model: model ?? undefined, taskProfile: profile, status: "requested" } });
  } catch {
    // If we cannot audit an outbound request, do not send it.
    return unavailable({ dependencies, ...input, started, profile, reason: "provider_error", providerId, model });
  }

  const controller = new AbortController();
  let timeoutHit = false;
  let requestCancelled = false;
  let rejectCancellation: ((reason?: unknown) => void) | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => { timeoutHit = true; controller.abort(); reject(new Error("riwi_provider_timeout")); }, dependencies.timeoutMs);
  });
  const cancelled = input.signal
    ? new Promise<never>((_, reject) => { rejectCancellation = reject; })
    : new Promise<never>(() => {});
  const abort = () => {
    requestCancelled = true;
    controller.abort();
    rejectCancellation?.(new Error("riwi_request_cancelled"));
  };
  input.signal?.addEventListener("abort", abort, { once: true });
  let outcome: RiwiProviderResult | null = null;
  try {
    const call = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error("riwi_request_cancelled");
      return provider.respondToRiwi!({
        userId: "external-anonymous", language: guarded.payload.language,
        model: model ?? undefined, signal: controller.signal,
        ...(input.instructionTask ? { instructionTask: input.instructionTask } : {}),
      }, guarded.payload);
    });
    outcome = await Promise.race([call, timeout, cancelled]);
  } catch {
    outcome = null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", abort);
  }

  const durationMs = elapsed(started, dependencies.now());
  if (requestCancelled) return unavailable({ dependencies, ...input, started, profile, reason: "cancelled", providerId, model });
  if (timeoutHit) return unavailable({ dependencies, ...input, started, profile, reason: "timeout", providerId, model });
  const parsedOutcome = providerResultSchema.safeParse(outcome);
  if (!parsedOutcome.success) return unavailable({ dependencies, ...input, started, profile, reason: "invalid_response", providerId, model });
  if (!parsedOutcome.data.ok) {
    const providerReason = parsedOutcome.data.failure.reason;
    const reason = providerReason === "cancelled" ? "cancelled"
      : providerReason === "timeout" ? "timeout"
        : providerReason === "invalid_response" ? "invalid_response"
          : providerReason === "not_configured" ? "not_configured"
            : providerReason === "capability_missing" ? "capability_missing" : "provider_error";
    return unavailable({ dependencies, ...input, started, profile, reason, providerId, model });
  }

  const citations = parsedOutcome.data.answer.citations.filter((ref) => guarded.payload.knowledge.some((item) => item.ref === ref));
  if (input.instructionTask === "grammar.explanation" && (citations.length !== 1 || citations[0] !== "K1"))
    return unavailable({ dependencies, ...input, started, profile, reason: "invalid_response", providerId, model });
  if (citations.length !== parsedOutcome.data.answer.citations.length) {
    return unavailable({ dependencies, ...input, started, profile, reason: "invalid_response", providerId, model });
  }
  // Validate steps here too. An adapter's capability declaration alone cannot
  // turn an arbitrary answer into proof that the selected task was executed.
  const teachingAnswer = input.instructionTask
    ? formatInstructionTeaching(input.instructionTask, parsedOutcome.data.teaching, guarded.payload.language)
    : parsedOutcome.data.teaching ? null : parsedOutcome.data.answer.answer;
  if (!teachingAnswer) return unavailable({ dependencies, ...input, started, profile, reason: "invalid_response", providerId, model });
  const answer = safeAnswer(teachingAnswer);
  if (!answer) return unavailable({ dependencies, ...input, started, profile, reason: "invalid_response", providerId, model });
  try {
    await dependencies.writeAudit({ actorUserId: input.actor.id, action: "riwi.external.succeeded", targetType: "riwi_provider", targetId: providerId,
      metadata: { correlationId: input.correlationId, role: input.actor.role, providerId, model: model ?? undefined, taskProfile: profile, status: "succeeded", durationMs, resultCount: citations.length } });
  } catch {
    // The result is withheld if its completion cannot be traced.
    return unavailable({ dependencies, ...input, started, profile, reason: "provider_error", providerId, model });
  }
  await dependencies.writeUsage({ actor: input.actor, correlationId: input.correlationId, taskProfile: profile,
    providerId, model, state: "succeeded", durationMs }).catch(() => {});
  return {
    status: "external_success", answer,
    uncertainty: parsedOutcome.data.answer.uncertainty ? safeAnswer(parsedOutcome.data.answer.uncertainty, 600) : null,
    citations, providerId, model, durationMs,
    ...(input.instructionTask ? { teachingContract: instructionContractTrace(input.instructionTask) } : {}),
  };
}
