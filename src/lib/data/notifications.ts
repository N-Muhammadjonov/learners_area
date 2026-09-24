import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { notifications, users } from "@/db/schema";

/**
 * In-app notifications.
 *
 * The centre's admission workflow must work with no external service
 * configured, so every notification is written here first. Telegram (or email)
 * is an *additional* delivery channel that a future integration may attach to
 * `notifyUsers` — never a dependency (see src/lib/services/integrations).
 */

export type NotificationInput = {
  type: string;
  title: string;
  body?: string | null;
  href?: string | null;
  payload?: Record<string, unknown>;
};

export async function notifyUsers(userIds: readonly string[], input: NotificationInput) {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (unique.length === 0) return;
  await db.insert(notifications).values(
    unique.map((userId) => ({
      userId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      href: input.href ?? null,
      payload: input.payload ?? null,
    }))
  );
}

/** Every active administrator and owner — the people who review admissions. */
export async function staffAdminUserIds(): Promise<string[]> {
  const rows = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.role, ["admin", "owner"]), eq(users.accountStatus, "active")));
  return rows.map((row) => row.id);
}

export async function listNotifications(userId: string, limit = 20) {
  return db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

export async function countUnread(userId: string): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return rows[0]?.count ?? 0;
}

export async function markNotificationsRead(userId: string, ids?: string[]) {
  const where = ids?.length
    ? and(eq(notifications.userId, userId), inArray(notifications.id, ids))
    : and(eq(notifications.userId, userId), isNull(notifications.readAt));
  await db.update(notifications).set({ readAt: new Date() }).where(where);
}

/** Notifications the caller may actually see — used by the bell in the topbar. */
export async function listUnread(userId: string, limit = 8) {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.userId, userId), or(isNull(notifications.readAt), isNull(notifications.readAt))))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}
