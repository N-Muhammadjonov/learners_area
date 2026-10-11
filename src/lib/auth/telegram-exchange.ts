import "server-only";
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, telegramLoginIntents, users } from "@/db/schema";
import { hashToken } from "@/lib/auth/telegram-intent";
import { createAccessRequest, findOpenRequestForUser } from "@/lib/data/admission";
import { recordAudit } from "@/lib/data/audit";
import type { ExchangeOutcome } from "@/lib/telegram/intent-purpose";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { checkRequiredSubscriptions } from "@/lib/telegram/required-channels";

type UserRow = typeof users.$inferSelect;

export type ExchangeResult =
  | { ok: false; error: "intent_not_confirmed" | "expired" | "already_consumed" | "no_linked_account" | "conflict" | "missing_user" | "phone_required" | "not_subscribed" | "membership_unavailable" }
  | { ok: true; user: UserRow; outcome: ExchangeOutcome };

function clipName(value: string | null | undefined) {
  const name = (value ?? "").trim().slice(0, 200);
  return name || "Telegram";
}

/**
 * Apply the server-owned purpose. Does not consume the intent and does not
 * issue a session. The intent row is locked so two exchanges of the same
 * confirmation cannot both create an account. Login never inserts a user.
 */
export async function prepareIntentExchange(intentId: string, browserNonce: string): Promise<ExchangeResult> {
  const nonceHash = hashToken(browserNonce);
  // The website registration path must enforce the SAME admission prerequisites
  // as the bot's /apply API; otherwise applicants could bypass the channel gate.
  const preflight = await db.query.telegramLoginIntents.findFirst({
    where: and(
      eq(telegramLoginIntents.id, intentId),
      eq(telegramLoginIntents.browserNonceHash, nonceHash),
      eq(telegramLoginIntents.status, "confirmed"),
    ),
    columns: { telegramUserId: true, purpose: true },
  });
  if (preflight?.purpose === "register" && preflight.telegramUserId) {
    const contact = await db.query.telegramContacts.findFirst({
      where: eq(telegramContacts.telegramUserId, preflight.telegramUserId),
      columns: { phoneNumber: true, phoneVerifiedAt: true },
    });
    if (!contact?.phoneNumber || !contact.phoneVerifiedAt) {
      return { ok: false, error: "phone_required" };
    }
    const membership = await checkRequiredSubscriptions(preflight.telegramUserId);
    if (!membership.ok) return { ok: false, error: membership.error };
  }
  const prepared = await db.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(telegramLoginIntents)
      .where(and(eq(telegramLoginIntents.id, intentId), eq(telegramLoginIntents.browserNonceHash, nonceHash)))
      .for("update")
      .limit(1);
    if (!intent) return { ok: false as const, error: "intent_not_confirmed" as const };
    if (intent.status === "consumed") return { ok: false as const, error: "already_consumed" as const };
    if (intent.status !== "confirmed" || !intent.telegramUserId || !isTelegramUserId(intent.telegramUserId)) {
      return { ok: false as const, error: "intent_not_confirmed" as const };
    }
    if (intent.expiresAt.getTime() <= Date.now()) return { ok: false as const, error: "expired" as const };

    const purpose = intent.purpose === "register" || intent.purpose === "link" ? intent.purpose : "login";
    if (purpose === "login") {
      const [user] = await tx.select().from(users).where(eq(users.telegramId, intent.telegramUserId)).limit(1);
      if (!user) return { ok: false as const, error: "no_linked_account" as const };
      return { ok: true as const, user, outcome: "session" as const };
    }
    if (purpose === "link") {
      if (!intent.userId) return { ok: false as const, error: "missing_user" as const };
      const linked = await linkForIntent(tx, intent.userId, intent.telegramUserId);
      if (!linked.ok) return { ok: false as const, error: linked.error };
      const [user] = await tx.select().from(users).where(eq(users.id, intent.userId)).limit(1);
      if (!user) return { ok: false as const, error: "missing_user" as const };
      return { ok: true as const, user, outcome: "session" as const };
    }

    const [existing] = await tx.select().from(users).where(eq(users.telegramId, intent.telegramUserId)).limit(1);
    if (existing) return { ok: true as const, user: existing, outcome: "existing" as const, displayName: intent.displayName };
    const [created] = await tx
      .insert(users)
      .values({
        telegramId: intent.telegramUserId,
        name: clipName(intent.displayName),
        role: "student",
        accountStatus: "pending",
        locale: intent.languageCode === "en" ? "en" : "uz",
      })
      .returning();
    if (!created) return { ok: false as const, error: "intent_not_confirmed" as const };
    return { ok: true as const, user: created, outcome: "created" as const };
  });

  if (!prepared.ok) return prepared;
  if (prepared.outcome === "session") return { ok: true, user: prepared.user, outcome: "session" };
  return finishRegister(prepared.user);
}

async function linkForIntent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  telegramUserId: string
) {
  const [taken] = await tx.select({ id: users.id }).from(users).where(eq(users.telegramId, telegramUserId)).limit(1);
  if (taken && taken.id !== userId) return { ok: false as const, error: "conflict" as const };
  const [target] = await tx.select({ id: users.id, telegramId: users.telegramId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return { ok: false as const, error: "missing_user" as const };
  if (target.telegramId && target.telegramId !== telegramUserId) return { ok: false as const, error: "conflict" as const };
  if (taken && taken.id === userId) return { ok: true as const };
  const updated = await tx
    .update(users)
    .set({ telegramId: telegramUserId })
    .where(and(eq(users.id, userId), or(isNull(users.telegramId), eq(users.telegramId, telegramUserId))))
    .returning({ id: users.id });
  if (updated.length === 0) return { ok: false as const, error: "conflict" as const };
  await tx
    .update(telegramContacts)
    .set({ linkedUserId: userId, updatedAt: new Date() })
    .where(eq(telegramContacts.telegramUserId, telegramUserId));
  await recordAudit({
    actorUserId: userId,
    action: "telegram.linked",
    targetType: "user",
    targetId: userId,
    metadata: { source: "telegram_intent_link", telegramUserId },
  });
  return { ok: true as const };
}

async function finishRegister(user: UserRow): Promise<ExchangeResult> {
  if (user.accountStatus === "active") return { ok: true, user, outcome: "already_active" };
  if (user.accountStatus === "suspended") return { ok: true, user, outcome: "suspended" };
  const open = await findOpenRequestForUser(user.id);
  if (open) return { ok: true, user, outcome: "already_pending" };
  const wasRejected = user.accountStatus === "rejected";
  await createAccessRequest({
    userId: user.id,
    metadata: { source: "telegram_website_register", telegramUserId: user.telegramId },
  });
  const fresh = (await db.query.users.findFirst({ where: eq(users.id, user.id) })) ?? user;
  return { ok: true, user: fresh, outcome: wasRejected ? "reopened" : "pending" };
}
