import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { removeBotAdmin, updateBotAdmin } from "@/lib/telegram/admins";

export async function PATCH(req: NextRequest, context: { params: Promise<{ telegramUserId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { telegramUserId } = await context.params;
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "MANAGE_BOT_ADMINS");
  if (!actor.ok) return actorError(actor.error);
  const result = await updateBotAdmin({
    actor: actor.actor,
    telegramUserId,
    permissions: body?.permissions,
    active: typeof body?.active === "boolean" ? body.active : undefined,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  return NextResponse.json(result);
}

export async function DELETE(req: NextRequest, context: { params: Promise<{ telegramUserId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { telegramUserId } = await context.params;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "MANAGE_BOT_ADMINS");
  if (!actor.ok) return actorError(actor.error);
  const result = await removeBotAdmin(actor.actor, telegramUserId);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "not_found" ? 404 : 409 });
  return NextResponse.json(result);
}
