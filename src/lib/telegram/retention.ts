import "server-only";
import { and, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  telegramBroadcastDeliveries,
  telegramDeletionIntents,
  telegramFlowDrafts,
  telegramLoginIntents,
  telegramNotifications,
  telegramProcessedUpdates,
} from "@/db/schema";

function missingRelation(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String(error.cause ?? "")}` : String(error);
  return text.includes("42P01") || text.includes("does not exist");
}

/**
 * Telegram operational rows follow the centre's retention windows.
 * Login intents die quickly. Delivery logs follow the raw-event window.
 * This never deletes users, academic history, or the audit trail.
 * Missing tables (migration not applied yet) are skipped so production
 * retention keeps working.
 */
export async function cleanupTelegramRetention(input: { now: Date; rawEventCutoff: Date; dryRun: boolean; batchSize: number }) {
  try {
    const intentCutoff = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
    const staleIntents = await db
      .select({ id: telegramLoginIntents.id })
      .from(telegramLoginIntents)
      .where(
        and(
          lt(telegramLoginIntents.expiresAt, intentCutoff),
          inArray(telegramLoginIntents.status, ["pending", "confirmed", "consumed", "expired", "cancelled"])
        )
      )
      .limit(input.batchSize);

    const staleUpdates = await db
      .select({ updateId: telegramProcessedUpdates.updateId })
      .from(telegramProcessedUpdates)
      .where(lt(telegramProcessedUpdates.receivedAt, input.rawEventCutoff))
      .limit(input.batchSize);

    const staleNotices = await db
      .select({ id: telegramNotifications.id })
      .from(telegramNotifications)
      .where(and(lt(telegramNotifications.createdAt, input.rawEventCutoff), inArray(telegramNotifications.status, ["sent", "failed", "blocked", "cancelled"])))
      .limit(input.batchSize);

    const staleDeliveries = await db
      .select({ id: telegramBroadcastDeliveries.id })
      .from(telegramBroadcastDeliveries)
      .where(and(lt(telegramBroadcastDeliveries.deliveredAt, input.rawEventCutoff), inArray(telegramBroadcastDeliveries.status, ["sent", "failed", "blocked", "cancelled", "success"])))
      .limit(input.batchSize);

    const staleChallenges = await db
      .select({ id: telegramDeletionIntents.id })
      .from(telegramDeletionIntents)
      .where(lt(telegramDeletionIntents.expiresAt, intentCutoff))
      .limit(input.batchSize);

    if (!input.dryRun) {
      if (staleIntents.length) {
        await db.delete(telegramLoginIntents).where(inArray(telegramLoginIntents.id, staleIntents.map((row) => row.id)));
      }
      if (staleUpdates.length) {
        await db.delete(telegramProcessedUpdates).where(inArray(telegramProcessedUpdates.updateId, staleUpdates.map((row) => row.updateId)));
      }
      if (staleNotices.length) {
        await db.delete(telegramNotifications).where(inArray(telegramNotifications.id, staleNotices.map((row) => row.id)));
      }
      if (staleDeliveries.length) {
        await db.delete(telegramBroadcastDeliveries).where(inArray(telegramBroadcastDeliveries.id, staleDeliveries.map((row) => row.id)));
      }
      if (staleChallenges.length) {
        await db.delete(telegramDeletionIntents).where(inArray(telegramDeletionIntents.id, staleChallenges.map((row) => row.id)));
      }
    }

    const drafts = await cleanupFlowDrafts(input);

    return [
      { rule: "telegram_login_intents", affected: staleIntents.length, applied: !input.dryRun, note: "expired and consumed login intents older than one day" },
      drafts,
      { rule: "telegram_processed_updates", affected: staleUpdates.length, applied: !input.dryRun, note: "webhook dedup rows inside the raw-event window" },
      { rule: "telegram_notification_log", affected: staleNotices.length, applied: !input.dryRun, note: "finished notification deliveries inside the raw-event window" },
      { rule: "telegram_broadcast_deliveries", affected: staleDeliveries.length, applied: !input.dryRun, note: "finished broadcast deliveries inside the raw-event window" },
      { rule: "telegram_deletion_intents", affected: staleChallenges.length, applied: !input.dryRun, note: "expired deletion challenges" },
    ];
  } catch (error) {
    if (missingRelation(error)) {
      return [{ rule: "telegram_retention", affected: 0, applied: false, note: "telegram tables are not migrated; skipped" }];
    }
    throw error;
  }
}

async function cleanupFlowDrafts(input: { now: Date; dryRun: boolean; batchSize: number }) {
  try {
    const cutoff = new Date(input.now.getTime() - 24 * 60 * 60 * 1000);
    const stale = await db
      .select({ id: telegramFlowDrafts.id })
      .from(telegramFlowDrafts)
      .where(lt(telegramFlowDrafts.expiresAt, cutoff))
      .limit(input.batchSize);
    if (!input.dryRun && stale.length) {
      await db.delete(telegramFlowDrafts).where(inArray(telegramFlowDrafts.id, stale.map((row) => row.id)));
    }
    return { rule: "telegram_flow_drafts", affected: stale.length, applied: !input.dryRun, note: "expired compose drafts older than one day" };
  } catch (error) {
    if (missingRelation(error)) {
      return { rule: "telegram_flow_drafts", affected: 0, applied: false, note: "0021 is not applied; drafts skipped" };
    }
    throw error;
  }
}

export async function telegramTablesPresent() {
  const result = await db.execute(sql`select to_regclass('public.telegram_login_intents') as rel`);
  const rows = "rows" in result ? result.rows : result;
  const row = Array.isArray(rows) ? rows[0] : undefined;
  return Boolean(row && typeof row === "object" && "rel" in row && row.rel);
}
