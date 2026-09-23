function readFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export const flags = {
  billingEnabled: readFlag("BILLING_ENABLED", false),
  publicPaymentEnabled: readFlag("PUBLIC_PAYMENT_ENABLED", false),
  /**
   * Deprecated. Evaluation is now selected by `AI_PRIMARY_PROVIDER` through the
   * provider registry (see src/lib/services/coach), which is what actually
   * decides whether an external model runs. The variable is still parsed so an
   * older deployment does not break, but it no longer switches anything: a flag
   * that silently changes which code path evaluates student work is worse than
   * an explicit provider id.
   */
  realAiEnabledLegacy: readFlag("REAL_AI_ENABLED", false),
  satEnabled: readFlag("SAT_ENABLED", false),
} as const;
