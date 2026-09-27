import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission, resolveBotActor } from "@/lib/telegram/actor";
import { actorError } from "@/lib/telegram/http";
import { getSupportThread } from "@/lib/telegram/support";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { isUuid } from "@/lib/validation/ids";

export async function GET(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { id } = await context.params;
  if (!isUuid(id)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actorId = req.nextUrl.searchParams.get("actorTelegramId") ?? "";
  if (!isTelegramUserId(actorId)) return NextResponse.json({ error: "invalid_actor" }, { status: 400 });

  const staff = await requireBotPermission(actorId, "SUPPORT");
  const actor = staff.ok
    ? staff.actor
    : (await resolveBotActor(actorId)) ?? {
        telegramUserId: actorId,
        isPrimaryOwner: false,
        permissions: [],
        linkedUserId: null,
        auditUserId: null,
        websiteRole: null,
        accountStatus: null,
      };
  const detail = await getSupportThread(id, actor);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (detail.forbidden) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(detail);
}
