import "server-only";
import { desc, and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { contentImports, generalReadingSets, listeningPackages } from "@/db/schema";
import { generalReadingSchemaReady } from "@/lib/data/general-reading";
import { recordAudit } from "@/lib/data/audit";
import type { Role } from "@/lib/auth/roles";
import { claimDeclaredAssets, type ResolvedAsset } from "./assets";
import { runWithDryRun, type ImportTransaction } from "./dry-run";
import { packageContentHash } from "./identity";
import { parseContentPackage } from "./parse";
import { contentImportSchemaReady } from "./readiness";
import { mayImportModule, mayPublishImportedContent } from "./permissions";
import { describeProvenance } from "./provenance";
import { resolveModuleImporter } from "./server-registry";
import type { ImportRunOutcome, ImportRunSuccess } from "./types";
import { issue, type ImportErrorCode, type ImportIssue, type ValidationReport } from "./validation";
import type { CanonicalPackage } from "./envelope";

/**
 * The canonical import pipeline.
 *
 *   parse (pure)          structure + semantics + asset declarations
 *   authorize             role, per module, server-side
 *   assets (level 3)      ownership, finalized state, MIME, size, hash
 *   transaction           claim → write domain rows → provenance/audit
 *   result                action, version, hash, publication state, preview
 *
 * A dry run executes every one of those steps inside a transaction that is
 * always rolled back: same queries, same constraints, same failures — and no
 * canonical data can be mutated or published by it.
 */

export type ContentImportRequest = {
  actor: { id: string; role: Role };
  /** The parsed JSON body's package (envelope or a still-supported older version). */
  raw: unknown;
  /** Package asset key → finalized upload id. */
  assetUploads: Record<string, string>;
  dryRun: boolean;
  /** Explicit publish action; the server still decides whether the role allows it. */
  publish: boolean;
  originalFilename?: string;
  acknowledgeGradeImpact?: boolean;
  moduleEndpoints?: { listening?: boolean };
};

export type ContentImportFailure = {
  ok: false;
  code: ImportErrorCode;
  report: ValidationReport;
  detail?: string;
  missingAssetKeys?: string[];
};

export type ContentImportSuccess = {
  ok: true;
  dryRun: boolean;
  module: string;
  contentType: string;
  schemaVersion: number;
  title: string;
  sourceRef: string;
  migratedFrom?: number;
  contentHash: string;
  action: ImportRunSuccess["action"];
  targetType: string;
  targetId: string;
  contentVersion: number;
  publicationState: string;
  legacyRuntime: boolean;
  summary: Record<string, unknown>;
  warnings: string[];
  provenance: { source: string; description: string; importedBy: string };
  assets: { key: string; role: string; mimeType: string; size: number }[];
  preview: { title: string; lines: { label: string; value: string }[]; warnings: string[] } | null;
};

export type ContentImportOutcome = ContentImportSuccess | ContentImportFailure;

function blocked(code: ImportErrorCode, message: string, path?: string, detail?: string): ContentImportFailure {
  const entry = issue(4, code, message, path);
  return { ok: false, code, report: { ok: false, issues: [entry], warnings: [] }, ...(detail ? { detail } : {}) };
}

/** Rejected imports are recorded OUTSIDE the rolled-back transaction. */
async function recordRejection(
  request: ContentImportRequest,
  parsedModule: string,
  contentType: string,
  sourceRef: string,
  code: ImportErrorCode,
) {
  await recordAudit({
    actorUserId: request.actor.id,
    action: "content.import.rejected",
    targetType: `${parsedModule}:${contentType}`,
    metadata: { sourceRef, code, legacyRuntime: false },
  }).catch(() => undefined);
  await db
    .insert(contentImports)
    .values({
      module: parsedModule.slice(0, 20),
      contentType: contentType.slice(0, 40),
      schemaVersion: 0,
      sourceRef: (sourceRef || "unknown").slice(0, 80),
      contentHash: "0".repeat(64),
      status: "rejected",
      targetType: `${parsedModule}:${contentType}`,
      actorUserId: request.actor.id,
      originalFilename: request.originalFilename ?? null,
      note: code,
      result: { code, dryRun: request.dryRun },
    })
    .catch(() => undefined);
}

export async function runContentImport(request: ContentImportRequest): Promise<ContentImportOutcome> {
  const parsed = parseContentPackage(request.raw);
  if (!parsed.ok) {
    await recordRejection(request, moduleOf(request.raw), contentTypeOf(request.raw), sourceRefOf(request.raw), parsed.code);
    return { ok: false, code: parsed.code, report: parsed.report, detail: parsed.report.issues[0]?.message };
  }

  const { pkg, descriptor, migratedFrom, warnings: parseWarnings } = parsed;
  const moduleName = pkg.module;
  const contentType = pkg.contentType;

  if (!mayImportModule(request.actor.role, moduleName))
    return blocked("forbidden", `Your role cannot import ${moduleName} content.`, "module");

  if (!(await contentImportSchemaReady()))
    return {
      ok: false,
      code: "schema_not_ready",
      report: {
        ok: false,
        issues: [issue(4, "schema_not_ready", "Canonical import is unavailable until migration 0040 is applied.")],
        warnings: [],
      },
      detail: "qa_migration_0040_required",
    };

  const importer = resolveModuleImporter(moduleName, contentType);
  if (!importer)
    return blocked(
      "unknown_content_type",
      `The ${moduleName}:${contentType} importer is documented but not enabled yet.`,
      "contentType",
    );

  const publishAuthorized = mayPublishImportedContent(request.actor.role);
  const requestedState = pkg.publication.state;
  const wantsPublish = request.publish || requestedState === "published" || requestedState === "scheduled";
  const publish = wantsPublish && publishAuthorized;
  if (wantsPublish && !publishAuthorized)
    // Not fatal: the import is honoured as a draft, and the refusal is recorded.
    parseWarnings.push(issue(4, "forbidden", "Publication requires an administrator; the import is saved as a draft.", "publication", false));

  let assets: ResolvedAsset[] = [];
  if (pkg.assets.length) {
    const claim = await runWithDryRun(db, true, async (tx) => claimDeclaredAssets(tx, request.actor.id, pkg, request.assetUploads));
    if (!claim.ok) {
      if (claim.code === "asset_missing")
        return {
          ok: false,
          code: claim.code,
          report: { ok: false, issues: [issue(3, claim.code, claim.detail, "assets")], warnings: [] },
          detail: claim.detail,
          missingAssetKeys: claim.missingKeys ?? [],
        };
      return {
        ok: false,
        code: claim.code,
        report: { ok: false, issues: [issue(3, claim.code, claim.detail, "assets")], warnings: [] },
        detail: claim.detail,
      };
    }
    assets = claim.assets;
  }

  const preview = descriptor.preview?.(pkg) ?? {
    title: pkg.title,
    lines: [{ label: "Source identity", value: pkg.sourceRef }],
    warnings: [],
  };

  for (const warning of preview.warnings) parseWarnings.push(issue(2, "semantic_invalid", warning, "content", false));

  const outcome = await runWithDryRun(db, request.dryRun, async (tx) => {
    const result = await importer.run(tx, pkg, {
      actorUserId: request.actor.id,
      assets,
      publish,
      publishAuthorized,
      ...(request.originalFilename ? { originalFilename: request.originalFilename } : {}),
      ...(request.acknowledgeGradeImpact ? { acknowledgeGradeImpact: true } : {}),
      ...(migratedFrom !== undefined ? { legacyRuntime: false } : {}),
      dryRun: request.dryRun,
    });
    if (result.ok && !request.dryRun) {
      await recordAudit(
        {
          actorUserId: request.actor.id,
          action: result.action === "created" ? "content.import.created" : "content.import.updated",
          targetType: result.targetType,
          targetId: result.targetId,
          metadata: {
            module: moduleName,
            contentType,
            schemaVersion: pkg.schemaVersion,
            sourceRef: pkg.sourceRef,
            contentHash: result.contentHash,
            contentVersion: result.contentVersion,
            legacyRuntime: result.legacyRuntime,
            publicationState: result.publicationState,
            ...(result.action === "updated" && request.acknowledgeGradeImpact ? { acknowledgedGradeImpact: true } : {}),
          },
        },
        tx,
      );
    }
    return result;
  });

  if (!outcome.ok) {
    await recordRejection(request, moduleName, contentType, pkg.sourceRef, outcome.code);
    return {
      ok: false,
      code: outcome.code,
      report: { ok: false, issues: outcome.issues, warnings: [] },
      ...(outcome.detail ? { detail: outcome.detail } : {}),
    };
  }

  // A dry run reports real validation without claiming anything: the assets are
  // released by the rollback, and nothing is published.
  return {
    ok: true,
    dryRun: request.dryRun,
    module: moduleName,
    contentType,
    schemaVersion: pkg.schemaVersion,
    title: pkg.title,
    sourceRef: pkg.sourceRef,
    ...(migratedFrom !== undefined ? { migratedFrom } : {}),
    contentHash: outcome.contentHash || packageContentHash(pkg),
    action: request.dryRun ? "unchanged" : outcome.action,
    targetType: outcome.targetType,
    targetId: outcome.targetId,
    contentVersion: request.dryRun ? 0 : outcome.contentVersion,
    publicationState: request.dryRun ? "draft" : outcome.publicationState,
    legacyRuntime: outcome.legacyRuntime,
    summary: outcome.summary,
    warnings: [...parseWarnings.filter((entry) => !entry.blocking).map((entry) => entry.message), ...outcome.warnings],
    provenance: {
      source: pkg.provenance.source,
      description: describeProvenance(pkg),
      importedBy: request.actor.id,
    },
    assets: assets.map((asset) => ({ key: asset.key, role: asset.role, mimeType: asset.mimeType, size: asset.size })),
    preview,
  };
}

/** Best-effort reading of identity from an unparseable body, for the audit trail only. */
function moduleOf(raw: unknown): string {
  return typeof raw === "object" && raw && typeof (raw as { module?: unknown }).module === "string"
    ? (raw as { module: string }).module.slice(0, 20)
    : "unknown";
}
function contentTypeOf(raw: unknown): string {
  return typeof raw === "object" && raw && typeof (raw as { contentType?: unknown }).contentType === "string"
    ? (raw as { contentType: string }).contentType.slice(0, 40)
    : "unknown";
}
function sourceRefOf(raw: unknown): string {
  if (typeof raw !== "object" || !raw) return "unknown";
  const body = raw as { sourceRef?: unknown; testId?: unknown };
  if (typeof body.sourceRef === "string") return body.sourceRef.slice(0, 80);
  if (typeof body.testId === "string") return body.testId.slice(0, 80);
  return "unknown";
}

/**
 * Read-only source status for the validation step (§12/§13): does this identity
 * already exist, and if so is the incoming payload the same or a change? No
 * writes, no claims — this is what the operator sees BEFORE uploading a recording.
 */
export type SourceStatus = { status: "new" | "identical" | "changed"; detail?: string };

export async function peekSourceStatus(
  moduleName: string,
  contentType: string,
  sourceRef: string,
  incomingHash: string,
): Promise<SourceStatus> {
  const previous = await latestImportFor(moduleName, contentType, sourceRef);
  const domainExists = await domainSourceExists(moduleName, contentType, sourceRef);
  if (!previous) return domainExists ? { status: "changed", detail: "existing_material_without_import_record" } : { status: "new" };
  if (previous.contentHash === incomingHash) return { status: "identical", detail: `v${previous.contentVersion}` };
  return { status: "changed", detail: `v${previous.contentVersion}` };
}

/** Domain-level existence, so pre-framework material is not reported as brand new. */
async function domainSourceExists(moduleName: string, contentType: string, sourceRef: string): Promise<boolean> {
  if (moduleName === "listening" && contentType === "full_test") {
    const row = await db.query.listeningPackages.findFirst({ where: eq(listeningPackages.sourceId, sourceRef) });
    return Boolean(row);
  }
  if (moduleName === "reading" && contentType === "general_set") {
    if (!(await generalReadingSchemaReady())) return false;
    const row = await db.query.generalReadingSets.findFirst({ where: eq(generalReadingSets.sourceRef, sourceRef) });
    return Boolean(row);
  }
  return false;
}

/** Most recent accepted import for one source identity (used by admin history). */
export async function latestImportFor(moduleName: string, contentType: string, sourceRef: string) {
  const rows = await db
    .select()
    .from(contentImports)
    .where(
      and(
        eq(contentImports.module, moduleName),
        eq(contentImports.contentType, contentType),
        eq(contentImports.sourceRef, sourceRef),
      ),
    )
    .orderBy(desc(contentImports.contentVersion))
    .limit(1);
  return rows[0] ?? null;
}

export type { ImportRunOutcome };
