import "server-only";
import { isTelegramConfigured } from "./providers/telegram";

/** Independent rollout switch. Never disables password or recovery access. */
export function telegramIntentAuthEnabled(): boolean {
  return process.env.TELEGRAM_INTENT_AUTH_ENABLED === "true" &&
    isTelegramConfigured() && Boolean(process.env.BOT_SERVICE_SECRET);
}
