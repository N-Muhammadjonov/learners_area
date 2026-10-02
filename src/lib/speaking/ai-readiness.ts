import "server-only";
import { readCoachConfig } from "@/lib/services/coach/config";
import { getProvider, isRiwi } from "@/lib/services/coach/registry";
import { isSttConfigured } from "@/lib/services/coach/stt";

/**
 * What Practice with AI can honestly do right now. Booleans only — no
 * provider names, models or secrets leave the server.
 *  - transcription: a SpeechToText provider is selected and registered
 *  - aiEvaluation: an external (non-RIWI) evaluator with speaking support is
 *    selected, enabled, and has every required secret present
 * Without transcription there is nothing to analyse; RIWI's rule-based checks
 * are never presented as AI.
 */
export type SpeakingAiReadiness = { transcription: boolean; aiEvaluation: boolean };

export function speakingAiReadiness(env: NodeJS.ProcessEnv = process.env): SpeakingAiReadiness {
  const config = readCoachConfig();
  const transcription = isSttConfigured();
  const provider = isRiwi(config.aiPrimaryProvider) ? null : getProvider(config.aiPrimaryProvider);
  const aiEvaluation = Boolean(
    config.externalEnabled && provider && typeof provider.evaluateSpeaking === "function" &&
    provider.requiredSecrets.every((name) => Boolean(env[name]?.trim())),
  );
  return { transcription, aiEvaluation };
}
