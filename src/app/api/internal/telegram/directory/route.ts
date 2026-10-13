import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError } from "@/lib/telegram/http";
import { searchDirectory } from "@/lib/telegram/directory";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "VIEW_USERS");
  if (!actor.ok) return actorError(actor.error);
  const page = Number(req.nextUrl.searchParams.get("page") ?? "1");
  const result = await searchDirectory({
    q: req.nextUrl.searchParams.get("q"),
    status: req.nextUrl.searchParams.get("status"),
    role: req.nextUrl.searchParams.get("role"),
    page,
    pageSize: 10,
  });
  return NextResponse.json(result);
}
