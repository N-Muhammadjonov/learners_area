import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { assignSupportThread, closeSupportThread, reopenSupportThread, reportSupportDelivery } from "@/lib/telegram/support";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  const action = body?.action;
  if (action === "delivery") {
    const messageId = typeof body?.messageId === "string" ? body.messageId : "";
    const status = body?.status === "sent" || body?.status === "failed" || body?.status === "blocked" ? body.status : null;
    if (!isUuid(messageId) || !status) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    const row = await reportSupportDelivery({ messageId, status, error: typeof body?.error === "string" ? body.error : null });
    if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, deliveryStatus: row.deliveryStatus });
  }

  const actor = await requireBotPermission(body?.actorTelegramId, "SUPPORT");
  if (!actor.ok) return actorError(actor.error);
  const result =
    action === "assign"
      ? await assignSupportThread(id, actor.actor, String(body?.assigneeTelegramId ?? ""))
      : action === "close"
        ? await closeSupportThread(id, actor.actor)
        : action === "reopen"
          ? await reopenSupportThread(id, actor.actor)
          : null;
  if (!result) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  return NextResponse.json(result);
}
