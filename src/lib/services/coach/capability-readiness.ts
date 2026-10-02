import type { EvaluationProvider } from "./types";

/** Evaluator methods a feature can depend on. */
export type EvaluatorMethod = "evaluateWriting" | "evaluateSpeaking" | "evaluateGrammar" | "evaluateVocabulary";

type ProviderShape = Pick<EvaluationProvider, "type" | "requiredSecrets"> & Partial<Record<EvaluatorMethod, unknown>>;

/**
 * Pure check behind every "is external AI ready for X" question: external AI is
 * enabled, the selected provider is external (never RIWI), it implements the
 * exact method the feature calls, and every secret it declares is present.
 * Nothing else (STT, microphone, other methods) is consulted.
 */
export function externalCapabilityReady(
  opts: { externalEnabled: boolean; providerIsRiwi: boolean; provider: ProviderShape | null; method: EvaluatorMethod },
  env: NodeJS.ProcessEnv,
): boolean {
  const { externalEnabled, providerIsRiwi, provider, method } = opts;
  if (!externalEnabled || providerIsRiwi || !provider) return false;
  if (provider.type !== "external") return false;
  if (typeof provider[method] !== "function") return false;
  return provider.requiredSecrets.every((name) => Boolean(env[name]?.trim()));
}
