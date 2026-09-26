import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { telegramLoginIntents } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { hashToken } from "@/lib/auth/telegram-intent";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";

export async function POST(req: Request) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const { token, telegramUserId } = await req.json();
    if (!token || !telegramUserId) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();

    const [updated] = await db.update(telegramLoginIntents)
      .set({
        status: "confirmed",
        telegramUserId,
        confirmedAt: now,
      })
      .where(
        and(
          eq(telegramLoginIntents.tokenHash, tokenHash),
          eq(telegramLoginIntents.status, "pending"),
          gt(telegramLoginIntents.expiresAt, now)
        )
      )
      .returning({ id: telegramLoginIntents.id });

    if (!updated) {
      return NextResponse.json({ error: "Invalid, expired, or already processed token" }, { status: 404 });
    }

    return NextResponse.json({ success: true, intentId: updated.id });
  } catch (error) {
    console.error("Internal telegram confirm error:", error);
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
  }
}
