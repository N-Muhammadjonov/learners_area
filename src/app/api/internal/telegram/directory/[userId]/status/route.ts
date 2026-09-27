import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { changeAccountFromBot } from "@/lib/telegram/directory";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { userId } = await context.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "MANAGE_USERS", { requireAuditUser: true });
  if (!actor.ok) return actorError(actor.error);
  const status = body?.status === "suspended" || body?.status === "active" ? body.status : null;
  if (!status) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await changeAccountFromBot({
    actor: actor.actor,
    userId,
    status,
    reason: clipText(body?.reason, 500),
  });
  if (!result.ok) {
    const code = result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 409;
    return NextResponse.json({ error: result.error }, { status: code });
  }
  return NextResponse.json(result);
}
