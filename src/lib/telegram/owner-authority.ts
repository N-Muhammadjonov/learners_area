import { isTelegramUserId, normalizeTelegramUserId } from "./ids";

/** Ongoing source of truth after the first handover. Env must not override this. */
export const PRIMARY_OWNER_SETTING_KEY = "primary_owner_telegram_id";

export type OwnerSource = "database" | "bootstrap" | "none";

export function readStoredOwnerId(value: unknown): string | null {
  if (typeof value === "string") return normalizeTelegramUserId(value);
  if (value && typeof value === "object" && "telegramUserId" in value) {
    return normalizeTelegramUserId((value as { telegramUserId?: unknown }).telegramUserId);
  }
  return null;
}

/**
 * Database wins whenever a numeric owner is stored.
 * TELEGRAM_OWNER_ID is only the bootstrap when that row is absent.
 * A later env change cannot seize a handover that already happened.
 */
export function resolveEffectivePrimaryOwner(input: {
  storedValue: unknown;
  envTelegramId: unknown;
}): { id: string | null; source: OwnerSource } {
  const stored = readStoredOwnerId(input.storedValue);
  if (stored) return { id: stored, source: "database" };
  const bootstrap = normalizeTelegramUserId(input.envTelegramId);
  if (bootstrap) return { id: bootstrap, source: "bootstrap" };
  return { id: null, source: "none" };
}

export function sameTelegramOwner(left: string | null | undefined, right: string | null | undefined): boolean {
  return Boolean(left && right && isTelegramUserId(left) && left === right);
}
