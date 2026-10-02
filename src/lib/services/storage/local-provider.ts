import { mkdir, open, readFile, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { ObjectHead, ObjectKey, PresignedPut, PutInput, ReadResult, StorageService } from "./types";
import { isSafeObjectKey } from "./types";

/**
 * Local-disk storage. Objects live outside the web root, under
 * `STORAGE_LOCAL_DIR` (default `.data/uploads/<key>`), and are read back by
 * `GET /api/resources/<key>` — a Route Handler that authenticates the caller
 * and streams the file fresh on every request.
 *
 * The root used to be `public/uploads/<key>`, and that was a privacy defect
 * rather than a shortcut: everything under `public/` is served by Next as a
 * static file, so `GET /uploads/<key>` returned a private recording or an
 * applicant's document to anyone who knew the key, with no session and no
 * database read. Keeping bytes out of the web root makes the authenticated
 * route the *only* delivery path, which is what the rest of this system claims.
 *
 * Why a Route Handler instead of Next's built-in static serving: `next start`
 * only recognises files that existed under `public/` when the server booted, so
 * a file uploaded while the server is already running 404s until restart. That
 * is exactly what a live upload feature does. Reading from disk per request
 * fixes it (and `next dev` never had the problem — it watches the filesystem).
 *
 * Not for serverless hosts: an ephemeral/read-only filesystem loses every
 * upload. Use `STORAGE_PROVIDER=r2` there.
 *
 * `supportsDirectUpload` is false on purpose — there is no second host for the
 * browser to talk to, the bytes have to arrive here. The client therefore uses
 * the proxy path (`POST /api/uploads`) for this provider, with the same
 * intent → finalize bookkeeping as the direct path.
 */
/**
 * Where local objects are written.
 *
 * `STORAGE_LOCAL_DIR` lets a self-hoster put them on a mounted volume. The
 * default is deliberately outside `public/` — see the class comment.
 */
export const LOCAL_UPLOAD_ROOT = process.env.STORAGE_LOCAL_DIR
  ? path.resolve(process.env.STORAGE_LOCAL_DIR)
  : path.join(process.cwd(), ".data", "uploads");

export class LocalDiskStorageProvider implements StorageService {
  readonly kind = "local" as const;
  readonly supportsDirectUpload = false;

  private resolve(key: ObjectKey): string {
    if (!isSafeObjectKey(key)) throw new Error(`Refusing unsafe storage key: ${key}`);
    return path.join(LOCAL_UPLOAD_ROOT, key);
  }

  async put({ key, body }: PutInput): Promise<void> {
    const filePath = this.resolve(key);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, body);
  }

  async presignPut(_input: { key: ObjectKey; contentType: string; expiresInSeconds: number }): Promise<PresignedPut | null> {
    // Nothing to presign against — the app server *is* the storage host. The
    // client falls back to the proxy path (POST /api/uploads) for this
    // provider, with identical intent → finalize bookkeeping.
    return null;
  }

  async head(key: ObjectKey): Promise<ObjectHead | null> {
    // resolve() sits outside the try on purpose: an unsafe key must surface as
    // a thrown error, not be swallowed by the "file is simply missing" path.
    const filePath = this.resolve(key);
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;
      return { key, size: stats.size };
    } catch {
      return null;
    }
  }

  async signedReadUrl(_key: ObjectKey, _expiresInSeconds: number): Promise<string | null> {
    // No second host to sign a URL against — the resource route streams.
    return null;
  }

  async read(key: ObjectKey): Promise<ReadResult | null> {
    const filePath = this.resolve(key);
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) return null;
      return { body: await readFile(this.resolve(key)), contentType: inferContentType(key) };
    } catch {
      return null;
    }
  }

  async readHead(key: ObjectKey, maxBytes: number): Promise<Buffer | null> {
    const filePath = this.resolve(key);
    let handle;
    try {
      handle = await open(filePath, "r");
    } catch {
      return null;
    }
    try {
      const buffer = Buffer.alloc(Math.max(0, Math.floor(maxBytes)));
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      return buffer.subarray(0, bytesRead);
    } finally {
      await handle.close();
    }
  }

  async delete(key: ObjectKey): Promise<void> {
    // Same rule as head/read: an unsafe key must throw, not be logged and
    // swallowed as if the file were merely absent.
    const filePath = this.resolve(key);
    try {
      await unlink(filePath);
    } catch (err) {
      // Only an already absent object is success. Callers must retain their
      // retryable DB reference on permission, disk or filesystem errors.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }
}

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".m4v": "video/x-m4v",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".opus": "audio/opus",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".zip": "application/zip",
  ".txt": "text/plain; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
};

/** Exported so the resource route can serve a sensible type for local files. */
export function inferContentType(key: string): string {
  return MIME_BY_EXT[path.extname(key).toLowerCase()] ?? "application/octet-stream";
}
