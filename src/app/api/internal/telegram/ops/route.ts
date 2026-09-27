import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { botAudit, botStats, readBotSettings, writeBotSetting } from "@/lib/telegram/ops";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const view = req.nextUrl.searchParams.get("view");
  const permission = view === "audit" ? "VIEW_AUDIT" : view === "settings" ? "BOT_SETTINGS" : "VIEW_STATS";
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), permission);
  if (!actor.ok) return actorError(actor.error);
  if (view === "audit") return NextResponse.json({ entries: await botAudit() });
  if (view === "settings") return NextResponse.json(await readBotSettings());
  return NextResponse.json(await botStats());
}

export async function PATCH(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "BOT_SETTINGS");
  if (!actor.ok) return actorError(actor.error);
  if (typeof body?.key !== "string") return NextResponse.json({ error: "invalid_setting" }, { status: 400 });
  const result = await writeBotSetting(actor.actor, body.key, body.value);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
