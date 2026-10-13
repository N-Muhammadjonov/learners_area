/**
 * Safe, reversible admission migration switch.
 *
 * OFF by default, so the previous production bot can continue accepting
 * applicants while the compatible backend APIs and nullable DB migration
 * are deployed. Enable only AFTER the new Railway bot and website registration
 * paths have passed a real end-to-end smoke test.
 *
 * Once ON, both the bot admission API and Telegram website registration enforce
 * own-phone verification and membership in every configured required channel.
 */
export function telegramApplicationGatesEnabled(): boolean {
  return /^(1|true)$/i.test((process.env.TELEGRAM_ACCESS_GATES_ENABLED ?? "").trim());
}
