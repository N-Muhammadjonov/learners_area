/**
 * Telegram's authoritative identity is the numeric user id, never the username.
 * Stored as text so a 64-bit id cannot be corrupted by a JavaScript number.
 */

const TELEGRAM_ID = /^[0-9]{1,20}$/;

export function isTelegramUserId(value: unknown): value is string {
  return typeof value === "string" && TELEGRAM_ID.test(value);
}

export function normalizeTelegramUserId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return isTelegramUserId(trimmed) ? trimmed : null;
  }
  return null;
}

/**
 * Bootstrap id from the server environment. Unset or malformed → no bootstrap.
 * Authorization must not stop here: a stored handover wins. See owner-authority.ts.
 */
export function primaryOwnerTelegramId(env: NodeJS.ProcessEnv = process.env): string | null {
  return normalizeTelegramUserId(env.TELEGRAM_OWNER_ID);
}

export function isPrimaryOwnerTelegramId(telegramUserId: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const ownerId = primaryOwnerTelegramId(env);
  return ownerId !== null && telegramUserId === ownerId;
}
