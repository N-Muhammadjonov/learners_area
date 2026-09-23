import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyTelegramPayload, type TelegramAuthPayload } from "@/lib/auth/providers/telegram";
import { createSessionToken, SESSION_COOKIE, sessionCookieOptions } from "@/lib/auth/session";
import { getLocale } from "@/lib/i18n";

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
  let user = await db.query.users.findFirst({ where: eq(users.telegramId, telegramId) });

  if (!user) {
    const name = [payload.first_name, payload.last_name].filter(Boolean).join(" ") || "Telegram user";
    const [created] = await db
      .insert(users)
      .values({ name, telegramId, role: "student", locale: getLocale() })
      .returning();
    user = created;
  }

  if (!user) {
    return NextResponse.redirect(new URL("/login?error=telegram", req.url));
  }

  const token = await createSessionToken({
    sub: user.id,
    role: user.role,
    name: user.name,
    locale: user.locale,
    onboarded: Boolean(user.onboardingCompletedAt),
    isOwner: user.isOwner,
  });
  const res = NextResponse.redirect(
    new URL(user.onboardingCompletedAt ? "/dashboard" : "/onboarding", req.url)
  );
  res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return res;
}
