import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { verifyInternalBotRequest } from "@/lib/auth/internal-service";
import { publicBotAccess, resolveBotActor } from "@/lib/telegram/actor";
import { findTelegramContact } from "@/lib/telegram/contacts";
import { isTelegramUserId } from "@/lib/telegram/ids";

export async function GET(req: NextRequest, context: { params: Promise<{ telegramUserId: string }> }) {
  const authError = verifyInternalBotRequest(req);
  if (authError) return authError;

  const { telegramUserId } = await context.params;
  if (!isTelegramUserId(telegramUserId)) {
    return NextResponse.json({ error: "invalid_actor" }, { status: 400 });
  }

  try {
    const [user, actor, contact] = await Promise.all([
      db.query.users.findFirst({
        where: eq(users.telegramId, telegramUserId),
        columns: {
          id: true,
          role: true,
          name: true,
          accountStatus: true,
          locale: true,
          email: true,
        },
      }),
      resolveBotActor(telegramUserId),
      findTelegramContact(telegramUserId),
    ]);

    return NextResponse.json({
      found: Boolean(user),
      user: user ?? null,
      botAccess: publicBotAccess(actor),
      contact: contact
        ? {
            chatId: contact.chatId,
            username: contact.username,
            languageCode: contact.languageCode,
            localeOverride: contact.localeOverride,
            blocked: Boolean(contact.botBlockedAt),
            removed: Boolean(contact.removedAt),
          }
        : null,
    });
  } catch (error) {
    console.error("[telegram] user lookup failed");
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
