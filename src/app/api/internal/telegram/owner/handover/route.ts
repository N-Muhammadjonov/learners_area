import { NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { asRecord, readJson } from "@/lib/telegram/http";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { decideBotHandover, startBotHandover } from "@/lib/telegram/owner-handover";
import { isUuid } from "@/lib/validation/ids";

function statusFor(error: string) {
  if (error === "not_found" || error === "target_unknown") return 404;
  if (error === "forbidden" || error === "wrong_actor") return 403;
  if (error === "invalid_actor") return 400;
  return 409;
}

export async function POST(req: Request) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const action = typeof body?.action === "string" ? body.action : "";
  const actorTelegramId = typeof body?.actorTelegramId === "string" ? body.actorTelegramId : "";
  if (!isTelegramUserId(actorTelegramId) || "username" in (body ?? {}) || "password" in (body ?? {})) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }

  if (action === "start") {
    const targetTelegramId = typeof body?.targetTelegramId === "string" ? body.targetTelegramId.trim() : "";
    const started = await startBotHandover({ actorTelegramId, targetTelegramId });
    if (!started.ok) return NextResponse.json({ error: started.error }, { status: statusFor(started.error) });
    return NextResponse.json({ ok: true, handoverId: started.handoverId, expiresAt: started.expiresAt }, { status: 202 });
  }

  const handoverId = typeof body?.handoverId === "string" ? body.handoverId : "";
  const step = action === "current_confirm" || action === "target_accept" || action === "reject" ? action : null;
  if (!step || !isUuid(handoverId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await decideBotHandover({ handoverId, actorTelegramId, step });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: statusFor(result.error) });
  return NextResponse.json(result);
}
