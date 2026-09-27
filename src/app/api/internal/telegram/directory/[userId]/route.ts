import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError } from "@/lib/telegram/http";
import { userDetail } from "@/lib/telegram/directory";
import { isUuid } from "@/lib/validation/ids";

export async function GET(req: NextRequest, context: { params: Promise<{ userId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const { userId } = await context.params;
  if (!isUuid(userId)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "VIEW_USERS");
  if (!actor.ok) return actorError(actor.error);
  const detail = await userDetail(userId);
  if (!detail) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(detail);
}
