/** Off by default until the owner confirms Telegram login works on the target deployment. */
export function telegramOnlyAuthEnabled(): boolean {
  return ["true", "1"].includes((process.env.AUTH_TELEGRAM_ONLY ?? "").toLowerCase());
}
