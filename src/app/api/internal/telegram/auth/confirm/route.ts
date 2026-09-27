import { NextResponse } from "next/server";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramLoginIntents, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/telegram-intent";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { asRecord, readJson } from "@/lib/telegram/http";

export async function POST(req: Request) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  try {
    const body = asRecord(await readJson(req));
    const token = typeof body?.token === "string" ? body.token : "";
    const telegramUserId = typeof body?.telegramUserId === "string" ? body.telegramUserId : "";
    if (!token || token.length > 200 || !isTelegramUserId(telegramUserId)) {
      return NextResponse.json({ error: "invalid_input" }, { status: 400 });
    }

    const tokenHash = hashToken(token);
    const now = new Date();
    const pending = await db.query.telegramLoginIntents.findFirst({
      where: and(
        eq(telegramLoginIntents.tokenHash, tokenHash),
        eq(telegramLoginIntents.status, "pending"),
        gt(telegramLoginIntents.expiresAt, now)
      ),
    });
    if (!pending) {
      return NextResponse.json({ error: "intent_invalid" }, { status: 404 });
    }

    if (pending.userId) {
      const target = await db.query.users.findFirst({
        where: eq(users.id, pending.userId),
        columns: { id: true, telegramId: true },
      });
      const taken = await db.query.users.findFirst({
        where: eq(users.telegramId, telegramUserId),
        columns: { id: true },
      });
      if (!target) return NextResponse.json({ error: "missing_user" }, { status: 404 });
      if (target.telegramId && target.telegramId !== telegramUserId) {
        return NextResponse.json({ error: "telegram_already_linked" }, { status: 409 });
      }
      if (taken && taken.id !== target.id) {
        return NextResponse.json({ error: "telegram_already_linked" }, { status: 409 });
      }
    }

    const [updated] = await db
      .update(telegramLoginIntents)
      .set({ status: "confirmed", telegramUserId, confirmedAt: now })
      .where(
        and(
          eq(telegramLoginIntents.id, pending.id),
          eq(telegramLoginIntents.status, "pending"),
          gt(telegramLoginIntents.expiresAt, now)
        )
      )
      .returning({ id: telegramLoginIntents.id });

    if (!updated) {
      return NextResponse.json({ error: "intent_invalid" }, { status: 409 });
    }
    return NextResponse.json({ success: true, intentId: updated.id });
  } catch (error) {
    console.error("[telegram] confirm failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
