import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError, asRecord, clipText, readJson } from "@/lib/telegram/http";
import { enforce, RULES } from "@/lib/http/rate-limit";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { listSupportThreads, openOrAppendUserThread } from "@/lib/telegram/support";
import { settingEnabled } from "@/lib/telegram/ops";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "SUPPORT");
  if (!actor.ok) return actorError(actor.error);
  const filter = req.nextUrl.searchParams.get("filter");
  const allowed = filter === "mine" || filter === "all" || filter === "closed" ? filter : "open";
  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const result = await listSupportThreads({ actor: actor.actor, filter: allowed, page, pageSize: 10 });
  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const telegramUserId = typeof body?.telegramUserId === "string" ? body.telegramUserId : "";
  if (!isTelegramUserId(telegramUserId)) return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  const limited = enforce(RULES.telegramSupport, `support:${telegramUserId}`);
  if (limited) return limited;
  if (!(await settingEnabled("support_enabled"))) return NextResponse.json({ error: "support_disabled" }, { status: 403 });

  const linked = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramUserId),
    columns: { id: true },
  });
  const result = await openOrAppendUserThread({
    telegramUserId,
    linkedUserId: linked?.id ?? null,
    text: clipText(body?.text, 4000),
    messageType: typeof body?.messageType === "string" ? body.messageType : "text",
    fileId: clipText(body?.fileId, 300),
    fileName: clipText(body?.fileName, 255),
    mimeType: clipText(body?.mimeType, 120),
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.error === "blocked" ? 409 : 400 });
  return NextResponse.json(result);
}
