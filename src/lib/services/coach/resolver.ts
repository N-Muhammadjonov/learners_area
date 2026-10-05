import "server-only";
import { guardExternalPayload } from "@/lib/services/riwi/outbound-guard";
import { RIWI_PROVIDER_ID, readCoachConfig, type CoachConfig } from "./config";
import { providerRegistry } from "./registry";
import { assessmentContractForRequest, assessmentContractKeyForRequest, getAssessmentContract } from "./contracts/registry";
import { applyOwnerOverlayToOutput, validateAssessmentOutput } from "./contracts/compose";
import { getApprovedOwnerPolicyForContract } from "./contracts/owner-policy";
import type { AssessmentContractKey } from "./contracts/types";
import {
  buildCheckedBy,
  evaluationResultSchema,
  providerEvaluationOutputSchema,
  type EvaluationResult,
  type WritingAnalysis,
  type EvaluationType,
  type ProviderCapability,
  type ProviderEvaluationOutput,
} from "./schema";
import {
  providerFail,
  type AssignmentEvaluationInput,
  type EvaluationContext,
  type EvaluationProvider,
  type GrammarEvaluationInput,
  type ProviderAttempt,
  type ProviderFailure,
  type ProviderResult,
  type SpeakingEvaluationInput,
  type VocabularyEvaluationInput,
  type WritingEvaluationInput,
} from "./types";

export type CoachEvaluationError =
  | "evaluation_unavailable"
  | "capability_unsupported"
  | "invalid_evaluation"
  /** fallback "none": the configured evaluator is RIWI or not installed. */
  | "external_required";

/**
 * "riwi" (default): any external failure falls back to RIWI, as before.
 * "none": an external result or nothing — Grade My Work must never present
 * RIWI as AI. Other Coach features keep the default.
 */
export type ResolvePolicy = { fallback: "riwi" | "none" };

export type ResolveExtras = { writingAnalysis?: WritingAnalysis };

export type ResolveOutcome =
  | { ok: true; result: EvaluationResult; attempts: ProviderAttempt[]; extras: ResolveExtras }
  | { ok: false; error: CoachEvaluationError; attempts: ProviderAttempt[] };

export type EvaluationRequest =
  | { evaluationType: "writing"; input: WritingEvaluationInput; assessmentContractKey?: AssessmentContractKey }
  | { evaluationType: "speaking"; input: SpeakingEvaluationInput; assessmentContractKey?: AssessmentContractKey }
  | { evaluationType: "grammar"; input: GrammarEvaluationInput; assessmentContractKey?: AssessmentContractKey }
  | { evaluationType: "vocabulary"; input: VocabularyEvaluationInput; assessmentContractKey?: AssessmentContractKey }
  | { evaluationType: "assignment"; input: AssignmentEvaluationInput; assessmentContractKey?: AssessmentContractKey };

const CAPABILITY_BY_TYPE: Record<EvaluationType, ProviderCapability> = {
  writing: "writing-evaluation",
  speaking: "speaking-evaluation",
  grammar: "grammar-evaluation",
  vocabulary: "vocabulary-evaluation",
  assignment: "assignment-evaluation",
};

/** Retryable failures are the transient ones. Everything else falls back at once. */
const RETRYABLE: ReadonlySet<ProviderFailure["reason"]> = new Set([
  "timeout",
  "network",
  "provider_error",
  "rate_limited",
  "provider_unavailable",
]);

export class ProviderTimeoutError extends Error {
  constructor() {
    super("provider_call_timed_out");
    this.name = "ProviderTimeoutError";
  }
}

async function withTimeout<T>(work: Promise<T>, ms: number, signal: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          signal.abort();
          reject(new ProviderTimeoutError());
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Privacy: an external adapter receives no local user id, no email, no
 * Telegram handle — only the text (or transcript) the task genuinely needs.
 */
function externalContext(ctx: EvaluationContext, signal: AbortSignal): EvaluationContext {
  return {
    userId: "external-anonymous",
    language: ctx.language,
    signal,
    ...(ctx.model ? { model: ctx.model } : {}),
    ...(ctx.assessmentContract ? { assessmentContract: ctx.assessmentContract } : {}),
  };
}

async function invoke(
  provider: EvaluationProvider,
  request: EvaluationRequest,
  ctx: EvaluationContext
): Promise<ProviderResult> {
  switch (request.evaluationType) {
    case "writing":
      if (!provider.evaluateWriting) return providerFail("capability_missing", "evaluateWriting");
      return provider.evaluateWriting(ctx, request.input);
    case "speaking":
      if (!provider.evaluateSpeaking) return providerFail("capability_missing", "evaluateSpeaking");
      return provider.evaluateSpeaking(ctx, request.input);
    case "grammar":
      if (!provider.evaluateGrammar) return providerFail("capability_missing", "evaluateGrammar");
      return provider.evaluateGrammar(ctx, request.input);
    case "vocabulary":
      if (!provider.evaluateVocabulary) return providerFail("capability_missing", "evaluateVocabulary");
      return provider.evaluateVocabulary(ctx, request.input);
    case "assignment":
      if (!provider.evaluateAssignment) return providerFail("capability_missing", "evaluateAssignment");
      return provider.evaluateAssignment(ctx, request.input);
  }
}

/** External adapters receive a task-specific allowlisted DTO, not arbitrary application objects. */
function guardExternalRequest(request: EvaluationRequest): EvaluationRequest | null {
  const guarded = guardExternalPayload(request.evaluationType, request.input);
  if (!guarded.ok) return null;
  switch (request.evaluationType) {
    case "writing": return { evaluationType: "writing", input: guarded.payload as WritingEvaluationInput };
    case "speaking": return { evaluationType: "speaking", input: guarded.payload as SpeakingEvaluationInput };
    case "grammar": return { evaluationType: "grammar", input: guarded.payload as GrammarEvaluationInput };
    case "vocabulary": return { evaluationType: "vocabulary", input: guarded.payload as VocabularyEvaluationInput };
    case "assignment": return { evaluationType: "assignment", input: guarded.payload as AssignmentEvaluationInput };
  }
}

type SingleRun =
  | { ok: true; output: ProviderEvaluationOutput; durationMs: number; callCount: number }
  | { ok: false; failure: ProviderFailure; durationMs: number; callCount: number };

/**
 * One provider, one evaluation, at most `maxAttempts` network attempts.
 *
 * The raw provider response is validated against `providerEvaluationOutputSchema`
 * before it is allowed to exist anywhere else. A response that does not fit —
 * extra vendor fields, a renamed criterion, a string where a band belongs — is
 * reported as `invalid_response`, which the caller treats as a failure and
 * falls back from. Malformed provider output can never become student feedback.
 */
async function runProvider(
  provider: EvaluationProvider,
  request: EvaluationRequest,
  ctx: EvaluationContext,
  config: CoachConfig,
  capability: ProviderCapability,
  external: boolean
): Promise<SingleRun> {
  const startedAt = Date.now();

  if (!provider.capabilities.includes(capability)) {
    return {
      ok: false,
      failure: {
        reason: "capability_missing",
        detail: `${provider.id} does not declare ${capability}`,
        retryable: false,
      },
      durationMs: 0,
      callCount: 0,
    };
  }
  if (external && !config.externalEnabled) {
    return {
      ok: false,
      failure: {
        reason: "not_configured",
        detail: "AI_EXTERNAL_ENABLED is false",
        retryable: false,
      },
      durationMs: 0,
      callCount: 0,
    };
  }

  const safeRequest = external ? guardExternalRequest(request) : request;
  if (!safeRequest) {
    return { ok: false, failure: { reason: "invalid_response", detail: "Outbound payload did not match the task allowlist", retryable: false }, durationMs: 0, callCount: 0 };
  }

  let callCount = 0;
  let lastFailure: ProviderFailure = {
    reason: "provider_error",
    detail: "no attempt was made",
    retryable: false,
  };

  for (let attempt = 1; attempt <= config.maxAttempts; attempt += 1) {
    callCount = attempt;
    const controller = new AbortController();
    const attemptCtx = external ? externalContext(ctx, controller.signal) : ctx;

    try {
      const outcome = await withTimeout(
        invoke(provider, safeRequest, { ...attemptCtx, signal: controller.signal }),
        config.timeoutMs,
        controller
      );

      if (!outcome.ok) {
        lastFailure = outcome.failure;
      } else {
        const parsed = providerEvaluationOutputSchema.safeParse(outcome.output);
        const contract = ctx.assessmentContract ? getAssessmentContract(ctx.assessmentContract.key) : null;
        const validated = parsed.success && contract
          ? validateAssessmentOutput(contract, request.evaluationType, safeRequest.input, parsed.data, ctx.assessmentContract?.overlay ?? null)
          : null;
        if (!validated) {
          return {
            ok: false,
            failure: {
              reason: "invalid_response",
              detail: `${provider.id} returned a response that does not match the task assessment contract`,
              retryable: false,
            },
            durationMs: Date.now() - startedAt,
            callCount: attempt,
          };
        }
        return {
          ok: true,
          output: applyOwnerOverlayToOutput(validated, ctx.assessmentContract?.overlay ?? null),
          durationMs: Date.now() - startedAt,
          callCount: attempt,
        };
      }
    } catch (error) {
      if (error instanceof ProviderTimeoutError) {
        lastFailure = { reason: "timeout", detail: `${provider.id} exceeded ${config.timeoutMs}ms`, retryable: true };
      } else if (error instanceof Error) {
        // Only the error *name* is kept: an adapter is responsible for turning a
        // vendor payload into a safe failure before it reaches this point.
        lastFailure = { reason: "network", detail: `${provider.id} call threw ${error.name}`, retryable: true };
      } else {
        lastFailure = { reason: "provider_error", detail: `${provider.id} call failed`, retryable: true };
      }
    }

    const retryable = lastFailure.retryable || RETRYABLE.has(lastFailure.reason);
    if (!retryable || attempt === config.maxAttempts) break;
    await sleep(config.retryBackoffMs * attempt);
  }

  return { ok: false, failure: lastFailure, durationMs: Date.now() - startedAt, callCount };
}

function logAttempt(attempt: ProviderAttempt, request: EvaluationRequest): void {
  if (attempt.outcome === "succeeded") return;
  console.warn(
    `[coach] provider ${attempt.providerId} did not produce an evaluation for ${request.evaluationType}: ${attempt.failure?.reason ?? "unknown"} (${attempt.failure?.detail ?? ""})`
  );
}

function buildResult(params: {
  evaluationId: string;
  evaluationType: EvaluationType;
  provider: EvaluationProvider;
  output: ProviderEvaluationOutput;
  fallbackUsed: boolean;
  fallbackFrom: string | null;
  processedInMs: number;
  input?: unknown;
  assessmentContract?: EvaluationContext["assessmentContract"];
  /** The model actually used when the owner overrode the provider default. */
  model?: string | null;
}): { result: EvaluationResult; extras: ResolveExtras } {
  const { provider } = params;
  // The W7 analysis travels beside the result, never inside the strict row.
  const { writingAnalysis, ...output } = params.output;
  const versions = provider.versionsFor?.(params.evaluationType, params.input) ?? null;
  const meta = {
    providerId: provider.id,
    providerDisplayName: provider.displayName,
    providerType: provider.type,
    providerVersion: provider.version,
    model: params.model ?? provider.model,
    promptVersion: params.assessmentContract?.version ?? versions?.promptVersion ?? provider.promptVersion,
    rubricVersion: params.assessmentContract?.rubricVersion ?? versions?.rubricVersion ?? provider.rubricVersion,
  };

  const candidate: EvaluationResult = {
    evaluationId: params.evaluationId,
    evaluationType: params.evaluationType,
    ...meta,
    ...(params.assessmentContract ? {
      assessmentContractKey: params.assessmentContract.key,
      ownerPolicyScope: params.assessmentContract.policyScope,
      ownerPolicyVersion: params.assessmentContract.policyVersion,
    } : {}),
    fallbackUsed: params.fallbackUsed,
    fallbackFrom: params.fallbackFrom,
    checkedBy: buildCheckedBy(meta),
    ...output,
    processedInMs: params.processedInMs,
    createdAt: new Date().toISOString(),
  };

  const parsed = evaluationResultSchema.safeParse(candidate);
  if (!parsed.success) {
    // Our own contract must hold. RIWI's output is generated to match it and is
    // covered by tests; this is a last line of defence, not a normal path.
    throw new Error("coach_result_contract_violation");
  }
  return { result: parsed.data, extras: writingAnalysis ? { writingAnalysis } : {} };
}

/**
 * The single entry point every evaluation service uses.
 *
 * Order of operations:
 *   1. read the configured primary provider
 *   2. if it is RIWI, RIWI evaluates and no external call is ever made
 *   3. otherwise the external provider is attempted: capability check first,
 *      then bounded retries for transient failures only
 *   4. on any failure — or a response that fails validation — RIWI evaluates
 *   5. exactly one provider produces the final result, and the result records
 *      which one it was
 *
 * There is no recursive path back into this function: RIWI is a plain provider
 * and never calls the resolver, so a fallback can never cascade.
 */
export async function resolveEvaluation(
  request: EvaluationRequest,
  ctx: EvaluationContext,
  overrides?: Partial<CoachConfig>,
  policy: ResolvePolicy = { fallback: "riwi" },
): Promise<ResolveOutcome> {
  // Undefined override fields never erase configuration.
  const defined = Object.fromEntries(Object.entries(overrides ?? {}).filter(([, value]) => value !== undefined)) as Partial<CoachConfig>;
  const config: CoachConfig = { ...readCoachConfig(), ...defined };
  const capability = CAPABILITY_BY_TYPE[request.evaluationType];
  const attempts: ProviderAttempt[] = [];
  const evaluationId = crypto.randomUUID();
  const contract = assessmentContractForRequest(request);
  const contractKey = assessmentContractKeyForRequest(request);
  if (!contract || contract.execution !== "coach_evaluation" || contract.domain !== request.evaluationType) {
    return { ok: false, error: "invalid_evaluation", attempts };
  }
  const activeOwnerPolicy = await getApprovedOwnerPolicyForContract(contractKey);
  const assessmentContract: NonNullable<EvaluationContext["assessmentContract"]> = {
    key: contract.key,
    version: contract.version,
    rubricVersion: contract.rubricVersion,
    policyScope: activeOwnerPolicy?.scope ?? null,
    policyVersion: activeOwnerPolicy?.version ?? null,
    overlay: activeOwnerPolicy?.overlay ?? null,
  };
  const evaluationContext: EvaluationContext = { ...ctx, assessmentContract };

  const primaryId = config.aiPrimaryProvider;
  const primary = providerRegistry.get(primaryId);
  const riwi = providerRegistry.get(RIWI_PROVIDER_ID);

  if (!riwi) {
    return { ok: false, error: "evaluation_unavailable", attempts };
  }

  // --- 2. RIWI is the configured evaluator -------------------------------
  if ((primaryId === RIWI_PROVIDER_ID || !primary) && policy.fallback === "none") {
    // External required: RIWI is not asked, so nothing can be mislabelled.
    return { ok: false, error: "external_required", attempts };
  }
  if (primaryId === RIWI_PROVIDER_ID || !primary) {
    // A configured provider that is not installed (typo, missing adapter,
    // removed dependency) is a configuration failure, not a silent success:
    // the result records that the configured evaluator did not produce it.
    const configuredButMissing = !primary && primaryId !== RIWI_PROVIDER_ID;
    if (configuredButMissing) {
      attempts.push({
        providerId: primaryId,
        providerDisplayName: primaryId,
        outcome: "skipped",
        durationMs: 0,
        failure: {
          reason: "not_configured",
          detail: `AI_PRIMARY_PROVIDER="${primaryId}" is not registered`,
          retryable: false,
        },
      });
    }
    const run = await runProvider(riwi.provider, request, evaluationContext, config, capability, false);
    if (!run.ok) {
      const attempt: ProviderAttempt = {
        providerId: riwi.provider.id,
        providerDisplayName: riwi.provider.displayName,
        outcome: "failed",
        durationMs: run.durationMs,
        callCount: run.callCount,
        failure: run.failure,
      };
      attempts.push(attempt);
      logAttempt(attempt, request);
      return { ok: false, error: "evaluation_unavailable", attempts };
    }
    attempts.push({
      providerId: riwi.provider.id,
      providerDisplayName: riwi.provider.displayName,
      outcome: "succeeded",
      durationMs: run.durationMs,
      callCount: run.callCount,
    });
    return {
      ok: true,
      attempts,
      ...buildResult({
        evaluationId,
        evaluationType: request.evaluationType,
        provider: riwi.provider,
        output: run.output,
        fallbackUsed: configuredButMissing,
        fallbackFrom: configuredButMissing ? primaryId : null,
        processedInMs: run.durationMs,
        input: request.input,
        assessmentContract,
      }),
    };
  }

  // --- 3. the configured external provider is attempted -------------------
  const modelOverride = config.modelOverride ?? null;
  const externalRun = await runProvider(
    primary.provider,
    request,
    modelOverride ? { ...evaluationContext, model: modelOverride } : evaluationContext,
    config,
    capability,
    true
  );

  if (externalRun.ok) {
    attempts.push({
      providerId: primary.provider.id,
      providerDisplayName: primary.provider.displayName,
      outcome: "succeeded",
      durationMs: externalRun.durationMs,
      callCount: externalRun.callCount,
    });
    // RIWI is deliberately NOT called: one submission, one authoritative result.
    return {
      ok: true,
      attempts,
      ...buildResult({
        evaluationId,
        evaluationType: request.evaluationType,
        provider: primary.provider,
        output: externalRun.output,
        fallbackUsed: false,
        fallbackFrom: null,
        processedInMs: externalRun.durationMs,
        input: request.input,
        assessmentContract,
        model: modelOverride,
      }),
    };
  }

  const externalAttempt: ProviderAttempt = {
    providerId: primary.provider.id,
    providerDisplayName: primary.provider.displayName,
    outcome: "failed",
    durationMs: externalRun.durationMs,
    callCount: externalRun.callCount,
    failure: externalRun.failure,
  };
  attempts.push(externalAttempt);
  logAttempt(externalAttempt, request);

  // --- 4. automatic RIWI fallback ----------------------------------------
  if (policy.fallback === "none") {
    return { ok: false, error: "evaluation_unavailable", attempts };
  }
  if (!riwi.provider.capabilities.includes(capability)) {
    return { ok: false, error: "capability_unsupported", attempts };
  }

  const fallbackRun = await runProvider(riwi.provider, request, evaluationContext, config, capability, false);
  if (!fallbackRun.ok) {
    const attempt: ProviderAttempt = {
      providerId: riwi.provider.id,
      providerDisplayName: riwi.provider.displayName,
      outcome: "failed",
      durationMs: fallbackRun.durationMs,
      callCount: fallbackRun.callCount,
      failure: fallbackRun.failure,
    };
    attempts.push(attempt);
    logAttempt(attempt, request);
    return { ok: false, error: "evaluation_unavailable", attempts };
  }
  attempts.push({
    providerId: riwi.provider.id,
    providerDisplayName: riwi.provider.displayName,
    outcome: "succeeded",
    durationMs: fallbackRun.durationMs,
    callCount: fallbackRun.callCount,
  });

  return {
    ok: true,
    attempts,
    ...buildResult({
      evaluationId,
      evaluationType: request.evaluationType,
      provider: riwi.provider,
      output: fallbackRun.output,
      fallbackUsed: true,
      fallbackFrom: primary.provider.id,
      processedInMs: externalRun.durationMs + fallbackRun.durationMs,
      input: request.input,
      assessmentContract,
    }),
  };
}
