import { and, desc, eq } from "drizzle-orm";
import { contentImports } from "@/db/schema";
import { importGeneralReadingSet } from "@/lib/services/reading/general-import";
import type { ImportTransaction } from "../core/dry-run";
import { packageContentHash } from "../core/identity";
import { provenanceRecord } from "../core/provenance";
import { issue, type ImportErrorCode, type ImportIssue } from "../core/validation";
import { READING_CONTENT_TYPE, type ReadingCanonicalPackage } from "./canonical";

/**
 * Reading canonical import — the SAME idempotent importer Reading already used
 * (`importGeneralReadingSet`, idempotent on sourceRef), now reached through the
 * shared pipeline so it reports one shape, one provenance record and one audit
 * trail. Domain behaviour is untouched: no table, no grading rule, no renderer
 * changed.
 */

export const READING_IMPORT_VERSION = 1;

export type ReadingImportResult =
  | {
      ok: true;
      action: "created" | "unchanged";
      targetId: string;
      sourceRef: string;
      contentVersion: number;
      contentHash: string;
      publicationState: string;
      passages: { passageNo: number; passageId: string; resolved: number; unresolved: number }[];
      warnings: string[];
    }
  | { ok: false; code: ImportErrorCode; issues: ImportIssue[]; detail?: string };

export async function importCanonicalReadingSet(
  tx: ImportTransaction,
  pkg: ReadingCanonicalPackage,
  options: { actorUserId: string; publish: boolean; publishAuthorized: boolean; originalFilename?: string; dryRun?: boolean },
): Promise<ReadingImportResult> {
  const publish = options.publish && options.publishAuthorized;
  const bundle = {
    sourceRef: pkg.sourceRef,
    title: pkg.title,
    publish,
    ...(pkg.content.description !== undefined ? { description: pkg.content.description } : {}),
    ...(pkg.content.level !== undefined ? { level: pkg.content.level } : {}),
    passages: pkg.content.passages,
  };

  const outcome = await importGeneralReadingSet(tx, bundle);
  const contentHash = packageContentHash(pkg);

  if (!outcome.created) {
    const previous = await tx
      .select()
      .from(contentImports)
      .where(
        and(
          eq(contentImports.module, "reading"),
          eq(contentImports.contentType, READING_CONTENT_TYPE),
          eq(contentImports.sourceRef, pkg.sourceRef),
        ),
      )
      .orderBy(desc(contentImports.contentVersion))
      .limit(1);
    const record = previous[0];
    if (record && record.contentHash !== contentHash && !options.dryRun) {
      // Same identity, different authored text: the existing bundle is not
      // overwritten. Reading updates go through an explicit new sourceRef.
      return {
        ok: false,
        code: "source_conflict",
        issues: [
          issue(
            4,
            "source_conflict",
            "This Reading sourceRef already exists with different content. Publishing material is never overwritten silently: use a new sourceRef (for example a version suffix).",
            "sourceRef",
          ),
        ],
      };
    }
    return {
      ok: true,
      action: "unchanged",
      targetId: outcome.setId,
      sourceRef: pkg.sourceRef,
      contentVersion: record?.contentVersion ?? 1,
      contentHash,
      publicationState: publish ? "published" : "draft",
      passages: [],
      warnings: ["This sourceRef was already imported; no Reading content changed."],
    };
  }

  const now = new Date();
  const [record] = await tx
    .insert(contentImports)
    .values({
      module: "reading",
      contentType: READING_CONTENT_TYPE,
      schemaVersion: pkg.schemaVersion,
      importVersion: READING_IMPORT_VERSION,
      sourceRef: pkg.sourceRef,
      contentHash,
      contentVersion: 1,
      status: "created",
      targetType: "general_reading_set",
      targetId: outcome.setId,
      actorUserId: options.actorUserId,
      originalFilename: options.originalFilename ?? pkg.provenance.originalFilename ?? null,
      legacyRuntime: false,
      assets: [],
      provenance: provenanceRecord(pkg, options.actorUserId, now),
      result: { action: "created", passages: outcome.passages.length, publicationState: publish ? "published" : "draft" },
      createdAt: now,
    })
    .returning();

  return {
    ok: true,
    action: "created",
    targetId: outcome.setId,
    sourceRef: pkg.sourceRef,
    contentVersion: record?.contentVersion ?? 1,
    contentHash,
    publicationState: publish ? "published" : "draft",
    passages: outcome.passages,
    warnings: [],
  };
}
