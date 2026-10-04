import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { riwiKnowledgeConflicts, riwiKnowledgeSources, riwiKnowledgeUnits } from "@/db/schema";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { authorizeCapability } from "./capabilities";
import { recordRiwiAudit } from "./audit";
import { isRiwiRegressionFixture, runRiwiRegressionSuite } from "./golden/fixtures";
import { chunkKnowledgeText } from "./knowledge-parser";
import type { KnowledgeScope } from "./knowledge-policy";

export const KNOWLEDGE_SOURCE_TYPES = [
  "owner_instruction", "ielts_rubric", "grammar_material", "vocabulary_material", "speaking_material",
  "writing_material", "dictionary_material", "learning_methodology", "course_document", "policy",
  "verified_example", "provider_evaluation", "teacher_correction", "owner_correction", "regression_fixture",
] as const;
export type KnowledgeSourceType = (typeof KNOWLEDGE_SOURCE_TYPES)[number];
export const KNOWLEDGE_RIGHTS_CLASSES = ["owner_authored", "licensed", "public_domain", "internal_permission", "third_party_reference", "unknown"] as const;
export type KnowledgeRightsClass = (typeof KNOWLEDGE_RIGHTS_CLASSES)[number];
export type { KnowledgeScope } from "./knowledge-policy";
export type KnowledgePublicationScope = Exclude<KnowledgeScope, { kind: "user" }>;

const RIGHTS_ALLOWED_FOR_PROMOTION = new Set<KnowledgeRightsClass>(["owner_authored", "licensed", "public_domain", "internal_permission"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OWNER_AUTHORITY: Record<KnowledgeSourceType, number> = {
  owner_instruction: 100, policy: 100, ielts_rubric: 95, dictionary_material: 90,
  verified_example: 85, owner_correction: 85, learning_methodology: 80, course_document: 75,
  teacher_correction: 70, writing_material: 65, speaking_material: 65, grammar_material: 65,
  vocabulary_material: 65, provider_evaluation: 40, regression_fixture: 100,
};

export class KnowledgeServiceError extends Error {
  constructor(public readonly code: "forbidden" | "invalid_input" | "not_found" | "invalid_state" | "rights_unverified" | "unresolved_conflict" | "regression_required" | "duplicate_source" | "write_failed") {
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
}, database: Pick<typeof db, "select" | "insert" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.submit_candidate")) throw new KnowledgeServiceError("forbidden");
  if (!KNOWLEDGE_SOURCE_TYPES.includes(input.sourceType) || !KNOWLEDGE_RIGHTS_CLASSES.includes(input.rightsClass)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  if (!input.scope || !["global", "role"].includes(input.scope.kind) ||
      (input.scope.kind === "role" && !["student", "teacher", "admin", "owner"].includes(input.scope.role))) {
    throw new KnowledgeServiceError("invalid_input");
  }
  const title = input.title.trim();
  const provenance = input.provenance.trim();
  const content = input.content.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!title || title.length > 200 || !provenance || provenance.length > 500) throw new KnowledgeServiceError("invalid_input");
  const checksum = sha256(content);
  if (input.checksum && (!/^[a-f0-9]{64}$/i.test(input.checksum) || input.checksum.toLowerCase() !== checksum)) {
    throw new KnowledgeServiceError("invalid_input");
  }
  const units = chunkKnowledgeText(content);
  const [duplicate] = await database.select({ id: riwiKnowledgeSources.id }).from(riwiKnowledgeSources)
    .where(and(eq(riwiKnowledgeSources.checksum, checksum), eq(riwiKnowledgeSources.sourceType, input.sourceType))).limit(1);
  if (duplicate) throw new KnowledgeServiceError("duplicate_source");

  const source = await database.transaction(async (tx) => {
    const [created] = await tx.insert(riwiKnowledgeSources).values({
      sourceType: input.sourceType, title, checksum, provenance,
      rightsClass: input.rightsClass, authority: OWNER_AUTHORITY[input.sourceType],
      scope: input.scope.kind, scopeRole: input.scope.kind === "role" ? input.scope.role : null, scopeUserId: null,
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
      : or(eq(riwiKnowledgeSources.scope, "global"), and(eq(riwiKnowledgeSources.scope, "role"), eq(riwiKnowledgeSources.scopeRole, input.scope.role)));
    const existing = await tx.select({
      sourceId: riwiKnowledgeSources.id,
      unitId: riwiKnowledgeUnits.id,
      text: riwiKnowledgeUnits.content,
    }).from(riwiKnowledgeUnits)
      .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeUnits.sourceId))
      .where(and(eq(riwiKnowledgeSources.state, "active"), activeScope))
      .orderBy(desc(riwiKnowledgeSources.authority), desc(riwiKnowledgeSources.updatedAt))
      .limit(500);

    const conflicts: Array<{ candidateUnitId: string; activeSourceId: string; activeUnitId: string; conflictKey: string }> = [];
    for (const candidate of storedUnits) {
      for (const active of existing) {
        if (!detectKnowledgeOverlap(candidate.content, active.text)) continue;
        const key = sha256([...keywords(candidate.content)].filter((word) => keywords(active.text).has(word)).sort().join(" "));
        conflicts.push({ candidateUnitId: candidate.id, activeSourceId: active.sourceId, activeUnitId: active.unitId, conflictKey: key });
        if (conflicts.length >= 1000) break;
      }
      if (conflicts.length >= 1000) break;
    }
    if (conflicts.length) await tx.insert(riwiKnowledgeConflicts).values(conflicts.map((conflict) => ({
      candidateSourceId: created.id, candidateUnitId: conflict.candidateUnitId,
      activeSourceId: conflict.activeSourceId, activeUnitId: conflict.activeUnitId,
      conflictKey: conflict.conflictKey, reason: "lexical_overlap_review", state: "open" as const,
    }))).onConflictDoNothing();

    const [candidate] = await tx.update(riwiKnowledgeSources).set({ state: "candidate", updatedAt: new Date() })
      .where(eq(riwiKnowledgeSources.id, created.id)).returning({ id: riwiKnowledgeSources.id, version: riwiKnowledgeSources.version, unitCount: riwiKnowledgeSources.unitCount, state: riwiKnowledgeSources.state });
    if (!candidate) throw new KnowledgeServiceError("write_failed");
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.source.created", targetType: "riwi_knowledge_source", targetId: candidate.id,
      metadata: { sourceId: candidate.id, version: candidate.version, unitCount: candidate.unitCount, contentHash: checksum, sourceType: input.sourceType, rightsClass: input.rightsClass, resultCount: conflicts.length } }, tx as never);
    return { ...candidate, conflictCount: conflicts.length };
  });
  return source;
}

export async function listKnowledgeSources(actor: KnowledgeActor, database: Pick<typeof db, "select"> = db) {
  if (!canManage(actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  return database.select({
    id: riwiKnowledgeSources.id, sourceType: riwiKnowledgeSources.sourceType, title: riwiKnowledgeSources.title,
    provenance: riwiKnowledgeSources.provenance, rightsClass: riwiKnowledgeSources.rightsClass, authority: riwiKnowledgeSources.authority,
    scope: riwiKnowledgeSources.scope, scopeRole: riwiKnowledgeSources.scopeRole, version: riwiKnowledgeSources.version,
    state: riwiKnowledgeSources.state, unitCount: riwiKnowledgeSources.unitCount, checksum: riwiKnowledgeSources.checksum,
    regressionFixtureId: riwiKnowledgeSources.regressionFixtureId, regressionEvidenceHash: riwiKnowledgeSources.regressionEvidenceHash,
    regressionPassedAt: riwiKnowledgeSources.regressionPassedAt,
    createdAt: riwiKnowledgeSources.createdAt, approvedAt: riwiKnowledgeSources.approvedAt, activatedAt: riwiKnowledgeSources.activatedAt,
  }).from(riwiKnowledgeSources).orderBy(desc(riwiKnowledgeSources.updatedAt)).limit(200);
}

export async function listKnowledgeConflicts(actor: KnowledgeActor, sourceId: string, database: Pick<typeof db, "select"> = db) {
  if (!canManage(actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(sourceId)) throw new KnowledgeServiceError("invalid_input");
  return database.select({
    id: riwiKnowledgeConflicts.id, state: riwiKnowledgeConflicts.state, reason: riwiKnowledgeConflicts.reason,
    candidateText: riwiKnowledgeUnits.content, candidateHeading: riwiKnowledgeUnits.heading,
    activeTitle: riwiKnowledgeSources.title, activeSourceId: riwiKnowledgeConflicts.activeSourceId,
    activeUnitId: riwiKnowledgeConflicts.activeUnitId,
  }).from(riwiKnowledgeConflicts)
    .innerJoin(riwiKnowledgeUnits, eq(riwiKnowledgeUnits.id, riwiKnowledgeConflicts.candidateUnitId))
    .innerJoin(riwiKnowledgeSources, eq(riwiKnowledgeSources.id, riwiKnowledgeConflicts.activeSourceId))
    .where(eq(riwiKnowledgeConflicts.candidateSourceId, sourceId))
    .orderBy(riwiKnowledgeConflicts.createdAt).limit(500);
}

export async function resolveKnowledgeConflict(input: {
  actor: KnowledgeActor;
  conflictId: string;
  decision: "accept_candidate" | "keep_active";
  reason: string;
}, database: Pick<typeof db, "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.review")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.conflictId)) throw new KnowledgeServiceError("invalid_input");
  const reason = input.reason.trim();
  if (!reason || reason.length > 1000) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    const [row] = await tx.select({ id: riwiKnowledgeConflicts.id, state: riwiKnowledgeConflicts.state, candidateSourceId: riwiKnowledgeConflicts.candidateSourceId })
      .from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.id, input.conflictId)).limit(1).for("update");
    if (!row) throw new KnowledgeServiceError("not_found");
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
    }
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.conflict.resolved", targetType: "riwi_knowledge_conflict", targetId: row.id,
      metadata: { sourceId: row.candidateSourceId, role: input.actor.role, decision: input.decision, status: state } }, tx as never);
    return { ok: true as const, sourceId: row.candidateSourceId, state };
  });
}

export async function approveKnowledgeCandidate(input: {
  actor: KnowledgeActor;
  sourceId: string;
}, database: Pick<typeof db, "select" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.approve")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.sourceId)) throw new KnowledgeServiceError("invalid_input");
  return database.transaction(async (tx) => {
    const [source] = await tx.select({ id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, rightsClass: riwiKnowledgeSources.rightsClass, version: riwiKnowledgeSources.version })
      .from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.sourceId)).limit(1).for("update");
    if (!source) throw new KnowledgeServiceError("not_found");
    if (source.state !== "candidate") throw new KnowledgeServiceError("invalid_state");
    if (!RIGHTS_ALLOWED_FOR_PROMOTION.has(source.rightsClass as KnowledgeRightsClass)) throw new KnowledgeServiceError("rights_unverified");
    const [openConflict] = await tx.select({ id: riwiKnowledgeConflicts.id }).from(riwiKnowledgeConflicts)
      .where(and(eq(riwiKnowledgeConflicts.candidateSourceId, source.id), eq(riwiKnowledgeConflicts.state, "open"))).limit(1);
    if (openConflict) throw new KnowledgeServiceError("unresolved_conflict");
    await tx.update(riwiKnowledgeSources).set({ state: "approved", reviewedByUserId: input.actor.id, approvedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(riwiKnowledgeSources.id, source.id), eq(riwiKnowledgeSources.state, "candidate")));
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.approved", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: source.version, status: "approved" } }, tx as never);
    return { id: source.id, version: source.version, state: "approved" as const };
  });
}

export async function promoteKnowledgeSource(input: {
  actor: KnowledgeActor;
  sourceId: string;
  regressionFixtureId: string;
  supersedesSourceId?: string | null;
}, database: Pick<typeof db, "select" | "update" | "transaction"> = db) {
  if (!canManage(input.actor, "riwi.knowledge.promote")) throw new KnowledgeServiceError("forbidden");
  if (!UUID.test(input.sourceId) || (input.supersedesSourceId && !UUID.test(input.supersedesSourceId))) throw new KnowledgeServiceError("invalid_input");
  if (!isRiwiRegressionFixture(input.regressionFixtureId, "knowledge")) throw new KnowledgeServiceError("regression_required");
  return database.transaction(async (tx) => {
    const [source] = await tx.select({
      id: riwiKnowledgeSources.id, state: riwiKnowledgeSources.state, rightsClass: riwiKnowledgeSources.rightsClass,
      version: riwiKnowledgeSources.version, supersedesSourceId: riwiKnowledgeSources.supersedesSourceId,
      sourceType: riwiKnowledgeSources.sourceType, checksum: riwiKnowledgeSources.checksum,
      scope: riwiKnowledgeSources.scope, scopeRole: riwiKnowledgeSources.scopeRole, scopeUserId: riwiKnowledgeSources.scopeUserId,
      unitCount: riwiKnowledgeSources.unitCount,
    }).from(riwiKnowledgeSources).where(eq(riwiKnowledgeSources.id, input.sourceId)).limit(1).for("update");
    if (!source) throw new KnowledgeServiceError("not_found");
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
    const conflicts = await tx.select({ activeSourceId: riwiKnowledgeConflicts.activeSourceId, state: riwiKnowledgeConflicts.state })
      .from(riwiKnowledgeConflicts).where(eq(riwiKnowledgeConflicts.candidateSourceId, source.id));
    if (conflicts.some((conflict) => conflict.state === "open" || conflict.state === "resolved")) {
      throw new KnowledgeServiceError("unresolved_conflict");
    }
    if (conflicts.some((conflict) => conflict.state === "rejected")) throw new KnowledgeServiceError("invalid_state");
    const acceptedSources = [...new Set(conflicts.filter((conflict) => conflict.state === "accepted").map((conflict) => conflict.activeSourceId))];
    if (acceptedSources.length > 0 && (acceptedSources.length !== 1 || input.supersedesSourceId !== acceptedSources[0])) {
      throw new KnowledgeServiceError("unresolved_conflict");
    }

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
    await recordRiwiAudit({ actorUserId: input.actor.id, action: "riwi.knowledge.promoted", targetType: "riwi_knowledge_source", targetId: source.id,
      metadata: { sourceId: source.id, version: nextVersion, status: "active", regressionFixtureId: input.regressionFixtureId, inputHash: regression.evidenceHash } }, tx as never);
    return { id: source.id, version: nextVersion, state: "active" as const, regressionFixtureId: input.regressionFixtureId, regressionEvidenceHash: regression.evidenceHash };
  });
}

export type RetrievedKnowledge = { ref: string; sourceId: string; unitId: string; title: string; sourceType: KnowledgeSourceType; authority: number; version: number; text: string };
export async function retrieveActiveKnowledge(query: string, actor: { id: string; role: Role }, database: Pick<typeof db, "select"> = db): Promise<RetrievedKnowledge[]> {
  const safeQuery = query.trim().slice(0, 500);
  if (!safeQuery) return [];
  const scope = or(
    eq(riwiKnowledgeSources.scope, "global"),
    and(eq(riwiKnowledgeSources.scope, "role"), eq(riwiKnowledgeSources.scopeRole, actor.role)),
    and(eq(riwiKnowledgeSources.scope, "user"), eq(riwiKnowledgeSources.scopeUserId, actor.id)),
  );
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
        sql`to_tsvector('simple', ${riwiKnowledgeUnits.content}) @@ plainto_tsquery('simple', ${safeQuery})`,
      ))
      .orderBy(desc(sql`ts_rank(to_tsvector('simple', ${riwiKnowledgeUnits.content}), plainto_tsquery('simple', ${safeQuery}))`), desc(riwiKnowledgeSources.authority))
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
