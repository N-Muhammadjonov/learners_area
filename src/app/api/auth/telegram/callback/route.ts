import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyTelegramPayload, type TelegramAuthPayload } from "@/lib/auth/providers/telegram";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";

/**
 * Legacy Login Widget callback.
 *
 * It no longer creates accounts. An unknown Telegram identity is sent back to
 * the bot flow. A known identity receives the same session cookie as email
 * login; admission status is not upgraded here.
 */
export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams.entries());
  const payload = {
    ...params,
    id: Number(params.id),
    auth_date: Number(params.auth_date),
  } as TelegramAuthPayload;

  if (!payload.id || !payload.hash || !verifyTelegramPayload(payload)) {
    return NextResponse.redirect(new URL("/login?error=telegram", req.url));
  }

  const user = await db.query.users.findFirst({ where: eq(users.telegramId, String(payload.id)) });
  if (!user) {
    return NextResponse.redirect(new URL("/login?error=telegram", req.url));
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: Boolean(user.onboardingCompletedAt),
  });
  const destination = user.accountStatus === "active"
    ? user.onboardingCompletedAt ? "/dashboard" : "/onboarding"
    : "/pending";
  const res = NextResponse.redirect(new URL(destination, req.url));
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
}
