import { NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { decideWebsiteChallengeFromTelegram } from "@/lib/auth/owner-transfer";
import { asRecord, readJson } from "@/lib/telegram/http";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { isUuid } from "@/lib/validation/ids";

function statusFor(error: string) {
  if (error === "not_found") return 404;
  if (error === "wrong_actor") return 403;
  if (error === "wrong_purpose") return 400;
  return 409;
}

/** Telegram approval. The body carries an opaque challenge id, never a password. */
export async function POST(req: Request) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const challengeId = typeof body?.challengeId === "string" ? body.challengeId : "";
  const actorTelegramId = typeof body?.actorTelegramId === "string" ? body.actorTelegramId : "";
  const decision = body?.decision === "approve" || body?.decision === "reject" ? body.decision : null;
  if (!isUuid(challengeId) || !isTelegramUserId(actorTelegramId) || !decision) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if ("username" in (body ?? {}) || "password" in (body ?? {})) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const result = await decideWebsiteChallengeFromTelegram({ challengeId, actorTelegramId, decision });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  return NextResponse.json(result);
}
