import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db/client";
import { accessEventsConnectionString } from "./access-event-config";

/**
 * ONE publish on the actual staff/owner mutation path. No table triggers, no
 * background identity poller, and no database schema migration required.
 *
 * The role/status write has already committed at this point. NOTIFY is only
 * a best-effort UX invalidation; it cannot authorize, revoke or veto a write.
 * All existing server-side role and active-account guards remain authoritative.
 */
export async function publishAccessChange(userId: string): Promise<void> {
  if (!accessEventsConnectionString()) return;
  try {
    await db.execute(sql`select pg_notify('la_access_changed', ${JSON.stringify({ userId })})`);
  } catch {
    // Client push is non-critical. On reconnect and on the next private request
    // the server rechecks the database before any protected content is returned.
    console.warn("[auth-events] access invalidation publish unavailable");
  }
}

export async function publishAccessChanges(userIds: readonly string[]): Promise<void> {
  await Promise.all([...new Set(userIds)].map((id) => publishAccessChange(id)));
}
