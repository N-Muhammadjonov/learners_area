import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { runRiwiConversationRetention } from "@/lib/services/riwi/conversation-retention";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function validRetentionAuthorization(authorization: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 32 || !authorization) return false;
  const hash = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(hash(authorization), hash(`Bearer ${secret}`));
}

export async function GET(request: NextRequest) {
  if (!validRetentionAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  const result = await runRiwiConversationRetention({ dryRun: false });
  return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
}
