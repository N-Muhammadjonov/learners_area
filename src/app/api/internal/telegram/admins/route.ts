import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { addBotAdmin, listBotAdmins } from "@/lib/telegram/admins";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "MANAGE_BOT_ADMINS");
  if (!actor.ok) return actorError(actor.error);
  return NextResponse.json({ admins: await listBotAdmins() });
}

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "MANAGE_BOT_ADMINS");
  if (!actor.ok) return actorError(actor.error);
  const result = await addBotAdmin({
    actor: actor.actor,
    telegramUserId: typeof body?.telegramUserId === "string" ? body.telegramUserId : "",
    permissions: body?.permissions,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
