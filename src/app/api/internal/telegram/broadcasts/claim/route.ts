import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { asRecord, readJson } from "@/lib/telegram/http";
import { claimBroadcastBatch, reportBroadcastResults } from "@/lib/telegram/broadcast";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  if (Array.isArray(body?.results)) {
    const results = body.results.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const row = item as Record<string, unknown>;
      const status = row.status === "sent" || row.status === "failed" || row.status === "blocked" ? row.status : null;
      if (typeof row.deliveryId !== "string" || !status) return [];
      return [{
        deliveryId: row.deliveryId,
        status: status as "sent" | "failed" | "blocked",
        error: typeof row.error === "string" ? row.error : null,
        retryAfterSeconds: typeof row.retryAfterSeconds === "number" ? row.retryAfterSeconds : null,
        telegramMessageId: typeof row.telegramMessageId === "string" ? row.telegramMessageId : null,
      }];
    });
    return NextResponse.json(await reportBroadcastResults(results));
  }
  const limit = typeof body?.limit === "number" ? body.limit : 15;
  return NextResponse.json({ deliveries: await claimBroadcastBatch(limit) });
}
