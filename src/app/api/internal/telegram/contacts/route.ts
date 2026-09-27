import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { markTelegramBlocked, upsertTelegramContact } from "@/lib/telegram/contacts";
import { asRecord, clipText, readJson } from "@/lib/telegram/http";
import { isTelegramUserId } from "@/lib/telegram/ids";

export async function POST(req: NextRequest) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  const body = asRecord(await readJson(req));
  const telegramUserId = typeof body?.telegramUserId === "string" ? body.telegramUserId : "";
  if (!isTelegramUserId(telegramUserId)) {
    return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  }

  if (typeof body?.blocked === "boolean" && body.sync === false) {
    await markTelegramBlocked(telegramUserId, body.blocked);
    return NextResponse.json({ ok: true });
  }

  const row = await upsertTelegramContact({
    telegramUserId,
    chatId: clipText(body?.chatId, 64),
    username: clipText(body?.username, 120),
    firstName: clipText(body?.firstName, 120),
    lastName: clipText(body?.lastName, 120),
    languageCode: clipText(body?.languageCode, 10),
    restarted: body?.restarted === true,
  });
  if (typeof body?.blocked === "boolean") {
    await markTelegramBlocked(telegramUserId, body.blocked);
  }
  return NextResponse.json({ ok: true, contactId: row?.id ?? null });
}
