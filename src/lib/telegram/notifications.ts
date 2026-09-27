import "server-only";
import { and, eq, inArray, lte, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, telegramNotifications, users } from "@/db/schema";
import { isTelegramUserId } from "./ids";

export type NoticeCategory = "critical" | "optional";

const CRITICAL_TYPES = new Set(["account.approved", "account.rejected", "account.suspended", "account.unsuspended"]);

function missingRelation(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return text.includes("42P01") || text.includes("does not exist");
}

export async function enqueueTelegramNotice(input: {
  userId?: string | null;
  telegramUserId?: string | null;
  type: string;
  title: string;
  body?: string | null;
  category?: NoticeCategory;
  correlationId?: string | null;
}) {
  try {
    let telegramUserId = input.telegramUserId ?? null;
    if (!telegramUserId && input.userId) {
      const user = await db.query.users.findFirst({
        where: eq(users.id, input.userId),
        columns: { telegramId: true },
      });
      telegramUserId = user?.telegramId ?? null;
    }
    if (!telegramUserId || !isTelegramUserId(telegramUserId)) return { queued: false as const, reason: "no_telegram" };

    const contact = await db.query.telegramContacts.findFirst({
      where: eq(telegramContacts.telegramUserId, telegramUserId),
    });
    if (!contact || contact.removedAt || contact.botBlockedAt) return { queued: false as const, reason: "unavailable" };

    const category: NoticeCategory = input.category ?? (CRITICAL_TYPES.has(input.type) ? "critical" : "optional");
    const prefs = (contact.notificationPrefs ?? {}) as { announcements?: boolean; reminders?: boolean };
    if (category === "optional") {
      const allowed = input.type.startsWith("reminder") ? prefs.reminders === true : prefs.announcements === true;
      if (!allowed) return { queued: false as const, reason: "preference" };
    }

    await db.insert(telegramNotifications).values({
      telegramUserId,
      category,
      type: input.type.slice(0, 64),
      title: input.title.slice(0, 200),
      body: input.body?.slice(0, 1000) ?? null,
      correlationId: input.correlationId ?? null,
    });
    return { queued: true as const };
  } catch (error) {
    if (!missingRelation(error)) console.error("[telegram] notice enqueue skipped");
    return { queued: false as const, reason: "unavailable" };
  }
}

export async function readNotificationPrefs(telegramUserId: string) {
  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, telegramUserId),
  });
  const prefs = (contact?.notificationPrefs ?? {}) as { announcements?: boolean; reminders?: boolean };
  return {
    locale: contact?.localeOverride ?? contact?.languageCode ?? "uz",
    announcements: prefs.announcements === true,
    reminders: prefs.reminders === true,
    accountNotices: true,
  };
}

export async function writeNotificationPrefs(input: {
  telegramUserId: string;
  announcements?: boolean;
  reminders?: boolean;
  locale?: "uz" | "en";
}) {
  const current = await readNotificationPrefs(input.telegramUserId);
  const next = {
    announcements: input.announcements ?? current.announcements,
    reminders: input.reminders ?? current.reminders,
  };
  await db
    .update(telegramContacts)
    .set({
      notificationPrefs: next,
      localeOverride: input.locale ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(telegramContacts.telegramUserId, input.telegramUserId));
  return { ...next, locale: input.locale ?? current.locale, accountNotices: true as const };
}

export async function claimNotificationBatch(limit = 20) {
  const now = new Date();
  const size = Math.min(Math.max(limit, 1), 30);
  const due = await db
    .select({ id: telegramNotifications.id })
    .from(telegramNotifications)
    .where(
      and(
        or(
          and(eq(telegramNotifications.status, "queued"), or(sql`${telegramNotifications.nextAttemptAt} is null`, lte(telegramNotifications.nextAttemptAt, now))),
          and(eq(telegramNotifications.status, "sending"), lte(telegramNotifications.leaseUntil, now))
        )
      )
    )
    .limit(size);
  if (due.length === 0) return [];
  const claimed = await db
    .update(telegramNotifications)
    .set({
      status: "sending",
      leaseUntil: new Date(now.getTime() + 90_000),
      attempts: sql`${telegramNotifications.attempts} + 1`,
    })
    .where(and(inArray(telegramNotifications.id, due.map((row) => row.id)), inArray(telegramNotifications.status, ["queued", "sending"])))
    .returning({
      id: telegramNotifications.id,
      telegramUserId: telegramNotifications.telegramUserId,
      title: telegramNotifications.title,
      body: telegramNotifications.body,
      category: telegramNotifications.category,
      type: telegramNotifications.type,
    });
  const contacts = claimed.length
    ? await db
        .select({ telegramUserId: telegramContacts.telegramUserId, chatId: telegramContacts.chatId, blocked: telegramContacts.botBlockedAt, removed: telegramContacts.removedAt })
        .from(telegramContacts)
        .where(inArray(telegramContacts.telegramUserId, claimed.map((row) => row.telegramUserId)))
    : [];
  const byUser = new Map(contacts.map((row) => [row.telegramUserId, row]));
  return claimed.map((row) => {
    const contact = byUser.get(row.telegramUserId);
    const unavailable = !contact || contact.blocked || contact.removed;
    return {
      id: row.id,
      chatId: unavailable ? null : contact?.chatId ?? row.telegramUserId,
      title: row.title,
      body: row.body,
      category: row.category,
      type: row.type,
      unavailable,
    };
  });
}

export async function reportNotificationResults(
  results: Array<{ id: string; status: "sent" | "failed" | "blocked"; error?: string | null; retryAfterSeconds?: number | null }>
) {
  const now = new Date();
  for (const result of results.slice(0, 50)) {
    const retry = result.status === "failed" && result.retryAfterSeconds && result.retryAfterSeconds > 0 && result.retryAfterSeconds < 3600;
    await db
      .update(telegramNotifications)
      .set({
        status: retry ? "queued" : result.status,
        errorMessage: result.error?.slice(0, 300) ?? null,
        sentAt: result.status === "sent" ? now : null,
        nextAttemptAt: retry ? new Date(now.getTime() + result.retryAfterSeconds! * 1000) : null,
        leaseUntil: null,
      })
      .where(eq(telegramNotifications.id, result.id));
  }
  return { ok: true as const };
}
