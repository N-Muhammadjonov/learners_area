import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telegram Login Widget verification.
 *
 * This is the real, documented Telegram algorithm (https://core.telegram.org/widgets/login):
 *   1. Take all fields Telegram returns except `hash`.
 *   2. Sort them alphabetically, join as `key=value` lines with `\n`.
 *   3. HMAC-SHA256 that string, keyed with SHA256(bot_token).
 *   4. Compare hex digest to the `hash` field (constant-time).
 *   5. Reject if `auth_date` is stale (replay protection).
 *
 * It only runs when TELEGRAM_BOT_TOKEN is set server-side — never in the
 * browser. Without a token this environment has no way to actually receive
 * a signed callback from Telegram, so `isTelegramConfigured()` is what the
 * UI checks to decide whether to render a working "Continue with Telegram"
 * button or a disabled one — we do not fake success in the component.
 */

export type TelegramAuthPayload = {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
};

const MAX_AUTH_AGE_SECONDS = 60 * 5;

export function isTelegramConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_USERNAME);
}

export function verifyTelegramPayload(payload: TelegramAuthPayload): boolean {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return false;

  if (!Number.isSafeInteger(payload.id) || payload.id <= 0 ||
      !Number.isSafeInteger(payload.auth_date) || payload.auth_date <= 0 ||
      typeof payload.hash !== "string" || !/^[a-f0-9]{64}$/.test(payload.hash)) return false;

  const { hash, ...rest } = payload;
  const checkString = Object.keys(rest)
    .sort()
    .map((key) => `${key}=${(rest as Record<string, unknown>)[key]}`)
    .join("\n");

  const secretKey = createHash("sha256").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey).update(checkString).digest("hex");

  const age = Date.now() / 1000 - payload.auth_date;
  const isFresh = age >= -30 && age < MAX_AUTH_AGE_SECONDS;
  if (!isFresh) return false;

  const a = Buffer.from(computedHash);
  const b = Buffer.from(hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
