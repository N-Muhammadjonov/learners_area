import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { replyToThread } from "@/lib/telegram/support";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "SUPPORT");
  if (!actor.ok) return actorError(actor.error);
  const result = await replyToThread({
    threadId: id,
    actor: actor.actor,
    text: clipText(body?.text, 4000),
    messageType: typeof body?.messageType === "string" ? body.messageType : "text",
    fileId: clipText(body?.fileId, 300),
    fileName: clipText(body?.fileName, 255),
    mimeType: clipText(body?.mimeType, 120),
  });
  if (!result.ok) {
    const status = result.error === "not_found" ? 404 : result.error === "closed" ? 409 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json(result);
}
