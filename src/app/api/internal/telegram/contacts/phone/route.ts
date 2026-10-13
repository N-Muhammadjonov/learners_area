import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts } from "@/db/schema";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { asRecord, readJson } from "@/lib/telegram/http";
import { isTelegramUserId } from "@/lib/telegram/ids";

/**
 * A service-authenticated bot has verified native Contact.user_id === Message.from_user.id.
 * The matching IDs are checked again here; ordinary web clients cannot invoke this route.
 * A phone number is PII, never included in the response or application logs.
 */
export async function POST(req: NextRequest) {
  const denied = verifyInternalBotRequest(req);
  if (denied) return denied;
  const input = asRecord(await readJson(req));
  const telegramUserId = input?.telegramUserId;
  if (typeof telegramUserId !== "string" || !isTelegramUserId(telegramUserId)
      || input?.contactUserId !== telegramUserId) {
    return NextResponse.json({ error: "contact_owner_mismatch" }, { status: 403 });
  }
  const raw = typeof input.phoneNumber === "string" ? input.phoneNumber.trim() : "";
  const cleaned = raw.replace(/[\s()-]/g, "");
  if (!/^\+?[0-9]{7,18}$/.test(cleaned)) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }
  const phone = cleaned.startsWith("+") ? cleaned : "+" + cleaned;
  const [updated] = await db.update(telegramContacts)
    .set({ phoneNumber: phone, phoneVerifiedAt: new Date(), updatedAt: new Date() })
    .where(eq(telegramContacts.telegramUserId, telegramUserId))
    .returning({ telegramUserId: telegramContacts.telegramUserId });
  if (!updated) return NextResponse.json({ error: "start_required" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
