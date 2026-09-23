import "server-only";
import { NO_STT_PROVIDER_ID, readCoachConfig } from "../config";
import type { SpeechToTextProvider } from "./types";

/**
 * Speech-to-text registry — the same shape as the evaluation registry, kept
 * separate on purpose. A deployment can run `STT_PRIMARY_PROVIDER=vendor-a`
 * with `AI_PRIMARY_PROVIDER=vendor-b` (or `riwi`), in any combination.
 */
export class SpeechToTextRegistry {
  private providers = new Map<string, SpeechToTextProvider>();

  register(provider: SpeechToTextProvider): void {
    this.providers.set(provider.id.toLowerCase(), provider);
  }

  has(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }

  get(id: string): SpeechToTextProvider | null {
    return this.providers.get(id.toLowerCase()) ?? null;
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  clear(): void {
    this.providers.clear();
  }
}

export const sttRegistry = new SpeechToTextRegistry();

/**
 * Extension point: add bundled STT adapters here exactly like evaluators.
 * Nothing is bundled today — no transcription vendor is chosen, and the service
 * reports `not_configured` rather than pretending otherwise.
 */
export const bundledSttProviders: readonly SpeechToTextProvider[] = [];

for (const provider of bundledSttProviders) {
  sttRegistry.register(provider);
}

export function isSttConfigured(): boolean {
  const configured = readCoachConfig().sttPrimaryProvider;
  return configured !== NO_STT_PROVIDER_ID && sttRegistry.has(configured);
}
