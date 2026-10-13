import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, telegramDirectMessages, users } from "@/db/schema";
import type { BotActor } from "./actor";

/**
 * Direct message is authorised here, then sent by the bot. The row stays
 * `queued` until the bot reports Telegram's real answer. A blocked chat or a
 * person who never started the bot is never reported as sent.
 */
export async function prepareDirectMessage(input: { actor: BotActor; userId: string; text: string }) {
  const text = input.text.trim().slice(0, 4000);
  if (!text) return { ok: false as const, error: "invalid_input" };
  const user = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, name: true, telegramId: true },
  });
  if (!user) return { ok: false as const, error: "not_found" };
  if (!user.telegramId) return { ok: false as const, error: "unavailable", reason: "never_started" };

  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, user.telegramId),
  });
  if (!contact) return { ok: false as const, error: "unavailable", reason: "never_started" };
  if (contact.botBlockedAt) return { ok: false as const, error: "blocked", reason: "blocked" };
  if (contact.removedAt) return { ok: false as const, error: "blocked", reason: "removed" };

  const [row] = await db
    .insert(telegramDirectMessages)
    .values({
      actorTelegramId: input.actor.telegramUserId,
      actorUserId: input.actor.auditUserId,
      targetUserId: user.id,
      targetTelegramId: user.telegramId,
      body: text,
      status: "queued",
    })
    .returning();

  return {
    ok: true as const,
    messageId: row?.id,
    chatId: contact.chatId,
    targetName: user.name,
    targetTelegramId: user.telegramId,
    text,
    status: "queued" as const,
  };
}

export async function reportDirectMessage(input: {
  messageId: string;
  status: "sent" | "failed" | "blocked";
  error?: string | null;
  telegramMessageId?: string | null;
}) {
  const [row] = await db
    .update(telegramDirectMessages)
    .set({
      status: input.status,
      errorMessage: input.error?.slice(0, 300) ?? null,
      telegramMessageId: input.telegramMessageId ?? null,
      sentAt: input.status === "sent" ? new Date() : null,
    })
    .where(eq(telegramDirectMessages.id, input.messageId))
    .returning({ id: telegramDirectMessages.id, status: telegramDirectMessages.status });
  return row ?? null;
}
