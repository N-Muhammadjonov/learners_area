import { NextRequest, NextResponse } from "next/server";
import { cancelIntent } from "@/lib/auth/telegram-intent";
import { clientKey, enforce, RULES } from "@/lib/http/rate-limit";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest) {
  const limited = enforce(RULES.telegramIntent, clientKey(req));
  if (limited) return limited;

  const body = await req.json().catch(() => null);
  const intentId = body && typeof body === "object" ? (body as { intentId?: unknown }).intentId : null;
  const browserNonce = body && typeof body === "object" ? (body as { browserNonce?: unknown }).browserNonce : null;
  if (typeof intentId !== "string" || typeof browserNonce !== "string" || !isUuid(intentId)) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  const cancelled = await cancelIntent(intentId, browserNonce);
  if (!cancelled.ok) {
    const status = cancelled.reason === "not_found" ? 404 : 409;
    return NextResponse.json({ error: cancelled.reason }, { status });
  }
  return NextResponse.json({ ok: true });
}
