import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { StorageService, UploadInput, UploadResult } from "./types";

/**
 * Writes into public/uploads/<folder>/ on disk and hands back a URL served
 * by /api/files/[...path] (a small Route Handler that reads the file fresh
 * on every request — see that route for why this doesn't just use Next's
 * built-in /public static serving).
 *
 * This genuinely works for local dev and for a self-hosted Node server with
 * persistent disk (`next start` on a normal VM/container).
 *
 * It does NOT work on serverless hosts with an ephemeral/read-only
 * filesystem (Vercel's default deploy target, for one) — that's exactly
 * the case real object storage (S3Provider/CloudinaryProvider below) is
 * for. Pick local for cheap self-hosted deployments, S3/Cloudinary for
 * serverless ones. It also has no presignUpload — files are proxied
 * through this server, which is fine for local disk (no separate host to
 * upload directly to).
 */
export class LocalDiskStorageProvider implements StorageService {
  async upload({ buffer, filename, folder }: UploadInput): Promise<UploadResult> {
    const ext = path.extname(filename) || "";
    const key = `${folder}/${randomUUID()}${ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", folder);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(process.cwd(), "public", "uploads", key), buffer);

    const base = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    return { url: `${base}/api/files/${key}`, key };
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(path.join(process.cwd(), "public", "uploads", key));
    } catch (err) {
      // Already gone is fine; anything else is worth knowing about but
      // shouldn't block the caller (e.g. deleting a DB row) from finishing.
      console.warn(`LocalDiskStorageProvider.delete: could not remove ${key}:`, err);
    }
  }
}
