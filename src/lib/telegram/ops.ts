import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog, telegramBotSettings, telegramContacts, telegramSupportThreads, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { BotActor } from "./actor";

/** Bot settings are a whitelist. Owner identity is not one of them; handover is the only writer. */
const SETTING_KEYS = ["default_locale", "support_enabled", "broadcasts_enabled"] as const;
type SettingKey = (typeof SETTING_KEYS)[number];

function isSettingKey(value: string): value is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(value);
}

export async function botStats() {
  const [accounts] = await db
    .select({
      pending: sql<number>`count(*) filter (where ${users.accountStatus} = 'pending')::int`,
      active: sql<number>`count(*) filter (where ${users.accountStatus} = 'active')::int`,
      rejected: sql<number>`count(*) filter (where ${users.accountStatus} = 'rejected')::int`,
      suspended: sql<number>`count(*) filter (where ${users.accountStatus} = 'suspended')::int`,
    })
    .from(users);
  const [contacts] = await db
    .select({
      contacts: sql<number>`count(*)::int`,
      blocked: sql<number>`count(*) filter (where ${telegramContacts.botBlockedAt} is not null)::int`,
      removed: sql<number>`count(*) filter (where ${telegramContacts.removedAt} is not null)::int`,
    })
    .from(telegramContacts);
  const [support] = await db
    .select({
      open: sql<number>`count(*) filter (where ${telegramSupportThreads.status} <> 'closed')::int`,
    })
    .from(telegramSupportThreads);
  return { accounts, contacts, support };
}

export async function botAudit(limit = 20, page = 1) {
  const size = Math.min(Math.max(limit, 1), 30);
  const safePage = Math.max(page || 1, 1);
  const rows = await db.select().from(auditLog).orderBy(sql`${auditLog.createdAt} desc`).limit(size).offset((safePage - 1) * size);
  return rows.map((row) => ({
    action: row.action,
    targetType: row.targetType,
    targetId: row.targetId,
    createdAt: row.createdAt,
    metadata: row.metadata,
  }));
}

export async function readBotSettings() {
  const rows = await db.select().from(telegramBotSettings);
  const map = new Map(rows.map((row) => [row.key, row.value]));
  return {
    default_locale: map.get("default_locale") === "en" ? "en" : "uz",
    support_enabled: map.get("support_enabled") !== false,
    broadcasts_enabled: map.get("broadcasts_enabled") !== false,
  };
}

export async function writeBotSetting(actor: BotActor, key: string, value: unknown) {
  if (!isSettingKey(key)) return { ok: false as const, error: "invalid_setting" };
  let stored: unknown = value;
  if (key === "default_locale") {
    if (value !== "uz" && value !== "en") return { ok: false as const, error: "invalid_setting" };
    stored = value;
  } else if (typeof value !== "boolean") {
    return { ok: false as const, error: "invalid_setting" };
  }
  const now = new Date();
  await db
    .insert(telegramBotSettings)
    .values({ key, value: stored, updatedAt: now, updatedByTelegramId: actor.telegramUserId })
    .onConflictDoUpdate({
      target: telegramBotSettings.key,
      set: { value: stored, updatedAt: now, updatedByTelegramId: actor.telegramUserId },
    });
  await recordAudit({
    actorUserId: actor.auditUserId,
    action: "bot_settings.changed",
    targetType: "telegram_bot_setting",
    targetId: key,
    metadata: { source: "telegram_bot", actorTelegramId: actor.telegramUserId, value: stored },
  });
  return { ok: true as const, key, value: stored };
}

export async function settingEnabled(key: "support_enabled" | "broadcasts_enabled") {
  const row = await db.query.telegramBotSettings.findFirst({ where: eq(telegramBotSettings.key, key) });
  return row?.value !== false;
}
