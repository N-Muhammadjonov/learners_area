import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { createBroadcast, isBroadcastAudience, previewBroadcast } from "@/lib/telegram/broadcast";
import { enforce, RULES } from "@/lib/http/rate-limit";
import { settingEnabled } from "@/lib/telegram/ops";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const actor = await requireBotPermission(body?.actorTelegramId, "BROADCAST");
  if (!actor.ok) return actorError(actor.error);
  if (!isBroadcastAudience(body?.audience)) return NextResponse.json({ error: "invalid_audience" }, { status: 400 });
  if (body?.preview === true) {
    return NextResponse.json(await previewBroadcast(body.audience));
  }
  const limited = enforce(RULES.telegramBroadcast, `broadcast:${actor.actor.telegramUserId}`);
  if (limited) return limited;
  if (!(await settingEnabled("broadcasts_enabled"))) return NextResponse.json({ error: "broadcasts_disabled" }, { status: 403 });
  const result = await createBroadcast({
    actor: actor.actor,
    audience: body.audience,
    content: clipText(body?.content, 4000) ?? "",
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json(result);
}
