import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { auditLog } from "@/db/schema";

/**
 * The audit trail for actions that change who can do what.
 *
 * Rows here never contain a secret, a password, a token or a full private text:
 * only ids, roles, statuses, counts and short reasons. The audit log is what
 * makes an ownership transfer or a suspension explainable months later.
 */

export type AuditAction =
  | "account.registered"
  | "access.requested"
  | "access.approved"
  | "access.rejected"
  | "role.changed"
  | "account.suspended"
  | "account.reactivated"
  | "ownership.transferred"
  | "retention.cleanup"
  | "retention_text.created"
  | "retention_text.version_created"
  | "retention_text.archived"
  | "retention_text.restored"
  | "support.reported"
  | "video_lesson.saved"
  | "grammar.bundle_imported"
  | "content.created"
  | "content.updated"
  | "retention.preview"
  | "upload.deleted"
  | "ai.control.set"
  | "report.generated"
  | "report.downloaded"
  | "roster.assigned"
  | "roster.unassigned";

export async function recordAudit(input: {
  actorUserId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}, connection: Pick<typeof db, "insert"> = db): Promise<void> {
  await connection.insert(auditLog).values({
    actorUserId: input.actorUserId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata: input.metadata ?? null,
  });
}

export async function listAudit(limit = 50) {
  return db.select().from(auditLog).orderBy(desc(auditLog.createdAt)).limit(limit);
}

export async function listAuditForTarget(targetId: string, limit = 20) {
  return db
    .select()
    .from(auditLog)
    .where(eq(auditLog.targetId, targetId))
    .orderBy(desc(auditLog.createdAt))
    .limit(limit);
}
