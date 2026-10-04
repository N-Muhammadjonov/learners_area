import "server-only";
import { z } from "zod";
import { recordAudit, type AuditAction } from "@/lib/data/audit";
import { db } from "@/db/client";

export const RIWI_AUDIT_ACTIONS = [
  "riwi.request.started", "riwi.request.completed", "riwi.request.denied", "riwi.action.confirmation.required", "riwi.tool.invoked", "riwi.tool.succeeded", "riwi.tool.failed",
  "riwi.external.requested", "riwi.external.succeeded", "riwi.external.failed", "riwi.provider.config.changed",
  "riwi.knowledge.source.created", "riwi.knowledge.conflict.resolved", "riwi.knowledge.approved", "riwi.knowledge.promoted", "riwi.knowledge.superseded",
  "riwi.owner.action.confirmed", "riwi.learning.signal.created", "riwi.learning.promotion.rejected", "riwi.learning.signal.materialized", "riwi.conversation.deleted", "riwi.conversation.read", "riwi.learning.reviewed",
] as const satisfies readonly AuditAction[];
export type RiwiAuditAction = (typeof RIWI_AUDIT_ACTIONS)[number];

/** Allowlisted metadata only. Private text, prompt bodies, secrets and URLs cannot be passed through. */
const metadataSchema = z.object({
  correlationId: z.string().uuid().optional(),
  role: z.enum(["student", "teacher", "admin", "owner"]).optional(),
  intent: z.string().max(40).optional(),
  answerSource: z.enum(["canonical_dictionary", "deterministic_learning_data", "deterministic_report", "external_provider", "policy_refusal", "unavailable"]).optional(),
  capability: z.string().max(80).optional(),
  toolName: z.string().max(80).optional(),
  riskClass: z.enum(["read-only", "reversible-write", "high-impact-write", "outbound"]).optional(),
  scopeKind: z.enum(["self", "assigned", "roster", "admin-subject", "staff", "admin", "global"]).optional(),
  targetId: z.string().max(80).optional(),
  sourceId: z.string().uuid().optional(),
  signalId: z.string().uuid().optional(),
  version: z.number().int().min(1).max(1_000_000).optional(),
  resultCount: z.number().int().min(0).max(100_000).optional(),
  unitCount: z.number().int().min(0).max(1000).optional(),
  durationMs: z.number().int().min(0).max(600_000).optional(),
  providerId: z.string().max(60).optional(),
  model: z.string().max(120).optional(),
  externalEnabled: z.boolean().optional(),
  fallback: z.enum(["riwi", "none"]).optional(),
  taskProfile: z.string().max(60).optional(),
  fallbackUsed: z.boolean().optional(),
  status: z.string().max(40).optional(),
  code: z.string().max(80).optional(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  sourceType: z.string().max(60).optional(),
  rightsClass: z.string().max(40).optional(),
  decision: z.string().max(40).optional(),
  regressionFixtureId: z.string().max(120).optional(),
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
