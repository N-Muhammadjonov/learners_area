import "server-only";
import { isAdministrator, type Role } from "./roles";

/** Server-owned release switch. A request/header/query cannot opt into recovery. */
export function publicAuthPolicy(env: Record<string, string | undefined> = process.env) {
  let verifiedOrigin = false;
  try {
    const base = new URL(env.PUBLIC_BASE_URL ?? "");
    verifiedOrigin = base.protocol === "https:" && !base.username && !base.password &&
      env.TELEGRAM_AUTH_E2E_VERIFIED_ORIGIN === base.origin;
  } catch { /* No origin attestation means no cutover. */ }
  const telegramOnly = env.PUBLIC_AUTH_MODE === "telegram-only" && verifiedOrigin &&
    Boolean(env.TELEGRAM_BOT_TOKEN?.trim() && env.TELEGRAM_BOT_USERNAME?.trim());
  return { telegramOnly, passwordEnabled: !telegramOnly, googleEnabled: !telegramOnly };
}

/** Recovery never creates/promotes an account, and uses live database authority. */
export function canUsePasswordRecovery(user: { role: Role; accountStatus: string } | null | undefined) {
  return Boolean(user && user.accountStatus === "active" && isAdministrator(user.role));
}

export function publicAuthDisabledResponse() {
  return Response.json({ error: "authentication_method_disabled" }, {
    status: 403, headers: { "Cache-Control": "no-store" },
  });
}
