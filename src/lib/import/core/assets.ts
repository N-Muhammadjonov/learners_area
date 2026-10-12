import { and, eq, inArray } from "drizzle-orm";
import { uploadIntents } from "@/db/schema";
import { getStorageService } from "@/lib/services/storage";
import type { AssetDeclaration, AssetRole, CanonicalPackage } from "./envelope";
import { assetHash } from "./identity";
import type { ImportTransaction } from "./dry-run";

/**
 * Asset ownership and integrity (validation level 3).
 *
 * The client never sends an object key. It sends the id of an upload it already
 * finalized through `/api/uploads/{intent,finalize}`; the server re-reads that
 * intent, proves ownership, purpose, finalized state and MIME, and only then
 * links the stored object. A forged upload id from another account fails here,
 * not in the renderer.
 */

export type ResolvedAsset = {
  key: string;
  role: AssetRole;
  uploadId: string;
  objectKey: string;
  mimeType: string;
  size: number;
  originalName: string;
};

export type AssetOutcome =
  | { ok: true; assets: ResolvedAsset[]; warnings: string[] }
  | { ok: false; code: "asset_missing" | "asset_not_finalized" | "asset_not_owned" | "asset_mime_invalid" | "asset_hash_mismatch" | "duplicate_asset"; detail: string; missingKeys?: string[] };

/** Role → acceptable stored MIME. `video/webm` is an audio-only WebM recording. */
export function mimeAllowedForRole(role: AssetRole, mimeType: string): boolean {
  if (role === "audio") return mimeType.startsWith("audio/") || mimeType === "video/webm";
  if (role === "image") return mimeType.startsWith("image/");
  return mimeType.startsWith("text/") || mimeType === "application/pdf" || mimeType.startsWith("application/vnd.");
}

/** Declarations that need an upload for this package (required ones must exist). */
export function requiredAssetKeys(pkg: CanonicalPackage): AssetDeclaration[] {
  return pkg.assets.filter((asset) => asset.required);
}

const MAX_HASH_BYTES = 64 * 1024 * 1024;

function duplicateUploadIds(ids: string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * Claims every declared asset inside the caller's transaction: all intents are
 * locked together, so an interrupted import can never attach half a package.
 */
export async function claimDeclaredAssets(
  tx: ImportTransaction,
  actorUserId: string,
  pkg: CanonicalPackage,
  uploads: Record<string, string>,
): Promise<AssetOutcome> {
  const declarations = pkg.assets;
  if (!declarations.length) return { ok: true, assets: [], warnings: [] };

  const provided = declarations.filter((asset) => typeof uploads[asset.key] === "string" && uploads[asset.key]!.length > 0);
  const missing = declarations.filter((asset) => asset.required && !provided.includes(asset));
  if (missing.length)
    return {
      ok: false,
      code: "asset_missing",
      detail: `Provide the uploaded file for: ${missing.map((asset) => asset.key).join(", ")}.`,
      missingKeys: missing.map((asset) => asset.key),
    };

  const ids = provided.map((asset) => uploads[asset.key]!);
  const duplicates = duplicateUploadIds(ids);
  if (duplicates.length)
    return { ok: false, code: "duplicate_asset", detail: "The same uploaded file was assigned to two assets." };

  const intents = await tx
    .select()
    .from(uploadIntents)
    .where(inArray(uploadIntents.id, ids))
    .orderBy(uploadIntents.id)
    .for("update");

  if (intents.length !== ids.length)
    return { ok: false, code: "asset_not_finalized", detail: "One or more uploaded files could not be found." };

  const byId = new Map(intents.map((intent) => [intent.id, intent]));
  const warnings: string[] = [];
  const resolved: ResolvedAsset[] = [];

  for (const declaration of provided) {
    const intent = byId.get(uploads[declaration.key]!)!;
    if (intent.userId !== actorUserId) return { ok: false, code: "asset_not_owned", detail: `Asset "${declaration.key}" was uploaded by another account.` };
    if (intent.status !== "finalized" || intent.usedAt) return { ok: false, code: "asset_not_finalized", detail: `Asset "${declaration.key}" is not a finalized, unused upload.` };
    if (intent.purpose !== "material_primary" && intent.purpose !== "material_block")
      return { ok: false, code: "asset_not_owned", detail: `Asset "${declaration.key}" was uploaded for a different purpose.` };
    if (!mimeAllowedForRole(declaration.role, intent.mimeType) || !declaration.mimeTypes.includes(intent.mimeType))
      return {
        ok: false,
        code: "asset_mime_invalid",
        detail: `Asset "${declaration.key}" is ${intent.mimeType}; declared types are ${declaration.mimeTypes.join(", ")}.`,
      };
    if (intent.size > declaration.maxBytes)
      return { ok: false, code: "asset_mime_invalid", detail: `Asset "${declaration.key}" exceeds ${declaration.maxBytes} bytes.` };

    if (declaration.sha256) {
      if (intent.size <= MAX_HASH_BYTES) {
        const stored = await getStorageService().read(intent.objectKey).catch(() => null);
        if (stored && assetHash(new Uint8Array(stored.body)) !== declaration.sha256)
          return { ok: false, code: "asset_hash_mismatch", detail: `Asset "${declaration.key}" does not match the declared sha256.` };
        if (!stored) warnings.push(`Asset "${declaration.key}": sha256 could not be verified against storage.`);
      } else {
        warnings.push(`Asset "${declaration.key}": sha256 not verified (file above the verification ceiling).`);
      }
    }

    resolved.push({
      key: declaration.key,
      role: declaration.role,
      uploadId: intent.id,
      objectKey: intent.objectKey,
      mimeType: intent.mimeType,
      size: intent.size,
      originalName: intent.originalName,
    });
  }

  resolved.sort((a, b) => a.key.localeCompare(b.key));
  return { ok: true, assets: resolved, warnings };
}

/** Marks claimed uploads as attached; called by the importer inside the same transaction. */
export async function attachClaimedAssets(tx: ImportTransaction, assets: ResolvedAsset[]): Promise<void> {
  if (!assets.length) return;
  await tx
    .update(uploadIntents)
    .set({ status: "attached", usedAt: new Date() })
    .where(and(inArray(uploadIntents.id, assets.map((asset) => asset.uploadId)), eq(uploadIntents.status, "finalized")));
}
