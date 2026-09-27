import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBotAdmins, users } from "@/db/schema";
import {
  actorCan,
  sanitizeGrantablePermissions,
  type AnyBotPermission,
  type BotAccess,
  type BotPermission,
} from "./permissions";
import { isPrimaryOwnerTelegramId, isTelegramUserId } from "./ids";

export type BotActor = BotAccess & {
  telegramUserId: string;
  linkedUserId: string | null;
  /**
   * Website user id written into audit rows. For the primary owner this falls
   * back to the live centre owner when Telegram is not linked yet, so a
   * bootstrap approval is still attributable. Never a password, never a secret.
   */
  auditUserId: string | null;
  websiteRole: string | null;
  accountStatus: string | null;
};

export async function resolveBotActor(telegramUserId: string): Promise<BotActor | null> {
  if (!isTelegramUserId(telegramUserId)) return null;

  const linked = await db.query.users.findFirst({
    where: eq(users.telegramId, telegramUserId),
    columns: { id: true, role: true, accountStatus: true },
  });

  if (isPrimaryOwnerTelegramId(telegramUserId)) {
    let auditUserId = linked?.id ?? null;
    if (!auditUserId) {
      const owner = await db.query.users.findFirst({
        where: and(eq(users.role, "owner"), eq(users.accountStatus, "active")),
        columns: { id: true },
      });
      auditUserId = owner?.id ?? null;
    }
    return {
      telegramUserId,
      isPrimaryOwner: true,
      permissions: [
        "VIEW_USERS",
        "MANAGE_USERS",
        "ADMISSIONS",
        "SUPPORT",
        "DIRECT_MESSAGE",
        "BROADCAST",
        "VIEW_STATS",
        "VIEW_AUDIT",
      ],
      linkedUserId: linked?.id ?? null,
      auditUserId,
      websiteRole: linked?.role ?? null,
      accountStatus: linked?.accountStatus ?? null,
    };
  }

  const admin = await db.query.telegramBotAdmins.findFirst({
    where: and(eq(telegramBotAdmins.telegramUserId, telegramUserId), eq(telegramBotAdmins.isActive, sql`true`)),
  });
  if (!admin || admin.deactivatedAt) return null;

  return {
    telegramUserId,
    isPrimaryOwner: false,
    permissions: sanitizeGrantablePermissions(admin.permissions),
    linkedUserId: admin.linkedUserId ?? linked?.id ?? null,
    auditUserId: admin.linkedUserId ?? linked?.id ?? null,
    websiteRole: linked?.role ?? null,
    accountStatus: linked?.accountStatus ?? null,
  };
}

export function actorHas(actor: BotActor, permission: AnyBotPermission): boolean {
  return actorCan(actor, permission);
}

export type ActorDenial = "invalid_actor" | "forbidden" | "actor_not_linked";

/**
 * Sensitive bot operations require service auth (checked by the route) AND an
 * actor who holds the permission. Website role is never consulted here.
 */
export async function requireBotPermission(
  telegramUserId: unknown,
  permission: AnyBotPermission,
  options?: { requireAuditUser?: boolean }
): Promise<{ ok: true; actor: BotActor } | { ok: false; error: ActorDenial }> {
  if (typeof telegramUserId !== "string" || !isTelegramUserId(telegramUserId)) {
    return { ok: false, error: "invalid_actor" };
  }
  const actor = await resolveBotActor(telegramUserId);
  if (!actor || !actorHas(actor, permission)) return { ok: false, error: "forbidden" };
  if (options?.requireAuditUser && !actor.auditUserId) return { ok: false, error: "actor_not_linked" };
  return { ok: true, actor };
}

export function publicBotAccess(actor: BotActor | null): {
  isPrimaryOwner: boolean;
  permissions: BotPermission[];
  active: boolean;
} {
  if (!actor) return { isPrimaryOwner: false, permissions: [], active: false };
  return {
    isPrimaryOwner: actor.isPrimaryOwner,
    permissions: [...actor.permissions],
    active: true,
  };
}
