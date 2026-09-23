function readFlag(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export const flags = {
  billingEnabled: readFlag("BILLING_ENABLED", false),
  publicPaymentEnabled: readFlag("PUBLIC_PAYMENT_ENABLED", false),
  realAiEnabled: readFlag("REAL_AI_ENABLED", false),
  satEnabled: readFlag("SAT_ENABLED", false),
} as const;
