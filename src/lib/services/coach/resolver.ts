import "server-only";
import { RIWI_PROVIDER_ID, readCoachConfig, type CoachConfig } from "./config";
import { providerRegistry } from "./registry";
import {
  buildCheckedBy,
  evaluationResultSchema,
  providerEvaluationOutputSchema,
  type EvaluationResult,
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
  | "invalid_evaluation";

export type ResolveOutcome =
  | { ok: true; result: EvaluationResult; attempts: ProviderAttempt[] }
  | { ok: false; error: CoachEvaluationError; attempts: ProviderAttempt[] };

export type EvaluationRequest =
  | { evaluationType: "writing"; input: WritingEvaluationInput }
  | { evaluationType: "speaking"; input: SpeakingEvaluationInput }
  | { evaluationType: "grammar"; input: GrammarEvaluationInput }
  | { evaluationType: "vocabulary"; input: VocabularyEvaluationInput }
  | { evaluationType: "assignment"; input: AssignmentEvaluationInput };

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
  return { userId: "external-anonymous", language: ctx.language, signal };
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
        invoke(provider, request, { ...attemptCtx, signal: controller.signal }),
        config.timeoutMs,
        controller
      );

      if (!outcome.ok) {
        lastFailure = outcome.failure;
      } else {
        const parsed = providerEvaluationOutputSchema.safeParse(outcome.output);
        if (!parsed.success) {
          return {
            ok: false,
            failure: {
              reason: "invalid_response",
              detail: `${provider.id} returned a response that does not match the evaluation contract`,
              retryable: false,
            },
            durationMs: Date.now() - startedAt,
            callCount: attempt,
          };
        }
        return { ok: true, output: parsed.data, durationMs: Date.now() - startedAt, callCount: attempt };
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
}): EvaluationResult {
  const { provider, output } = params;
  const meta = {
    providerId: provider.id,
    providerDisplayName: provider.displayName,
    providerType: provider.type,
    providerVersion: provider.version,
    model: provider.model,
    promptVersion: provider.promptVersion,
    rubricVersion: provider.rubricVersion,
  };

  const candidate: EvaluationResult = {
    evaluationId: params.evaluationId,
    evaluationType: params.evaluationType,
    ...meta,
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
  return parsed.data;
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
  overrides?: Partial<CoachConfig>
): Promise<ResolveOutcome> {
  const config: CoachConfig = { ...readCoachConfig(), ...overrides };
  const capability = CAPABILITY_BY_TYPE[request.evaluationType];
  const attempts: ProviderAttempt[] = [];
  const evaluationId = crypto.randomUUID();

  const primaryId = config.aiPrimaryProvider;
  const primary = providerRegistry.get(primaryId);
  const riwi = providerRegistry.get(RIWI_PROVIDER_ID);

  if (!riwi) {
    return { ok: false, error: "evaluation_unavailable", attempts };
  }

  // --- 2. RIWI is the configured evaluator -------------------------------
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
    const run = await runProvider(riwi.provider, request, ctx, config, capability, false);
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
      result: buildResult({
        evaluationId,
        evaluationType: request.evaluationType,
        provider: riwi.provider,
        output: run.output,
        fallbackUsed: configuredButMissing,
        fallbackFrom: configuredButMissing ? primaryId : null,
        processedInMs: run.durationMs,
      }),
    };
  }

  // --- 3. the configured external provider is attempted -------------------
  const externalRun = await runProvider(
    primary.provider,
    request,
    ctx,
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
      result: buildResult({
        evaluationId,
        evaluationType: request.evaluationType,
        provider: primary.provider,
        output: externalRun.output,
        fallbackUsed: false,
        fallbackFrom: null,
        processedInMs: externalRun.durationMs,
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
  if (!riwi.provider.capabilities.includes(capability)) {
    return { ok: false, error: "capability_unsupported", attempts };
  }

  const fallbackRun = await runProvider(riwi.provider, request, ctx, config, capability, false);
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
    result: buildResult({
      evaluationId,
      evaluationType: request.evaluationType,
      provider: riwi.provider,
      output: fallbackRun.output,
      fallbackUsed: true,
      fallbackFrom: primary.provider.id,
      processedInMs: externalRun.durationMs + fallbackRun.durationMs,
    }),
  };
}
