import "server-only";
import { eq, sql } from "drizzle-orm";
import { recordAudit } from "@/lib/data/audit";
import { db } from "@/db/client";
import { users } from "@/db/schema";
import { RIWI_CONVERSATION_OFFLINE_DAYS, RIWI_CONVERSATION_TTL_DAYS } from "./contracts";

const DAY_MS = 86_400_000;
const TOUCH_INTERVAL_MS = 60_000;
type RetentionDatabase = Pick<typeof db, "execute">;

/** Online time is authenticated site use, independent of learning activity. */
export async function recordRiwiOnlineActivity(userId: string, now = new Date(), database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async (tx) => {
    // The sweep locks the same user row. A returning user cannot refresh their
    // timestamp before the offline chat deletion has been evaluated.
    const [user] = await tx.select({ id: users.id, lastActiveAt: users.lastActiveAt })
      .from(users).where(eq(users.id, userId)).limit(1).for("update");
    if (!user) return;
    if (user.lastActiveAt.getTime() < now.getTime() - RIWI_CONVERSATION_OFFLINE_DAYS * DAY_MS) {
      const removed = await tx.execute<{ count: number }>(sql`
        with removed as (delete from riwi_conversations where user_id = ${userId}::uuid returning id)
        select count(*)::int as count from removed`);
      if (removed.rows[0]?.count) await recordAudit({ actorUserId: userId, action: "retention.cleanup",
        targetType: "riwi_conversation", metadata: { rule: "offline_more_than_7_days", conversations: removed.rows[0].count } }, tx);
    }
    if (user.lastActiveAt.getTime() <= now.getTime() - TOUCH_INTERVAL_MS) {
      await tx.update(users).set({ lastActiveAt: now }).where(eq(users.id, userId));
    }
  });
}

/** Called inside the retention transaction, or with dryRun=true for a preview. */
export async function sweepRiwiConversationsOn(database: RetentionDatabase, options: { now: Date; dryRun: boolean; batchSize: number }) {
  const offlineCutoff = new Date(options.now.getTime() - RIWI_CONVERSATION_OFFLINE_DAYS * DAY_MS);
  const messageCutoff = new Date(options.now.getTime() - RIWI_CONVERSATION_TTL_DAYS * DAY_MS);
  const batchSize = Math.max(1, Math.min(5000, Math.floor(options.batchSize)));
  if (options.dryRun) {
    const result = await database.execute<{ offlineChats: number; oldMessages: number; expiredChats: number }>(sql`
      select
        (select count(*)::int from riwi_conversations c join users u on u.id = c.user_id
          where u.last_active_at < ${offlineCutoff}) as "offlineChats",
        (select count(*)::int from riwi_conversation_messages where created_at < ${messageCutoff}) as "oldMessages",
        (select count(*)::int from riwi_conversations where expires_at <= ${options.now}) as "expiredChats"`);
    return { ...result.rows[0]!, applied: false, complete: true };
  }
  let offlineChats = 0;
  let oldMessages = 0;
  let expiredChats = 0;
  let complete = false;
  for (let round = 0; round < 100; round++) {
    // Lock only users whose chats need deletion, in the same order as online
    // touches. Re-check inactivity under the lock; avoid auth/sweep races.
    const offline = await database.execute<{ id: string }>(sql`
      with offline_users as (
        select u.id from users u where u.last_active_at < ${offlineCutoff}
          and exists (select 1 from riwi_conversations c where c.user_id = u.id)
        order by u.id limit ${batchSize} for update skip locked
      ) delete from riwi_conversations c using offline_users u where c.user_id = u.id returning c.id`);
    const messages = await database.execute<{ id: string }>(sql`
      with old_messages as (
        select id from riwi_conversation_messages where created_at < ${messageCutoff}
        order by created_at, id limit ${batchSize} for update skip locked
      ) delete from riwi_conversation_messages m using old_messages o where m.id = o.id returning m.id`);
    const expired = await database.execute<{ id: string }>(sql`
      with expired_chats as (
        select id from riwi_conversations where expires_at <= ${options.now}
        order by expires_at, id limit ${batchSize} for update skip locked
      ) delete from riwi_conversations c using expired_chats e where c.id = e.id
        and c.expires_at <= ${options.now} returning c.id`);
    offlineChats += offline.rows.length;
    oldMessages += messages.rows.length;
    expiredChats += expired.rows.length;
    if (!offline.rows.length && !messages.rows.length && !expired.rows.length) {
      complete = true;
      break;
    }
  }
  return { offlineChats, oldMessages, expiredChats, applied: true, complete };
}

export async function runRiwiConversationRetention(options: { now?: Date; dryRun?: boolean } = {}, database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async (tx) => {
    const lockResult = await tx.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('learners_area.riwi.chat_retention')) as got`);
    if (!lockResult.rows[0]?.got) return { locked: false as const };
    const result = await sweepRiwiConversationsOn(tx, { now: options.now ?? new Date(), dryRun: options.dryRun ?? true, batchSize: 500 });
    if (result.applied && (result.offlineChats || result.oldMessages || result.expiredChats)) {
      await recordAudit({ actorUserId: null, action: "retention.cleanup", targetType: "riwi_conversation",
        metadata: { offlineConversations: result.offlineChats, oldMessages: result.oldMessages, expiredConversations: result.expiredChats, complete: result.complete } }, tx);
    }
    return { locked: true as const, ...result };
  });
}
