import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { confirmDeletion, startDeletion } from "@/lib/telegram/directory";
import { isUuid } from "@/lib/validation/ids";

export async function POST(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { userId } = await context.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "DANGEROUS_USER_DELETE", { requireAuditUser: true });
  if (!actor.ok) return actorError(actor.error);
  const result =
    body?.confirm === true
      ? await confirmDeletion(actor.actor, userId, typeof body.code === "string" ? body.code : "")
      : await startDeletion(actor.actor, userId);
  if (!result.ok) {
    const code = result.error === "not_found" ? 404 : result.error === "invalid_code" ? 400 : 409;
    return NextResponse.json({ error: result.error }, { status: code });
  }
  return NextResponse.json(result);
}
