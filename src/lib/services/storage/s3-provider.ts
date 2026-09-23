import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { ObjectHead, ObjectKey, PresignedPut, PutInput, ReadResult, StorageService } from "./types";
import { isSafeObjectKey } from "./types";

/**
 * Cloudflare R2 (and any other S3-compatible bucket: AWS S3, MinIO,
 * DigitalOcean Spaces) via the official AWS SDK. R2 implements the same
 * SigV4 signing scheme, so this one class covers both — the "S3" naming is
 * the S3 *API*, not a claim that the bucket is AWS.
 *
 * This is the production storage path. `supportsDirectUpload` is true, so the
 * browser PUTs bytes straight to the bucket through a presigned URL and the
 * app server never proxies the payload.
 *
 * NOT verified against a live bucket from this environment (no credentials and
 * no network path to Cloudflare here). It is written against the documented
 * SDK/SigV4 behaviour, but treat the first real upload as the acceptance test:
 * upload something small, confirm the object appears in the R2 dashboard,
 * confirm `GET /api/resources/<key>` actually delivers it. See README.
 *
 * Env (either naming works; R2_* wins when both are set):
 *   STORAGE_PROVIDER=r2
 *   R2_BUCKET_NAME / S3_BUCKET
 *   R2_ACCESS_KEY_ID / S3_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY / S3_SECRET_ACCESS_KEY
 *   R2_ENDPOINT / S3_ENDPOINT      https://<account-id>.r2.cloudflarestorage.com
 *   R2_REGION / S3_REGION          always "auto" for R2
 *
 * There is intentionally NO public-URL base. The bucket stays private; reads
 * are authorised by the app and answered with a short-lived signed GET URL.
 */
export class S3StorageProvider implements StorageService {
  readonly kind = "s3" as const;
  readonly supportsDirectUpload = true;

  private client: S3Client;
  private bucket: string;

  constructor() {
    const bucket = requireEnv(["R2_BUCKET_NAME", "S3_BUCKET"]);
    const accessKeyId = requireEnv(["R2_ACCESS_KEY_ID", "S3_ACCESS_KEY_ID"]);
    const secretAccessKey = requireEnv(["R2_SECRET_ACCESS_KEY", "S3_SECRET_ACCESS_KEY"]);
    const endpoint = process.env.R2_ENDPOINT || process.env.S3_ENDPOINT || undefined;
    // "auto" is correct for Cloudflare R2; a plain AWS S3 deployment can pass
    // S3_REGION=us-east-1 and it still works.
    const region = process.env.R2_REGION || process.env.S3_REGION || "auto";

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint,
      // Path-style is required by R2 and MinIO; harmless for the others.
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async put({ key, body, contentType }: PutInput): Promise<void> {
    this.assertSafeKey(key);
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType })
    );
  }

  /**
   * The preferred upload path: the browser PUTs bytes straight to this URL,
   * never through our server. Scoped to exactly one object key and one
   * content type, and it expires in minutes, not hours.
   */
  async presignPut({
    key,
    contentType,
    expiresInSeconds,
  }: {
    key: ObjectKey;
    contentType: string;
    expiresInSeconds: number;
  }): Promise<PresignedPut | null> {
    this.assertSafeKey(key);
    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: expiresInSeconds }
    );
    return { uploadUrl, key, contentType, expiresInSeconds };
  }

  async head(key: ObjectKey): Promise<ObjectHead | null> {
    this.assertSafeKey(key);
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { key, contentType: res.ContentType, size: res.ContentLength };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /**
   * Private delivery: a short-lived, single-object signed GET. The app decides
   * who is allowed to ask for it (see `GET /api/resources/[...key]`); the
   * signature only guarantees the URL stops working quickly.
   */
  async signedReadUrl(key: ObjectKey, expiresInSeconds: number): Promise<string | null> {
    this.assertSafeKey(key);
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
        expiresIn: expiresInSeconds,
      });
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  /** Fallback delivery path if a redirect is not usable for some reason. */
  async read(key: ObjectKey): Promise<ReadResult | null> {
    this.assertSafeKey(key);
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = await res.Body?.transformToByteArray();
      if (!body) return null;
      return { body: Buffer.from(body), contentType: res.ContentType ?? "application/octet-stream" };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async delete(key: ObjectKey): Promise<void> {
    this.assertSafeKey(key);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  private assertSafeKey(key: ObjectKey): void {
    if (!isSafeObjectKey(key)) throw new Error(`Refusing unsafe storage key: ${key}`);
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } } | null;
  const status = e?.$metadata?.httpStatusCode;
  return (
    e?.name === "NotFound" ||
    e?.name === "NoSuchKey" ||
    e?.Code === "NotFound" ||
    e?.Code === "NoSuchKey" ||
    status === 404
  );
}

function requireEnv(names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  throw new Error(`Missing required env var (tried ${names.join(" / ")}) for S3StorageProvider`);
}
