import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { lexicalOccurrences, retentionTexts, retentionTextVersions, users } from "@/db/schema";
import { isAdministrator } from "@/lib/auth/roles";
import { recordAudit } from "@/lib/data/audit";
import { validateAuthoredContent } from "@/lib/data/retention-bank";
import { projectId, sha, stableJson } from "@/lib/dictionary/model";
import { sentenceAt } from "@/lib/services/lexical/listening-occurrences";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const retentionWordingRevisionSchema = z.object({
  version: z.literal(1), revision: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,59}$/),
  sourceVersionId: z.string().uuid(), nextVersionId: z.string().uuid(),
  bodySha: digest, structureSha: digest, start: z.number().int().nonnegative(),
  before: z.string().min(1).max(1000), after: z.string().min(1).max(1000),
  nextBodySha: digest, reason: z.string().trim().min(12).max(1000),
}).strict();
export type RetentionWordingRevision = z.infer<typeof retentionWordingRevisionSchema>;

/** A prepared editorial revision is applied explicitly by an active administrator.
 * It creates a new immutable version. Existing attempts, results, saved words and
 * old occurrences retain their original identities. No startup migration or
 * learner endpoint calls this function.
 */
export async function reviseRetentionWording(input: unknown, actorUserId: string, executor: typeof db = db) {
  const plan = retentionWordingRevisionSchema.parse(input);
  if (plan.nextVersionId !== projectId("retention-source-revision", `${plan.revision}|${plan.sourceVersionId}`)) {
    throw Error("retention_revision_identity_changed");
  }
  return executor.transaction(async tx => {
    const actor = await tx.query.users.findFirst({ where: eq(users.id, actorUserId), columns: { role: true, accountStatus: true } });
    if (!actor || actor.accountStatus !== "active" || !isAdministrator(actor.role)) throw Error("retention_revision_forbidden");
    const original = await tx.query.retentionTextVersions.findFirst({ where: eq(retentionTextVersions.id, plan.sourceVersionId) });
    if (!original || sha(original.bodyText) !== plan.bodySha || sha(stableJson(original.scoringStructure)) !== plan.structureSha
      || original.bodyText.slice(plan.start, plan.start + plan.before.length) !== plan.before) throw Error("retention_revision_source_changed");
    // Lock order matches the normal Retention version editor: parent, then the
    // version-allocation advisory lock. Never take a learner-attempt lock.
    const [parent] = await tx.select().from(retentionTexts).where(eq(retentionTexts.id, original.retentionTextId)).for("update");
    if (!parent || !parent.active) throw Error("retention_revision_source_not_current");
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`retention.version:${parent.id}`}))`);
    const end = plan.start + plan.before.length;
    const body = original.bodyText.slice(0, plan.start) + plan.after + original.bodyText.slice(end);
    if (sha(body) !== plan.nextBodySha || body === original.bodyText) throw Error("retention_revision_body_changed");
    const content = validateAuthoredContent({ level: parent.level, bodyText: body, scoringStructure: original.scoringStructure });
    if (content.bodyText !== body) throw Error("retention_revision_body_changed");
    const existing = await tx.query.retentionTextVersions.findFirst({ where: eq(retentionTextVersions.id, plan.nextVersionId) });
    if (existing) {
      if (existing.retentionTextId !== parent.id || existing.bodyText !== body
        || sha(stableJson(existing.scoringStructure)) !== plan.structureSha) throw Error("retention_revision_identity_conflict");
      if (parent.currentVersionId !== existing.id) throw Error("retention_revision_source_not_current");
      return { created: false, originalVersionId: original.id, versionId: existing.id, versionNumber: existing.versionNumber };
    }
    if (parent.currentVersionId !== original.id) throw Error("retention_revision_source_not_current");
    const occurrences = await tx.select().from(lexicalOccurrences).where(and(
      eq(lexicalOccurrences.sourceType, "retention"), eq(lexicalOccurrences.retentionTextVersionId, original.id),
    ));
    const delta = plan.after.length - plan.before.length;
    const copied = occurrences.map(row => {
      if (original.bodyText.slice(row.startChar, row.endChar) !== row.surfaceForm) throw Error("retention_revision_occurrence_changed");
      if (row.startChar < end && row.endChar > plan.start) throw Error("retention_revision_occurrence_overlap");
      const startChar = row.startChar >= end ? row.startChar + delta : row.startChar;
      const endChar = row.endChar >= end ? row.endChar + delta : row.endChar;
      if (body.slice(startChar, endChar) !== row.surfaceForm) throw Error("retention_revision_occurrence_changed");
      return { ...row, id: projectId("retention-revision-occurrence", `${plan.nextVersionId}|${row.id}`),
        retentionTextVersionId: plan.nextVersionId, startChar, endChar, sentenceText: sentenceAt(body, startChar, endChar) };
    });
    const [latest] = await tx.select({ max: sql<number>`coalesce(max(${retentionTextVersions.versionNumber}), 0)::int` })
      .from(retentionTextVersions).where(eq(retentionTextVersions.retentionTextId, parent.id));
    const versionNumber = Number(latest!.max) + 1;
    await tx.insert(retentionTextVersions).values({ id: plan.nextVersionId, retentionTextId: parent.id, versionNumber,
      bodyText: body, wordCount: content.wordCount, scoringStructure: original.scoringStructure, createdByUserId: actorUserId });
    if (copied.length) await tx.insert(lexicalOccurrences).values(copied);
    await tx.update(retentionTexts).set({ currentVersionId: plan.nextVersionId, updatedAt: new Date() }).where(eq(retentionTexts.id, parent.id));
    await recordAudit({ actorUserId, action: "retention_text.version_created", targetType: "retention_text", targetId: parent.id,
      metadata: { revision: plan.revision, originalVersionId: original.id, versionId: plan.nextVersionId,
        version: versionNumber, wordCount: content.wordCount, revisionManifestSha: sha(stableJson(plan)), copiedOccurrences: copied.length } }, tx as unknown as typeof db);
    return { created: true, originalVersionId: original.id, versionId: plan.nextVersionId, versionNumber };
  });
}
