import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * Service-to-service credential for the Telegram bot process.
 *
 * Matching this secret proves the caller is the bot service. It does NOT prove
 * the Telegram user is the owner, a bot admin, or allowed to touch a target.
 * Every sensitive route still resolves the actor and the permission.
 */
export function serviceSecretsMatch(provided: string, expected: string): boolean {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

export function verifyInternalBotRequest(req: Request): NextResponse | null {
  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const token = authHeader.slice("Bearer ".length);
  const secret = process.env.BOT_SERVICE_SECRET;
  if (!secret) {
    console.error("[telegram] BOT_SERVICE_SECRET is not configured");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }

  if (!token || !serviceSecretsMatch(token, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  return null;
}
