import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts } from "@/db/schema";
import { isTelegramUserId } from "./ids";

export type ContactSyncInput = {
  telegramUserId: string;
  chatId?: string | null;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  languageCode?: string | null;
  /** Explicit /start clears a previous "remove from bot" so the person can opt back in. */
  restarted?: boolean;
};

function clip(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, max);
}

export async function upsertTelegramContact(input: ContactSyncInput) {
  if (!isTelegramUserId(input.telegramUserId)) return null;
  const now = new Date();
  const chatId = clip(input.chatId, 64) ?? input.telegramUserId;
  const username = clip(input.username?.replace(/^@/, ""), 120);
  const firstName = clip(input.firstName, 120);
  const lastName = clip(input.lastName, 120);
  const languageCode = clip(input.languageCode, 10);

  const [row] = await db
    .insert(telegramContacts)
    .values({
      telegramUserId: input.telegramUserId,
      chatId,
      username,
      firstName,
      lastName,
      languageCode,
      lastSeenAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramContacts.telegramUserId,
      set: {
        chatId,
        username,
        firstName,
        lastName,
        languageCode,
        lastSeenAt: now,
        updatedAt: now,
        ...(input.restarted ? { removedAt: null, botBlockedAt: null } : {}),
      },
    })
    .returning();
  return row ?? null;
}

export async function markTelegramBlocked(telegramUserId: string, blocked: boolean) {
  if (!isTelegramUserId(telegramUserId)) return null;
  const now = new Date();
  const [row] = await db
    .update(telegramContacts)
    .set({
      botBlockedAt: blocked ? now : null,
      updatedAt: now,
      lastSeenAt: now,
    })
    .where(eq(telegramContacts.telegramUserId, telegramUserId))
    .returning();
  return row ?? null;
}

export async function findTelegramContact(telegramUserId: string) {
  if (!isTelegramUserId(telegramUserId)) return null;
  return db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, telegramUserId),
  });
}

/** Remove-from-bot: deactivate the bot relationship. Does not delete the website account. */
export async function removeContactFromBot(telegramUserId: string) {
  if (!isTelegramUserId(telegramUserId)) return null;
  const now = new Date();
  const [row] = await db
    .update(telegramContacts)
    .set({ removedAt: now, updatedAt: now })
    .where(eq(telegramContacts.telegramUserId, telegramUserId))
    .returning();
  return row ?? null;
}
