import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { consumeIntent } from "@/lib/auth/telegram-intent";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";
import { clientKey, enforce, RULES } from "@/lib/http/rate-limit";
import { linkTelegramToUser } from "@/lib/telegram/identity";
import { isUuid } from "@/lib/validation/ids";

/**
 * Exchange a confirmed one-time intent for the same session cookie email login
 * issues. Account status is returned so the client can send PENDING / REJECTED /
 * SUSPENDED to the waiting room. This route never marks an account ACTIVE.
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

    const intent = await consumeIntent(intentId, browserNonce);
    if (!intent?.telegramUserId) {
      return NextResponse.json({ error: "intent_not_confirmed" }, { status: 400 });
    }

    let user = await db.query.users.findFirst({ where: eq(users.telegramId, intent.telegramUserId) });

    if (intent.userId && user && user.id !== intent.userId) {
      return NextResponse.json({ error: "telegram_already_linked" }, { status: 409 });
    }

    if (intent.userId && !user) {
      const linked = await linkTelegramToUser({
        userId: intent.userId,
        telegramUserId: intent.telegramUserId,
        actorUserId: intent.userId,
      });
      if (!linked.ok) {
        return NextResponse.json({ error: "telegram_already_linked" }, { status: 409 });
      }
      user = await db.query.users.findFirst({ where: eq(users.id, intent.userId) });
    }

    if (!user) {
      return NextResponse.json(
        { error: "no_linked_account" },
        { status: 404 }
      );
    }

    const token = await createSessionToken({
      sub: user.id,
      role: user.role,
      name: user.name,
      locale: user.locale,
      onboarded: Boolean(user.onboardingCompletedAt),
    });

    const res = NextResponse.json({
      success: true,
      onboarded: Boolean(user.onboardingCompletedAt),
      accountStatus: user.accountStatus,
    });
    clearSessionCookies(res, req);
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
    return res;
  } catch (error) {
    console.error("[telegram] intent exchange failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
