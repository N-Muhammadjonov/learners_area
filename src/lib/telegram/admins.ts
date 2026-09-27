import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBotAdmins, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { BotActor } from "./actor";
import { isPrimaryOwnerTelegramId, isTelegramUserId } from "./ids";
import { permissionsEqual, sanitizeGrantablePermissions, type BotPermission } from "./permissions";

export async function listBotAdmins() {
  const rows = await db.select().from(telegramBotAdmins).orderBy(telegramBotAdmins.createdAt);
  return rows.map((row) => ({
    telegramUserId: row.telegramUserId,
    linkedUserId: row.linkedUserId,
    permissions: sanitizeGrantablePermissions(row.permissions),
    isActive: row.isActive && !row.deactivatedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

export async function addBotAdmin(input: { actor: BotActor; telegramUserId: string; permissions: unknown }) {
  if (!isTelegramUserId(input.telegramUserId)) return { ok: false as const, error: "invalid_actor" };
  if (isPrimaryOwnerTelegramId(input.telegramUserId)) return { ok: false as const, error: "primary_owner_protected" };
  const permissions = sanitizeGrantablePermissions(input.permissions);
  const linked = await db.query.users.findFirst({
    where: eq(users.telegramId, input.telegramUserId),
    columns: { id: true },
  });
  const now = new Date();
  await db
    .insert(telegramBotAdmins)
    .values({
      telegramUserId: input.telegramUserId,
      linkedUserId: linked?.id ?? null,
      permissions,
      isActive: true,
      createdBy: input.actor.auditUserId,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: telegramBotAdmins.telegramUserId,
      set: {
        permissions,
        isActive: true,
        deactivatedAt: null,
        linkedUserId: linked?.id ?? null,
        updatedAt: now,
      },
    });
  await recordAudit({
    actorUserId: input.actor.auditUserId,
    action: "bot_admin.added",
    targetType: "telegram_bot_admin",
    targetId: input.telegramUserId,
    metadata: { source: "telegram_bot", actorTelegramId: input.actor.telegramUserId, permissions },
  });
  return { ok: true as const, permissions };
}

export async function updateBotAdmin(input: { actor: BotActor; telegramUserId: string; permissions?: unknown; active?: boolean }) {
  if (!isTelegramUserId(input.telegramUserId)) return { ok: false as const, error: "invalid_actor" };
  if (isPrimaryOwnerTelegramId(input.telegramUserId)) return { ok: false as const, error: "primary_owner_protected" };
  const existing = await db.query.telegramBotAdmins.findFirst({
    where: eq(telegramBotAdmins.telegramUserId, input.telegramUserId),
  });
  if (!existing) return { ok: false as const, error: "not_found" };
  const permissions = input.permissions === undefined ? sanitizeGrantablePermissions(existing.permissions) : sanitizeGrantablePermissions(input.permissions);
  const active = input.active ?? existing.isActive;
  const now = new Date();
  await db
    .update(telegramBotAdmins)
    .set({
      permissions,
      isActive: active,
      deactivatedAt: active ? null : now,
      updatedAt: now,
    })
    .where(eq(telegramBotAdmins.id, existing.id));
  const action = permissionsEqual(sanitizeGrantablePermissions(existing.permissions), permissions)
    ? active ? "bot_admin.added" : "bot_admin.removed"
    : "bot_admin.permissions_changed";
  await recordAudit({
    actorUserId: input.actor.auditUserId,
    action,
    targetType: "telegram_bot_admin",
    targetId: input.telegramUserId,
    metadata: {
      source: "telegram_bot",
      actorTelegramId: input.actor.telegramUserId,
      permissions,
      active,
    },
  });
  return { ok: true as const, permissions, active };
}

export async function removeBotAdmin(actor: BotActor, telegramUserId: string) {
  return updateBotAdmin({ actor, telegramUserId, active: false });
}

export type { BotPermission };
