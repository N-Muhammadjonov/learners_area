import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { prepareDirectMessage, reportDirectMessage } from "@/lib/telegram/messages";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { userId } = await context.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  if (body?.report === true) {
    const messageId = typeof body.messageId === "string" ? body.messageId : "";
    const status = body.status === "sent" || body.status === "failed" || body.status === "blocked" ? body.status : null;
    if (!isUuid(messageId) || !status) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const row = await reportDirectMessage({
      messageId,
      status,
      error: typeof body.error === "string" ? body.error : null,
      telegramMessageId: typeof body.telegramMessageId === "string" ? body.telegramMessageId : null,
    });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, status: row.status });
  }
  const actor = await requireBotPermission(body?.actorTelegramId, "DIRECT_MESSAGE");
  if (!actor.ok) return actorError(actor.error);
  const result = await prepareDirectMessage({ actor: actor.actor, userId, text: clipText(body?.text, 4000) ?? "" });
  if (!result.ok) {
    const code = result.error === "not_found" ? 404 : result.error === "invalid_input" ? 400 : 409;
    return NextResponse.json(result, { status: code });
  }
  return NextResponse.json(result);
}
