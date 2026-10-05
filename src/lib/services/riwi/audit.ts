import "server-only";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { recordAudit, type AuditAction } from "@/lib/data/audit";
import { db } from "@/db/client";
import { auditLog, users } from "@/db/schema";
import type { AccountStatus } from "@/lib/auth/account-status";
import type { Role } from "@/lib/auth/roles";
import { RIWI_PROVENANCE } from "./contracts";
import { authorizeCapability } from "./capabilities";
import {
  decodeOwnerHistoryCursor,
  encodeOwnerHistoryCursor,
  ownerHistoryPageLimit,
  RiwiOwnerHistoryCursorError,
  type RiwiOwnerHistoryPosition,
} from "./owner-history-cursor";

export const RIWI_AUDIT_ACTIONS = [
  "riwi.request.started", "riwi.request.completed", "riwi.request.denied", "riwi.action.confirmation.required", "riwi.tool.invoked", "riwi.tool.succeeded", "riwi.tool.failed",
  "riwi.external.requested", "riwi.external.succeeded", "riwi.external.failed", "riwi.provider.config.changed",
  "riwi.knowledge.source.created", "riwi.knowledge.conflict.resolved", "riwi.knowledge.approved", "riwi.knowledge.regression.passed", "riwi.knowledge.rejected", "riwi.learning.regression.passed", "riwi.knowledge.promoted", "riwi.knowledge.superseded",
  "riwi.owner.action.confirmed", "riwi.learning.signal.created", "riwi.learning.promotion.rejected", "riwi.learning.signal.materialized", "riwi.conversation.deleted", "riwi.conversation.read", "riwi.learning.reviewed", "riwi.course.lesson.read",
  "riwi.assessment.policy.candidate", "riwi.assessment.policy.previewed", "riwi.assessment.policy.regression.passed", "riwi.assessment.policy.approved", "riwi.assessment.policy.rejected",
] as const satisfies readonly AuditAction[];
export type RiwiAuditAction = (typeof RIWI_AUDIT_ACTIONS)[number];

/** Allowlisted metadata only. Private text, prompt bodies, secrets and URLs cannot be passed through. */
const metadataSchema = z.object({
  correlationId: z.string().uuid().optional(),
  role: z.enum(["student", "teacher", "admin", "owner"]).optional(),
  intent: z.string().max(40).optional(),
  answerSource: z.enum(RIWI_PROVENANCE).optional(),
  capability: z.string().max(80).optional(),
  toolName: z.string().max(80).optional(),
  riskClass: z.enum(["read-only", "reversible-write", "high-impact-write", "outbound"]).optional(),
  scopeKind: z.enum(["self", "assigned", "roster", "admin-subject", "staff", "admin", "global", "course_lesson"]).optional(),
  targetId: z.string().max(80).optional(),
  sourceId: z.string().uuid().optional(),
  signalId: z.string().uuid().optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  resultCount: z.number().int().min(0).max(100_000).optional(),
  unitCount: z.number().int().min(0).max(1000).optional(),
  durationMs: z.number().int().min(0).max(600_000).optional(),
  providerId: z.string().max(60).optional(),
  model: z.string().max(120).optional(),
  evaluationId: z.string().uuid().optional(),
  evaluationType: z.enum(["writing", "speaking", "grammar", "vocabulary"]).optional(),
  validationStatus: z.enum(["validated"]).optional(),
  externalEnabled: z.boolean().optional(),
  fallback: z.enum(["riwi", "none"]).optional(),
  taskProfile: z.string().max(60).optional(),
  fallbackUsed: z.boolean().optional(),
  status: z.string().max(40).optional(),
  code: z.string().max(80).optional(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceChecksum: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceType: z.string().max(60).optional(),
  rightsClass: z.string().max(40).optional(),
  decision: z.string().max(40).optional(),
  regressionFixtureId: z.string().max(120).optional(),
  reason: z.string().max(1000).optional(),
}).strict();

export type RiwiAuditMetadata = z.infer<typeof metadataSchema>;

export async function recordRiwiAudit(input: {
  actorUserId: string | null;
  action: RiwiAuditAction;
  targetType?: string;
  targetId?: string;
  metadata: RiwiAuditMetadata;
}, connection: Pick<typeof db, "insert"> = db): Promise<void> {
  const safe = metadataSchema.parse(input.metadata);
  await recordAudit({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType ?? "riwi",
    targetId: input.targetId,
    metadata: safe,
  }, connection);
}

export class RiwiAuditError extends Error {
  constructor(public readonly code: "forbidden" | "invalid_input") { super(code); }
}

async function requireActiveAuditOwner(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  database: Pick<typeof db, "select">,
): Promise<void> {
  if (actor.role !== "owner" || !authorizeCapability(actor, "riwi.audit.read_owner").allowed) throw new RiwiAuditError("forbidden");
  const [subject] = await database.select({ role: users.role, accountStatus: users.accountStatus })
    .from(users).where(eq(users.id, actor.id)).limit(1);
  if (subject?.role !== "owner" || subject.accountStatus !== "active") throw new RiwiAuditError("forbidden");
}

export async function listRiwiGovernanceAuditPage(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  options: { cursor?: string | null; limit?: number } = {},
  database: Pick<typeof db, "select"> = db,
) {
  await requireActiveAuditOwner(actor, database);
  let limit: number;
  let after: RiwiOwnerHistoryPosition | null;
  try {
    limit = ownerHistoryPageLimit(options.limit);
    after = decodeOwnerHistoryCursor(options.cursor, actor, "audit_entries");
  } catch (error) {
    if (error instanceof RiwiOwnerHistoryCursorError) throw new RiwiAuditError("invalid_input");
    throw error;
  }
  const rows = await database.select({
    id: auditLog.id, actorUserId: auditLog.actorUserId, action: auditLog.action,
    targetType: auditLog.targetType, targetId: auditLog.targetId, metadata: auditLog.metadata, createdAt: auditLog.createdAt,
  }).from(auditLog).where(and(
    inArray(auditLog.action, RIWI_AUDIT_ACTIONS),
    after ? or(
      lt(auditLog.createdAt, after.sortAt),
      and(eq(auditLog.createdAt, after.sortAt), lt(auditLog.id, after.id)),
    ) : undefined,
  )).orderBy(desc(auditLog.createdAt), desc(auditLog.id)).limit(limit + 1);
  const hasMore = rows.length > limit;
  const entries = rows.slice(0, limit).map((entry) => {
    const parsed = metadataSchema.safeParse(entry.metadata);
    return { ...entry, metadata: parsed.success ? parsed.data : null };
  });
  const last = entries.at(-1);
  return {
    entries,
    nextCursor: hasMore && last
      ? encodeOwnerHistoryCursor({ actor, collection: "audit_entries", after: { sortAt: last.createdAt, id: last.id } })
      : null,
  };
}

export async function countRiwiGovernanceAuditForOwner(
  actor: { id: string; role: Role; accountStatus: AccountStatus },
  database: Pick<typeof db, "select"> = db,
) {
  await requireActiveAuditOwner(actor, database);
  const [row] = await database.select({ total: sql<number>`count(*)::int` })
    .from(auditLog).where(inArray(auditLog.action, RIWI_AUDIT_ACTIONS));
  return Number(row?.total ?? 0);
}
