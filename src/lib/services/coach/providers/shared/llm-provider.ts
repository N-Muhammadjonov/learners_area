import "server-only";
import { providerEvaluationOutputSchema, type ProviderCapability } from "../../schema";
import { WRITING_GRADE_PROMPT_VERSION, WRITING_GRADE_RUBRIC_VERSION } from "@/lib/writing/grade-criteria";
import {
  providerFail,
  providerOk,
  type EvaluationContext,
  type EvaluationProvider,
  type ProviderFailure,
  type ProviderResult,
  type WritingEvaluationInput,
} from "../../types";
import { CHECK_VERSIONS, instructions, writingCheckInstructions, writingGradeInstructions } from "./prompts";

/**
 * One validated evaluation pipeline for every LLM adapter.
 *
 * An adapter supplies only a TRANSPORT: "send this system + user text, give me
 * the model's raw text back, or a safe failure". Everything that protects the
 * product is shared and therefore identical across vendors:
 *  - the same prompts and the same strict output schema (no free-form output);
 *  - identity-free payloads (no user id, email, profile or history);
 *  - input/output size bounds and a hard per-call deadline;
 *  - vendors cannot create links/exercises or invent pronunciation evidence;
 *  - provider error bodies are never surfaced (safe, fixed failure details).
 */

export type CompletionRequest = { system: string; user: string; maxOutputTokens: number; signal: AbortSignal };
export type CompletionResult = { ok: true; text: string } | { ok: false; failure: ProviderFailure };
export type LlmTransport = (request: CompletionRequest) => Promise<CompletionResult>;

export const TEXT_CAPABILITIES: readonly ProviderCapability[] = [
  "text-evaluation", "writing-evaluation", "speaking-evaluation", "grammar-evaluation",
  "vocabulary-evaluation", "assignment-evaluation", "structured-output",
];

export const MAX_INPUT_CHARS = 60_000;
export const MAX_RESPONSE_CHARS = 200_000;
export const CALL_TIMEOUT_MS = 20_000;

export type LlmProviderDefinition = {
  id: string;
  displayName: string;
  version: string;
  model: () => string | null;
  requiredSecrets: () => readonly string[];
  capabilities?: readonly ProviderCapability[];
  transport: LlmTransport;
};

/** Map an HTTP status to a failure reason; never includes the response body. */
export function httpFailure(status: number, label: string): CompletionResult {
  const reason = status === 401 || status === 403 ? "auth_failed" : status === 429 ? "rate_limited" : "provider_error";
  return { ok: false, failure: { reason, detail: `${label} evaluation request failed`, retryable: status >= 500 } };
}

/** Strict JSON extraction: the whole reply, or one fenced JSON block — nothing else. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return JSON.parse(fenced ? fenced[1]! : trimmed);
}

export function createLlmEvaluationProvider(def: LlmProviderDefinition): EvaluationProvider {
  const capabilities = (def.capabilities ?? TEXT_CAPABILITIES).filter((c) => TEXT_CAPABILITIES.includes(c));

  async function evaluate(task: string, ctx: EvaluationContext, input: unknown, system: string = instructions, maxOutputTokens = 2500): Promise<ProviderResult> {
    if (!def.model() || def.requiredSecrets().some((name) => !process.env[name]?.trim())) {
      return providerFail("not_configured", `${def.displayName} key and evaluation model are required`);
    }
    // Identity-free by construction: only the task, the language and the task input.
    const user = JSON.stringify({ task, language: ctx.language, input });
    if (user.length > MAX_INPUT_CHARS) return providerFail("provider_error", "Evaluation input is too large");
    const signal = ctx.signal ? AbortSignal.any([ctx.signal, AbortSignal.timeout(CALL_TIMEOUT_MS)]) : AbortSignal.timeout(CALL_TIMEOUT_MS);
    let completion: CompletionResult;
    try {
      completion = await def.transport({ system, user, maxOutputTokens, signal });
    } catch {
      return providerFail(ctx.signal?.aborted ? "cancelled" : "network", `${def.displayName} evaluation could not complete`, !ctx.signal?.aborted);
    }
    if (!completion.ok) return { ok: false, failure: completion.failure };
    if (completion.text.length > MAX_RESPONSE_CHARS) return providerFail("invalid_response", "Evaluation response is too large");
    let json: unknown;
    try {
      json = extractJson(completion.text);
    } catch {
      return providerFail("invalid_response", "Evaluation format is invalid");
    }
    const parsed = providerEvaluationOutputSchema.safeParse(json);
    if (!parsed.success) return providerFail("invalid_response", "Evaluation format is invalid");
    // Vendors cannot create clickable destinations or invent pronunciation evidence.
    parsed.data.recommendedExercises = [];
    // Only Grade My Work asks for the analysis; anything else drops it.
    if (system === instructions || task === "writing-check") delete parsed.data.writingAnalysis;
    if (task === "speaking") {
      parsed.data.criteria = parsed.data.criteria.filter((criterion) => !/pronunciation/i.test(`${criterion.key} ${criterion.label}`));
      parsed.data.criteria.push({ key: "pronunciation", label: "Pronunciation", band: null, limited: true, note: "Audio pronunciation was not evaluated" });
      if (parsed.data.criteria.length > 12) parsed.data.criteria.splice(11, parsed.data.criteria.length - 12);
    }
    return providerOk(parsed.data);
  }

  const has = (c: ProviderCapability) => capabilities.includes(c);
  const provider: EvaluationProvider = {
    id: def.id,
    displayName: def.displayName,
    type: "external",
    version: def.version,
    get model() { return def.model(); },
    capabilities,
    get requiredSecrets() { return def.requiredSecrets(); },
    promptVersion: "learners-evidence-v1",
    rubricVersion: "learning-estimate-v1",
    versionsFor: (type, input) => type === "writing" && (input as WritingEvaluationInput | undefined)?.check
      ? CHECK_VERSIONS
      : type === "writing" && (input as WritingEvaluationInput | undefined)?.detailedAnalysis
      ? { promptVersion: WRITING_GRADE_PROMPT_VERSION, rubricVersion: WRITING_GRADE_RUBRIC_VERSION }
      : null,
    ...(has("writing-evaluation") ? {
      evaluateWriting: (ctx: EvaluationContext, input: WritingEvaluationInput) => input.check
        ? evaluate("writing-check", ctx, input.check, writingCheckInstructions(input.check.kind, input.check.kind === "activation" ? input.check.mode : "writing"), 1500)
        : input.detailedAnalysis
        ? evaluate("writing", ctx, { taskType: input.taskType, question: input.prompt, essay: input.content, wordCount: input.wordCount ?? null }, writingGradeInstructions(input.taskType), 5000)
        : evaluate("writing", ctx, input),
    } : {}),
    ...(has("speaking-evaluation") ? {
      evaluateSpeaking: (ctx: EvaluationContext, input: Parameters<NonNullable<EvaluationProvider["evaluateSpeaking"]>>[1]) => !input.transcript?.trim()
        ? Promise.resolve(providerFail("capability_missing", "A transcript is required"))
        : evaluate("speaking", ctx, { ...input, pronunciationAvailable: false }),
    } : {}),
    ...(has("grammar-evaluation") ? { evaluateGrammar: (ctx: EvaluationContext, input: unknown) => evaluate("grammar", ctx, input) } : {}),
    ...(has("vocabulary-evaluation") ? { evaluateVocabulary: (ctx: EvaluationContext, input: unknown) => evaluate("vocabulary", ctx, input) } : {}),
    ...(has("assignment-evaluation") ? { evaluateAssignment: (ctx: EvaluationContext, input: unknown) => evaluate("assignment", ctx, input) } : {}),
  };
  return provider;
}
