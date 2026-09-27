import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { isTelegramUserId } from "./ids";

export type LinkResult =
  | { ok: true; userId: string; linked: boolean }
  | { ok: false; error: "conflict" | "missing_user" | "invalid_id" };

/**
 * Bind a numeric Telegram id to one website account.
 *
 * Refuses to overwrite an existing link in either direction. The update only
 * matches a row whose telegram_id is still null, so two confirms cannot steal
 * each other's identity.
 */
export async function linkTelegramToUser(input: {
  userId: string;
  telegramUserId: string;
  actorUserId?: string | null;
  correlationId?: string;
}): Promise<LinkResult> {
  if (!isTelegramUserId(input.telegramUserId)) return { ok: false, error: "invalid_id" };

  const taken = await db.query.users.findFirst({
    where: eq(users.telegramId, input.telegramUserId),
    columns: { id: true },
  });
  if (taken && taken.id !== input.userId) return { ok: false, error: "conflict" };
  if (taken && taken.id === input.userId) return { ok: true, userId: input.userId, linked: true };

  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, telegramId: true },
  });
  if (!target) return { ok: false, error: "missing_user" };
  if (target.telegramId && target.telegramId !== input.telegramUserId) return { ok: false, error: "conflict" };

  const updated = await db
    .update(users)
    .set({ telegramId: input.telegramUserId })
    .where(and(eq(users.id, input.userId), or(isNull(users.telegramId), eq(users.telegramId, input.telegramUserId))))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false, error: "conflict" };

  await db
    .update(telegramContacts)
    .set({ linkedUserId: input.userId, updatedAt: new Date() })
    .where(eq(telegramContacts.telegramUserId, input.telegramUserId));

  await recordAudit({
    actorUserId: input.actorUserId ?? input.userId,
    action: "telegram.linked",
    targetType: "user",
    targetId: input.userId,
    metadata: {
      source: "telegram_bot",
      telegramUserId: input.telegramUserId,
      correlationId: input.correlationId ?? null,
    },
  });

  return { ok: true, userId: input.userId, linked: true };
}

/** Remove the login identity only. Academic history stays. */
export async function unlinkTelegramFromUser(input: {
  userId: string;
  actorUserId: string | null;
  actorTelegramId: string;
  correlationId?: string;
}) {
  const target = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { id: true, telegramId: true },
  });
  if (!target) return { ok: false as const, error: "not_found" };
  const previous = target.telegramId;
  if (!previous) return { ok: true as const, already: true };

  await db.update(users).set({ telegramId: null }).where(eq(users.id, input.userId));
  await db
    .update(telegramContacts)
    .set({ linkedUserId: null, updatedAt: new Date() })
    .where(eq(telegramContacts.telegramUserId, previous));

  await recordAudit({
    actorUserId: input.actorUserId,
    action: "telegram.unlinked",
    targetType: "user",
    targetId: input.userId,
    metadata: {
      source: "telegram_bot",
      actorTelegramId: input.actorTelegramId,
      previousTelegramUserId: previous,
      correlationId: input.correlationId ?? null,
    },
  });
  return { ok: true as const, already: false };
}
