import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db/client";
import { telegramProcessedUpdates } from "@/db/schema";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { asRecord, readJson } from "@/lib/telegram/http";

/** Accept a webhook update id once. A duplicate is acknowledged and ignored. */
export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const body = asRecord(await readJson(req));
  const updateId = typeof body?.updateId === "string" || typeof body?.updateId === "number" ? String(body.updateId) : "";
  if (!/^[0-9]{1,32}$/.test(updateId)) return NextResponse.json({ error: "invalid_input" }, { status: 400 });
  const inserted = await db
    .insert(telegramProcessedUpdates)
    .values({ updateId })
    .onConflictDoNothing()
    .returning({ updateId: telegramProcessedUpdates.updateId });
  return NextResponse.json({ fresh: inserted.length > 0 });
}
