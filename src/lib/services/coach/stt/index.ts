import "server-only";
import { NO_STT_PROVIDER_ID, readCoachConfig } from "../config";
import { sttRegistry } from "./registry";
import type { TranscriptionRequest, TranscriptionResult } from "./types";

export * from "./types";
export { sttRegistry, isSttConfigured } from "./registry";

/**
 * SpeechToTextService.
 *
 * Its only job is AUDIO → TEXT. It has no opinion about quality and no access
 * to the evaluation path, which is what makes it impossible for a transcription
 * provider to be reported as the evaluator.
 *
 * When no provider is configured the service says so. It never returns a
 * placeholder transcript, and the speaking flow treats a missing transcript as
 * "not evaluated" rather than as an empty answer.
 */
export const SpeechToTextService = {
  isConfigured(): boolean {
    const configured = readCoachConfig().sttPrimaryProvider;
    return configured !== NO_STT_PROVIDER_ID && sttRegistry.has(configured);
  },

  /** The configured provider id, or null. Safe to show in an admin diagnostics view. */
  configuredProviderId(): string | null {
    const configured = readCoachConfig().sttPrimaryProvider;
    return configured === NO_STT_PROVIDER_ID ? null : configured;
  },

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const configured = readCoachConfig().sttPrimaryProvider;
    if (configured === NO_STT_PROVIDER_ID) {
      return {
        ok: false,
        failure: {
          reason: "not_configured",
          detail: "No speech-to-text provider is configured (STT_PRIMARY_PROVIDER).",
          retryable: false,
        },
      };
    }

    const provider = sttRegistry.get(configured);
    if (!provider) {
      return {
        ok: false,
        failure: {
          reason: "not_configured",
          detail: `STT_PRIMARY_PROVIDER="${configured}" is not registered.`,
          retryable: false,
        },
      };
    }
    if (provider.type === "external" && !readCoachConfig().externalEnabled) {
      return { ok: false, failure: { reason: "not_configured", detail: "External AI services are disabled", retryable: false } };
    }
    if (!provider.capabilities.includes("speech-to-text")) {
      return {
        ok: false,
        failure: {
          reason: "capability_missing",
          detail: `${provider.id} does not declare speech-to-text.`,
          retryable: false,
        },
      };
    }

    return provider.transcribe(request);
  },
};
