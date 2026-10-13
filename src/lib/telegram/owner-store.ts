import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBotSettings } from "@/db/schema";
import { PRIMARY_OWNER_SETTING_KEY, resolveEffectivePrimaryOwner, type OwnerSource } from "./owner-authority";
import { isTelegramUserId } from "./ids";

export type OwnerTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Authorization reads the database on every check.
 * A short cache would let the previous owner act after a handover on another
 * instance, and this process cannot invalidate that cache. Correctness wins.
 * writePrimaryOwner is the only writer. Reading never copies TELEGRAM_OWNER_ID in.
 */
export async function readEffectivePrimaryOwner(env: NodeJS.ProcessEnv = process.env): Promise<{ id: string | null; source: OwnerSource }> {
  const row = await db.query.telegramBotSettings.findFirst({
    where: eq(telegramBotSettings.key, PRIMARY_OWNER_SETTING_KEY),
  });
  return resolveEffectivePrimaryOwner({
    storedValue: row?.value,
    envTelegramId: env.TELEGRAM_OWNER_ID,
  });
}

export async function readEffectivePrimaryOwnerIn(tx: OwnerTx, env: NodeJS.ProcessEnv = process.env) {
  const [row] = await tx
    .select({ value: telegramBotSettings.value })
    .from(telegramBotSettings)
    .where(eq(telegramBotSettings.key, PRIMARY_OWNER_SETTING_KEY))
    .limit(1);
  return resolveEffectivePrimaryOwner({
    storedValue: row?.value,
    envTelegramId: env.TELEGRAM_OWNER_ID,
  });
}

export async function isEffectivePrimaryOwner(telegramUserId: string, env: NodeJS.ProcessEnv = process.env) {
  if (!isTelegramUserId(telegramUserId)) return false;
  const effective = await readEffectivePrimaryOwner(env);
  return effective.id === telegramUserId;
}

/** Serialises bot-owner commits. Released when the transaction ends. */
export async function lockOwnerAuthority(tx: OwnerTx) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext('learners-area-owner-authority'))`);
}

/**
 * Writes the new owner. Call this only inside the handover transaction,
 * after lockOwnerAuthority. The env var is not consulted and is not updated.
 */
export async function writePrimaryOwner(
  tx: OwnerTx,
  input: { telegramUserId: string; previousTelegramUserId: string | null; actorTelegramId: string }
) {
  const value = {
    telegramUserId: input.telegramUserId,
    previousTelegramUserId: input.previousTelegramUserId,
  };
  const now = new Date();
  await tx
    .insert(telegramBotSettings)
    .values({
      key: PRIMARY_OWNER_SETTING_KEY,
      value,
      updatedAt: now,
      updatedByTelegramId: input.actorTelegramId,
    })
    .onConflictDoUpdate({
      target: telegramBotSettings.key,
      set: { value, updatedAt: now, updatedByTelegramId: input.actorTelegramId },
    });
}
