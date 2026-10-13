import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createLoginIntent } from "@/lib/auth/telegram-intent";
import { telegramIntentAuthEnabled } from "@/lib/auth/telegram-intent-config";
import { clientKey, enforce, RULES } from "@/lib/http/rate-limit";
import { resolveIntentPurpose } from "@/lib/telegram/intent-purpose";

export async function POST(req: NextRequest) {
  if (!telegramIntentAuthEnabled()) {
    return NextResponse.json({ error: "telegram_not_configured" }, { status: 400 });
  }

  const limited = enforce(RULES.telegramIntent, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const requested = body && typeof body === "object" ? (body as { purpose?: unknown }).purpose : undefined;
  const current = await getCurrentUser();
  const decision = resolveIntentPurpose(requested, Boolean(current));
  if (!decision.ok) {
    const status = decision.error === "sign_in_required" ? 401 : 409;
    return NextResponse.json({ error: decision.error }, { status });
  }

  const intent = await createLoginIntent({
    purpose: decision.purpose,
    userId: decision.bindUser ? current?.id : null,
  });

  return NextResponse.json({
    intentId: intent.intentId,
    token: intent.token,
    browserNonce: intent.browserNonce,
    expiresAt: intent.expiresAt,
    purpose: intent.purpose,
    botUsername: process.env.TELEGRAM_BOT_USERNAME,
  });
}
