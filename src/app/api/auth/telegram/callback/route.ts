import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyTelegramPayload, type TelegramAuthPayload } from "@/lib/auth/providers/telegram";
import { createSessionToken, SESSION_COOKIE, clearSessionCookies, sessionCookieOptions } from "@/lib/auth/session";

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

  const telegramId = String(payload.id);
  const user = await db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });

  // Existing Telegram identities may sign in here. New accounts complete the
  // explicit registration form, including the learner's own first/last name.

  if (!user) {
    return NextResponse.redirect(new URL("/register?error=telegram_no_account", req.url));
  }

  const token = await createSessionToken({
    sub: user.id,
    authVersion: user.authVersion,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: Boolean(user.onboardingCompletedAt),
  });
  const res = NextResponse.redirect(
    new URL(user.onboardingCompletedAt ? "/app" : "/onboarding", req.url)
  );
  clearSessionCookies(res, req);
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return res;
}
