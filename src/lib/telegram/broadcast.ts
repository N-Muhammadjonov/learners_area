import "server-only";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBroadcastDeliveries, telegramBroadcasts, telegramContacts, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { BotActor } from "./actor";
import { isBroadcastAudience, type BroadcastAudience } from "./audiences";

export { isBroadcastAudience, BROADCAST_AUDIENCES } from "./audiences";
export type { BroadcastAudience } from "./audiences";

type Recipient = { telegramUserId: string; chatId: string };

async function recipientsFor(audience: BroadcastAudience): Promise<Recipient[]> {
  const base = and(sql`${telegramContacts.removedAt} is null`, sql`${telegramContacts.botBlockedAt} is null`);
  if (audience === "all_bot_users") {
    return db
      .select({ telegramUserId: telegramContacts.telegramUserId, chatId: telegramContacts.chatId })
      .from(telegramContacts)
      .where(base);
  }
  const filters = [base];
  if (audience === "admins") {
    filters.push(inArray(users.role, ["admin", "owner"]));
    filters.push(eq(users.accountStatus, "active"));
  } else if (audience === "teachers") {
    filters.push(eq(users.role, "teacher"));
    filters.push(eq(users.accountStatus, "active"));
  } else if (audience === "pending_applicants") {
    filters.push(eq(users.role, "student"));
    filters.push(eq(users.accountStatus, "pending"));
  } else {
    filters.push(eq(users.role, "student"));
    filters.push(eq(users.accountStatus, "active"));
  }
  return db
    .select({ telegramUserId: telegramContacts.telegramUserId, chatId: telegramContacts.chatId })
    .from(telegramContacts)
    .innerJoin(users, eq(users.id, telegramContacts.linkedUserId))
    .where(and(...filters));
}

export async function previewBroadcast(audience: BroadcastAudience) {
  const recipients = await recipientsFor(audience);
  return { audience, recipientCount: recipients.length };
}

export async function createBroadcast(input: { actor: BotActor; audience: BroadcastAudience; content: string }) {
  const content = input.content.trim().slice(0, 4000);
  if (!content) return { ok: false as const, error: "invalid_input" };
  const recipients = await recipientsFor(input.audience);
  const [broadcast] = await db
    .insert(telegramBroadcasts)
    .values({
      createdBy: input.actor.auditUserId,
      actorTelegramId: input.actor.telegramUserId,
      audience: input.audience,
      content,
      status: "queued",
      recipientCount: recipients.length,
    })
    .returning();
  if (!broadcast) return { ok: false as const, error: "internal_error" };

  if (recipients.length > 0) {
    await db.insert(telegramBroadcastDeliveries).values(
      recipients.map((recipient) => ({
        broadcastId: broadcast.id,
        telegramUserId: recipient.telegramUserId,
        chatId: recipient.chatId,
        status: "queued" as const,
      }))
    );
  } else {
    await db
      .update(telegramBroadcasts)
      .set({ status: "sent", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(telegramBroadcasts.id, broadcast.id));
  }

  await recordAudit({
    actorUserId: input.actor.auditUserId,
    action: "broadcast.created",
    targetType: "telegram_broadcast",
    targetId: broadcast.id,
    metadata: {
      source: "telegram_bot",
      actorTelegramId: input.actor.telegramUserId,
      audience: input.audience,
      recipientCount: recipients.length,
    },
  });

  return { ok: true as const, id: broadcast.id, recipientCount: recipients.length, status: recipients.length ? "queued" : "sent" };
}

export async function cancelBroadcast(actor: BotActor, broadcastId: string) {
  const now = new Date();
  const [row] = await db
    .update(telegramBroadcasts)
    .set({ status: "cancelled", updatedAt: now, completedAt: now })
    .where(and(eq(telegramBroadcasts.id, broadcastId), inArray(telegramBroadcasts.status, ["queued", "sending"])))
    .returning({ id: telegramBroadcasts.id });
  if (!row) return { ok: false as const, error: "not_cancellable" };
  await db
    .update(telegramBroadcastDeliveries)
    .set({ status: "cancelled" })
    .where(and(eq(telegramBroadcastDeliveries.broadcastId, broadcastId), eq(telegramBroadcastDeliveries.status, "queued")));
  await recordAudit({
    actorUserId: actor.auditUserId,
    action: "broadcast.cancelled",
    targetType: "telegram_broadcast",
    targetId: broadcastId,
    metadata: { source: "telegram_bot", actorTelegramId: actor.telegramUserId },
  });
  return { ok: true as const };
}

export async function broadcastStatus(broadcastId: string) {
  const row = await db.query.telegramBroadcasts.findFirst({ where: eq(telegramBroadcasts.id, broadcastId) });
  if (!row) return null;
  return {
    id: row.id,
    audience: row.audience,
    status: row.status,
    recipientCount: row.recipientCount,
    sentCount: row.sentCount,
    failedCount: row.failedCount,
    blockedCount: row.blockedCount,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
  };
}

const LEASE_MS = 90_000;

export async function claimBroadcastBatch(limit = 20) {
  const now = new Date();
  const size = Math.min(Math.max(limit, 1), 30);
  const due = await db
    .select({ id: telegramBroadcastDeliveries.id })
    .from(telegramBroadcastDeliveries)
    .innerJoin(telegramBroadcasts, eq(telegramBroadcasts.id, telegramBroadcastDeliveries.broadcastId))
    .where(
      and(
        inArray(telegramBroadcasts.status, ["queued", "sending"]),
        or(
          and(eq(telegramBroadcastDeliveries.status, "queued"), or(sql`${telegramBroadcastDeliveries.nextAttemptAt} is null`, lte(telegramBroadcastDeliveries.nextAttemptAt, now))),
          and(eq(telegramBroadcastDeliveries.status, "sending"), lte(telegramBroadcastDeliveries.leaseUntil, now))
        )
      )
    )
    .limit(size);

  if (due.length === 0) return [];
  const leaseUntil = new Date(now.getTime() + LEASE_MS);
  const claimed = await db
    .update(telegramBroadcastDeliveries)
    .set({ status: "sending", leaseUntil, attempts: sql`${telegramBroadcastDeliveries.attempts} + 1` })
    .where(and(inArray(telegramBroadcastDeliveries.id, due.map((row) => row.id)), inArray(telegramBroadcastDeliveries.status, ["queued", "sending"])))
    .returning({
      id: telegramBroadcastDeliveries.id,
      broadcastId: telegramBroadcastDeliveries.broadcastId,
      chatId: telegramBroadcastDeliveries.chatId,
      telegramUserId: telegramBroadcastDeliveries.telegramUserId,
    });

  if (claimed.length === 0) return [];
  const broadcastIds = [...new Set(claimed.map((row) => row.broadcastId))];
  const broadcasts = await db
    .select({ id: telegramBroadcasts.id, content: telegramBroadcasts.content, messageType: telegramBroadcasts.messageType })
    .from(telegramBroadcasts)
    .where(inArray(telegramBroadcasts.id, broadcastIds));
  const byId = new Map(broadcasts.map((row) => [row.id, row]));
  await db
    .update(telegramBroadcasts)
    .set({ status: "sending", updatedAt: now })
    .where(and(inArray(telegramBroadcasts.id, broadcastIds), eq(telegramBroadcasts.status, "queued")));

  return claimed.map((row) => ({
    deliveryId: row.id,
    chatId: row.chatId ?? row.telegramUserId,
    text: byId.get(row.broadcastId)?.content ?? "",
    messageType: byId.get(row.broadcastId)?.messageType ?? "text",
  }));
}

export async function reportBroadcastResults(
  results: Array<{ deliveryId: string; status: "sent" | "failed" | "blocked"; error?: string | null; retryAfterSeconds?: number | null; telegramMessageId?: string | null }>
) {
  const now = new Date();
  const touched = new Set<string>();
  for (const result of results.slice(0, 50)) {
    const retry = result.status === "failed" && result.retryAfterSeconds && result.retryAfterSeconds > 0 && result.retryAfterSeconds < 3600;
    const [row] = await db
      .update(telegramBroadcastDeliveries)
      .set({
        status: retry ? "queued" : result.status === "sent" ? "sent" : result.status,
        errorMessage: result.error?.slice(0, 300) ?? null,
        telegramMessageId: result.telegramMessageId ?? null,
        deliveredAt: result.status === "sent" ? now : null,
        nextAttemptAt: retry ? new Date(now.getTime() + result.retryAfterSeconds! * 1000) : null,
        leaseUntil: null,
      })
      .where(eq(telegramBroadcastDeliveries.id, result.deliveryId))
      .returning({ broadcastId: telegramBroadcastDeliveries.broadcastId });
    if (row) touched.add(row.broadcastId);
  }

  for (const broadcastId of touched) {
    const [counts] = await db
      .select({
        sent: sql<number>`count(*) filter (where ${telegramBroadcastDeliveries.status} = 'sent')::int`,
        failed: sql<number>`count(*) filter (where ${telegramBroadcastDeliveries.status} = 'failed')::int`,
        blocked: sql<number>`count(*) filter (where ${telegramBroadcastDeliveries.status} = 'blocked')::int`,
        open: sql<number>`count(*) filter (where ${telegramBroadcastDeliveries.status} in ('queued','sending'))::int`,
      })
      .from(telegramBroadcastDeliveries)
      .where(eq(telegramBroadcastDeliveries.broadcastId, broadcastId));
    const done = (counts?.open ?? 0) === 0;
    await db
      .update(telegramBroadcasts)
      .set({
        sentCount: counts?.sent ?? 0,
        failedCount: counts?.failed ?? 0,
        blockedCount: counts?.blocked ?? 0,
        status: done ? ((counts?.failed ?? 0) > 0 && (counts?.sent ?? 0) === 0 ? "failed" : "sent") : "sending",
        completedAt: done ? now : null,
        updatedAt: now,
      })
      .where(and(eq(telegramBroadcasts.id, broadcastId), inArray(telegramBroadcasts.status, ["queued", "sending"])));
  }
  return { ok: true as const, updated: touched.size };
}
