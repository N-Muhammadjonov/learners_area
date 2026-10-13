import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { ownerSummary } from "@/lib/telegram/owner-handover";

export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = req.nextUrl.searchParams.get("actorTelegramId") ?? "";
  if (!isTelegramUserId(actor)) return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  const summary = await ownerSummary(actor);
  if (!summary.ok) return NextResponse.json({ error: summary.error }, { status: 403 });
  return NextResponse.json(summary);
}
