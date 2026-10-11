import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBotSettings } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { BotActor } from "./actor";

export type RequiredChannel = { id: string; title: string; url: string };
const KEY = "required_channels";
const CHANNEL_ID = /^-100[0-9]{5,20}$/;
const LINK = /^https:\/\/t\.me\/(?:[a-zA-Z0-9_]{4,}|\+[a-zA-Z0-9_-]+)$/;

function decode(value: unknown): RequiredChannel[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value) || value.length > 4) throw new Error("required_channels_corrupt");
  const used = new Set<string>();
  return value.map((entry) => {
    if (!entry || typeof entry !== "object") throw new Error("required_channels_corrupt");
    const row = entry as Record<string, unknown>;
    if (typeof row.id !== "string" || !CHANNEL_ID.test(row.id)
      || typeof row.title !== "string" || row.title.length < 1 || row.title.length > 120
      || typeof row.url !== "string" || !LINK.test(row.url) || used.has(row.id)) {
      throw new Error("required_channels_corrupt");
    }
    used.add(row.id);
    return { id: row.id, title: row.title, url: row.url };
  });
}

export async function listRequiredChannels(): Promise<RequiredChannel[]> {
  const row = await db.query.telegramBotSettings.findFirst({
    where: eq(telegramBotSettings.key, KEY),
  });
  return decode(row?.value);
}

/**
 * One server-authoritative settings row. A transaction-level advisory lock
 * serializes concurrent owner changes, so a race cannot add a fifth channel.
 */
export async function changeRequiredChannels(
  actor: BotActor, action: "add" | "remove", candidate: RequiredChannel | { id: string },
) {
  if (!actor.isPrimaryOwner) return { ok: false as const, error: "forbidden" };
  if (!CHANNEL_ID.test(candidate.id)) return { ok: false as const, error: "invalid_channel" };
  const outcome = await db.transaction(async (tx) => {
    await tx.execute(sql.raw("select pg_advisory_xact_lock(719335, 103)"));
    const [row] = await tx.select({ value: telegramBotSettings.value })
      .from(telegramBotSettings).where(eq(telegramBotSettings.key, KEY));
    const channels = decode(row?.value);
    let next: RequiredChannel[];
    if (action === "add") {
      if (!("title" in candidate) || !("url" in candidate)
        || typeof candidate.title !== "string" || candidate.title.length < 1
        || candidate.title.length > 120 || typeof candidate.url !== "string"
        || !LINK.test(candidate.url)) return { ok: false as const, error: "invalid_channel" };
      if (channels.some((c) => c.id === candidate.id)) return { ok: true as const, channels };
      if (channels.length >= 4) return { ok: false as const, error: "max_channels" };
      next = [...channels, { id: candidate.id, title: candidate.title, url: candidate.url }];
    } else if (action === "remove") {
      next = channels.filter((c) => c.id !== candidate.id);
    } else return { ok: false as const, error: "invalid_action" };
    await tx.insert(telegramBotSettings).values({
      key: KEY, value: next, updatedByTelegramId: actor.telegramUserId, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: telegramBotSettings.key,
      set: { value: next, updatedByTelegramId: actor.telegramUserId, updatedAt: new Date() },
    });
    return { ok: true as const, channels: next };
  });
  if (outcome.ok) {
    await recordAudit({
      actorUserId: actor.auditUserId,
      action: "telegram.required_channels_changed",
      targetType: "telegram_bot_setting",
      targetId: KEY,
      metadata: { actorTelegramId: actor.telegramUserId, action, channelId: candidate.id },
    });
  }
  return outcome;
}

type SubscriptionCheck =
  | { ok: true }
  | { ok: false; error: "not_subscribed" | "membership_unavailable"; channels: RequiredChannel[] };

/** A fresh Telegram getChatMember for EACH channel before application creation. */
export async function checkRequiredSubscriptions(telegramUserId: string): Promise<SubscriptionCheck> {
  const channels = await listRequiredChannels();
  if (!channels.length) return { ok: true };
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return { ok: false, error: "membership_unavailable", channels };
  try {
    const checked = await Promise.all(channels.map(async (channel) => {
      const params = new URLSearchParams({ chat_id: channel.id, user_id: telegramUserId });
      const response = await fetch("https://api.telegram.org/bot" + token + "/getChatMember?" + params, {
        cache: "no-store", signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error("telegram_membership_unavailable");
      const body = await response.json() as { ok?: boolean; result?: { status?: string; is_member?: boolean } };
      if (!body.ok || !body.result) throw new Error("telegram_membership_unavailable");
      const status = body.result.status;
      return status === "creator" || status === "administrator" || status === "member"
        || (status === "restricted" && body.result.is_member === true);
    }));
    if (checked.every(Boolean)) return { ok: true };
    return { ok: false, error: "not_subscribed", channels };
  } catch {
    return { ok: false, error: "membership_unavailable", channels };
  }
}
