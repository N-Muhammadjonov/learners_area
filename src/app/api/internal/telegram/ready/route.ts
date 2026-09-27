import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";

/** Readiness for the bot process. Liveness stays on the bot's own /health. */
export async function GET(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
