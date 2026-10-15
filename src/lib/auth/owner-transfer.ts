import "server-only";
import { randomBytes, createHash } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  ownershipTransferChallenges,
  ownershipTransfers,
  telegramContacts,
  telegramOwnerHandovers,
  users,
} from "@/db/schema";
import { countActiveOwnersIn } from "@/lib/auth/owner-invariant";
import { recordAudit } from "@/lib/data/audit";
import { notifyUsers } from "@/lib/data/notifications";
import { publishAccessChanges } from "@/lib/auth/publish-access-change";
import {
  WEBSITE_OWNER_TRANSFER,
  canInitiateWebsiteTransfer,
  decideWebsiteChallenge,
  isKeepRole,
  liveOwnerCommitAllowed,
  websiteTransferNotice,
  type KeepRole,
} from "@/lib/auth/owner-challenge";
import { enqueueTelegramNotice } from "@/lib/telegram/notifications";
import { isTelegramUserId } from "@/lib/telegram/ids";
import { isEffectivePrimaryOwner, lockOwnerAuthority, readEffectivePrimaryOwnerIn } from "@/lib/telegram/owner-store";

const TTL_MS = 5 * 60 * 1000;

function hashNonce(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function reachable(telegramUserId: string | null) {
  if (!telegramUserId || !isTelegramUserId(telegramUserId)) return false;
  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, telegramUserId),
  });
  return Boolean(contact && !contact.removedAt && !contact.botBlockedAt);
}

export async function initiateWebsiteTransfer(input: {
  actorId: string;
  email: string;
  passwordOk: boolean;
  hasPassword: boolean;
  keepRole: KeepRole;
  includeBotHandover: boolean;
}) {
  const actor = await db.query.users.findFirst({ where: eq(users.id, input.actorId) });
  if (!actor) return { ok: false as const, error: "forbidden" as const };
  const target = await db.query.users.findFirst({ where: eq(users.email, input.email) });
  const actorIsBotOwner = Boolean(actor.telegramId && (await isEffectivePrimaryOwner(actor.telegramId)));
  const actorReachable = await reachable(actor.telegramId);
  const targetKnown = input.includeBotHandover ? await reachable(target?.telegramId ?? null) : false;
  const gate = canInitiateWebsiteTransfer({
    actorRole: actor.role,
    actorActive: actor.accountStatus === "active",
    hasPassword: input.hasPassword,
    passwordOk: input.passwordOk,
    actorTelegramId: actor.telegramId,
    actorReachable,
    actorId: actor.id,
    targetFound: Boolean(target),
    targetId: target?.id,
    targetStatus: target?.accountStatus,
    includeBotHandover: input.includeBotHandover,
    actorIsBotOwner,
    targetTelegramId: target?.telegramId ?? null,
    targetKnown,
  });
  if (!gate.ok) return gate;
  if (!target || !actor.telegramId || !isTelegramUserId(actor.telegramId)) {
    return { ok: false as const, error: "telegram_not_linked" as const };
  }

  const browserNonce = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);
  const [challenge] = await db
    .insert(ownershipTransferChallenges)
    .values({
      fromUserId: actor.id,
      toUserId: target.id,
      requestedKeepRole: input.keepRole,
      purpose: WEBSITE_OWNER_TRANSFER,
      telegramUserId: actor.telegramId,
      browserNonceHash: hashNonce(browserNonce),
      includeBotHandover: input.includeBotHandover,
      targetTelegramId: input.includeBotHandover ? target.telegramId : null,
      expiresAt,
    })
    .returning({ id: ownershipTransferChallenges.id });
  if (!challenge) return { ok: false as const, error: "forbidden" as const };

  const notice = websiteTransferNotice({
    targetName: target.name,
    targetEmail: target.email ?? "",
    keepRole: input.keepRole,
    includeBotHandover: input.includeBotHandover,
  });
  await enqueueTelegramNotice({
    telegramUserId: actor.telegramId,
    type: "website.owner_transfer",
    title: notice.title,
    body: notice.body,
    category: "critical",
    correlationId: challenge.id,
  });
  await recordAudit({
    actorUserId: actor.id,
    action: "ownership.transfer_challenged",
    targetType: "user",
    targetId: target.id,
    metadata: {
      challengeId: challenge.id,
      keepRole: input.keepRole,
      includeBotHandover: input.includeBotHandover,
      telegramUserId: actor.telegramId,
    },
  });
  return {
    ok: true as const,
    status: "pending" as const,
    challengeId: challenge.id,
    browserNonce,
    expiresAt,
    includeBotHandover: input.includeBotHandover,
  };
}

export async function readWebsiteChallenge(input: { actorId: string; challengeId: string; browserNonce: string }) {
  const row = await db.query.ownershipTransferChallenges.findFirst({
    where: and(
      eq(ownershipTransferChallenges.id, input.challengeId),
      eq(ownershipTransferChallenges.fromUserId, input.actorId),
      eq(ownershipTransferChallenges.browserNonceHash, hashNonce(input.browserNonce))
    ),
  });
  if (!row) return null;
  const expired = row.status === "pending" && row.expiresAt.getTime() <= Date.now();
  return {
    status: expired ? "expired" : row.status,
    includeBotHandover: row.includeBotHandover,
    expiresAt: row.expiresAt,
  };
}

export async function cancelWebsiteChallenge(input: { actorId: string; challengeId: string; browserNonce: string }) {
  const [updated] = await db
    .update(ownershipTransferChallenges)
    .set({ status: "cancelled", cancelledAt: new Date() })
    .where(
      and(
        eq(ownershipTransferChallenges.id, input.challengeId),
        eq(ownershipTransferChallenges.fromUserId, input.actorId),
        eq(ownershipTransferChallenges.browserNonceHash, hashNonce(input.browserNonce)),
        eq(ownershipTransferChallenges.status, "pending")
      )
    )
    .returning({ id: ownershipTransferChallenges.id, toUserId: ownershipTransferChallenges.toUserId });
  if (!updated) return false;
  await recordAudit({
    actorUserId: input.actorId,
    action: "ownership.transfer_cancelled",
    targetType: "user",
    targetId: updated.toUserId,
    metadata: { challengeId: updated.id },
  });
  return true;
}

export async function decideWebsiteChallengeFromTelegram(input: {
  challengeId: string;
  actorTelegramId: string;
  decision: "approve" | "reject";
}) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    const [challenge] = await tx
      .select()
      .from(ownershipTransferChallenges)
      .where(eq(ownershipTransferChallenges.id, input.challengeId))
      .for("update")
      .limit(1);
    if (!challenge) return { ok: false as const, error: "not_found" as const };
    const verdict = decideWebsiteChallenge({
      status: challenge.status,
      purpose: challenge.purpose,
      expiresAtMs: challenge.expiresAt.getTime(),
      boundTelegramId: challenge.telegramUserId,
      actorTelegramId: input.actorTelegramId,
      decision: input.decision,
      nowMs: now.getTime(),
    });
    if (verdict.action === "already") return { ok: true as const, already: true as const };
    if (verdict.action === "deny") {
      if (verdict.error === "expired" && challenge.status === "pending") {
        await tx
          .update(ownershipTransferChallenges)
          .set({ status: "expired" })
          .where(and(eq(ownershipTransferChallenges.id, challenge.id), eq(ownershipTransferChallenges.status, "pending")));
      }
      return { ok: false as const, error: verdict.error };
    }
    if (verdict.action === "reject") {
      const [rejected] = await tx
        .update(ownershipTransferChallenges)
        .set({ status: "rejected", rejectedAt: now })
        .where(and(eq(ownershipTransferChallenges.id, challenge.id), eq(ownershipTransferChallenges.status, "pending")))
        .returning({ id: ownershipTransferChallenges.id });
      if (!rejected) return { ok: false as const, error: "replay" as const };
      return { ok: true as const, rejected: true as const, fromUserId: challenge.fromUserId, toUserId: challenge.toUserId };
    }

    const [actor] = await tx.select().from(users).where(eq(users.id, challenge.fromUserId)).for("update").limit(1);
    const [target] = await tx.select().from(users).where(eq(users.id, challenge.toUserId)).for("update").limit(1);
    const abort = async (error: "aborted" | "target_not_active" | "target_telegram_missing" | "bot_owner_mismatch") => {
      await tx
        .update(ownershipTransferChallenges)
        .set({ status: "cancelled", cancelledAt: now })
        .where(and(eq(ownershipTransferChallenges.id, challenge.id), eq(ownershipTransferChallenges.status, "pending")));
      return { ok: false as const, error };
    };
    if (!actor || actor.role !== "owner" || actor.accountStatus !== "active" || actor.telegramId !== challenge.telegramUserId) {
      return abort("aborted");
    }
    if (!target || target.id === actor.id || target.accountStatus !== "active") {
      return abort("target_not_active");
    }
    if (!isKeepRole(challenge.requestedKeepRole)) return abort("aborted");

    if (challenge.includeBotHandover) {
      if (!target.telegramId || target.telegramId !== challenge.targetTelegramId) return abort("target_telegram_missing");
      const [contact] = await tx
        .select({ removedAt: telegramContacts.removedAt, botBlockedAt: telegramContacts.botBlockedAt })
        .from(telegramContacts)
        .where(eq(telegramContacts.telegramUserId, target.telegramId))
        .limit(1);
      if (!contact || contact.removedAt || contact.botBlockedAt) return abort("target_telegram_missing");
      await lockOwnerAuthority(tx);
      const effective = await readEffectivePrimaryOwnerIn(tx);
      if (effective.id !== challenge.telegramUserId) return abort("bot_owner_mismatch");
    }

    const keepRole = challenge.requestedKeepRole;
    await tx.update(users).set({ role: "owner" }).where(eq(users.id, target.id));
    await tx.update(users).set({ role: keepRole }).where(eq(users.id, actor.id));
    await tx.insert(ownershipTransfers).values({
      fromUserId: actor.id,
      toUserId: target.id,
      previousOwnerRole: keepRole,
    });
    const liveOwners = await countActiveOwnersIn(tx);
    if (!liveOwnerCommitAllowed(liveOwners)) throw new Error("owner_invariant");

    const consumed = await tx
      .update(ownershipTransferChallenges)
      .set({ status: "consumed", approvedAt: now, consumedAt: now })
      .where(
        and(
          eq(ownershipTransferChallenges.id, challenge.id),
          eq(ownershipTransferChallenges.status, "pending"),
          gt(ownershipTransferChallenges.expiresAt, now)
        )
      )
      .returning({ id: ownershipTransferChallenges.id });
    if (consumed.length === 0) throw new Error("replay");

    await tx
      .update(ownershipTransferChallenges)
      .set({ status: "cancelled", cancelledAt: now })
      .where(and(eq(ownershipTransferChallenges.fromUserId, actor.id), eq(ownershipTransferChallenges.status, "pending")));

    let handoverId: string | null = null;
    if (challenge.includeBotHandover && target.telegramId) {
      await tx
        .update(telegramOwnerHandovers)
        .set({ status: "cancelled", cancelledAt: now })
        .where(
          and(
            eq(telegramOwnerHandovers.fromTelegramId, challenge.telegramUserId),
            inArray(telegramOwnerHandovers.status, ["pending", "current_confirmed"])
          )
        );
      const [handover] = await tx
        .insert(telegramOwnerHandovers)
        .values({
          fromTelegramId: challenge.telegramUserId,
          toTelegramId: target.telegramId,
          initiatedByUserId: actor.id,
          status: "current_confirmed",
          currentConfirmedAt: now,
          expiresAt: new Date(now.getTime() + TTL_MS),
        })
        .returning({ id: telegramOwnerHandovers.id });
      handoverId = handover?.id ?? null;
    }
    return {
      ok: true as const,
      committed: true as const,
      fromUserId: actor.id,
      toUserId: target.id,
      targetName: target.name,
      keepRole,
      handoverId,
      targetTelegramId: target.telegramId,
    };
  });

  if (!result.ok) return result;
  if ("already" in result) return result;
  if ("rejected" in result) {
    await recordAudit({
      actorUserId: result.fromUserId,
      action: "ownership.transfer_rejected",
      targetType: "user",
      targetId: result.toUserId,
      metadata: { challengeId: input.challengeId, telegramUserId: input.actorTelegramId },
    });
    return { ok: true as const, rejected: true as const };
  }
  if (!("committed" in result)) return { ok: false as const, error: "aborted" as const };

  // Both roles changed atomically; invalidate both open UI sessions once.
  await publishAccessChanges([result.fromUserId, result.toUserId]);

  await recordAudit({
    actorUserId: result.fromUserId,
    action: "ownership.transferred",
    targetType: "user",
    targetId: result.toUserId,
    metadata: { previousOwnerRole: result.keepRole, challengeId: input.challengeId, telegramUserId: input.actorTelegramId },
  });
  await notifyUsers([result.toUserId, result.fromUserId], {
    type: "OWNERSHIP_TRANSFERRED",
    title: "Ownership transferred",
    body: `The centre is now owned by ${result.targetName}.`,
    href: "/owner",
  });
  if (result.handoverId && result.targetTelegramId) {
    await recordAudit({
      actorUserId: result.fromUserId,
      action: "telegram.owner_handover_current_confirmed",
      targetType: "telegram_owner",
      targetId: result.targetTelegramId,
      metadata: { handoverId: result.handoverId, source: "website_opt_in" },
    });
    await enqueueTelegramNotice({
      telegramUserId: result.targetTelegramId,
      type: "telegram.owner_handover_target",
      title: "Accept bot control",
      body: "The current Learners Area bot owner asked you to accept bot control. This is not @BotFather ownership. It expires in 5 minutes.",
      category: "critical",
      correlationId: result.handoverId,
    });
  }
  return { ok: true as const, committed: true as const, botHandover: result.handoverId ? "pending_target" : "skipped" };
}
