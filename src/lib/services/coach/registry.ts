import "server-only";
import { RIWI_PROVIDER_ID } from "./config";
import type { ProviderCapability } from "./schema";
import type { EvaluationProvider, ProviderRegistration } from "./types";
import { registrationFromProvider } from "./types";
import { bundledProviders } from "./providers";
import { RiwiProvider } from "./providers/riwi";

/**
 * The provider registry.
 *
 * Registering a provider is the *only* thing a future integration has to do:
 * implement `EvaluationProvider`, register the adapter here (or from
 * `providers/index.ts`), set its server-side secrets, and point
 * `AI_PRIMARY_PROVIDER` at its id. No evaluation service, route, UI component
 * or database column knows a vendor name.
 *
 * The registry is server-only. It holds the configured model names and each
 * adapter's required secret *names* — never a secret value.
 */
export class ProviderRegistry {
  private providers = new Map<string, ProviderRegistration>();

  register(provider: EvaluationProvider): void {
    this.providers.set(provider.id.toLowerCase(), registrationFromProvider(provider));
  }

  has(id: string): boolean {
    return this.providers.has(id.toLowerCase());
  }

  get(id: string): ProviderRegistration | null {
    return this.providers.get(id.toLowerCase()) ?? null;
  }

  /** Registration metadata only — safe to expose to an admin diagnostics view. */
  listMetadata() {
    return [...this.providers.values()].map((entry) => entry.metadata);
  }

  ids(): string[] {
    return [...this.providers.keys()];
  }

  /** Ids of the registered providers that genuinely declare this capability. */
  idsWithCapability(capability: ProviderCapability): string[] {
    return [...this.providers.values()]
      .filter((entry) => entry.provider.capabilities.includes(capability))
      .map((entry) => entry.provider.id);
  }

  /**
   * True when any registered provider genuinely declares this capability.
   *
   * Used to decide whether a criterion can be evaluated at all: with no
   * pronunciation-capable provider registered, the speaking result reports
   * pronunciation as `limited` instead of inventing a score.
   */
  hasCapabilityAnywhere(capability: ProviderCapability): boolean {
    return this.idsWithCapability(capability).length > 0;
  }

  clear(): void {
    this.providers.clear();
  }
}

export const providerRegistry = new ProviderRegistry();

/**
 * RIWI is registered once, at module load, and is never removed: it is the
 * permanent evaluator and the automatic fallback for every other provider.
 */
providerRegistry.register(new RiwiProvider());
for (const provider of bundledProviders) {
  providerRegistry.register(provider);
}

/**
 * Extension point for external adapters.
 *
 * Implementation note for a future integration: call this from
 * `src/lib/services/coach/providers/index.ts` — a file that is imported by
 * this module — so registration happens before any evaluation is resolved.
 */
export function registerProvider(provider: EvaluationProvider): void {
  providerRegistry.register(provider);
}

export function getProvider(id: string): EvaluationProvider | null {
  return providerRegistry.get(id)?.provider ?? null;
}

export function isRiwi(id: string): boolean {
  return id.toLowerCase() === RIWI_PROVIDER_ID;
}

export function listConfiguredProviderIds(): string[] {
  return providerRegistry.ids();
}
