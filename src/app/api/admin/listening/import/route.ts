import { listeningSchemaReady } from "@/lib/data/listening-schema-ready";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveUser } from "@/lib/auth/current-user";
import { mayImportListening } from "@/lib/listening/permissions";
import { listeningPackageSchema, publicationIssues } from "@/lib/listening/package";
import { contentImportSchemaReady } from "@/lib/import/core/readiness";
import { registerImportFramework, runContentImport } from "@/lib/import/server";
import type { ImportErrorCode } from "@/lib/import/core/validation";
import { importLegacyListeningRuntime } from "@/lib/import/listening";
import { claimDeclaredAssets } from "@/lib/import/core/assets";
import { runWithDryRun } from "@/lib/import/core/dry-run";
import { db } from "@/db/client";

/**
 * POST /api/admin/listening/import
 *
 * Listening is CANONICAL-FIRST. Two accepted shapes:
 *
 *  1. Canonical (preferred) — the same body `/api/admin/content/import` accepts:
 *     { package, assetUploads, dryRun?, publish?, acknowledgeGradeImpact? }
 *     A version 1 Listening payload (the shape existing packages already carry)
 *     is upgraded by the importer, so nothing already authored stops working.
 *
 *  2. Legacy one-shot — { payload, audioUploadId, imageUploadId }, the body the
 *     ZIP/HTML discovery UI has always sent. When `payload.authoredRuntime` is
 *     present the material genuinely needs the sandboxed authored frame, so it
 *     is imported through the explicit legacy path and recorded as
 *     `legacyRuntime: true` with its own import record.
 *
 * A canonical package never creates `authoredRuntime`.
 */

const legacyInput = z.object({
  payload: listeningPackageSchema,
  audioUploadId: z.string().uuid(),
  imageUploadId: z.string().uuid().nullable(),
});

const canonicalInput = z.object({
  package: z.unknown(),
  assetUploads: z.record(z.string().max(64)).default({}),
  dryRun: z.boolean().default(false),
  publish: z.boolean().default(false),
  acknowledgeGradeImpact: z.boolean().default(false),
  originalFilename: z.string().max(255).optional(),
});

export async function POST(req: NextRequest) {
  registerImportFramework();
  try {
    return await handle(req);
  } catch (error) {
    const correlationId = crypto.randomUUID().slice(0, 8);
    console.error("[listening-import] failed", { correlationId, error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "unknown", correlationId }, { status: 500 });
  }
}

async function handle(req: NextRequest) {
  const user = await requireActiveUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  if (!mayImportListening(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!(await listeningSchemaReady())) return NextResponse.json({ error: "qa_migration_0028_required" }, { status: 503 });
  if (!(await contentImportSchemaReady()))
    return NextResponse.json({ error: "unknown", detail: "qa_migration_0040_required" }, { status: 503 });

  const body = await req.json().catch(() => null);
  const canonical = canonicalInput.safeParse(body);
  const legacy = legacyInput.safeParse(body);

  if (canonical.success && body?.package !== undefined) return canonicalImport(user, canonical.data);
  if (legacy.success) return legacyOneShot(user, legacy.data);

  const parsed = legacy.success ? legacy : canonical;
  return NextResponse.json(
    { error: "invalid_package", detail: parsed.error?.issues[0]?.message?.slice(0, 200) },
    { status: 400 },
  );
}

/**
 * Canonical failures are reported in the vocabulary this endpoint has always
 * used (the dictionary has readable en/uz text for every one of these codes),
 * with the precise canonical issues attached as `issues` for staff diagnostics.
 */
function listeningProblem(code: ImportErrorCode, detail?: string, issues?: unknown[]) {
  const body = { detail, issues };
  switch (code) {
    case "unauthenticated":
      return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
    case "forbidden":
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    case "schema_not_ready":
      return NextResponse.json({ error: "qa_migration_0040_required", ...body }, { status: 503 });
    case "asset_missing":
      return NextResponse.json({ error: "asset_missing", ...body }, { status: 400 });
    case "asset_hash_mismatch":
      return NextResponse.json({ error: "asset_hash_mismatch", ...body }, { status: 400 });
    case "asset_not_owned":
    case "asset_not_finalized":
      return NextResponse.json({ error: "upload_not_owned_or_finalized", ...body }, { status: 409 });
    case "asset_mime_invalid":
      return NextResponse.json({ error: "invalid_media_type", ...body }, { status: 400 });
    case "duplicate_asset":
      return NextResponse.json({ error: "duplicate_asset", ...body }, { status: 400 });
    case "source_already_imported":
      return NextResponse.json({ error: "source_already_imported", ...body }, { status: 409 });
    case "source_conflict":
      return NextResponse.json({ error: "source_conflict", ...body }, { status: 409 });
    case "payload_too_large":
      return NextResponse.json({ error: "invalid_package", ...body }, { status: 413 });
    case "unknown":
      return NextResponse.json({ error: "unknown", ...body }, { status: 500 });
    default:
      return NextResponse.json({ error: "invalid_package", ...body }, { status: 400 });
  }
}

async function canonicalImport(user: { id: string; role: Parameters<typeof mayImportListening>[0] }, body: z.infer<typeof canonicalInput>) {
  const outcome = await runContentImport({
    actor: { id: user.id, role: user.role },
    raw: body.package,
    assetUploads: Object.fromEntries(Object.entries(body.assetUploads).map(([key, value]) => [key, String(value)])),
    dryRun: body.dryRun,
    publish: body.publish,
    acknowledgeGradeImpact: body.acknowledgeGradeImpact,
    ...(body.originalFilename ? { originalFilename: body.originalFilename } : {}),
  });
  if (!outcome.ok) return listeningProblem(outcome.code, outcome.detail, outcome.report.issues);
  return NextResponse.json(outcome, { status: 200 });
}

/** The ZIP/HTML discovery UI keeps working: one call uploads and stores. */
async function legacyOneShot(
  user: { id: string; role: Parameters<typeof mayImportListening>[0] },
  body: z.infer<typeof legacyInput>,
) {
  const { payload, audioUploadId, imageUploadId } = body;
  if (!!payload.imagePath !== !!imageUploadId) return NextResponse.json({ error: "missing_map" }, { status: 400 });
  const ids = [audioUploadId, ...(imageUploadId ? [imageUploadId] : [])];
  if (new Set(ids).size !== ids.length) return NextResponse.json({ error: "duplicate_asset" }, { status: 400 });

  if (!payload.authoredRuntime) {
    // Canonical data through the shared pipeline (no authored runtime is created).
    const assetUploads = { "audio.full": audioUploadId, ...(imageUploadId ? { "image.map": imageUploadId } : {}) };
    const outcome = await runContentImport({
      actor: { id: user.id, role: user.role },
      raw: payload,
      assetUploads,
      dryRun: false,
      publish: true,
    });
    if (!outcome.ok) return listeningProblem(outcome.code, outcome.detail, outcome.report.issues);
    return NextResponse.json(
      { id: outcome.targetId, dryRun: false, action: outcome.action, publicationIssues: [], warnings: outcome.warnings },
      { status: outcome.action === "created" ? 201 : 200 },
    );
  }

  const claimed = await runWithDryRun(db, true, (tx) =>
    claimDeclaredAssets(tx, user.id, {
      schemaVersion: 1,
      module: "listening",
      contentType: "legacy_runtime",
      sourceRef: payload.testId,
      title: payload.title,
      language: "en",
      provenance: { source: "legacy_conversion" },
      publication: { state: "published" },
      assets: [
        { key: "audio.full", role: "audio", required: true, mimeTypes: ["audio/mpeg", "audio/mp4", "audio/aac", "audio/ogg", "audio/wav", "audio/x-wav", "audio/webm", "video/webm", "audio/flac"], maxBytes: 200 * 1024 * 1024 },
        ...(payload.imagePath
          ? [{ key: "image.map", role: "image" as const, required: true, mimeTypes: ["image/png", "image/jpeg", "image/webp"], maxBytes: 20 * 1024 * 1024 }]
          : []),
      ],
      content: null,
    }, { "audio.full": audioUploadId, ...(imageUploadId ? { "image.map": imageUploadId } : {}) }),
  );
  if (!claimed.ok)
    return claimed.code === "duplicate_asset"
      ? NextResponse.json({ error: "duplicate_asset", detail: claimed.detail }, { status: 400 })
      : NextResponse.json({ error: "upload_not_owned_or_finalized", detail: claimed.detail }, { status: 409 });

  const outcome = await runWithDryRun(db, false, (tx) =>
    importLegacyListeningRuntime(tx, payload, {
      actorUserId: user.id,
      assets: claimed.assets,
      publish: true,
      publishAuthorized: mayImportListening(user.role),
    }),
  );
  if (!outcome.ok) return listeningProblem(outcome.code, outcome.report.issues[0]?.message, outcome.report.issues);
  return NextResponse.json(
    {
      id: outcome.targetId,
      action: outcome.action,
      legacyRuntime: true,
      publicationIssues: publicationIssues(payload),
      warnings: outcome.warnings,
    },
    { status: 201 },
  );
}
