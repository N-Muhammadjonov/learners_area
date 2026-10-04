import "server-only";
import { and, desc, eq, gt, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { riwiConversationMessages, riwiConversations } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n";
import { recordRiwiAudit } from "./audit";
import type { RiwiConversationTurn } from "@/lib/services/coach/types";

export const RIWI_CONVERSATION_TTL_DAYS = 30;
export const RIWI_CONVERSATION_HISTORY_MAX = 6;
export const RIWI_CONVERSATION_STORAGE_MAX_MESSAGES = 60;
export const RIWI_CONVERSATION_MESSAGE_MAX = 6000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayMs = 24 * 60 * 60 * 1000;

export class RiwiConversationError extends Error {
  constructor(public readonly code: "not_found" | "expired" | "invalid_input" | "write_failed") { super(code); }
}

function expiresInThirtyDays(now: Date): Date {
  return new Date(now.getTime() + RIWI_CONVERSATION_TTL_DAYS * dayMs);
}

/** Actor-scoped lookup: neither an owner nor another user can inspect these messages. */
export async function openRiwiConversation(input: {
  actor: { id: string; role: Role };
  locale: Locale;
  conversationId?: string;
  now?: Date;
}, database: Pick<typeof db, "select" | "insert"> = db) {
  const now = input.now ?? new Date();
  if (input.conversationId) {
    const [row] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
      .from(riwiConversations)
      .where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
      .limit(1);
    if (!row || row.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
    if (row.expiresAt <= now) throw new RiwiConversationError("expired");
    return { id: row.id, created: false };
  }
  const [row] = await database.insert(riwiConversations).values({
    userId: input.actor.id, roleAtCreation: input.actor.role, locale: input.locale,
    expiresAt: expiresInThirtyDays(now),
  }).returning({ id: riwiConversations.id });
  if (!row) throw new RiwiConversationError("write_failed");
  return { id: row.id, created: true };
}

export async function getRiwiConversationHistory(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  now?: Date;
}, database: Pick<typeof db, "select"> = db): Promise<RiwiConversationTurn[]> {
  const now = input.now ?? new Date();
  const [conversation] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
    .from(riwiConversations).where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
    .limit(1);
  if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
  if (conversation.expiresAt <= now) throw new RiwiConversationError("expired");
  const rows = await database.select({ role: riwiConversationMessages.role, content: riwiConversationMessages.content, metadata: riwiConversationMessages.metadata })
    .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversation.id))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id)).limit(RIWI_CONVERSATION_STORAGE_MAX_MESSAGES);
  // Only educational turns may cross an external-provider boundary. Progress,
  // reports, dictionary facts and policy refusals stay out of later chat context.
  return rows.reverse()
    .filter((row) => row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      && (row.metadata as Record<string, unknown>).externalEligible === true)
    .slice(-RIWI_CONVERSATION_HISTORY_MAX)
    .map((row) => ({ role: row.role, content: row.content }));
}

/** Persist a turn atomically after the response is ready; metadata is allowlisted and body-free. */
export async function appendRiwiTurn(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  userMessage: string;
  assistantMessage: string;
  metadata: {
    correlationId: string;
    intent: string;
    providerId?: string | null;
    model?: string | null;
    fallbackUsed: boolean;
    externalEligible: boolean;
    provenance: "canonical_dictionary" | "deterministic_learning_data" | "deterministic_report" | "external_provider" | "policy_refusal" | "unavailable";
    citations: Array<{ source: string; version: number | null }>;
  };
  now?: Date;
}, database: Pick<typeof db, "transaction"> = db) {
  const userMessage = input.userMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  const assistantMessage = input.assistantMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  if (!userMessage || !assistantMessage || !UUID.test(input.metadata.correlationId)) throw new RiwiConversationError("invalid_input");
  const now = input.now ?? new Date();
  await database.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
      .from(riwiConversations).where(and(
        eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id),
        isNull(riwiConversations.deletedAt), gt(riwiConversations.expiresAt, now),
      )).limit(1).for("update");
    if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
    await tx.insert(riwiConversationMessages).values([
      { conversationId: conversation.id, role: "user", content: userMessage, createdAt: now, metadata: {
        intent: input.metadata.intent.slice(0, 40), externalEligible: input.metadata.externalEligible,
      } },
      { conversationId: conversation.id, role: "assistant", content: assistantMessage, createdAt: new Date(now.getTime() + 1), metadata: {
        correlationId: input.metadata.correlationId, intent: input.metadata.intent.slice(0, 40), providerId: input.metadata.providerId?.slice(0, 60) ?? null,
        model: input.metadata.model?.slice(0, 120) ?? null, fallbackUsed: input.metadata.fallbackUsed,
        externalEligible: input.metadata.externalEligible, provenance: input.metadata.provenance,
        citations: input.metadata.citations.slice(0, 8).map((citation) => ({ source: citation.source.slice(0, 120), version: citation.version })),
      } },
    ]);
    const retainedMessages = tx.select({ id: riwiConversationMessages.id }).from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, conversation.id))
      .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id))
      .limit(RIWI_CONVERSATION_STORAGE_MAX_MESSAGES);
    await tx.delete(riwiConversationMessages).where(and(
      eq(riwiConversationMessages.conversationId, conversation.id), notInArray(riwiConversationMessages.id, retainedMessages),
    ));
    await tx.update(riwiConversations).set({ expiresAt: expiresInThirtyDays(now), updatedAt: now })
      .where(and(eq(riwiConversations.id, conversation.id), eq(riwiConversations.userId, input.actor.id)));
  });
}

export async function getRiwiConversationTranscript(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  now?: Date;
}, database: Pick<typeof db, "select"> = db) {
  const now = input.now ?? new Date();
  const [conversation] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
    .from(riwiConversations).where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
    .limit(1);
  if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
  if (conversation.expiresAt <= now) throw new RiwiConversationError("expired");
  const rows = await database.select({ role: riwiConversationMessages.role, content: riwiConversationMessages.content, metadata: riwiConversationMessages.metadata, createdAt: riwiConversationMessages.createdAt })
    .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversation.id))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id)).limit(RIWI_CONVERSATION_STORAGE_MAX_MESSAGES);
  return rows.reverse().map((row) => {
    const metadata = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? row.metadata as Record<string, unknown>
      : {};
    const citations = Array.isArray(metadata.citations) ? metadata.citations.flatMap((citation) => {
      if (!citation || typeof citation !== "object" || Array.isArray(citation)) return [];
      const item = citation as Record<string, unknown>;
      return typeof item.source === "string" && item.source.length <= 120
        && (item.version === null || (typeof item.version === "number" && Number.isInteger(item.version) && item.version > 0))
        ? [{ source: item.source, version: item.version as number | null }]
        : [];
    }).slice(0, 8) : [];
    const provenance = ["canonical_dictionary", "deterministic_learning_data", "deterministic_report", "external_provider", "policy_refusal", "unavailable"].includes(String(metadata.provenance))
      ? metadata.provenance as "canonical_dictionary" | "deterministic_learning_data" | "deterministic_report" | "external_provider" | "policy_refusal" | "unavailable"
      : "unavailable" as const;
    const correlationId = typeof metadata.correlationId === "string" && UUID.test(metadata.correlationId) ? metadata.correlationId : null;
    return {
      role: row.role,
      content: row.content,
      createdAt: row.createdAt.toISOString(),
      correlationId: row.role === "assistant" ? correlationId : null,
      provenance: row.role === "assistant" ? provenance : null,
      provider: row.role === "assistant" && typeof metadata.providerId === "string"
        ? { id: metadata.providerId.slice(0, 60), model: typeof metadata.model === "string" ? metadata.model.slice(0, 120) : null }
        : null,
      citations: row.role === "assistant" ? citations : [],
    };
  });
}

export async function deleteRiwiConversation(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  correlationId: string;
}, database: Pick<typeof db, "transaction"> = db) {
  return database.transaction(async (tx) => {
    const [removed] = await tx.delete(riwiConversations).where(and(
      eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt),
    )).returning({ id: riwiConversations.id });
    if (!removed) throw new RiwiConversationError("not_found");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.conversation.deleted", targetType: "riwi_conversation", targetId: removed.id,
      metadata: { correlationId: input.correlationId, role: input.actor.role, status: "deleted" } }, tx as never);
    return { deleted: true as const };
  });
}
