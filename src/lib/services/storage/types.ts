/**
 * Storage abstraction.
 *
 * Two implementations, chosen by `STORAGE_PROVIDER`:
 *
 *  - `local`  (default) — writes to `./.data/uploads/<key>` on disk, outside the web
 *               root, so the authenticated resource route is the only reader. Genuine
 *    for development and single-node self-hosting; unusable on hosts with an
 *    ephemeral/read-only filesystem (Vercel and most serverless targets).
 *    `supportsDirectUpload` is false: the bytes have to reach this server to
 *    land on its disk, so the browser uploads through `POST /api/uploads`.
 *
 *  - `r2` / `s3` — Cloudflare R2 or any other S3-compatible bucket, driven
 *    through the AWS SDK's SigV4 signer (R2 implements SigV4). This is the
 *    production path: `supportsDirectUpload` is true, so the browser PUTs
 *    bytes straight at the bucket via a short-lived presigned URL and the
 *    application server never sees the payload.
 *
 * `Cloudinary` was removed deliberately: it is not part of this product's
 * architecture, its browser-direct model (unsigned upload presets) does not
 * fit per-request authorization, and it cannot serve private content. There
 * is no provider-selection branch for it and no `CLOUDINARY_*` env var is
 * read anywhere.
 *
 * ---------------------------------------------------------------------------
 * PRIVATE BY DEFAULT
 * ---------------------------------------------------------------------------
 * Course content is authenticated educational material, so the bucket stays
 * private. Nothing in this file exposes a public base URL. Reads go through
 * `GET /api/resources/<objectKey>`, which authenticates the caller, checks
 * they may read that specific object, and then either streams the bytes
 * (local) or redirects to a short-lived signed GET URL (r2/s3). A signed URL
 * is a *transport* detail and is never persisted as the authoritative value —
 * `objectKey` is, in the database.
 */

/** Where an object lives. Never derived from a user-supplied filename. */
export type ObjectKey = string;

export type PutInput = {
  key: ObjectKey;
  body: Buffer;
  contentType: string;
};

export type PresignedPut = {
  /** Browser PUTs the raw bytes here. One object, one content type, expires fast. */
  uploadUrl: string;
  key: ObjectKey;
  contentType: string;
  expiresInSeconds: number;
};

export type ObjectHead = {
  key: ObjectKey;
  contentType?: string;
  size?: number;
};

export type ReadResult = {
  body: Buffer;
  contentType: string;
};

export interface StorageService {
  /** Provider identity — used for logging and diagnostics only. */
  readonly kind: "local" | "s3";
  /**
   * True when a browser can upload bytes directly to this provider. False
   * means the app server must proxy the bytes (local disk).
   */
  readonly supportsDirectUpload: boolean;
  /** Server-side write — the proxy upload path, seeds and tests. */
  put(input: PutInput): Promise<void>;
  /**
   * Short-lived presigned PUT for exactly one object key. Returns null when
   * the provider cannot presign (`local`), in which case callers fall back to
   * the proxy path instead of failing.
   */
  presignPut(input: { key: ObjectKey; contentType: string; expiresInSeconds: number }): Promise<PresignedPut | null>;
  /** HEAD the object — used to verify an upload actually landed before finalizing. */
  head(key: ObjectKey): Promise<ObjectHead | null>;
  /**
   * Short-lived signed GET URL for private delivery. Returns null when the
   * caller should stream the bytes itself (`local`).
   */
  signedReadUrl(key: ObjectKey, expiresInSeconds: number): Promise<string | null>;
  /**
   * Read raw bytes. Required by providers that cannot redirect to a signed
   * URL (local disk); S3/R2 implement it too, as a fallback delivery path.
   */
  read(key: ObjectKey): Promise<ReadResult | null>;
  /**
   * The first `maxBytes` of an object (bounded: S3/R2 use a Range GET, local
   * disk reads only the prefix). Used by finalize to verify the stored bytes —
   * the server-side authority behind the browser's signature preflight.
   * Returns null when the object does not exist.
   */
  readHead(key: ObjectKey, maxBytes: number): Promise<Buffer | null>;
  delete(key: ObjectKey): Promise<void>;
}

// Re-exported so storage code and route handlers share one definition.
export { isSafeObjectKey } from "@/lib/validation/uploads";
