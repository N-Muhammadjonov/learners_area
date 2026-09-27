import "server-only";
import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { telegramBotAdmins, telegramContacts, telegramSupportMessages, telegramSupportThreads, users } from "@/db/schema";
import { recordAudit } from "@/lib/data/audit";
import type { BotActor } from "./actor";
import { isTelegramUserId } from "./ids";
import { readEffectivePrimaryOwner } from "./owner-store";

const MESSAGE_TYPES = ["text", "photo", "document", "voice", "audio"] as const;
type MessageType = (typeof MESSAGE_TYPES)[number];
const OPEN = ["open", "waiting_for_user", "waiting_for_staff"] as const;

export function isSupportMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && (MESSAGE_TYPES as readonly string[]).includes(value);
}

function pageArgs(page: number, pageSize: number) {
  const size = Math.min(Math.max(pageSize || 10, 1), 20);
  const current = Math.max(page || 1, 1);
  return { size, current, offset: (current - 1) * size };
}

async function notifyTargets(thread: { assignedTelegramId: string | null }) {
  const ids = new Set<string>();
  const owner = (await readEffectivePrimaryOwner()).id;
  if (owner) ids.add(owner);
  if (thread.assignedTelegramId) ids.add(thread.assignedTelegramId);
  const admins = await db
    .select({ telegramUserId: telegramBotAdmins.telegramUserId, permissions: telegramBotAdmins.permissions })
    .from(telegramBotAdmins)
    .where(eq(telegramBotAdmins.isActive, sql`true`));
  for (const admin of admins) {
    const permissions = Array.isArray(admin.permissions) ? admin.permissions : [];
    if (permissions.includes("SUPPORT")) ids.add(admin.telegramUserId);
  }
  return [...ids];
}

export async function openOrAppendUserThread(input: {
  telegramUserId: string;
  text?: string | null;
  messageType?: string;
  fileId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
  linkedUserId?: string | null;
}) {
  if (!isTelegramUserId(input.telegramUserId)) return { ok: false as const, error: "invalid_actor" };
  const messageType = isSupportMessageType(input.messageType) ? input.messageType : "text";
  const text = input.text?.trim().slice(0, 4000) || null;
  if (messageType === "text" && !text) return { ok: false as const, error: "invalid_input" };
  if (messageType !== "text" && !input.fileId) return { ok: false as const, error: "invalid_input" };

  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, input.telegramUserId),
  });
  if (contact?.botBlockedAt) return { ok: false as const, error: "blocked" };

  const existing = await db.query.telegramSupportThreads.findFirst({
    where: and(
      eq(telegramSupportThreads.telegramUserId, input.telegramUserId),
      inArray(telegramSupportThreads.status, [...OPEN])
    ),
    orderBy: desc(telegramSupportThreads.updatedAt),
  });

  const now = new Date();
  let thread = existing;
  if (!thread) {
    const [created] = await db
      .insert(telegramSupportThreads)
      .values({
        telegramUserId: input.telegramUserId,
        linkedUserId: input.linkedUserId ?? null,
        status: "waiting_for_staff",
        lastMessageAt: now,
        updatedAt: now,
      })
      .returning();
    thread = created;
  }
  if (!thread) return { ok: false as const, error: "internal_error" };

  const [message] = await db
    .insert(telegramSupportMessages)
    .values({
      threadId: thread.id,
      senderType: "user",
      senderUserId: input.linkedUserId ?? null,
      senderTelegramId: input.telegramUserId,
      messageType,
      text,
      telegramFileId: input.fileId ?? null,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
    })
    .returning();

  await db
    .update(telegramSupportThreads)
    .set({ status: "waiting_for_staff", lastMessageAt: now, updatedAt: now, linkedUserId: input.linkedUserId ?? thread.linkedUserId })
    .where(eq(telegramSupportThreads.id, thread.id));

  const user = input.linkedUserId
    ? await db.query.users.findFirst({
        where: eq(users.id, input.linkedUserId),
        columns: { name: true, accountStatus: true },
      })
    : null;

  return {
    ok: true as const,
    threadId: thread.id,
    messageId: message?.id ?? null,
    status: "waiting_for_staff",
    notifyTelegramIds: await notifyTargets(thread),
    preview: {
      name: user?.name ?? contact?.firstName ?? input.telegramUserId,
      accountStatus: user?.accountStatus ?? null,
      text,
      messageType,
    },
  };
}

export async function listSupportThreads(input: {
  actor: BotActor;
  filter: "open" | "mine" | "all" | "closed";
  page: number;
  pageSize: number;
}) {
  const { size, current, offset } = pageArgs(input.page, input.pageSize);
  const filters = [];
  if (input.filter === "closed") filters.push(eq(telegramSupportThreads.status, "closed"));
  else if (input.filter === "open") filters.push(inArray(telegramSupportThreads.status, [...OPEN]));
  else if (input.filter === "mine") filters.push(eq(telegramSupportThreads.assignedTelegramId, input.actor.telegramUserId));
  const where = filters.length ? and(...filters) : undefined;

  const rows = await db
    .select({
      id: telegramSupportThreads.id,
      telegramUserId: telegramSupportThreads.telegramUserId,
      status: telegramSupportThreads.status,
      assignedTelegramId: telegramSupportThreads.assignedTelegramId,
      createdAt: telegramSupportThreads.createdAt,
      updatedAt: telegramSupportThreads.updatedAt,
      lastMessageAt: telegramSupportThreads.lastMessageAt,
      name: users.name,
      accountStatus: users.accountStatus,
    })
    .from(telegramSupportThreads)
    .leftJoin(users, eq(users.telegramId, telegramSupportThreads.telegramUserId))
    .where(where)
    .orderBy(desc(telegramSupportThreads.updatedAt))
    .limit(size)
    .offset(offset);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(telegramSupportThreads)
    .where(where);

  return { items: rows, page: current, pageSize: size, total: countRow?.count ?? 0 };
}

export async function getSupportThread(threadId: string, actor: BotActor) {
  const thread = await db.query.telegramSupportThreads.findFirst({
    where: eq(telegramSupportThreads.id, threadId),
  });
  if (!thread) return null;
  const owns = thread.telegramUserId === actor.telegramUserId;
  const staff = actor.isPrimaryOwner || actor.permissions.includes("SUPPORT");
  if (!owns && !staff) return { forbidden: true as const };

  const [user, contact, messages] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.telegramId, thread.telegramUserId),
      columns: { id: true, name: true, email: true, accountStatus: true, role: true },
    }),
    db.query.telegramContacts.findFirst({ where: eq(telegramContacts.telegramUserId, thread.telegramUserId) }),
    db
      .select({
        id: telegramSupportMessages.id,
        senderType: telegramSupportMessages.senderType,
        senderTelegramId: telegramSupportMessages.senderTelegramId,
        messageType: telegramSupportMessages.messageType,
        text: telegramSupportMessages.text,
        fileName: telegramSupportMessages.fileName,
        deliveryStatus: telegramSupportMessages.deliveryStatus,
        createdAt: telegramSupportMessages.createdAt,
      })
      .from(telegramSupportMessages)
      .where(eq(telegramSupportMessages.threadId, threadId))
      .orderBy(telegramSupportMessages.createdAt)
      .limit(50),
  ]);

  return {
    forbidden: false as const,
    thread: {
      id: thread.id,
      telegramUserId: thread.telegramUserId,
      status: thread.status,
      assignedTelegramId: thread.assignedTelegramId,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
      closedAt: thread.closedAt,
    },
    account: user
      ? { id: user.id, name: user.name, email: staff ? user.email : null, accountStatus: user.accountStatus, role: user.role }
      : null,
    contact: contact
      ? { username: contact.username, blocked: Boolean(contact.botBlockedAt), removed: Boolean(contact.removedAt) }
      : null,
    messages,
  };
}

export async function replyToThread(input: {
  threadId: string;
  actor: BotActor;
  text?: string | null;
  messageType?: string;
  fileId?: string | null;
  fileName?: string | null;
  mimeType?: string | null;
}) {
  const messageType = isSupportMessageType(input.messageType) ? input.messageType : "text";
  const text = input.text?.trim().slice(0, 4000) || null;
  if (messageType === "text" && !text) return { ok: false as const, error: "invalid_input" };
  if (messageType !== "text" && !input.fileId) return { ok: false as const, error: "invalid_input" };

  const thread = await db.query.telegramSupportThreads.findFirst({
    where: eq(telegramSupportThreads.id, input.threadId),
  });
  if (!thread) return { ok: false as const, error: "not_found" };
  if (thread.status === "closed") return { ok: false as const, error: "closed" };

  const contact = await db.query.telegramContacts.findFirst({
    where: eq(telegramContacts.telegramUserId, thread.telegramUserId),
  });
  const blocked = Boolean(contact?.botBlockedAt || contact?.removedAt || !contact);
  const now = new Date();
  const [message] = await db
    .insert(telegramSupportMessages)
    .values({
      threadId: thread.id,
      senderType: input.actor.isPrimaryOwner ? "owner" : "admin",
      senderUserId: input.actor.auditUserId,
      senderTelegramId: input.actor.telegramUserId,
      messageType,
      text,
      telegramFileId: input.fileId ?? null,
      fileName: input.fileName ?? null,
      mimeType: input.mimeType ?? null,
      deliveryStatus: blocked ? "blocked" : "queued",
      deliveryError: blocked ? (contact?.botBlockedAt ? "blocked" : contact?.removedAt ? "removed" : "unavailable") : null,
    })
    .returning();

  await db
    .update(telegramSupportThreads)
    .set({ status: "waiting_for_user", lastMessageAt: now, updatedAt: now })
    .where(eq(telegramSupportThreads.id, thread.id));

  const user = await db.query.users.findFirst({
    where: eq(users.telegramId, thread.telegramUserId),
    columns: { name: true },
  });

  return {
    ok: true as const,
    messageId: message?.id ?? null,
    delivery: blocked ? ("blocked" as const) : ("queued" as const),
    chatId: blocked ? null : contact?.chatId ?? thread.telegramUserId,
    target: {
      threadId: thread.id,
      telegramUserId: thread.telegramUserId,
      name: user?.name ?? contact?.firstName ?? thread.telegramUserId,
    },
    text,
    messageType,
    fileId: input.fileId ?? null,
  };
}

export async function reportSupportDelivery(input: {
  messageId: string;
  status: "sent" | "failed" | "blocked";
  error?: string | null;
}) {
  const [row] = await db
    .update(telegramSupportMessages)
    .set({
      deliveryStatus: input.status,
      deliveryError: input.error?.slice(0, 300) ?? null,
    })
    .where(eq(telegramSupportMessages.id, input.messageId))
    .returning({ id: telegramSupportMessages.id, deliveryStatus: telegramSupportMessages.deliveryStatus });
  return row ?? null;
}

async function mutateThread(input: {
  threadId: string;
  actor: BotActor;
  action: "assign" | "close" | "reopen";
  assigneeTelegramId?: string | null;
}) {
  const thread = await db.query.telegramSupportThreads.findFirst({
    where: eq(telegramSupportThreads.id, input.threadId),
  });
  if (!thread) return { ok: false as const, error: "not_found" };
  const now = new Date();

  if (input.action === "assign") {
    if (!input.assigneeTelegramId || !isTelegramUserId(input.assigneeTelegramId)) {
      return { ok: false as const, error: "invalid_input" };
    }
    await db
      .update(telegramSupportThreads)
      .set({ assignedTelegramId: input.assigneeTelegramId, updatedAt: now })
      .where(eq(telegramSupportThreads.id, thread.id));
    await recordAudit({
      actorUserId: input.actor.auditUserId,
      action: "support.assigned",
      targetType: "telegram_support_thread",
      targetId: thread.id,
      metadata: { source: "telegram_bot", actorTelegramId: input.actor.telegramUserId, assigneeTelegramId: input.assigneeTelegramId },
    });
    return { ok: true as const, status: thread.status };
  }

  if (input.action === "close") {
    if (thread.status === "closed") return { ok: false as const, error: "already_closed" };
    await db
      .update(telegramSupportThreads)
      .set({ status: "closed", closedAt: now, updatedAt: now })
      .where(and(eq(telegramSupportThreads.id, thread.id), ne(telegramSupportThreads.status, "closed")));
    await recordAudit({
      actorUserId: input.actor.auditUserId,
      action: "support.closed",
      targetType: "telegram_support_thread",
      targetId: thread.id,
      metadata: { source: "telegram_bot", actorTelegramId: input.actor.telegramUserId },
    });
    return { ok: true as const, status: "closed" };
  }

  await db
    .update(telegramSupportThreads)
    .set({ status: "open", closedAt: null, updatedAt: now })
    .where(eq(telegramSupportThreads.id, thread.id));
  await recordAudit({
    actorUserId: input.actor.auditUserId,
    action: "support.reopened",
    targetType: "telegram_support_thread",
    targetId: thread.id,
    metadata: { source: "telegram_bot", actorTelegramId: input.actor.telegramUserId },
  });
  return { ok: true as const, status: "open" };
}

export const assignSupportThread = (threadId: string, actor: BotActor, assigneeTelegramId: string) =>
  mutateThread({ threadId, actor, action: "assign", assigneeTelegramId });
export const closeSupportThread = (threadId: string, actor: BotActor) => mutateThread({ threadId, actor, action: "close" });
export const reopenSupportThread = (threadId: string, actor: BotActor) => mutateThread({ threadId, actor, action: "reopen" });
