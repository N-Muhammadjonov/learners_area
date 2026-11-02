import "server-only";
import { and, asc, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { createHash, randomInt } from "node:crypto";
import { db } from "@/db/client";
import { telegramContacts, telegramDeletionIntents, users } from "@/db/schema";
import { isAccountStatus, type AccountStatus } from "@/lib/auth/account-status";
import { isRole, type Role } from "@/lib/auth/roles";
import { canDeleteUser, canRemoveOwnerAccess } from "@/lib/auth/owner-invariant";
import { setAccountStatus } from "@/lib/data/admission";
import { recordAudit } from "@/lib/data/audit";
import { listAuditForTarget } from "@/lib/data/audit";
import type { BotActor } from "./actor";
import { isTelegramUserId } from "./ids";
import { isEffectivePrimaryOwner } from "./owner-store";
import { removeContactFromBot } from "./contacts";
import { unlinkTelegramFromUser } from "./identity";
import { compareDirectoryEntries } from "./directory-order";

function like(value: string) {
  return `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function usernameSortKey(value: SQL) {
  return sql`nullif(lower(ltrim(btrim(${value}), '@')), '') collate "C"`;
}

export async function searchDirectory(input: {
  q?: string | null;
  status?: string | null;
  role?: string | null;
  page: number;
  pageSize: number;
}) {
  const pageSize = Number.isFinite(input.pageSize)
    ? Math.min(Math.max(Math.trunc(input.pageSize) || 10, 1), 20) : 10;
  const page = Number.isSafeInteger(input.page) ? Math.max(input.page, 1) : 1;
  const offset = (page - 1) * pageSize;
  const fetchLimit = page * pageSize;

  const rawQuery = input.q?.trim() ?? "";
  const telegramQuery = rawQuery.replace(/^@+/, "");

  const userFilters = [];

  if (input.status && isAccountStatus(input.status)) {
    userFilters.push(eq(users.accountStatus, input.status));
  }

  if (input.role && isRole(input.role)) {
    userFilters.push(eq(users.role, input.role));
  }

  if (rawQuery) {
    const textPattern = like(rawQuery.slice(0, 80));
    const usernamePattern = like(telegramQuery.slice(0, 80));

    userFilters.push(
      or(
        ilike(users.name, textPattern),
        ilike(users.email, textPattern),
        eq(users.telegramId, telegramQuery),
        sql`exists (
          select 1
          from telegram_contacts c
          where c.linked_user_id = ${users.id}
            and c.username ilike ${usernamePattern}
        )`
      )!
    );
  }

  const userWhere = userFilters.length ? and(...userFilters) : undefined;

  // Use a scalar lookup to avoid duplicating website users when contacts are
  // linked by account ID or Telegram ID. This also matches userDetail's lookup.
  const userUsername = sql<string | null>`(
    select c.username from telegram_contacts c
    where c.linked_user_id = ${users.id} or c.telegram_user_id = ${users.telegramId}
    order by (c.telegram_user_id = ${users.telegramId}) desc nulls last, c.id
    limit 1
  )`;

  const userRows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      accountStatus: users.accountStatus,
      telegramId: users.telegramId,
      username: userUsername,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(userWhere)
    .orderBy(sql`${usernameSortKey(userUsername)} asc nulls last`, asc(users.id))
    .limit(fetchLimit);

  const [userCountRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(users)
    .where(userWhere);

  // Telegram-only contacts have no website account, so status/role filters
  // intentionally exclude them. Normal directory/search includes them.
  const contactResult =
    input.status || input.role
      ? { rows: [], count: 0 }
      : await (async () => {
          const contactFilters = [isNull(telegramContacts.linkedUserId)];

          if (rawQuery) {
            const textPattern = like(rawQuery.slice(0, 80));
            const usernamePattern = like(telegramQuery.slice(0, 80));

            contactFilters.push(
              or(
                ilike(telegramContacts.firstName, textPattern),
                ilike(telegramContacts.lastName, textPattern),
                ilike(telegramContacts.username, usernamePattern),
                eq(telegramContacts.telegramUserId, telegramQuery)
              )!
            );
          }

          const contactWhere = and(...contactFilters);

          const rows = await db
            .select({
              id: telegramContacts.id,
              telegramUserId: telegramContacts.telegramUserId,
              username: telegramContacts.username,
              firstName: telegramContacts.firstName,
              lastName: telegramContacts.lastName,
              botBlockedAt: telegramContacts.botBlockedAt,
              removedAt: telegramContacts.removedAt,
              lastSeenAt: telegramContacts.lastSeenAt,
            })
            .from(telegramContacts)
            .where(contactWhere)
            .orderBy(
              sql`${usernameSortKey(sql`${telegramContacts.username}`)} asc nulls last`,
              asc(telegramContacts.id)
            )
            .limit(fetchLimit);

          const [countRow] = await db
            .select({ count: sql<number>`count(*)::int` })
            .from(telegramContacts)
            .where(contactWhere);

          return {
            rows,
            count: countRow?.count ?? 0,
          };
        })();

  const websiteItems = userRows.map((row) => ({
    ...row,
    entryType: "website_user" as const,
    telegramLinked: Boolean(row.telegramId),
  }));

  const telegramItems = contactResult.rows.map((row) => {
    const fullName = [row.firstName, row.lastName]
      .filter(Boolean)
      .join(" ")
      .trim();

    return {
      id: row.id,
      entryType: "telegram_contact" as const,
      telegramUserId: row.telegramUserId,
      username: row.username,
      name:
        fullName ||
        (row.username ? `@${row.username}` : "—"),
      email: null,
      role: null,
      accountStatus: null,
      telegramLinked: true,
      botBlocked: Boolean(row.botBlockedAt),
      botRemoved: Boolean(row.removedAt),
      createdAt: row.lastSeenAt,
    };
  });

  // Each source must be ordered before LIMIT, then merged with the same order.
  // Sorting a single date-ordered page would only alphabetize that page.
  const merged = [...websiteItems, ...telegramItems]
    .sort(compareDirectoryEntries)
    .slice(offset, offset + pageSize);

  return {
    items: merged,
    page,
    pageSize,
    total: (userCountRow?.count ?? 0) + contactResult.count,
  };
}

export async function userDetail(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      accountStatus: true,
      statusReason: true,
      locale: true,
      telegramId: true,
      createdAt: true,
      lastActiveAt: true,
    },
  });
  if (!user) return null;
  const contact = user.telegramId
    ? await db.query.telegramContacts.findFirst({ where: eq(telegramContacts.telegramUserId, user.telegramId) })
    : await db.query.telegramContacts.findFirst({ where: eq(telegramContacts.linkedUserId, user.id) });
  const audit = await listAuditForTarget(user.id, 8);
  return {
    user: {
      ...user,
      telegramLinked: Boolean(user.telegramId),
      primaryOwner: Boolean(user.telegramId && (await isEffectivePrimaryOwner(user.telegramId))),
    },
    contact: contact
      ? {
          username: contact.username,
          blocked: Boolean(contact.botBlockedAt),
          removed: Boolean(contact.removedAt),
          chatId: contact.chatId,
        }
      : null,
    audit: audit.map((row) => ({
      action: row.action,
      createdAt: row.createdAt,
      metadata: row.metadata,
    })),
  };
}

async function protectOwnerTarget(userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, telegramId: true, role: true },
  });
  if (!user) return { ok: false as const, error: "not_found" };
  if (user.telegramId && (await isEffectivePrimaryOwner(user.telegramId))) {
    return { ok: false as const, error: "primary_owner_protected" };
  }
  return { ok: true as const, user };
}

export async function changeAccountFromBot(input: {
  actor: BotActor;
  userId: string;
  status: Extract<AccountStatus, "suspended" | "active">;
  reason?: string | null;
}) {
  const protectedTarget = await protectOwnerTarget(input.userId);
  if (!protectedTarget.ok) return protectedTarget;
  if (input.status === "suspended") {
    const guard = await canRemoveOwnerAccess(input.userId);
    if (!guard.ok) return { ok: false as const, error: guard.reason };
  }
  const current = await db.query.users.findFirst({
    where: eq(users.id, input.userId),
    columns: { accountStatus: true },
  });
  if (!current) return { ok: false as const, error: "not_found" };
  if (input.status === "active" && current.accountStatus !== "suspended") {
    return { ok: false as const, error: "not_suspended" };
  }
  if (!input.actor.auditUserId) return { ok: false as const, error: "actor_not_linked" };
  const result = await setAccountStatus({
    userId: input.userId,
    status: input.status,
    actorUserId: input.actor.auditUserId,
    reason: input.reason ?? null,
  });
  return result.ok ? { ok: true as const, status: input.status } : result;
}

export async function unlinkFromBot(actor: BotActor, userId: string) {
  const protectedTarget = await protectOwnerTarget(userId);
  if (!protectedTarget.ok) return protectedTarget;
  return unlinkTelegramFromUser({
    userId,
    actorUserId: actor.auditUserId,
    actorTelegramId: actor.telegramUserId,
  });
}

export async function removeBotContact(actor: BotActor, userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { id: true, telegramId: true },
  });
  if (!user) return { ok: false as const, error: "not_found" };
  if (user.telegramId && (await isEffectivePrimaryOwner(user.telegramId))) {
    return { ok: false as const, error: "primary_owner_protected" };
  }
  const telegramUserId = user.telegramId;
  if (!telegramUserId) {
    const contact = await db.query.telegramContacts.findFirst({ where: eq(telegramContacts.linkedUserId, userId) });
    if (!contact) return { ok: true as const, already: true };
    await removeContactFromBot(contact.telegramUserId);
  } else {
    await removeContactFromBot(telegramUserId);
  }
  await recordAudit({
    actorUserId: actor.auditUserId,
    action: "telegram.bot_contact_removed",
    targetType: "user",
    targetId: userId,
    metadata: { source: "telegram_bot", actorTelegramId: actor.telegramUserId },
  });
  return { ok: true as const, already: false };
}

function hashCode(code: string) {
  return createHash("sha256").update(code).digest("hex");
}

export async function startDeletion(actor: BotActor, userId: string) {
  const protectedTarget = await protectOwnerTarget(userId);
  if (!protectedTarget.ok) return protectedTarget;
  if (protectedTarget.user.role === "owner") return { ok: false as const, error: "primary_owner_protected" };
  const guard = await canDeleteUser(userId);
  if (!guard.ok) return { ok: false as const, error: guard.reason };
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const expiresAt = new Date(Date.now() + 10 * 60_000);
  const [row] = await db
    .insert(telegramDeletionIntents)
    .values({
      tokenHash: hashCode(`${actor.telegramUserId}:${userId}:${code}`),
      targetUserId: userId,
      actorTelegramId: actor.telegramUserId,
      expiresAt,
    })
    .returning({ id: telegramDeletionIntents.id });
  await recordAudit({
    actorUserId: actor.auditUserId,
    action: "account.deletion_started",
    targetType: "user",
    targetId: userId,
    metadata: { source: "telegram_bot", actorTelegramId: actor.telegramUserId },
  });
  return { ok: true as const, challengeId: row?.id, code, expiresAt };
}

export async function confirmDeletion(actor: BotActor, userId: string, code: string) {
  if (!/^[0-9]{6}$/.test(code)) return { ok: false as const, error: "invalid_code" };
  const protectedTarget = await protectOwnerTarget(userId);
  if (!protectedTarget.ok) return protectedTarget;
  if (protectedTarget.user.role === "owner") return { ok: false as const, error: "primary_owner_protected" };
  const guard = await canDeleteUser(userId);
  if (!guard.ok) return { ok: false as const, error: guard.reason };

  const now = new Date();
  const claimed = await db
    .update(telegramDeletionIntents)
    .set({ consumedAt: now })
    .where(
      and(
        eq(telegramDeletionIntents.targetUserId, userId),
        eq(telegramDeletionIntents.actorTelegramId, actor.telegramUserId),
        eq(telegramDeletionIntents.tokenHash, hashCode(`${actor.telegramUserId}:${userId}:${code}`)),
        sql`${telegramDeletionIntents.consumedAt} is null`,
        sql`${telegramDeletionIntents.expiresAt} > ${now}`
      )
    )
    .returning({ id: telegramDeletionIntents.id });
  if (claimed.length === 0) return { ok: false as const, error: "challenge_invalid" };

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { telegramId: true, role: true },
  });
  await db
    .update(users)
    .set({
      name: "Former student",
      email: null,
      telegramId: null,
      passwordHash: null,
      accountStatus: "suspended",
      statusReason: "anonymised_by_owner",
      statusUpdatedAt: now,
    })
    .where(eq(users.id, userId));

  if (user?.telegramId) {
    await db
      .update(telegramContacts)
      .set({
        linkedUserId: null,
        username: null,
        firstName: null,
        lastName: null,
        phoneNumber: null,
        phoneVerifiedAt: null,
        removedAt: now,
        updatedAt: now,
      })
      .where(eq(telegramContacts.telegramUserId, user.telegramId));
  }

  await recordAudit({
    actorUserId: actor.auditUserId,
    action: "account.anonymised",
    targetType: "user",
    targetId: userId,
    metadata: { source: "telegram_bot", actorTelegramId: actor.telegramUserId, mode: "retention_anonymise" },
  });
  return { ok: true as const };
}

export function canSearchRole(value: string | null): value is Role | null {
  return value === null || isRole(value);
}

export { isTelegramUserId };

