import { and, eq, sql } from "drizzle-orm";
import type { db } from "../src/db/client";
import { users, retentionTexts, retentionTextVersions } from "../src/db/schema";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { recordAudit } from "../src/lib/data/audit";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";
import { canonicalJson, sha256, RETENTION_V4_SOURCE_SHA256, type RetentionV4Item } from "./retention-v4-source";

export type RetentionV4Receipt = { sourceId: string; textId: string; versionId: string; internalLabel: string; action: "created" | "unchanged" };

/** One transaction: preserve all previous content, immutable versions, results and rotation state. */
export async function importRetentionV4(items: RetentionV4Item[], ownerId: string, connection: typeof db): Promise<RetentionV4Receipt[]> {
  if (items.length !== 75 || new Set(items.map(item => item.sourceId)).size !== 75) throw new Error("retention_v4_invalid_batch");
  return connection.transaction(async tx => {
    const [owner] = await tx.select({ id: users.id }).from(users)
      .where(and(eq(users.id, ownerId), eq(users.role, "owner"), eq(users.accountStatus, "active"))).for("update");
    if (!owner) throw new Error("retention_v4_active_owner_required");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('retention.owner-v4-batch'))`);
    const receipts: RetentionV4Receipt[] = [];
    for (const item of items) {
      const matching = await tx.select({ textId: retentionTexts.id, level: retentionTexts.level,
        active: retentionTexts.active, internalLabel: retentionTexts.internalLabel,
        versionId: retentionTextVersions.id, scoringStructure: retentionTextVersions.scoringStructure })
        .from(retentionTexts).innerJoin(retentionTextVersions, eq(retentionTextVersions.id, retentionTexts.currentVersionId))
        .where(eq(retentionTextVersions.bodyText, item.bodyText));
      if (matching.length > 1) throw new Error(`retention_v4_ambiguous_existing_body:${item.sourceId}`);
      const existing = matching[0];
      if (existing) {
        if (existing.level !== item.level || !existing.active ||
            sha256(canonicalJson(validateMeasurementStructure(existing.scoringStructure))) !== item.structureSha256) {
          throw new Error(`retention_v4_existing_content_conflict:${item.sourceId}`);
        }
        receipts.push({ sourceId: item.sourceId, textId: existing.textId, versionId: existing.versionId,
          internalLabel: existing.internalLabel, action: "unchanged" });
        continue;
      }
      const created = await createRetentionText({ ...item, actorUserId: ownerId }, tx as unknown as typeof db);
      await recordAudit({ actorUserId: ownerId, action: "content.import.created", targetType: "retention_text",
        targetId: created.textId, metadata: { sourceBank: "retention-distinct-v4", sourceId: item.sourceId,
          sourceSha256: RETENTION_V4_SOURCE_SHA256, bodySha256: item.bodySha256,
          structureSha256: item.structureSha256, level: item.level, label: created.internalLabel } }, tx);
      receipts.push({ sourceId: item.sourceId, textId: created.textId, versionId: created.versionId,
        internalLabel: created.internalLabel, action: "created" });
    }
    return receipts;
  });
}
