import type {
  EvaluationProviderMetadata,
  ProviderCapability,
  ProviderEvaluationOutput,
  ProviderType,
  RiwiAnswer,
} from "./schema";

/**
 * What a provider is asked to evaluate.
 *
 * Privacy: these inputs contain only what the task needs. A user id is passed
 * to internal providers for logging/authorization context, and stripped before
 * any external call (see the resolver) — no email, phone, Telegram id, profile
 * or unrelated history is ever part of an evaluation request.
 */
export type EvaluationContext = {
  /** Opaque local id, used for logging and weakness attribution. */
  userId: string;
  language: "uz" | "en";
  /** Aborted on timeout so a slow provider cannot hold a request open. */
  signal?: AbortSignal;
  /** Owner-selected model for the external provider (server-side value, never from a learner). */
  model?: string;
};

export type WritingTaskType = "task1" | "task2";

export type WritingEvaluationInput = {
  taskType: WritingTaskType;
  prompt: string;
  content: string;
  targetWordCount: number;
  /** Grade My Work: ask for the bilingual W7 analysis and the exact four criteria. */
  detailedAnalysis?: boolean;
  wordCount?: number;
  /** A short Writing-workspace check (Translation / Activation / Language Stealing) instead of an essay grade. */
  check?: WritingCheckInput;
};

/**
 * Short, structured Writing checks. Reference answers travel only server →
 * provider; they are never returned to the browser by the check layer.
 */
export type WritingCheckInput =
  | { kind: "translation"; uzbekSource: string; referenceEnglish: string; acceptedAlternatives: string[]; targetBand: number; answer: string }
  | { kind: "activation"; item: string; meaningHint: string | null; mode: "writing" | "speaking"; targetLevel: string; uzbekPrompt: string | null; upgradeFrom: string | null; answer: string }
  | { kind: "pattern"; pattern: string; sourceExample: string; sourceTopic: string; newTopic: string; answer: string };

export type SpeakingPart = "part1" | "part2" | "part3" | "general" | "mock";

export type SpeakingEvaluationInput = {
  part: SpeakingPart;
  promptText: string | null;
  /**
   * The transcript is the only textual input a speaking evaluator gets.
   * `null` means no transcript exists — and a provider must refuse to score in
   * that case rather than invent one.
   */
  transcript: string | null;
  transcriptOrigin: "stt" | "manual" | null;
  durationMs: number | null;
  /** False when the provider has no audio/pronunciation capability at all. */
  pronunciationAvailable: boolean;
};

export type GrammarEvaluationInput = {
  /** The item the student had to answer or correct. */
  promptText: string;
  studentAnswer: string;
  /** Free-text name of the structure being practised, e.g. "articles". */
  targetStructure: string | null;
  sampleAnswer: string | null;
};

export type VocabularyEvaluationInput = {
  targetWord: string;
  definition: string;
  studentSentence: string;
};

export type AssignmentEvaluationInput = {
  title: string;
  description: string | null;
  studentResponse: string;
};

export type ProviderFailureReason =
  | "timeout"
  | "network"
  | "provider_error"
  | "rate_limited"
  | "auth_failed"
  | "quota_exhausted"
  | "invalid_response"
  | "capability_missing"
  | "not_configured"
  | "provider_unavailable"
  | "cancelled";

export type ProviderFailure = {
  reason: ProviderFailureReason;
  /** Safe, non-secret detail. Provider raw error payloads are never surfaced. */
  detail: string;
  retryable: boolean;
};

export type ProviderSuccess = { ok: true; output: ProviderEvaluationOutput };
export type ProviderResult = ProviderSuccess | { ok: false; failure: ProviderFailure };
export type RiwiConversationTurn = { role: "user" | "assistant"; content: string };
export type RiwiKnowledgeContext = { ref: string; text: string; authority: number; version: number };
export type RiwiProviderInput = { language: "uz" | "en"; message: string; history: RiwiConversationTurn[]; knowledge: RiwiKnowledgeContext[] };
export type RiwiProviderResult = { ok: true; answer: RiwiAnswer } | { ok: false; failure: ProviderFailure };

const ok = (output: ProviderEvaluationOutput): ProviderSuccess => ({ ok: true, output });
const fail = (
  reason: ProviderFailureReason,
  detail: string,
  retryable = false
): { ok: false; failure: ProviderFailure } => ({ ok: false, failure: { reason, detail, retryable } });

export const providerOk = ok;
export const providerFail = fail;

/**
 * The one interface every evaluator implements — RIWI today, any external AI
 * tomorrow. Every method is optional: a provider declares in `capabilities`
 * what it can actually do, and the resolver refuses to call a method the
 * provider does not claim.
 */
export interface EvaluationProvider {
  readonly id: string;
  readonly displayName: string;
  readonly type: ProviderType;
  readonly version: string;
  readonly model: string | null;
  readonly capabilities: readonly ProviderCapability[];
  /**
   * Environment-variable NAMES this adapter reads. Used for configuration
   * diagnostics only — values are never read here, logged, or returned.
   */
  readonly requiredSecrets: readonly string[];
  readonly promptVersion: string;
  readonly rubricVersion: string;
  /** A dedicated prompt/rubric for one evaluation type (e.g. Grade My Work). */
  versionsFor?(evaluationType: string, input: unknown): { promptVersion: string; rubricVersion: string } | null;

  evaluateWriting?(
    ctx: EvaluationContext,
    input: WritingEvaluationInput
  ): Promise<ProviderResult>;
  evaluateSpeaking?(
    ctx: EvaluationContext,
    input: SpeakingEvaluationInput
  ): Promise<ProviderResult>;
  evaluateGrammar?(
    ctx: EvaluationContext,
    input: GrammarEvaluationInput
  ): Promise<ProviderResult>;
  evaluateVocabulary?(
    ctx: EvaluationContext,
    input: VocabularyEvaluationInput
  ): Promise<ProviderResult>;
  evaluateAssignment?(
    ctx: EvaluationContext,
    input: AssignmentEvaluationInput
  ): Promise<ProviderResult>;
  /** Optional general RIWI answer capability; never returns tool calls. */
  respondToRiwi?(ctx: EvaluationContext, input: RiwiProviderInput): Promise<RiwiProviderResult>;
}

/**
 * One provider, one evaluation run. Kept for logging, tests and the audit trail:
 * it records *why* RIWI had to take over when the configured provider failed.
 */
export type ProviderAttempt = {
  providerId: string;
  providerDisplayName: string;
  outcome: "succeeded" | "failed" | "skipped";
  durationMs: number;
  callCount?: number;
  failure?: ProviderFailure;
};

/** Registry metadata, kept next to the adapter so it can never drift. */
export type ProviderRegistration = {
  provider: EvaluationProvider;
  metadata: EvaluationProviderMetadata;
};

export function registrationFromProvider(provider: EvaluationProvider): ProviderRegistration {
  return {
    provider,
    metadata: {
      providerId: provider.id,
      providerDisplayName: provider.displayName,
      providerType: provider.type,
      providerVersion: provider.version,
      model: provider.model,
      promptVersion: provider.promptVersion,
      rubricVersion: provider.rubricVersion,
    },
  };
}
