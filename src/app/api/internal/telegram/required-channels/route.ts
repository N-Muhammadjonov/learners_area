import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, readJson } from "@/lib/telegram/http";
import { changeRequiredChannels, listRequiredChannels } from "@/lib/telegram/required-channels";

export async function GET(req: NextRequest) {
  const denied = verifyInternalBotRequest(req);
  if (denied) return denied;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "BOT_SETTINGS");
  if (!actor.ok) return actorError(actor.error);
  return NextResponse.json({ channels: await listRequiredChannels() });
}

export async function POST(req: NextRequest) {
  const denied = verifyInternalBotRequest(req);
  if (denied) return denied;
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "BOT_SETTINGS");
  if (!actor.ok) return actorError(actor.error);
  const action = body?.action;
  const channel = asRecord(body?.channel);
  if ((action !== "add" && action !== "remove") || !channel
    || typeof channel.id !== "string") {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  if (action === "add" && (typeof channel.title !== "string" || typeof channel.url !== "string")) {
    return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  }
  const result = await changeRequiredChannels(
    actor.actor, action, {
      id: channel.id, title: typeof channel.title === "string" ? channel.title : "",
      url: typeof channel.url === "string" ? channel.url : "",
    },
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error === "max_channels" ? 409 : 400 });
  }
  return NextResponse.json({ success: true, channels: result.channels });
}
