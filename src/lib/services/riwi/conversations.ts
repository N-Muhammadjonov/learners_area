import "server-only";
import { and, desc, eq, gt, gte, inArray, isNull, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { riwiConversationMessages, riwiConversations, teacherStudentLinks, users } from "@/db/schema";
import type { Role } from "@/lib/auth/roles";
import type { Locale } from "@/lib/i18n";
import { recordRiwiAudit } from "./audit";
import type { RiwiConversationTurn } from "@/lib/services/coach/types";
import { RIWI_CONVERSATION_TTL_DAYS, RIWI_PROVENANCE, type RiwiProvenance } from "./contracts";
export { RIWI_CONVERSATION_TTL_DAYS } from "./contracts";
import { reportSnapshotSchema, type ValidatedReportSnapshot } from "@/lib/reporter/snapshot-schema";
import { isAuthorizedRiwiCourseLesson } from "./course-lessons";
import { hasOpenExam, resolveDictionaryOccurrence } from "./dictionary";

export const RIWI_CONVERSATION_HISTORY_MAX = 6;
export const RIWI_CONVERSATION_MESSAGE_MAX = 6000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dayMs = 24 * 60 * 60 * 1000;
const SCOPED_DATA_PROVENANCE = new Set(["canonical_evaluation", "canonical_grammar", "approved_knowledge", "course_lesson", "deterministic_learning_data", "deterministic_report"]);
const SCOPE_REDACTED_EN = "This saved response is no longer available under the current access scope. Run the request again if you still have access.";
const ROSTER_NOT_STORED_EN = "This roster report is not saved in conversation history. Run it again to see current data.";

export type RiwiConversationScopeKind = "self" | "assigned" | "roster" | "admin-subject" | "staff" | "admin" | "global" | "course_lesson";
export type RiwiCourseLessonScope = { courseId: string; lessonId: string };
export type RiwiDictionaryConversationScope =
  | { kind: "canonical_term" }
  | { kind: "occurrence"; sourceType: "reading" | "listening"; sourceId: string; occurrenceId: string };
type ConversationSelectDatabase = Pick<typeof db, "select">;
type ConversationScopeDatabase = Pick<typeof db, "select" | "query">;

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
    || value === "staff" || value === "admin" || value === "global" || value === "course_lesson" ? value : null;
}

function metadataOf(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isScopedData(value: unknown): boolean {
  return typeof value === "string" && SCOPED_DATA_PROVENANCE.has(value);
}

function reportSnapshotMatchesScope(input: {
  snapshot: ValidatedReportSnapshot;
  actor: { id: string; role: Role };
  scope: RiwiConversationScopeKind | null;
  targetUserId: string | null;
}): boolean {
  const { snapshot, actor, scope, targetUserId } = input;
  if (snapshot.generatedBy.userId !== actor.id || snapshot.generatedBy.role !== actor.role) return false;
  switch (scope) {
    case "self":
      return snapshot.scope.kind === "student" && snapshot.scope.subjectId === actor.id;
    case "assigned":
    case "admin-subject":
      return snapshot.scope.kind === "student" && Boolean(targetUserId) && snapshot.scope.subjectId === targetUserId;
    case "roster":
      return actor.role === "teacher" && snapshot.scope.kind === "teacher" && snapshot.scope.teacherId === actor.id;
    case "admin":
      return actor.role === "admin" && snapshot.scope.kind === "teacher" && snapshot.scope.teacherId === null;
    case "global":
      return actor.role === "owner" && snapshot.scope.kind === "owner";
    default:
      return false;
  }
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

function sameCourseLessonScope(left: RiwiCourseLessonScope | null, right: RiwiCourseLessonScope | null): boolean {
  return Boolean(left && right && left.courseId === right.courseId && left.lessonId === right.lessonId);
}

/** Resolve immutable course/lesson ids from assistant metadata and re-check live authorization. */
async function storedCourseLessonScope(
  conversationId: string,
  actor: { id: string; role: Role },
  database: ConversationSelectDatabase,
): Promise<RiwiCourseLessonScope | null> {
  const rows = await database.select({ role: riwiConversationMessages.role, metadata: riwiConversationMessages.metadata })
    .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversationId))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id));
  let resolved: RiwiCourseLessonScope | null = null;
  for (const row of rows) {
    const metadata = metadataOf(row.metadata);
    const hasCourseIds = metadata.scopeCourseId !== undefined || metadata.scopeLessonId !== undefined;
    const markedCourseScoped = metadata.scopeKind === "course_lesson" || metadata.provenance === "course_lesson" || hasCourseIds;
    if (!markedCourseScoped) continue;
    if (row.role !== "assistant" || metadata.scopeKind !== "course_lesson"
      || typeof metadata.scopeCourseId !== "string" || !UUID.test(metadata.scopeCourseId)
      || typeof metadata.scopeLessonId !== "string" || !UUID.test(metadata.scopeLessonId)) {
      throw new RiwiConversationError("not_found");
    }
    const next = { courseId: metadata.scopeCourseId, lessonId: metadata.scopeLessonId };
    if (resolved && !sameCourseLessonScope(resolved, next)) throw new RiwiConversationError("not_found");
    resolved = next;
  }
  if (resolved && !await isAuthorizedRiwiCourseLesson(actor, resolved, database)) throw new RiwiConversationError("not_found");
  return resolved;
}

function dictionaryScopeOf(value: unknown): RiwiDictionaryConversationScope | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const scope = value as Record<string, unknown>;
  if (scope.kind === "canonical_term" && Object.keys(scope).length === 1) return { kind: "canonical_term" };
  if (scope.kind === "occurrence" && (scope.sourceType === "reading" || scope.sourceType === "listening")
    && typeof scope.sourceId === "string" && UUID.test(scope.sourceId)
    && typeof scope.occurrenceId === "string" && UUID.test(scope.occurrenceId)
    && Object.keys(scope).length === 4) {
    return { kind: "occurrence", sourceType: scope.sourceType, sourceId: scope.sourceId, occurrenceId: scope.occurrenceId };
  }
  return null;
}

function sameDictionaryScope(left: RiwiDictionaryConversationScope | null, right: RiwiDictionaryConversationScope | null): boolean {
  if (!left || !right || left.kind !== right.kind) return false;
  return left.kind === "canonical_term" && right.kind === "canonical_term"
    || left.kind === "occurrence" && right.kind === "occurrence" && left.sourceType === right.sourceType
      && left.sourceId === right.sourceId && left.occurrenceId === right.occurrenceId;
}

async function dictionaryScopeAuthorized(
  actor: { id: string; role: Role },
  scope: RiwiDictionaryConversationScope,
  database: ConversationScopeDatabase,
): Promise<boolean> {
  if (await hasOpenExam(actor, database)) return false;
  if (scope.kind === "canonical_term") return true;
  const resolved = await resolveDictionaryOccurrence({ actor, sourceType: scope.sourceType, sourceId: scope.sourceId, occurrenceId: scope.occurrenceId }, database as typeof db);
  return resolved?.status === "resolved";
}

/** A canonical Dictionary answer stays bound to its term/occurrence and current exam/source access. */
async function storedDictionaryScope(
  conversationId: string,
  actor: { id: string; role: Role },
  database: ConversationScopeDatabase,
): Promise<RiwiDictionaryConversationScope | null> {
  const rows = await database.select({ role: riwiConversationMessages.role, metadata: riwiConversationMessages.metadata })
    .from(riwiConversationMessages).where(eq(riwiConversationMessages.conversationId, conversationId))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id));
  let resolved: RiwiDictionaryConversationScope | null = null;
  for (const row of rows) {
    const metadata = metadataOf(row.metadata);
    if (metadata.provenance !== "canonical_dictionary" && metadata.dictionaryScope === undefined) continue;
    if (row.role !== "assistant" || metadata.provenance !== "canonical_dictionary") throw new RiwiConversationError("not_found");
    const next = metadata.dictionaryScope === undefined ? { kind: "canonical_term" } as const : dictionaryScopeOf(metadata.dictionaryScope);
    if (!next || (resolved && !sameDictionaryScope(resolved, next))) throw new RiwiConversationError("not_found");
    resolved = next;
  }
  if (resolved && !await dictionaryScopeAuthorized(actor, resolved, database)) throw new RiwiConversationError("not_found");
  return resolved;
}

function messageCutoff(now: Date): Date {
  return new Date(now.getTime() - RIWI_CONVERSATION_TTL_DAYS * dayMs);
}

function expiresInThirtyDays(now: Date): Date {
  return new Date(now.getTime() + RIWI_CONVERSATION_TTL_DAYS * dayMs);
}

/** Actor-scoped lookup: neither an owner nor another user can inspect these messages. */
export async function openRiwiConversation(input: {
  actor: { id: string; role: Role };
  locale: Locale;
  conversationId?: string;
  courseLessonScope?: RiwiCourseLessonScope;
  dictionaryScope?: RiwiDictionaryConversationScope;
  now?: Date;
}, database: Pick<typeof db, "select" | "insert" | "query"> = db) {
  const now = input.now ?? new Date();
  if (input.courseLessonScope && (!UUID.test(input.courseLessonScope.courseId) || !UUID.test(input.courseLessonScope.lessonId)
    || !await isAuthorizedRiwiCourseLesson(input.actor, input.courseLessonScope, database))) {
    throw new RiwiConversationError("not_found");
  }
  if (input.dictionaryScope && !await dictionaryScopeAuthorized(input.actor, input.dictionaryScope, database)) {
    throw new RiwiConversationError("not_found");
  }
  if (input.courseLessonScope && input.dictionaryScope) throw new RiwiConversationError("not_found");
  if (input.conversationId) {
    const [row] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
      .from(riwiConversations)
      .where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
      .limit(1);
    if (!row || row.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
    if (row.expiresAt <= now) throw new RiwiConversationError("expired");
    const storedScope = await storedCourseLessonScope(row.id, input.actor, database);
    if (storedScope) {
      if (!sameCourseLessonScope(storedScope, input.courseLessonScope ?? null)) throw new RiwiConversationError("not_found");
    } else if (input.courseLessonScope) {
      const [priorMessage] = await database.select({ id: riwiConversationMessages.id }).from(riwiConversationMessages)
        .where(eq(riwiConversationMessages.conversationId, row.id)).limit(1);
      // A lesson scope cannot be grafted onto an existing general conversation.
      if (priorMessage) throw new RiwiConversationError("not_found");
    }
    const storedDictionary = await storedDictionaryScope(row.id, input.actor, database);
    if (storedDictionary) {
      if (input.dictionaryScope && !sameDictionaryScope(storedDictionary, input.dictionaryScope)) throw new RiwiConversationError("not_found");
    } else if (input.dictionaryScope?.kind === "occurrence") {
      const [priorMessage] = await database.select({ id: riwiConversationMessages.id }).from(riwiConversationMessages)
        .where(eq(riwiConversationMessages.conversationId, row.id)).limit(1);
      // An exact source occurrence cannot be grafted onto unrelated prior turns.
      if (priorMessage) throw new RiwiConversationError("not_found");
    }
    return { id: row.id, created: false, courseLessonScope: storedScope ?? input.courseLessonScope ?? null,
      dictionaryScope: storedDictionary ?? input.dictionaryScope ?? null };
  }
  const [row] = await database.insert(riwiConversations).values({
    userId: input.actor.id, roleAtCreation: input.actor.role, locale: input.locale,
    expiresAt: expiresInThirtyDays(now),
  }).returning({ id: riwiConversations.id });
  if (!row) throw new RiwiConversationError("write_failed");
  return { id: row.id, created: true, courseLessonScope: input.courseLessonScope ?? null, dictionaryScope: input.dictionaryScope ?? null };
}

export async function getRiwiConversationHistory(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  now?: Date;
}, database: ConversationScopeDatabase = db): Promise<RiwiConversationTurn[]> {
  const now = input.now ?? new Date();
  const [conversation] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt, roleAtCreation: riwiConversations.roleAtCreation })
    .from(riwiConversations).where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
    .limit(1);
  if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
  if (conversation.expiresAt <= now) throw new RiwiConversationError("expired");
  await storedCourseLessonScope(conversation.id, input.actor, database);
  await storedDictionaryScope(conversation.id, input.actor, database);
  const rows = await database.select({ role: riwiConversationMessages.role, content: riwiConversationMessages.content, metadata: riwiConversationMessages.metadata })
    .from(riwiConversationMessages).where(and(eq(riwiConversationMessages.conversationId, conversation.id),
      gte(riwiConversationMessages.createdAt, messageCutoff(now))))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id));
  await storedCourseLessonScope(conversation.id, input.actor, database);
  await storedDictionaryScope(conversation.id, input.actor, database);
  // Only educational turns may cross an external-provider boundary. Progress,
  // reports, dictionary facts and policy refusals stay out of later chat context.
  return rows.reverse()
    .filter((row) => row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      && (row.metadata as Record<string, unknown>).externalEligible === true)
    .slice(-RIWI_CONVERSATION_HISTORY_MAX)
    .map((row) => ({ role: row.role, content: row.content }));
}

/** Persist a bounded turn atomically; report snapshots are schema-checked and scope-bound metadata. */
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
    provenance: RiwiProvenance;
    citations: Array<{ source: string; version: number | null }>;
    evaluationId?: string | null;
    evaluationType?: "writing" | "speaking" | "grammar" | "vocabulary" | null;
    evaluationValidationStatus?: "validated" | null;
    reportSnapshot?: ValidatedReportSnapshot | null;
    /** Server-resolved scope metadata; targets are never accepted from the transcript client. */
    scopeKind?: RiwiConversationScopeKind | null;
    scopeTargetUserId?: string | null;
    scopeCourseId?: string | null;
    scopeLessonId?: string | null;
    dictionaryScope?: RiwiDictionaryConversationScope | null;
  };
  now?: Date;
}, database: Pick<typeof db, "transaction"> = db) {
  const userMessage = input.userMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  const assistantMessage = input.assistantMessage.trim().slice(0, RIWI_CONVERSATION_MESSAGE_MAX);
  const resolvedScopeKind = scopeKind(input.metadata.scopeKind);
  const scopeTargetUserId = input.metadata.scopeTargetUserId ?? null;
  const scopeCourseId = input.metadata.scopeCourseId ?? null;
  const scopeLessonId = input.metadata.scopeLessonId ?? null;
  const rawDictionaryScope = input.metadata.dictionaryScope ?? null;
  const hasRawDictionaryScope = rawDictionaryScope !== null;
  const parsedDictionaryScope = hasRawDictionaryScope ? dictionaryScopeOf(rawDictionaryScope) : null;
  const resolvedDictionaryScope = parsedDictionaryScope
    ?? (!hasRawDictionaryScope && input.metadata.provenance === "canonical_dictionary" ? { kind: "canonical_term" as const } : null);
  const evaluationId = input.metadata.evaluationId ?? null;
  const evaluationType = input.metadata.evaluationType ?? null;
  const evaluationValidationStatus = input.metadata.evaluationValidationStatus ?? null;
  const hasEvaluationTrace = evaluationId !== null || evaluationType !== null || evaluationValidationStatus !== null;
  const validEvaluationTrace = input.metadata.provenance === "canonical_evaluation"
    ? Boolean(evaluationId && UUID.test(evaluationId)
      && (evaluationType === "writing" || evaluationType === "speaking" || evaluationType === "grammar" || evaluationType === "vocabulary")
      && evaluationValidationStatus === "validated")
    : !hasEvaluationTrace;
  const rawReportSnapshot = input.metadata.reportSnapshot ?? null;
  const parsedReportSnapshot = rawReportSnapshot === null ? null : reportSnapshotSchema.safeParse(rawReportSnapshot);
  const reportSnapshot = parsedReportSnapshot?.success ? parsedReportSnapshot.data : null;
  if (!userMessage || !assistantMessage || !UUID.test(input.metadata.correlationId)
    || !validEvaluationTrace
    || (hasRawDictionaryScope && !parsedDictionaryScope)
    || (resolvedDictionaryScope && input.metadata.provenance !== "canonical_dictionary")
    || (resolvedScopeKind === "course_lesson" && resolvedDictionaryScope)
    || (input.metadata.scopeKind !== undefined && input.metadata.scopeKind !== null && !resolvedScopeKind)
    || (scopeTargetUserId !== null && !UUID.test(scopeTargetUserId))
    || (scopeTargetUserId && !resolvedScopeKind)
    || (resolvedScopeKind === "course_lesson"
      ? !scopeCourseId || !UUID.test(scopeCourseId) || !scopeLessonId || !UUID.test(scopeLessonId) || Boolean(scopeTargetUserId)
      : Boolean(scopeCourseId || scopeLessonId))
    || (rawReportSnapshot !== null && (!reportSnapshot || input.metadata.provenance !== "deterministic_report"
      || !reportSnapshotMatchesScope({ snapshot: reportSnapshot, actor: input.actor, scope: resolvedScopeKind, targetUserId: scopeTargetUserId })))) {
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

    const priorCourseScope = await storedCourseLessonScope(conversation.id, input.actor, tx);
    const [priorMessage] = await tx.select({ id: riwiConversationMessages.id }).from(riwiConversationMessages)
      .where(eq(riwiConversationMessages.conversationId, conversation.id)).limit(1);
    const priorDictionaryScope = await storedDictionaryScope(conversation.id, input.actor, tx);
    if (priorDictionaryScope) {
      if (resolvedDictionaryScope && !sameDictionaryScope(priorDictionaryScope, resolvedDictionaryScope)) {
        throw new RiwiConversationError("not_found");
      }
    } else if (resolvedDictionaryScope) {
      if (resolvedDictionaryScope.kind === "occurrence" && priorMessage) throw new RiwiConversationError("not_found");
      if (!await dictionaryScopeAuthorized(input.actor, resolvedDictionaryScope, tx)) throw new RiwiConversationError("not_found");
    }
    if (priorCourseScope) {
      if (resolvedScopeKind !== "course_lesson"
        || !sameCourseLessonScope(priorCourseScope, { courseId: scopeCourseId!, lessonId: scopeLessonId! })) {
        throw new RiwiConversationError("not_found");
      }
    } else if (resolvedScopeKind === "course_lesson" && priorMessage) {
      // Scoped chats are born scoped. Do not mix a course excerpt into a general
      // conversation that already contains unrelated turns.
      throw new RiwiConversationError("not_found");
    }
    if (resolvedScopeKind === "course_lesson"
      && !await isAuthorizedRiwiCourseLesson(input.actor, { courseId: scopeCourseId!, lessonId: scopeLessonId! }, tx)) {
      throw new RiwiConversationError("not_found");
    }

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
        : resolvedScopeKind === "course_lesson" ? Boolean(scopeCourseId && scopeLessonId && !scopeTargetUserId)
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
        ...(resolvedScopeKind === "course_lesson" ? { scopeCourseId, scopeLessonId } : {}),
        citations: input.metadata.citations.slice(0, 8).map((citation) => ({ source: citation.source.slice(0, 120), version: citation.version })),
        ...(reportSnapshot && resolvedScopeKind !== "roster" ? { reportSnapshot } : {}),
        ...(evaluationId && evaluationType && evaluationValidationStatus
          ? { evaluationId, evaluationType, evaluationValidationStatus } : {}),
        ...(resolvedDictionaryScope ? { dictionaryScope: resolvedDictionaryScope } : {}),
      } },
    ]);
    await tx.delete(riwiConversationMessages).where(and(
      eq(riwiConversationMessages.conversationId, conversation.id),
      lt(riwiConversationMessages.createdAt, messageCutoff(now)),
    ));
    await tx.update(riwiConversations).set({ expiresAt: expiresInThirtyDays(now), updatedAt: now })
      .where(and(eq(riwiConversations.id, conversation.id), eq(riwiConversations.userId, input.actor.id)));
  });
}

export async function getRiwiConversationTranscript(input: {
  actor: { id: string; role: Role };
  conversationId: string;
  now?: Date;
}, database: ConversationScopeDatabase = db) {
  const now = input.now ?? new Date();
  const [conversation] = await database.select({ id: riwiConversations.id, expiresAt: riwiConversations.expiresAt,
    roleAtCreation: riwiConversations.roleAtCreation, locale: riwiConversations.locale })
    .from(riwiConversations).where(and(eq(riwiConversations.id, input.conversationId), eq(riwiConversations.userId, input.actor.id), isNull(riwiConversations.deletedAt)))
    .limit(1);
  if (!conversation || conversation.roleAtCreation !== input.actor.role) throw new RiwiConversationError("not_found");
  if (conversation.expiresAt <= now) throw new RiwiConversationError("expired");
  const conversationCourseScope = await storedCourseLessonScope(conversation.id, input.actor, database);
  const conversationDictionaryScope = await storedDictionaryScope(conversation.id, input.actor, database);
  const rows = await database.select({ role: riwiConversationMessages.role, content: riwiConversationMessages.content, metadata: riwiConversationMessages.metadata, createdAt: riwiConversationMessages.createdAt })
    .from(riwiConversationMessages).where(and(eq(riwiConversationMessages.conversationId, conversation.id),
      gte(riwiConversationMessages.createdAt, messageCutoff(now))))
    .orderBy(desc(riwiConversationMessages.createdAt), desc(riwiConversationMessages.id));
  await storedCourseLessonScope(conversation.id, input.actor, database);
  if (conversationDictionaryScope && !await dictionaryScopeAuthorized(input.actor, conversationDictionaryScope, database)) throw new RiwiConversationError("not_found");
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

  const transcript = orderedRows.map((row) => {
    const metadata = metadataOf(row.metadata);
    const citations = Array.isArray(metadata.citations) ? metadata.citations.flatMap((citation) => {
      if (!citation || typeof citation !== "object" || Array.isArray(citation)) return [];
      const item = citation as Record<string, unknown>;
      return typeof item.source === "string" && item.source.length <= 120
        && (item.version === null || (typeof item.version === "number" && Number.isInteger(item.version) && item.version > 0))
        ? [{ source: item.source, version: item.version as number | null }]
        : [];
    }).slice(0, 8) : [];
    const provenance: RiwiProvenance = (RIWI_PROVENANCE as readonly string[]).includes(String(metadata.provenance))
      ? metadata.provenance as RiwiProvenance
      : "unavailable";
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
          case "course_lesson":
            scopeAllowed = Boolean(conversationCourseScope && !targetUserId
              && metadata.scopeCourseId === conversationCourseScope.courseId
              && metadata.scopeLessonId === conversationCourseScope.lessonId);
            break;
          case "staff": scopeAllowed = false; break;
        }
      }
    }
    const hasReportSnapshot = metadata.reportSnapshot !== undefined && metadata.reportSnapshot !== null;
    const parsedReportSnapshot = hasReportSnapshot ? reportSnapshotSchema.safeParse(metadata.reportSnapshot) : null;
    if (row.role === "assistant" && hasReportSnapshot
      && (!parsedReportSnapshot?.success || provenance !== "deterministic_report"
        || !reportSnapshotMatchesScope({ snapshot: parsedReportSnapshot.data, actor: input.actor, scope: resolvedScope, targetUserId }))) {
      scopeAllowed = false;
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
      reportSnapshot: !redacted && row.role === "assistant" && parsedReportSnapshot?.success ? parsedReportSnapshot.data : null,
    };
  });
  await storedCourseLessonScope(conversation.id, input.actor, database);
  return transcript;
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
