import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramContacts, telegramOwnerHandovers, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import { canStartBotHandover, decideHandover } from "@/lib/auth/owner-challenge";
import { enqueueTelegramNotice } from "./notifications";
import { isTelegramUserId } from "./ids";
import { lockOwnerAuthority, readEffectivePrimaryOwner, readEffectivePrimaryOwnerIn, writePrimaryOwner } from "./owner-store";

const TTL_MS = 5 * 60 * 1000;

async function targetKnown(telegramUserId: string) {
  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, telegramUserId),
  });
  return Boolean(contact && !contact.removedAt && !contact.botBlockedAt);
}

export async function ownerSummary(actorTelegramId: string) {
  const effective = await readEffectivePrimaryOwner();
  if (!effective.id || effective.id !== actorTelegramId) return { ok: false as const, error: "forbidden" as const };
  const linked = await db.query.users.findFirst({
    where: eq(users.telegramId, effective.id),
    columns: { name: true },
  });
  return {
    ok: true as const,
    telegramUserId: effective.id,
    source: effective.source,
    linkedName: linked?.name ?? null,
    botfatherDetected: false,
  };
}

export async function startBotHandover(input: { actorTelegramId: string; targetTelegramId: string; initiatedByUserId?: string | null }) {
  const effective = await readEffectivePrimaryOwner();
  const known = isTelegramUserId(input.targetTelegramId) ? await targetKnown(input.targetTelegramId) : false;
  const gate = canStartBotHandover({
    actorIsPrimaryOwner: effective.id === input.actorTelegramId,
    actorTelegramId: input.actorTelegramId,
    targetTelegramId: input.targetTelegramId,
    targetKnown: known,
  });
  if (!gate.ok) return gate;

  const now = new Date();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const created = await db.transaction(async (tx) => {
    await lockOwnerAuthority(tx);
    const current = await readEffectivePrimaryOwnerIn(tx);
    if (current.id !== input.actorTelegramId) return { ok: false as const, error: "forbidden" as const };
    await tx
      .update(telegramOwnerHandovers)
      .set({ status: "cancelled", cancelledAt: now })
      .where(
        and(
          eq(telegramOwnerHandovers.fromTelegramId, input.actorTelegramId),
          inArray(telegramOwnerHandovers.status, ["pending", "current_confirmed"])
        )
      );
    const [row] = await tx
      .insert(telegramOwnerHandovers)
      .values({
        fromTelegramId: input.actorTelegramId,
        toTelegramId: input.targetTelegramId,
        initiatedByUserId: input.initiatedByUserId ?? null,
        expiresAt,
      })
      .returning({ id: telegramOwnerHandovers.id });
    if (!row) return { ok: false as const, error: "forbidden" as const };
    return { ok: true as const, handoverId: row.id };
  });
  if (!created.ok) return created;

  await recordAudit({
    actorUserId: input.initiatedByUserId ?? null,
    action: "telegram.owner_handover_started",
    targetType: "telegram_owner",
    targetId: input.targetTelegramId,
    metadata: { handoverId: created.handoverId, fromTelegramId: input.actorTelegramId, toTelegramId: input.targetTelegramId },
  });
  await enqueueTelegramNotice({
    telegramUserId: input.actorTelegramId,
    type: "telegram.owner_handover_current",
    title: "Transfer bot control",
    body: `Target Telegram ID: ${input.targetTelegramId}\nThis is Learners Area bot control, not @BotFather ownership.\nExpires in 5 minutes.`,
    category: "critical",
    correlationId: created.handoverId,
  });
  return { ok: true as const, handoverId: created.handoverId, expiresAt };
}

export async function decideBotHandover(input: {
  handoverId: string;
  actorTelegramId: string;
  step: "current_confirm" | "target_accept" | "reject";
}) {
  const now = new Date();
  const result = await db.transaction(async (tx) => {
    await lockOwnerAuthority(tx);
    const [row] = await tx
      .select()
      .from(telegramOwnerHandovers)
      .where(eq(telegramOwnerHandovers.id, input.handoverId))
      .for("update")
      .limit(1);
    if (!row) return { ok: false as const, error: "not_found" as const };
    const verdict = decideHandover({
      status: row.status,
      expiresAtMs: row.expiresAt.getTime(),
      fromTelegramId: row.fromTelegramId,
      toTelegramId: row.toTelegramId,
      actorTelegramId: input.actorTelegramId,
      step: input.step,
      nowMs: now.getTime(),
    });
    if (verdict.action === "already") return { ok: true as const, already: true as const };
    if (verdict.action === "deny") {
      if (verdict.error === "expired" && (row.status === "pending" || row.status === "current_confirmed")) {
        await tx
          .update(telegramOwnerHandovers)
          .set({ status: "expired" })
          .where(and(eq(telegramOwnerHandovers.id, row.id), eq(telegramOwnerHandovers.status, row.status)));
      }
      return { ok: false as const, error: verdict.error };
    }
    if (verdict.action === "reject") {
      const [updated] = await tx
        .update(telegramOwnerHandovers)
        .set({ status: "rejected", rejectedAt: now })
        .where(and(eq(telegramOwnerHandovers.id, row.id), eq(telegramOwnerHandovers.status, row.status)))
        .returning({ id: telegramOwnerHandovers.id });
      if (!updated) return { ok: true as const, already: true as const };
      return {
        ok: true as const,
        rejected: true as const,
        fromTelegramId: row.fromTelegramId,
        toTelegramId: row.toTelegramId,
        initiatedByUserId: row.initiatedByUserId,
      };
    }
    if (verdict.action === "confirm_current") {
      const effective = await readEffectivePrimaryOwnerIn(tx);
      if (effective.id !== row.fromTelegramId) {
        await tx.update(telegramOwnerHandovers).set({ status: "cancelled", cancelledAt: now }).where(eq(telegramOwnerHandovers.id, row.id));
        return { ok: false as const, error: "stale_owner" as const };
      }
      const [updated] = await tx
        .update(telegramOwnerHandovers)
        .set({ status: "current_confirmed", currentConfirmedAt: now, expiresAt: new Date(now.getTime() + TTL_MS) })
        .where(and(eq(telegramOwnerHandovers.id, row.id), eq(telegramOwnerHandovers.status, "pending"), gt(telegramOwnerHandovers.expiresAt, now)))
        .returning({ id: telegramOwnerHandovers.id });
      if (!updated) return { ok: false as const, error: "replay" as const };
      return {
        ok: true as const,
        confirmed: true as const,
        toTelegramId: row.toTelegramId,
        handoverId: row.id,
        initiatedByUserId: row.initiatedByUserId,
      };
    }

    const effective = await readEffectivePrimaryOwnerIn(tx);
    if (effective.id !== row.fromTelegramId) {
      await tx.update(telegramOwnerHandovers).set({ status: "cancelled", cancelledAt: now }).where(eq(telegramOwnerHandovers.id, row.id));
      return { ok: false as const, error: "stale_owner" as const };
    }
    const [contact] = await tx
      .select({ removedAt: telegramContacts.removedAt, botBlockedAt: telegramContacts.botBlockedAt })
      .from(telegramContacts)
      .where(eq(telegramContacts.telegramUserId, row.toTelegramId))
      .limit(1);
    if (!contact || contact.removedAt || contact.botBlockedAt) {
      await tx.update(telegramOwnerHandovers).set({ status: "cancelled", cancelledAt: now }).where(eq(telegramOwnerHandovers.id, row.id));
      return { ok: false as const, error: "target_unknown" as const };
    }
    await writePrimaryOwner(tx, {
      telegramUserId: row.toTelegramId,
      previousTelegramUserId: row.fromTelegramId,
      actorTelegramId: input.actorTelegramId,
    });
    const [updated] = await tx
      .update(telegramOwnerHandovers)
      .set({ status: "consumed", targetConfirmedAt: now, consumedAt: now })
      .where(
        and(
          eq(telegramOwnerHandovers.id, row.id),
          eq(telegramOwnerHandovers.status, "current_confirmed"),
          gt(telegramOwnerHandovers.expiresAt, now)
        )
      )
      .returning({ id: telegramOwnerHandovers.id });
    if (!updated) throw new Error("replay");
    return {
      ok: true as const,
      committed: true as const,
      fromTelegramId: row.fromTelegramId,
      toTelegramId: row.toTelegramId,
      initiatedByUserId: row.initiatedByUserId,
    };
  });

  if (!result.ok) return result;
  if ("already" in result) return result;
  if ("rejected" in result) {
    await recordAudit({
      actorUserId: result.initiatedByUserId,
      action: "telegram.owner_handover_rejected",
      targetType: "telegram_owner",
      targetId: result.toTelegramId,
      metadata: { handoverId: input.handoverId, actorTelegramId: input.actorTelegramId, fromTelegramId: result.fromTelegramId },
    });
    return { ok: true as const, rejected: true as const };
  }
  if ("confirmed" in result) {
    await recordAudit({
      actorUserId: result.initiatedByUserId,
      action: "telegram.owner_handover_current_confirmed",
      targetType: "telegram_owner",
      targetId: result.toTelegramId,
      metadata: { handoverId: result.handoverId, actorTelegramId: input.actorTelegramId },
    });
    await enqueueTelegramNotice({
      telegramUserId: result.toTelegramId,
      type: "telegram.owner_handover_target",
      title: "Accept bot control",
      body: "Accept Learners Area bot control. This does not detect or change @BotFather ownership. Expires in 5 minutes.",
      category: "critical",
      correlationId: result.handoverId,
    });
    return { ok: true as const, confirmed: true as const };
  }
  if (!("committed" in result)) return { ok: false as const, error: "aborted" as const };
  await recordAudit({
    actorUserId: result.initiatedByUserId,
    action: "telegram.owner_transferred",
    targetType: "telegram_owner",
    targetId: result.toTelegramId,
    metadata: {
      handoverId: input.handoverId,
      fromTelegramId: result.fromTelegramId,
      toTelegramId: result.toTelegramId,
    },
  });
  await enqueueTelegramNotice({
    telegramUserId: result.fromTelegramId,
    type: "telegram.owner_transferred",
    title: "Bot control transferred",
    body: "You are no longer the Learners Area bot owner. @BotFather ownership is unchanged.",
    category: "critical",
    correlationId: input.handoverId,
  });
  await enqueueTelegramNotice({
    telegramUserId: result.toTelegramId,
    type: "telegram.owner_transferred",
    title: "Bot control is yours",
    body: "You are now the Learners Area bot owner. This is not @BotFather ownership.",
    category: "critical",
    correlationId: input.handoverId,
  });
  return { ok: true as const, committed: true as const };
}
