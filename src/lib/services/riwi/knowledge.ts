import "server-only";
import { createHash } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { riwiKnowledgeConflicts, riwiKnowledgeSources, riwiKnowledgeUnits, uploadIntents, users } from "@/db/schema";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { isRiwiRegressionFixture, runRiwiRegressionSuite } from "./golden/fixtures";
import { chunkKnowledgeText, RIWI_MAX_UNITS, RIWI_UNIT_MAX_CHARS } from "./knowledge-parser";
import type { KnowledgeScope } from "./knowledge-policy";
import { redactExternalText } from "./outbound-guard";
import { isSafeObjectKey } from "@/lib/validation/uploads";
import {
  decodeOwnerHistoryCursor,
  encodeOwnerHistoryCursor,
  ownerHistoryPageLimit,
  RiwiOwnerHistoryCursorError,
  type RiwiOwnerHistoryPosition,
} from "./owner-history-cursor";

export const KNOWLEDGE_SOURCE_TYPES = [
  "owner_instruction", "ielts_rubric", "grammar_material", "vocabulary_material", "speaking_material",
  "writing_material", "dictionary_material", "learning_methodology", "course_document", "policy",
  "verified_example", "provider_evaluation", "teacher_correction", "owner_correction", "regression_fixture",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export const KNOWLEDGE_RIGHTS_CLASSES = ["owner_authored", "licensed", "public_domain", "internal_permission", "third_party_reference", "unknown"] as const;
export type KnowledgeRightsClass = (typeof KNOWLEDGE_RIGHTS_CLASSES)[number];
export type { KnowledgeScope } from "./knowledge-policy";
export type KnowledgePublicationScope = KnowledgeScope;

const RIGHTS_ALLOWED_FOR_PROMOTION = new Set<KnowledgeRightsClass>(["owner_authored", "licensed", "public_domain", "internal_permission"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS = 500;
export const RIWI_KNOWLEDGE_MAX_CONFLICTS_PER_CANDIDATE = 1000;
export const RIWI_KNOWLEDGE_HISTORY_STATES = [
  "draft", "parsed", "analyzed", "candidate", "approved", "active", "superseded", "rejected", "quarantined",
] as const;
const OWNER_AUTHORITY: Record<KnowledgeSourceType, number> = {
  owner_instruction: 100, policy: 100, ielts_rubric: 95, dictionary_material: 90,
  verified_example: 85, owner_correction: 85, learning_methodology: 80, course_document: 75,
  teacher_correction: 70, writing_material: 65, speaking_material: 65, grammar_material: 65,
  vocabulary_material: 65, provider_evaluation: 40, regression_fixture: 100,
};

export class KnowledgeServiceError extends Error {
  constructor(public readonly code: "forbidden" | "invalid_input" | "not_found" | "invalid_state" | "rights_unverified" | "unresolved_conflict" | "regression_required" | "duplicate_source" | "write_failed" | "stale_version" | "analysis_capacity_exceeded") {
    super(code);
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function normalizeClaim(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
}
function keywords(value: string): Set<string> {
  return new Set(normalizeClaim(value).split(" ").filter((word) => word.length >= 4));
}
function sharedRatio(left: Set<string>, right: Set<string>): number {
  if (!left.size || !right.size) return 0;
  let shared = 0;
  for (const word of left) if (right.has(word)) shared += 1;
  return shared / Math.min(left.size, right.size);
}

/** Conservative exact/lexical overlap signal. It flags review work; it never decides truth. */
export function detectKnowledgeOverlap(candidate: string, active: string): boolean {
  const left = normalizeClaim(candidate);
  const right = normalizeClaim(active);
  if (!left || !right || left === right) return false;
  return sharedRatio(keywords(left), keywords(right)) >= 0.72;
}

export type KnowledgeConflictCandidateUnit = { id: string; content: string };
export type KnowledgeConflictActiveUnit = { sourceId: string; unitId: string; text: string };
export type KnowledgeConflictRecord = { candidateUnitId: string; activeSourceId: string; activeUnitId: string; conflictKey: string };

/**
 * A capped overlap scan must fail closed rather than create a candidate with
 * only a partial conflict list. The active-unit + 1 query sentinel and the
 * conflict + 1 check make both hard bounds observable to the caller.
 */
export function collectKnowledgeConflicts(
  candidateUnits: readonly KnowledgeConflictCandidateUnit[],
  activeUnits: readonly KnowledgeConflictActiveUnit[],
): KnowledgeConflictRecord[] {
  if (activeUnits.length > RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS) {
    throw new KnowledgeServiceError("analysis_capacity_exceeded");
  }
  const conflicts: KnowledgeConflictRecord[] = [];
  for (const candidate of candidateUnits) {
    for (const active of activeUnits) {
      if (!detectKnowledgeOverlap(candidate.content, active.text)) continue;
      if (conflicts.length >= RIWI_KNOWLEDGE_MAX_CONFLICTS_PER_CANDIDATE) {
        throw new KnowledgeServiceError("analysis_capacity_exceeded");
      }
      const activeWords = keywords(active.text);
      const key = sha256([...keywords(candidate.content)].filter((word) => activeWords.has(word)).sort().join(" "));
      conflicts.push({ candidateUnitId: candidate.id, activeSourceId: active.sourceId, activeUnitId: active.unitId, conflictKey: key });
    }
  }
  return conflicts;
}

const KNOWLEDGE_QUERY_STOP_WORDS = new Set([
  "what", "which", "who", "where", "when", "why", "how", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "the", "and", "but", "for", "with", "from", "about", "into", "over", "under", "between", "after", "before",
  "that", "this", "these", "those", "there", "here", "please", "explain", "tell", "show", "give", "me", "you",
  "your", "yours", "our", "their", "his", "her", "they", "them", "we", "she", "him", "its", "then", "than",
  "men", "menga", "mening", "bu", "buni", "qanday", "nima", "nimani", "qachon", "qayerda", "nega", "uchun",
  "bilan", "ning", "ham", "shuni", "bering", "ayting", "tushuntir", "tushuntiring", "ko'rsat",
  "что", "как", "почему", "когда", "где", "который", "какая", "какое", "это", "этот", "эта", "или", "для",
  "есть", "мне", "мой", "моя", "мое", "ваш", "твой", "вы", "они", "быть", "значит", "объясни", "расскажи",
  "пожалуйста", "покажи",
]);

/** Build a bounded, conjunctive prefix query from content words, not conversational filler. */
function knowledgeSearchQuery(input: string): string {
  const terms = [...new Set(input.normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])]
    .filter((term) => term.length >= 3 && term.length <= 64 && !KNOWLEDGE_QUERY_STOP_WORDS.has(term))
    .slice(0, 16);
  return terms.map((term) => `${term}:*`).join(" & ");
}

type KnowledgeActor = { id: string; role: Role; accountStatus: AccountStatus };

function canManage(actor: KnowledgeActor, capability: "riwi.knowledge.submit_candidate" | "riwi.knowledge.review" | "riwi.knowledge.approve" | "riwi.knowledge.promote"): boolean {
  return actor.role === "owner" && authorizeCapability(actor, capability).allowed;
}

export async function createKnowledgeCandidate(input: {
  actor: KnowledgeActor;
  sourceType: KnowledgeSourceType;
  title: string;
  provenance: string;
  rightsClass: KnowledgeRightsClass;
  scope: KnowledgePublicationScope;
  checksum?: string;
  content: string;
  /** Present only for server-parsed bytes from the shared finalized upload intent. */
  sourceUpload?: { uploadId: string; objectKey: string; checksum: string };
}, database: Pick<typeof db, "select" | "insert" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.submit_candidate")) throw new KnowledgeServiceError("forbidden");
  if (!KNOWLEDGE_SOURCE_TYPES.includes(input.sourceType) || !KNOWLEDGE_RIGHTS_CLASSES.includes(input.rightsClass)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (!input.scope || !["global", "role", "user"].includes(input.scope.kind) ||
      (input.scope.kind === "role" && !["student", "teacher", "admin", "owner"].includes(input.scope.role)) ||
      (input.scope.kind === "user" && !UUID.test(input.scope.userId))) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (input.sourceUpload && (!UUID.test(input.sourceUpload.uploadId)
    || !isSafeObjectKey(input.sourceUpload.objectKey)
    || !/^[a-f0-9]{64}$/.test(input.sourceUpload.checksum))) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (input.scope.kind === "user") {
    const [subject] = await database.select({ role: users.role, accountStatus: users.accountStatus })
      .from(users).where(eq(users.id, input.scope.userId)).limit(1);
    if (subject?.role !== "student" || subject.accountStatus !== "active") throw new KnowledgeServiceError("invalid_input");
  }
  const title = input.title.trim();
  const provenance = input.provenance.trim();
  const content = input.content.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!title || title.length > 200 || !provenance || provenance.length > 500 ||
      redactExternalText(title, 200) !== title || redactExternalText(provenance, 500) !== provenance ||
      redactExternalText(content, 200_000) !== content) throw new KnowledgeServiceError("invalid_input");
  const checksum = sha256(content);
  if (input.checksum && (!/^[a-f0-9]{64}$/i.test(input.checksum) || input.checksum.toLowerCase() !== checksum)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  const units = chunkKnowledgeText(content);
  const [duplicate] = await database.select({ id: riwiKnowledgeSources.id }).from(riwiKnowledgeSources)
    .where(and(eq(riwiKnowledgeSources.checksum, checksum), eq(riwiKnowledgeSources.sourceType, input.sourceType))).limit(1);
  if (duplicate) throw new KnowledgeServiceError("duplicate_source");

  const source = await database.transaction(async (tx) => {
    const now = new Date();
    if (input.sourceUpload) {
      const [owner] = await tx.select({ role: users.role, accountStatus: users.accountStatus })
        .from(users).where(eq(users.id, input.actor.id)).limit(1).for("update");
      if (owner?.role !== "owner" || owner.accountStatus !== "active") throw new KnowledgeServiceError("forbidden");
      const [intent] = await tx.select({
        id: uploadIntents.id, userId: uploadIntents.userId, purpose: uploadIntents.purpose,
        objectKey: uploadIntents.objectKey, status: uploadIntents.status, usedAt: uploadIntents.usedAt,
        expiresAt: uploadIntents.expiresAt,
      }).from(uploadIntents).where(eq(uploadIntents.id, input.sourceUpload.uploadId)).limit(1).for("update");
      if (!intent || intent.userId !== input.actor.id || intent.purpose !== "riwi_knowledge_source"
        || intent.objectKey !== input.sourceUpload.objectKey) throw new KnowledgeServiceError("not_found");
      if (intent.status !== "finalized" || intent.usedAt || intent.expiresAt <= now) {
        throw new KnowledgeServiceError("invalid_state");
      }
    }

    const [created] = await tx.insert(riwiKnowledgeSources).values({
      sourceType: input.sourceType, title, checksum, sourceChecksum: input.sourceUpload?.checksum ?? null,
      sourceObjectKey: input.sourceUpload?.objectKey ?? null, provenance,
      rightsClass: input.rightsClass, authority: OWNER_AUTHORITY[input.sourceType],
      scope: input.scope.kind, scopeRole: input.scope.kind === "role" ? input.scope.role : null,
      scopeUserId: input.scope.kind === "user" ? input.scope.userId : null,
      state: "draft", parserVersion: "riwi-text-parser/1", unitCount: 0, createdByUserId: input.actor.id,
    }).onConflictDoNothing({ target: [riwiKnowledgeSources.sourceType, riwiKnowledgeSources.checksum] })
      .returning({ id: riwiKnowledgeSources.id, version: riwiKnowledgeSources.version });
    if (!created) throw new KnowledgeServiceError("duplicate_source");

    const storedUnits = await tx.insert(riwiKnowledgeUnits).values(units.map((unit) => ({
      sourceId: created.id, ordinal: unit.ordinal, heading: unit.heading,
      content: unit.text, contentHash: sha256(unit.text), characterCount: unit.characterCount,
    }))).returning({ id: riwiKnowledgeUnits.id, ordinal: riwiKnowledgeUnits.ordinal, content: riwiKnowledgeUnits.content });

    await tx.update(riwiKnowledgeSources).set({ state: "parsed", unitCount: storedUnits.length, updatedAt: new Date() }).where(eq(riwiKnowledgeSources.id, created.id));
    await tx.update(riwiKnowledgeSources).set({ state: "analyzed", updatedAt: new Date() }).where(eq(riwiKnowledgeSources.id, created.id));

    // Compare only against active, same-scope sources. Similarity is a review flag, never an automatic resolution.
    const activeScope = input.scope.kind === "global"
      ? sql`true`
      : input.scope.kind === "role"
        ? or(eq(riwiKnowledgeSources.scope, "global"), and(eq(riwiKnowledgeSources.scope, "role"), eq(riwiKnowledgeSources.scopeRole, input.scope.role)))
        : or(
          eq(riwiKnowledgeSources.scope, "global"),
          and(eq(riwiKnowledgeSources.scope, "role"), eq(riwiKnowledgeSources.scopeRole, "student")),
          and(eq(riwiKnowledgeSources.scope, "user"), eq(riwiKnowledgeSources.scopeUserId, input.scope.userId)),
        );
    const existing = await tx.select({
      sourceId: riwiKnowledgeSources.id,
      unitId: riwiKnowledgeUnits.id,
      text: riwiKnowledgeUnits.content,
    }).from(riwiKnowledgeUnits)
      .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeUnits.sourceId))
      .where(and(eq(riwiKnowledgeSources.state, "active"), activeScope))
      .orderBy(desc(riwiKnowledgeSources.authority), desc(riwiKnowledgeSources.updatedAt))
      .limit(RIWI_KNOWLEDGE_CONFLICT_SCAN_MAX_ACTIVE_UNITS + 1);

    const conflicts = collectKnowledgeConflicts(storedUnits, existing);
    if (conflicts.length) await tx.insert(riwiKnowledgeConflicts).values(conflicts.map((conflict) => ({
      candidateSourceId: created.id, candidateUnitId: conflict.candidateUnitId,
      activeSourceId: conflict.activeSourceId, activeUnitId: conflict.activeUnitId,
      conflictKey: conflict.conflictKey, reason: "lexical_overlap_review", state: "open" as const,
    }))).onConflictDoNothing();

    const [candidate] = await tx.update(riwiKnowledgeSources).set({ state: "candidate", updatedAt: new Date() })
      .where(eq(riwiKnowledgeSources.id, created.id)).returning({ id: riwiKnowledgeSources.id, version: riwiKnowledgeSources.version, unitCount: riwiKnowledgeSources.unitCount, state: riwiKnowledgeSources.state });
    if (!candidate) throw new KnowledgeServiceError("write_failed");
    if (input.sourceUpload) {
      const [attached] = await tx.update(uploadIntents).set({ status: "attached", usedAt: now })
        .where(and(eq(uploadIntents.id, input.sourceUpload.uploadId),
          eq(uploadIntents.userId, input.actor.id), eq(uploadIntents.purpose, "riwi_knowledge_source"),
          eq(uploadIntents.status, "finalized"), isNull(uploadIntents.usedAt), gt(uploadIntents.expiresAt, now)))
        .returning({ id: uploadIntents.id });
      if (!attached) throw new KnowledgeServiceError("invalid_state");
    }
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.source.created", targetType: "riwi_knowledge_source", targetId: candidate.id,
      metadata: { sourceId: candidate.id, version: candidate.version, unitCount: candidate.unitCount, contentHash: checksum,
        sourceChecksum: input.sourceUpload?.checksum, sourceType: input.sourceType, rightsClass: input.rightsClass, resultCount: conflicts.length } }, tx as never);
    return { ...candidate, conflictCount: conflicts.length };
  });
  return source;
}

async function requireActiveKnowledgeOwner(actor: KnowledgeActor, database: Pick<typeof db, "select">): Promise<void> {
  if (!canManage(actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  const [subject] = await database.select({ role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, actor.id)).limit(1);
  if (subject?.role !== "owner" || subject.accountStatus !== "active") throw new KnowledgeServiceError("forbidden");
}

export async function listKnowledgeSourcePage(
  actor: KnowledgeActor,
  options: { cursor?: string | null; limit?: number; state?: string | null } = {},
  database: Pick<typeof db, "select"> = db,
) {
  await requireActiveKnowledgeOwner(actor, database);
  const stateFilter = options.state ?? null;
  if (stateFilter !== null && !(RIWI_KNOWLEDGE_HISTORY_STATES as readonly string[]).includes(stateFilter)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  let limit: number;
  let after: RiwiOwnerHistoryPosition | null;
  try {
    limit = ownerHistoryPageLimit(options.limit);
    after = decodeOwnerHistoryCursor(options.cursor, actor, "knowledge_sources", undefined, stateFilter);
  } catch (error) {
    if (error instanceof RiwiOwnerHistoryCursorError) throw new KnowledgeServiceError("invalid_input");
    throw error;
  }
  const rows = await database.select({
    id: riwiKnowledgeSources.id, sourceType: riwiKnowledgeSources.sourceType, title: riwiKnowledgeSources.title,
    provenance: riwiKnowledgeSources.provenance, rightsClass: riwiKnowledgeSources.rightsClass, authority: riwiKnowledgeSources.authority,
    scope: riwiKnowledgeSources.scope, scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
    supersedesSourceId: riwiKnowledgeSources.supersedesSourceId, version: riwiKnowledgeSources.version,
    state: riwiKnowledgeSources.state, unitCount: riwiKnowledgeSources.unitCount, checksum: riwiKnowledgeSources.checksum,
    sourceChecksum: riwiKnowledgeSources.sourceChecksum, parserVersion: riwiKnowledgeSources.parserVersion,
    regressionFixtureId: riwiKnowledgeSources.regressionFixtureId, regressionEvidenceHash: riwiKnowledgeSources.regressionEvidenceHash,
    regressionPassedAt: riwiKnowledgeSources.regressionPassedAt,
    createdAt: riwiKnowledgeSources.createdAt, approvedAt: riwiKnowledgeSources.approvedAt, activatedAt: riwiKnowledgeSources.activatedAt,
    cursorAt: riwiKnowledgeSources.updatedAt,
  }).from(riwiKnowledgeSources).where(and(
    stateFilter ? eq(riwiKnowledgeSources.state, stateFilter as typeof riwiKnowledgeSources.$inferSelect.state) : undefined,
    after ? or(
      lt(riwiKnowledgeSources.updatedAt, after.sortAt),
      and(eq(riwiKnowledgeSources.updatedAt, after.sortAt), lt(riwiKnowledgeSources.id, after.id)),
    ) : undefined,
  ))
    .orderBy(desc(riwiKnowledgeSources.updatedAt), desc(riwiKnowledgeSources.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const pageRows = rows.slice(0, limit);
  const last = pageRows.at(-1);
  const nextCursor = hasMore && last
    ? encodeOwnerHistoryCursor({ actor, collection: "knowledge_sources", filter: stateFilter, after: { sortAt: last.cursorAt, id: last.id } })
    : null;
  return {
    sources: pageRows.map(({ cursorAt: _cursorAt, ...row }) => ({
      ...row, title: redactExternalText(row.title, 200), provenance: redactExternalText(row.provenance, 500),
    })),
    nextCursor,
  };
}

export async function countKnowledgeSourcesForOwner(actor: KnowledgeActor, database: Pick<typeof db, "select"> = db) {
  await requireActiveKnowledgeOwner(actor, database);
  const [counts] = await database.select({
    total: sql<number>`count(*)::int`,
    candidates: sql<number>`count(*) filter (where ${riwiKnowledgeSources.state} = 'candidate')::int`,
    approved: sql<number>`count(*) filter (where ${riwiKnowledgeSources.state} = 'approved')::int`,
  }).from(riwiKnowledgeSources);
  return {
    total: Number(counts?.total ?? 0),
    candidates: Number(counts?.candidates ?? 0),
    approved: Number(counts?.approved ?? 0),
  };
}

export async function getKnowledgeSourceDetail(
  actor: KnowledgeActor,
  sourceId: string,
  database: Pick<typeof db, "select"> = db,
) {
  if (!canManage(actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(sourceId)) throw new KnowledgeServiceError("invalid_input");
  const [source] = await database.select({
    id: riwiKnowledgeSources.id, sourceType: riwiKnowledgeSources.sourceType, title: riwiKnowledgeSources.title,
    provenance: riwiKnowledgeSources.provenance, rightsClass: riwiKnowledgeSources.rightsClass, authority: riwiKnowledgeSources.authority,
    scope: riwiKnowledgeSources.scope, scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
    version: riwiKnowledgeSources.version, state: riwiKnowledgeSources.state, checksum: riwiKnowledgeSources.checksum,
    sourceChecksum: riwiKnowledgeSources.sourceChecksum, parserVersion: riwiKnowledgeSources.parserVersion, unitCount: riwiKnowledgeSources.unitCount,
    supersedesSourceId: riwiKnowledgeSources.supersedesSourceId, createdByUserId: riwiKnowledgeSources.createdByUserId,
    reviewedByUserId: riwiKnowledgeSources.reviewedByUserId, regressionFixtureId: riwiKnowledgeSources.regressionFixtureId,
    regressionEvidenceHash: riwiKnowledgeSources.regressionEvidenceHash, regressionPassedAt: riwiKnowledgeSources.regressionPassedAt,
    createdAt: riwiKnowledgeSources.createdAt, approvedAt: riwiKnowledgeSources.approvedAt,
    activatedAt: riwiKnowledgeSources.activatedAt, updatedAt: riwiKnowledgeSources.updatedAt,
  }).from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, sourceId)).limit(1);
  if (!source) return null;
  const units = await database.select({
    id: riwiKnowledgeUnits.id, ordinal: riwiKnowledgeUnits.ordinal, heading: riwiKnowledgeUnits.heading,
    content: riwiKnowledgeUnits.content, contentHash: riwiKnowledgeUnits.contentHash,
    characterCount: riwiKnowledgeUnits.characterCount,
  }).from(riwiKnowledgeUnits).where(eq(riwiKnowledgeUnits.sourceId, sourceId))
    .orderBy(asc(riwiKnowledgeUnits.ordinal)).limit(RIWI_MAX_UNITS);
  const conflicts = await listKnowledgeConflicts(actor, sourceId, database);
  return {
    ...source,
    title: redactExternalText(source.title, 200),
    provenance: redactExternalText(source.provenance, 500),
    units: units.map((unit) => ({ ...unit,
      heading: unit.heading ? redactExternalText(unit.heading, 240) : null,
      content: redactExternalText(unit.content, RIWI_UNIT_MAX_CHARS),
    })),
    conflicts,
  };
}

export async function listKnowledgeConflicts(actor: KnowledgeActor, sourceId: string, database: Pick<typeof db, "select"> = db) {
  if (!canManage(actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(sourceId)) throw new KnowledgeServiceError("invalid_input");
  const rows = await database.select({
    id: riwiKnowledgeConflicts.id, state: riwiKnowledgeConflicts.state, reason: riwiKnowledgeConflicts.reason,
    candidateText: riwiKnowledgeUnits.content, candidateHeading: riwiKnowledgeUnits.heading,
    activeTitle: riwiKnowledgeSources.title, activeVersion: riwiKnowledgeSources.version,
    activeSourceId: riwiKnowledgeConflicts.activeSourceId, activeUnitId: riwiKnowledgeConflicts.activeUnitId,
  }).from(riwiKnowledgeConflicts)
    .innerJoin(riwiKnowledgeUnits, eq(riwiKnowledgeUnits.id, riwiKnowledgeConflicts.candidateUnitId))
    .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeConflicts.activeSourceId))
    .where(eq(riwiKnowledgeConflicts.candidateSourceId, sourceId))
    .orderBy(asc(riwiKnowledgeConflicts.createdAt), asc(riwiKnowledgeConflicts.id))
    .limit(RIWI_KNOWLEDGE_MAX_CONFLICTS_PER_CANDIDATE);
  return rows.map((row) => ({ ...row,
    reason: redactExternalText(row.reason, 1000),
    candidateText: redactExternalText(row.candidateText, RIWI_UNIT_MAX_CHARS),
    candidateHeading: row.candidateHeading ? redactExternalText(row.candidateHeading, 240) : null,
    activeTitle: redactExternalText(row.activeTitle, 200),
  }));
}

export async function resolveKnowledgeConflict(input: {
  actor: KnowledgeActor;
  conflictId: string;
  decision: "accept_candidate" | "keep_active";
  reason: string;
  expectedSourceId?: string;
}, database: Pick<typeof db, "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.conflictId) || (input.expectedSourceId && !UUID.test(input.expectedSourceId)) ||
      !["accept_candidate", "keep_active"].includes(input.decision)) throw new KnowledgeServiceError("invalid_input");
  const rawReason = input.reason.trim();
  if (!rawReason || rawReason.length > 1000) throw new KnowledgeServiceError("invalid_input");
  const reason = redactExternalText(rawReason, 1000).trim();
  if (!reason) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    const [row] = await tx.select({ id: riwiKnowledgeConflicts.id, state: riwiKnowledgeConflicts.state, candidateSourceId: riwiKnowledgeConflicts.candidateSourceId })
      .from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.id, input.conflictId)).limit(1).for("update");
    if (!row || (input.expectedSourceId && input.expectedSourceId !== row.candidateSourceId)) throw new KnowledgeServiceError("not_found");
    if (row.state !== "open") throw new KnowledgeServiceError("invalid_state");
    const [candidate] = await tx.select({ id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state })
      .from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, row.candidateSourceId)).limit(1).for("update");
    if (!candidate) throw new KnowledgeServiceError("not_found");
    if (candidate.state !== "candidate") throw new KnowledgeServiceError("invalid_state");
    const state = input.decision === "accept_candidate" ? "accepted" : "rejected";
    const [updated] = await tx.update(riwiKnowledgeConflicts).set({ state, resolvedByUserId: input.actor.id, resolutionNote: reason, resolvedAt: new Date() })
      .where(and(eq(riwiKnowledgeConflicts.id, row.id), eq(riwiKnowledgeConflicts.state, "open"))).returning({ id: riwiKnowledgeConflicts.id });
    if (!updated) throw new KnowledgeServiceError("invalid_state");
    if (input.decision === "keep_active") {
      const [rejected] = await tx.update(riwiKnowledgeSources).set({ state: "rejected", updatedAt: new Date() })
        .where(and(eq(riwiKnowledgeSources.id, candidate.id), eq(riwiKnowledgeSources.state, "candidate"))).returning({ id: riwiKnowledgeSources.id });
      if (!rejected) throw new KnowledgeServiceError("invalid_state");
      await tx.update(riwiKnowledgeConflicts).set({
        state: "rejected", resolvedByUserId: input.actor.id, resolutionNote: reason, resolvedAt: new Date(),
      }).where(and(eq(riwiKnowledgeConflicts.candidateSourceId, candidate.id), eq(riwiKnowledgeConflicts.state, "open")));
    }
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.conflict.resolved", targetType: "riwi_knowledge_conflict", targetId: row.id,
      metadata: { sourceId: row.candidateSourceId, role: input.actor.role, decision: input.decision, status: state, reason } }, tx as never);
    return { ok: true as const, sourceId: row.candidateSourceId, state };
  });
}

export async function rejectKnowledgeCandidate(input: {
  actor: KnowledgeActor;
  sourceId: string;
  reason: string;
}, database: Pick<typeof db, "select" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.sourceId)) throw new KnowledgeServiceError("invalid_input");
  const rawReason = input.reason.trim();
  if (!rawReason || rawReason.length > 1000) throw new KnowledgeServiceError("invalid_input");
  const reason = redactExternalText(rawReason, 1000).trim();
  if (!reason) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    // Match conflict-resolution lock order (conflict rows before source) to avoid a rejection/resolution deadlock.
    await tx.select({ id: riwiKnowledgeConflicts.id }).from(riwiKnowledgeConflicts)
      .where(and(eq(riwiKnowledgeConflicts.candidateSourceId, input.sourceId), eq(riwiKnowledgeConflicts.state, "open")))
      .orderBy(asc(riwiKnowledgeConflicts.id)).for("update");
    const [source] = await tx.select({ id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, version: riwiKnowledgeSources.version })
      .from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.sourceId)).limit(1).for("update");
    if (!source) throw new KnowledgeServiceError("not_found");
    if (source.state !== "candidate") throw new KnowledgeServiceError("invalid_state");
    const now = new Date();
    const [rejected] = await tx.update(riwiKnowledgeSources).set({
      state: "rejected", reviewedByUserId: input.actor.id, updatedAt: now,
    }).where(and(eq(riwiKnowledgeSources.id, source.id), eq(riwiKnowledgeSources.state, "candidate")))
      .returning({ id: riwiKnowledgeSources.id });
    if (!rejected) throw new KnowledgeServiceError("invalid_state");
    await tx.update(riwiKnowledgeConflicts).set({
      state: "rejected", resolvedByUserId: input.actor.id, resolutionNote: reason, resolvedAt: now,
    }).where(and(eq(riwiKnowledgeConflicts.candidateSourceId, source.id), eq(riwiKnowledgeConflicts.state, "open")));
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.rejected", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: source.version, status: "rejected", decision: "reject", reason } }, tx as never);
    return { id: source.id, version: source.version, state: "rejected" as const };
  });
}

export async function approveKnowledgeCandidate(input: {
  actor: KnowledgeActor;
  sourceId: string;
  reason?: string;
}, database: Pick<typeof db, "select" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.approve")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.sourceId)) throw new KnowledgeServiceError("invalid_input");
  const rawReason = input.reason?.trim();
  if (rawReason && rawReason.length > 1000) throw new KnowledgeServiceError("invalid_input");
  const reason = rawReason ? redactExternalText(rawReason, 1000).trim() : undefined;
  if (rawReason && !reason) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    // Lock conflicts before their candidate source, matching the conflict resolver's order.
    const openConflicts = await tx.select({ id: riwiKnowledgeConflicts.id }).from(riwiKnowledgeConflicts)
      .where(and(eq(riwiKnowledgeConflicts.candidateSourceId, input.sourceId), eq(riwiKnowledgeConflicts.state, "open")))
      .orderBy(asc(riwiKnowledgeConflicts.id)).for("update");
    const [source] = await tx.select({ id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, rightsClass: riwiKnowledgeSources.rightsClass, version: riwiKnowledgeSources.version })
      .from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.sourceId)).limit(1).for("update");
    if (!source) throw new KnowledgeServiceError("not_found");
    if (source.state !== "candidate") throw new KnowledgeServiceError("invalid_state");
    if (!RIGHTS_ALLOWED_FOR_PROMOTION.has(source.rightsClass as KnowledgeRightsClass)) throw new KnowledgeServiceError("rights_unverified");
    if (openConflicts.length > 0) throw new KnowledgeServiceError("unresolved_conflict");
    await tx.update(riwiKnowledgeSources).set({ state: "approved", reviewedByUserId: input.actor.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(riwiKnowledgeSources.id, source.id), eq(riwiKnowledgeSources.state, "candidate")));
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.approved", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: source.version, status: "approved", reason } }, tx as never);
    return { id: source.id, version: source.version, state: "approved" as const };
  });
}

export async function promoteKnowledgeSource(input: {
  actor: KnowledgeActor;
  sourceId: string;
  regressionFixtureId: string;
  supersedesSourceId?: string | null;
  expectedVersion?: number;
  expectedSupersedesVersion?: number;
  reason?: string;
}, database: Pick<typeof db, "select" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.promote")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.sourceId) || (input.supersedesSourceId && !UUID.test(input.supersedesSourceId))
    || (input.expectedVersion !== undefined && (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1))
    || (input.expectedSupersedesVersion !== undefined && (!Number.isInteger(input.expectedSupersedesVersion) || input.expectedSupersedesVersion < 1))) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (!isRiwiRegressionFixture(input.regressionFixtureId, "knowledge")) throw new KnowledgeServiceError("regression_required");
  const rawReason = input.reason?.trim();
  if (rawReason && rawReason.length > 1000) throw new KnowledgeServiceError("invalid_input");
  const reason = rawReason ? redactExternalText(rawReason, 1000).trim() : undefined;
  if (rawReason && !reason) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    const [source] = await tx.select({
      id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, rightsClass: riwiKnowledgeSources.rightsClass,
      version: riwiKnowledgeSources.version, supersedesSourceId: riwiKnowledgeSources.supersedesSourceId,
      sourceType: riwiKnowledgeSources.sourceType, checksum: riwiKnowledgeSources.checksum,
      scope: riwiKnowledgeSources.scope, scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
      unitCount: riwiKnowledgeSources.unitCount,
    }).from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.sourceId)).limit(1).for("update");
    if (!source) throw new KnowledgeServiceError("not_found");
    if (input.expectedVersion !== undefined && input.expectedVersion !== source.version) throw new KnowledgeServiceError("stale_version");
    if (source.state !== "approved") throw new KnowledgeServiceError("invalid_state");
    if (!RIGHTS_ALLOWED_FOR_PROMOTION.has(source.rightsClass as KnowledgeRightsClass)) throw new KnowledgeServiceError("rights_unverified");
    const verifiedUnits = await tx.select({ ordinal: riwiKnowledgeUnits.ordinal, content: riwiKnowledgeUnits.content, contentHash: riwiKnowledgeUnits.contentHash, characterCount: riwiKnowledgeUnits.characterCount })
      .from(riwiKnowledgeUnits).where(eq(riwiKnowledgeUnits.sourceId, source.id)).orderBy(riwiKnowledgeUnits.ordinal);
    if (verifiedUnits.length !== source.unitCount || verifiedUnits.length === 0 || verifiedUnits.length > 200
      || verifiedUnits.some((unit, index) => unit.ordinal !== index || unit.characterCount !== unit.content.length || unit.contentHash !== sha256(unit.content))) {
      throw new KnowledgeServiceError("regression_required");
    }
    const regression = runRiwiRegressionSuite(source.checksum);
    if (!regression.passed) throw new KnowledgeServiceError("regression_required");
    const regressionPassedAt = new Date();
    const conflicts = await tx.select({
      activeSourceId: riwiKnowledgeConflicts.activeSourceId, state: riwiKnowledgeConflicts.state,
      activeScope: riwiKnowledgeSources.scope, activeScopeRole: riwiKnowledgeSources.scopeRole,
      activeScopeUserId: riwiKnowledgeSources.scopeUserId,
    }).from(riwiKnowledgeConflicts)
      .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeConflicts.activeSourceId))
      .where(eq(riwiKnowledgeConflicts.candidateSourceId, source.id));
    if (conflicts.some((conflict) => conflict.state === "open" || conflict.state === "resolved")) {
      throw new KnowledgeServiceError("unresolved_conflict");
    }
    if (conflicts.some((conflict) => conflict.state === "rejected")) throw new KnowledgeServiceError("invalid_state");
    const sameScopeAcceptedSources = [...new Set(conflicts.filter((conflict) => conflict.state === "accepted"
      && conflict.activeScope === source.scope && conflict.activeScopeRole === source.scopeRole
      && conflict.activeScopeUserId === source.scopeUserId).map((conflict) => conflict.activeSourceId))];
    if (sameScopeAcceptedSources.length > 0
      && (sameScopeAcceptedSources.length !== 1 || input.supersedesSourceId !== sameScopeAcceptedSources[0])) {
      throw new KnowledgeServiceError("unresolved_conflict");
    }
    if (input.supersedesSourceId && sameScopeAcceptedSources.length > 0
      && input.supersedesSourceId !== sameScopeAcceptedSources[0]) throw new KnowledgeServiceError("unresolved_conflict");

    let nextVersion = source.version;
    if (input.supersedesSourceId) {
      const [prior] = await tx.select({
        id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, sourceType: riwiKnowledgeSources.sourceType,
        version: riwiKnowledgeSources.version, scope: riwiKnowledgeSources.scope,
        scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
      }).from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.supersedesSourceId)).limit(1).for("update");
      if (!prior || prior.state !== "active" || prior.sourceType !== source.sourceType
        || prior.scope !== source.scope || prior.scopeRole !== source.scopeRole || prior.scopeUserId !== source.scopeUserId) {
        throw new KnowledgeServiceError("invalid_input");
      }
      if (input.expectedSupersedesVersion !== undefined && input.expectedSupersedesVersion !== prior.version) {
        throw new KnowledgeServiceError("stale_version");
      }
      nextVersion = prior.version + 1;
      const [superseded] = await tx.update(riwiKnowledgeSources).set({ state: "superseded", updatedAt: new Date() })
        .where(and(eq(riwiKnowledgeSources.id, prior.id), eq(riwiKnowledgeSources.state, "active"))).returning({ id: riwiKnowledgeSources.id });
      if (!superseded) throw new KnowledgeServiceError("invalid_state");
      const [activated] = await tx.update(riwiKnowledgeSources).set({
        state: "active", version: nextVersion, supersedesSourceId: prior.id, activatedAt: new Date(), updatedAt: new Date(),
        regressionFixtureId: input.regressionFixtureId, regressionEvidenceHash: regression.evidenceHash, regressionPassedAt,
      }).where(and(eq(riwiKnowledgeSources.id, source.id), eq(riwiKnowledgeSources.state, "approved"))).returning({ id: riwiKnowledgeSources.id });
      if (!activated) throw new KnowledgeServiceError("invalid_state");
      await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.superseded", targetType: "riwi_knowledge_source", targetId: prior.id,
        metadata: { sourceId: prior.id, version: prior.version, status: "superseded" } }, tx as never);
    } else {
      const [activated] = await tx.update(riwiKnowledgeSources).set({
        state: "active", activatedAt: new Date(), updatedAt: new Date(), regressionFixtureId: input.regressionFixtureId,
        regressionEvidenceHash: regression.evidenceHash, regressionPassedAt,
      }).where(and(eq(riwiKnowledgeSources.id, source.id), eq(riwiKnowledgeSources.state, "approved"))).returning({ id: riwiKnowledgeSources.id });
      if (!activated) throw new KnowledgeServiceError("invalid_state");
    }
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.regression.passed", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: nextVersion, status: "passed", regressionFixtureId: input.regressionFixtureId, inputHash: regression.evidenceHash } }, tx as never);
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.promoted", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: nextVersion, status: "active", regressionFixtureId: input.regressionFixtureId, inputHash: regression.evidenceHash, reason } }, tx as never);
    return { id: source.id, version: nextVersion, state: "active" as const, regressionFixtureId: input.regressionFixtureId, regressionEvidenceHash: regression.evidenceHash };
  });
}

export type RetrievedKnowledge = { ref: string; sourceId: string; unitId: string; title: string; sourceType: KnowledgeSourceType; authority: number; version: number; text: string };
export async function retrieveActiveKnowledge(query: string, actor: { id: string; role: Role }, database: Pick<typeof db, "select"> = db): Promise<RetrievedKnowledge[]> {
  const safeQuery = knowledgeSearchQuery(query.trim().slice(0, 500));
  if (!safeQuery) return [];
  const scope = or(
    eq(riwiKnowledgeSources.scope, "global"),
    and(eq(riwiKnowledgeSources.scope, "role"), eq(riwiKnowledgeSources.scopeRole, actor.role)),
    and(eq(riwiKnowledgeSources.scope, "user"), eq(riwiKnowledgeSources.scopeUserId, actor.id)),
  );
  const search = sql`to_tsquery('simple', ${safeQuery})`;
  let rows: Array<{ sourceId: string; unitId: string; title: string; sourceType: KnowledgeSourceType; authority: number; version: number; text: string }> = [];
  try {
    rows = await database.select({
      sourceId: riwiKnowledgeSources.id, unitId: riwiKnowledgeUnits.id, title: riwiKnowledgeSources.title,
      sourceType: riwiKnowledgeSources.sourceType, authority: riwiKnowledgeSources.authority,
      version: riwiKnowledgeSources.version, text: riwiKnowledgeUnits.content,
    }).from(riwiKnowledgeUnits)
      .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeUnits.sourceId))
      .where(and(
        eq(riwiKnowledgeSources.state, "active"), scope,
        sql`to_tsvector('simple', ${riwiKnowledgeUnits.content}) @@ ${search}`,
      ))
      .orderBy(
        desc(sql`case ${riwiKnowledgeSources.scope} when 'user' then 2 when 'role' then 1 else 0 end`),
        desc(sql`ts_rank(to_tsvector('simple', ${riwiKnowledgeUnits.content}), ${search})`),
        desc(riwiKnowledgeSources.authority), desc(riwiKnowledgeSources.updatedAt),
        asc(riwiKnowledgeUnits.ordinal), asc(riwiKnowledgeUnits.id),
      )
      .limit(20);
  } catch {
    // Search unavailability is fail-closed: do not widen to unfiltered knowledge.
    return [];
  }
  return rows.slice(0, 5).map((row, index) => ({ ...row, ref: `K${index + 1}` }));
}

export async function getActiveConflictCount(database: Pick<typeof db, "select"> = db): Promise<number> {
  const [row] = await database.select({ count: sql<number>`count(*)::int` }).from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.state, "open"));
  return row?.count ?? 0;
}
