import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { broadcastStatus, cancelBroadcast } from "@/lib/telegram/broadcast";
import { isUuid } from "@/lib/validation/ids";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "BROADCAST");
  if (!actor.ok) return actorError(actor.error);
  const row = await broadcastStatus(id);
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "BROADCAST");
  if (!actor.ok) return actorError(actor.error);
  if (body?.action !== "cancel") return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const result = await cancelBroadcast(actor.actor, id);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 409 });
  return NextResponse.json(result);
}
