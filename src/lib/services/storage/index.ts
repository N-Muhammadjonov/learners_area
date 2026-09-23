import type { StorageService } from "./types";
import { LocalDiskStorageProvider } from "./local-provider";
import { S3StorageProvider } from "./s3-provider";

export * from "./types";

let cached: StorageService | null = null;

const SUPPORTED = ["local", "r2", "s3"] as const;

/**
 * Picks the storage backend from `STORAGE_PROVIDER`.
 *
 *   local  → LocalDiskStorageProvider  (dev / single-node self-hosted)
 *   r2     → S3StorageProvider pointed at Cloudflare R2   ← production
 *   s3     → S3StorageProvider pointed at any S3 bucket
 *
 * `r2` and `s3` resolve to the same class on purpose: R2 is S3-compatible and
 * speaks SigV4, so there is nothing to gain from a second implementation —
 * only from a name that says which product the deployment is actually using.
 *
 * Cloudinary used to be selectable here. It was removed: no `CLOUDINARY_*`
 * variable is read anywhere in the app, the bucket-private delivery model it
 * needs does not exist, and its browser-direct model (unsigned upload
 * presets) cannot be scoped per request the way this app authorizes uploads.
 * Setting `STORAGE_PROVIDER=cloudinary` now falls back to `local` with a
 * warning rather than silently running an unsupported provider.
 */
export function getStorageService(): StorageService {
  if (cached) return cached;

  const requested = (process.env.STORAGE_PROVIDER || "local").toLowerCase().trim();

  if (requested === "r2" || requested === "s3") {
    cached = new S3StorageProvider();
  } else {
    if (requested !== "local") {
      console.warn(
        `[storage] Unknown STORAGE_PROVIDER="${requested}". Supported values: ${SUPPORTED.join(", ")}. Falling back to local disk.`
      );
    }
    cached = new LocalDiskStorageProvider();
  }

  return cached!;
}

/** True when the configured provider can accept a direct browser PUT. */
export function supportsDirectUpload(): boolean {
  return getStorageService().supportsDirectUpload;
}

/** Test seam: drop the memoized provider so a changed env is picked up. */
export function resetStorageServiceForTests(): void {
  cached = null;
}
