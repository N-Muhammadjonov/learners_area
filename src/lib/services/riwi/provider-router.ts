import "server-only";
import { db } from "@/db/client";
import { riwiUsageMetrics } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import { effectiveCoachConfig } from "@/lib/services/coach/owner-control";
import { providerRegistry } from "@/lib/services/coach/registry";
import { riwiAnswerSchema } from "@/lib/services/coach/schema";
import type { RiwiProviderInput } from "@/lib/services/coach/types";
import { guardExternalPayload, redactExternalText } from "./outbound-guard";
import { recordRiwiAudit } from "./audit";
import { readRiwiRollout } from "./rollout";

export type RiwiTaskProfile = "riwi_chat" | "writing_high_stakes" | "speaking_feedback" | "grammar_feedback" | "vocabulary_explanation" | "translation_explanation" | "owner_complex_analysis" | "provider_benchmark" | "fast_classification";

export type RoutedRiwiAnswer =
  | { status: "external_success"; answer: string; uncertainty: string | null; citations: string[]; providerId: string; model: string | null; durationMs: number }
  | { status: "external_unavailable"; reason: "disabled" | "not_configured" | "capability_missing" | "invalid_request" | "timeout" | "cancelled" | "invalid_response" | "provider_error"; providerId: string | null; model: string | null; durationMs: number };

async function usage(input: { actor: { id: string; role: Role }; correlationId: string; taskProfile: RiwiTaskProfile; providerId: string | null; model: string | null; state: string; durationMs: number }) {
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

async function unavailable(input: {
  actor: { id: string; role: Role };
  correlationId: string;
  profile: RiwiTaskProfile;
  started: number;
  reason: Extract<RoutedRiwiAnswer, { status: "external_unavailable" }>['reason'];
  providerId: string | null;
  model: string | null;
}): Promise<RoutedRiwiAnswer> {
  const durationMs = Date.now() - input.started;
  await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.external.failed", targetType: "riwi_provider",
    targetId: input.providerId ?? undefined,
    metadata: { correlationId: input.correlationId, role: input.actor.role, providerId: input.providerId ?? undefined,
      model: input.model ?? undefined, taskProfile: input.profile, status: input.reason, durationMs } }).catch(() => {});
  await usage({ actor: input.actor, correlationId: input.correlationId, taskProfile: input.profile,
    providerId: input.providerId, model: input.model, state: input.reason, durationMs });
  return { status: "external_unavailable", reason: input.reason, providerId: input.providerId, model: input.model, durationMs };
}

/** Task-profile boundary. It never accepts a URL, secret, provider choice, or raw application object. */
export async function routeRiwiAnswer(input: {
  actor: { id: string; role: Role };
  correlationId: string;
  payload: RiwiProviderInput;
  profile?: RiwiTaskProfile;
  signal?: AbortSignal;
}): Promise<RoutedRiwiAnswer> {
  const started = Date.now();
  const profile = input.profile ?? "riwi_chat";
  const rollout = readRiwiRollout();
  const config = await effectiveCoachConfig();
  if (!rollout.externalAi || !config.externalEnabled) {
    return unavailable({ ...input, started, profile, reason: "disabled", providerId: null, model: null });
  }
  const providerId = config.aiPrimaryProvider;
  const registration = providerRegistry.get(providerId);
  const provider = registration?.provider;
  const model = config.modelOverride ?? provider?.model ?? null;
  if (!provider || provider.type !== "external") {
    return unavailable({ ...input, started, profile, reason: "not_configured", providerId, model });
  }
  if (!provider.capabilities.includes("riwi-assistant") || !provider.respondToRiwi) {
    return unavailable({ ...input, started, profile, reason: "capability_missing", providerId, model });
  }
  if (provider.requiredSecrets.some((name) => !process.env[name]?.trim())) {
    return unavailable({ ...input, started, profile, reason: "not_configured", providerId, model });
  }
  const guarded = guardExternalPayload("chat", input.payload);
  if (!guarded.ok) return unavailable({ ...input, started, profile, reason: "invalid_request", providerId, model });
  if (input.signal?.aborted) return unavailable({ ...input, started, profile, reason: "cancelled", providerId, model });

  try {
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.external.requested", targetType: "riwi_provider", targetId: providerId,
      metadata: { correlationId: input.correlationId, role: input.actor.role, providerId, model: model ?? undefined, taskProfile: profile, status: "requested" } });
  } catch {
    // If we cannot audit an outbound request, do not send it.
    return unavailable({ ...input, started, profile, reason: "provider_error", providerId, model });
  }

  const controller = new AbortController();
  let timeoutHit = false;
  let requestCancelled = false;
  let rejectCancellation: ((reason?: unknown) => void) | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => { timeoutHit = true; controller.abort(); reject(new Error("riwi_provider_timeout")); }, 25_000);
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
  let outcome: Awaited<ReturnType<NonNullable<typeof provider.respondToRiwi>>> | null = null;
  try {
    const call = Promise.resolve().then(() => {
      if (controller.signal.aborted) throw new Error("riwi_request_cancelled");
      return provider.respondToRiwi!({
        userId: "external-anonymous", language: input.payload.language,
        model: model ?? undefined, signal: controller.signal,
      }, guarded.payload);
    });
    outcome = await Promise.race([call, timeout, cancelled]);
  } catch {
    outcome = null;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    input.signal?.removeEventListener("abort", abort);
  }

  const durationMs = Date.now() - started;
  if (requestCancelled) return unavailable({ ...input, started, profile, reason: "cancelled", providerId, model });
  if (!outcome?.ok) {
    const reason = timeoutHit ? "timeout" : outcome?.failure.reason === "invalid_response" ? "invalid_response" : "provider_error";
    return unavailable({ ...input, started, profile, reason, providerId, model });
  }
  const parsedAnswer = riwiAnswerSchema.safeParse(outcome.answer);
  if (!parsedAnswer.success) return unavailable({ ...input, started, profile, reason: "invalid_response", providerId, model });

  const citations = parsedAnswer.data.citations.filter((ref) => guarded.payload.knowledge.some((item) => item.ref === ref));
  if (citations.length !== parsedAnswer.data.citations.length) {
    return unavailable({ ...input, started, profile, reason: "invalid_response", providerId, model });
  }
  const answer = safeAnswer(parsedAnswer.data.answer);
  if (!answer) return unavailable({ ...input, started, profile, reason: "invalid_response", providerId, model });
  try {
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.external.succeeded", targetType: "riwi_provider", targetId: providerId,
      metadata: { correlationId: input.correlationId, role: input.actor.role, providerId, model: model ?? undefined, taskProfile: profile, status: "succeeded", durationMs, resultCount: citations.length } });
  } catch {
    // The result is withheld if its completion cannot be traced.
    return unavailable({ ...input, started, profile, reason: "provider_error", providerId, model });
  }
  await usage({ actor: input.actor, correlationId: input.correlationId, taskProfile: profile, providerId, model, state: "succeeded", durationMs });
  return { status: "external_success", answer, uncertainty: parsedAnswer.data.uncertainty ? safeAnswer(parsedAnswer.data.uncertainty, 600) : null, citations, providerId, model, durationMs };
}
