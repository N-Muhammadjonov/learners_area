import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createLoginIntent } from "@/lib/auth/telegram-intent";
import { isTelegramConfigured } from "@/lib/auth/providers/telegram";

export async function POST() {
  if (!isTelegramConfigured()) {
    return NextResponse.json({ error: "Telegram login is not configured" }, { status: 400 });
  }

  // If a user is currently authenticated, we might be linking their account
  const session = await getSession();
  const userId = session?.sub;

  const intent = await createLoginIntent(userId);

  return NextResponse.json({
    intentId: intent.intentId,
    token: intent.token,
    browserNonce: intent.browserNonce,
    expiresAt: intent.expiresAt,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
  });
}
