import { NextRequest, NextResponse } from "next/server";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { requireBotPermission } from "@/lib/telegram/actor";
import { actorError } from "@/lib/telegram/http";
import { findTelegramContact } from "@/lib/telegram/contacts";
import { isTelegramUserId } from "@/lib/telegram/ids";

/** Phone is visible only to the effective primary Telegram owner, never delegated admins. */
export async function GET(req: NextRequest, context: { params: Promise<{ telegramUserId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;
  const actor = await requireBotPermission(req.nextUrl.searchParams.get("actorTelegramId"), "BOT_SETTINGS");
  if (!actor.ok) return actorError(actor.error);
  const { telegramUserId } = await context.params;
  if (!isTelegramUserId(telegramUserId)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const contact = await findTelegramContact(telegramUserId);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({
    telegramUserId: contact.telegramUserId,
    username: contact.username,
    phoneNumber: contact.phoneVerifiedAt ? contact.phoneNumber : null,
    phoneVerified: Boolean(contact.phoneVerifiedAt),
  });
}
