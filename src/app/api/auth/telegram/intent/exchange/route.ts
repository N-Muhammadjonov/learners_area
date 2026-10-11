import { NextRequest, NextResponse } from "next/server";
import { prepareIntentExchange } from "@/lib/auth/telegram-exchange";
import { consumeConfirmedIntent } from "@/lib/auth/telegram-intent";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { clientKey, enforce, RULES } from "@/lib/http/rate-limit";
import { isUuid } from "@/lib/validation/ids";

/**
 * Exchange a confirmed one-time intent for the same session cookie email login
 * issues. The intent is consumed only after the purpose succeeds and the
 * session can be issued. A login intent never creates an account.
 */
export async function POST(req: NextRequest) {
  const limited = enforce(RULES.telegramAuth, clientKey(req));
  if (limited) return limited;

  try {
    const body = await req.json().catch(() => null);
    const intentId = body && typeof body === "object" ? (body as { intentId?: unknown }).intentId : null;
    const browserNonce = body && typeof body === "object" ? (body as { browserNonce?: unknown }).browserNonce : null;
    if (typeof intentId !== "string" || typeof browserNonce !== "string" || !isUuid(intentId)) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    const prepared = await prepareIntentExchange(intentId, browserNonce);
    if (!prepared.ok) {
      const status = prepared.error === "no_linked_account" ? 404 :
        ["phone_required", "not_subscribed"].includes(prepared.error) ? 403 :
        prepared.error === "membership_unavailable" ? 503 :
        prepared.error === "conflict" || prepared.error === "already_consumed" ? 409 : 400;
      const error = prepared.error === "conflict" ? "telegram_already_linked" : prepared.error;
      return NextResponse.json({ error }, { status });
    }

    const token = await createSessionToken({
      sub: prepared.user.id,
      role: prepared.user.role,
      name: prepared.user.name,
      locale: prepared.user.locale,
      onboarded: Boolean(prepared.user.onboardingCompletedAt),
    });
    const consumed = await consumeConfirmedIntent(intentId, browserNonce);
    if (!consumed) {
      return NextResponse.json({ error: "already_consumed" }, { status: 409 });
    }

    const res = NextResponse.json({
      success: true,
      onboarded: Boolean(prepared.user.onboardingCompletedAt),
      accountStatus: prepared.user.accountStatus,
      outcome: prepared.outcome,
    });
    clearSessionCookies(res, req);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
    return res;
  } catch (error) {
    console.error("[telegram] intent exchange failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
