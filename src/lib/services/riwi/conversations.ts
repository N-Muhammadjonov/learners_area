import "server-only";
import { and, desc, eq, gt, inArray, isNull, notInArray } from "drizzle-orm";
import { db } from "@/db/client";
import { riwiConversationMessages, riwiConversations, teacherStudentLinks, users } from "@/db/schema";
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
const SCOPED_DATA_PROVENANCE = new Set(["deterministic_learning_data", "deterministic_report"]);
const SCOPE_REDACTED_EN = "This saved response is no longer available under the current access scope. Run the request again if you still have access.";
const ROSTER_NOT_STORED_EN = "This roster report is not saved in conversation history. Run it again to see current data.";

type RiwiConversationScopeKind = "self" | "assigned" | "roster" | "admin-subject" | "staff" | "admin" | "global";
type ConversationSelectDatabase = Pick<typeof db, "select">;

function scopeRedactedMessage(locale: string) {
  return locale.startsWith("uz")
    ? "Saqlangan javob joriy ruxsat doirasida mavjud emas. Hali ruxsatingiz bo'lsa, so'rovni qayta yuboring."
    : SCOPE_REDACTED_EN;
}

function rosterNotStoredMessage(locale: string) {
  return locale.startsWith("uz")
    ? "Ro'yxat hisoboti maxfiylik uchun suhbat tarixida saqlanmaydi. Joriy ma'lumotni ko'rish uchun qayta so'rang."
    : ROSTER_NOT_STORED_EN;
}

function scopeKind(value: unknown): RiwiConversationScopeKind | null {
  return value === "self" || value === "assigned" || value === "roster" || value === "admin-subject"
    || value === "staff" || value === "admin" || value === "global" ? value : null;
}

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isScopedData(value: unknown): boolean {
  return typeof value === "string" && SCOPED_DATA_PROVENANCE.has(value);
}

async function activeStudentIds(ids: readonly string[], database: ConversationSelectDatabase): Promise<Set<string>> {
  const validIds = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (validIds.length === 0) return new Set();
  const rows = await database.select({ id: users.id }).from(users).where(and(
    inArray(users.id, validIds), eq(users.role, "student"), eq(users.accountStatus, "active"),
  ));
  return new Set(rows.map((row) => row.id));
}

async function activeAssignedStudentIds(teacherId: string, ids: readonly string[], database: ConversationSelectDatabase): Promise<Set<string>> {
  const validIds = [...new Set(ids.filter((id) => UUID.test(id)))];
  if (!UUID.test(teacherId) || validIds.length === 0) return new Set();
  const rows = await database.select({ id: users.id }).from(teacherStudentLinks)
    .innerJoin(users, eq(users.id, teacherStudentLinks.studentUserId))
    .where(and(
      eq(teacherStudentLinks.teacherUserId, teacherId), inArray(teacherStudentLinks.studentUserId, validIds),
      eq(users.role, "student"), eq(users.accountStatus, "active"),
    ));
  return new Set(rows.map((row) => row.id));
}

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
    /** Server-resolved scope metadata; the target is never accepted from the transcript client. */
    scopeKind?: RiwiConversationScopeKind | null;
    scopeTargetUserId?: string | null;
  };
  now?: Date;
}, database: Pick<typeof db, "transaction"> = db) {
  const userMessage = input.userMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  const assistantMessage = input.assistantMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  const resolvedScopeKind = scopeKind(input.metadata.scopeKind);
  const scopeTargetUserId = input.metadata.scopeTargetUserId ?? null;
  if (!userMessage || !assistantMessage || !UUID.test(input.metadata.correlationId)
    || (input.metadata.scopeKind !== undefined && input.metadata.scopeKind !== null && !resolvedScopeKind)
    || (scopeTargetUserId !== null && !UUID.test(scopeTargetUserId))
    || (scopeTargetUserId && !resolvedScopeKind)) {
    throw new RiwiConversationError("invalid_input");
  }
  const now = input.now ?? new Date();
  await database.transaction(async (tx) => {
    const [conversation] = await tx.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt,
      roleAtCreation: riwiConversations.roleAtCreation, locale: riwiConversations.locale })
      .from(riwiConversations).where(and(
        eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id),
        isNull(riwiConversations.deletedAt), gt(riwiConversations.expiresAt, now),
      )).limit(1).for("update");
    if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");

    // Scope-bearing output is re-authorized immediately before storage. A roster
    // aggregate cannot be safely replayed after membership changes, so only a
    // neutral notice is retained; individual targets keep an explicit target id
    // and are checked again on every transcript read.
    if (resolvedScopeKind === "self" && scopeTargetUserId && scopeTargetUserId !== input.actor.id) {
      throw new RiwiConversationError("not_found");
    }
    if (resolvedScopeKind === "assigned" || resolvedScopeKind === "admin-subject") {
      if (!scopeTargetUserId) throw new RiwiConversationError("invalid_input");
      const activeTargets = await activeStudentIds([scopeTargetUserId], tx);
      const allowedTarget = resolvedScopeKind === "assigned"
        ? input.actor.role === "owner" ? activeTargets.has(scopeTargetUserId)
          : input.actor.role === "teacher" && (await activeAssignedStudentIds(input.actor.id, [scopeTargetUserId], tx)).has(scopeTargetUserId)
        : (input.actor.role === "admin" || input.actor.role === "owner") && activeTargets.has(scopeTargetUserId);
      if (!allowedTarget) throw new RiwiConversationError("not_found");
    }
    if ((resolvedScopeKind === "roster" && input.actor.role !== "teacher")
      || (resolvedScopeKind === "admin" && input.actor.role !== "admin")
      || (resolvedScopeKind === "global" && input.actor.role !== "owner")) {
      throw new RiwiConversationError("not_found");
    }

    const scopedData = isScopedData(input.metadata.provenance);
    const scopeMetadataValid = resolvedScopeKind === "self"
      ? !scopeTargetUserId || scopeTargetUserId === input.actor.id
      : resolvedScopeKind === "assigned" || resolvedScopeKind === "admin-subject"
        ? Boolean(scopeTargetUserId)
        : resolvedScopeKind === "admin" ? input.actor.role === "admin" && !scopeTargetUserId
          : resolvedScopeKind === "global" ? input.actor.role === "owner" && !scopeTargetUserId
            : false;
    const storedAssistantMessage = scopedData && input.actor.role !== "student" && !scopeMetadataValid
      ? (resolvedScopeKind === "roster" && input.actor.role === "teacher"
        ? rosterNotStoredMessage(conversation.locale)
        : scopeRedactedMessage(conversation.locale))
      : assistantMessage;

    await tx.insert(riwiConversationMessages).values([
      { conversationId: conversation.id, role: "user", content: userMessage, createdAt: now, metadata: {
        intent: input.metadata.intent.slice(0, 40), externalEligible: input.metadata.externalEligible,
      } },
      { conversationId: conversation.id, role: "assistant", content: storedAssistantMessage, createdAt: new Date(now.getTime() + 1), metadata: {
        correlationId: input.metadata.correlationId, intent: input.metadata.intent.slice(0, 40), providerId: input.metadata.providerId?.slice(0, 60) ?? null,
        model: input.metadata.model?.slice(0, 120) ?? null, fallbackUsed: input.metadata.fallbackUsed,
        externalEligible: input.metadata.externalEligible, provenance: input.metadata.provenance,
        scopeKind: resolvedScopeKind, scopeTargetUserId,
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
  const [conversation] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt,
    roleAtCreation: riwiConversations.roleAtCreation, locale: riwiConversations.locale })
    .from(riwiConversations).where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
    .limit(1);
  if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
  if (conversation.expiresAt <= now) throw new RiwiConversationError("expired");
  const rows = await database.select({ role: riwiConversationMessages.role, content: riwiConversationMessages.content, metadata: riwiConversationMessages.metadata, createdAt: riwiConversationMessages.createdAt })
    .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversation.id))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id)).limit(RIWI_CONVERSATION_STORAGE_MAX_MESSAGES);
  const orderedRows = rows.reverse();
  const targets = [...new Set(orderedRows.flatMap((row) => {
    const metadata = metadataOf(row.metadata);
    return typeof metadata.scopeTargetUserId === "string" && UUID.test(metadata.scopeTargetUserId)
      ? [metadata.scopeTargetUserId]
      : [];
  }))];
  // Resolve the small bounded set of transcript targets in batches. Database
  // failures reject the read; a missing/changed assignment never falls back to
  // the historical answer.
  const activeTargets = await activeStudentIds(targets, database);
  const assignedTargets = input.actor.role === "teacher"
    ? await activeAssignedStudentIds(input.actor.id, targets, database)
    : new Set<string>();

  return orderedRows.map((row) => {
    const metadata = metadataOf(row.metadata);
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
    const resolvedScope = scopeKind(metadata.scopeKind);
    const targetUserId = typeof metadata.scopeTargetUserId === "string" ? metadata.scopeTargetUserId : null;
    let scopeAllowed = true;
    if (row.role === "assistant") {
      if (metadata.scopeKind !== undefined && metadata.scopeKind !== null && !resolvedScope) scopeAllowed = false;
      else if (!resolvedScope) {
        // Old staff turns predate target persistence. They are deliberately
        // hidden rather than guessing whether they were self, roster or learner scoped.
        scopeAllowed = input.actor.role === "student" || !isScopedData(provenance);
      } else {
        switch (resolvedScope) {
          case "self": scopeAllowed = !targetUserId || targetUserId === input.actor.id; break;
          case "assigned":
            scopeAllowed = Boolean(targetUserId && activeTargets.has(targetUserId)
              && (input.actor.role === "owner" || (input.actor.role === "teacher" && assignedTargets.has(targetUserId))));
            break;
          case "admin-subject":
            scopeAllowed = Boolean(targetUserId && activeTargets.has(targetUserId)
              && (input.actor.role === "admin" || input.actor.role === "owner"));
            break;
          // Roster aggregates are never replayed from transcript storage. They
          // are saved only as a neutral notice and must be requested afresh.
          case "roster": scopeAllowed = row.content === rosterNotStoredMessage(conversation.locale); break;
          case "admin": scopeAllowed = input.actor.role === "admin" && !targetUserId; break;
          case "global": scopeAllowed = input.actor.role === "owner" && !targetUserId; break;
          case "staff": scopeAllowed = false; break;
        }
      }
    }
    const redacted = row.role === "assistant" && !scopeAllowed;
    const correlationId = !redacted && typeof metadata.correlationId === "string" && UUID.test(metadata.correlationId) ? metadata.correlationId : null;
    return {
      role: row.role,
      content: redacted ? scopeRedactedMessage(conversation.locale) : row.content,
      createdAt: row.createdAt.toISOString(),
      correlationId: row.role === "assistant" ? correlationId : null,
      provenance: row.role === "assistant" ? (redacted ? "unavailable" as const : provenance) : null,
      provider: !redacted && row.role === "assistant" && typeof metadata.providerId === "string"
        ? { id: metadata.providerId.slice(0, 60), model: typeof metadata.model === "string" ? metadata.model.slice(0, 120) : null }
        : null,
      citations: row.role === "assistant" && !redacted ? citations : [],
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
