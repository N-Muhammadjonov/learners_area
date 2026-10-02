import "server-only";
import { readCoachConfig } from "@/lib/services/coach/config";
import { getProvider, isRiwi } from "@/lib/services/coach/registry";
import { externalCapabilityReady } from "@/lib/services/coach/capability-readiness";

/**
 * Whether Writing external AI (Grade My Work, Translation semantic checks,
 * Activation/Language Stealing checks) can run: needs `evaluateWriting` on an
 * external provider with its secrets. Independent of STT and of
 * `evaluateSpeaking`. Boolean only — no provider names or secrets leave the server.
 */
export function writingAiReady(env: NodeJS.ProcessEnv = process.env): boolean {
  const config = readCoachConfig();
  const providerIsRiwi = isRiwi(config.aiPrimaryProvider);
  return externalCapabilityReady({
    externalEnabled: config.externalEnabled,
    providerIsRiwi,
    provider: providerIsRiwi ? null : getProvider(config.aiPrimaryProvider),
    method: "evaluateWriting",
  }, env);
}
