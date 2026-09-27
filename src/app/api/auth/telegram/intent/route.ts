import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLoginIntent } from "@/lib/auth/telegram-intent";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";
import { clientKey, enforce, RULES } from "@/lib/http/rate-limit";

export async function POST(req: NextRequest) {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 400 });
  }

  const limited = enforce(RULES.telegramIntent, clientKey(req));
  if (limited) return limited;

  // Linking uses the database-backed current user, never the cookie role.
  // A signed-out caller still gets a login intent; admission is not bypassed.
  const current = await getCurrentUser();
  const intent = await createLoginIntent(current?.id);

  return NextResponse.json({
    intentId: intent.intentId,
    token: intent.token,
    browserNonce: intent.browserNonce,
    expiresAt: intent.expiresAt,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
  });
}
