import { S3Client, PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { PresignedUpload, StorageService, UploadInput, UploadResult } from "./types";

/**
 * Real S3-compatible upload via the official AWS SDK. Works with AWS S3
 * itself, or anything that speaks the S3 API — Cloudflare R2, DigitalOcean
 * Spaces, Backblaze B2, self-hosted MinIO — by setting S3_ENDPOINT.
 *
 * NOT tested against a real bucket in this environment (no credentials
 * available here) — this is written correctly to the documented API and
 * the presigned-URL scheme (AWS SigV4, which R2 also implements), but
 * treat it as "review before first real use", the same as any new
 * integration would get.
 *
 * Required env vars: S3_BUCKET, S3_REGION, S3_ACCESS_KEY_ID,
 * S3_SECRET_ACCESS_KEY. Optional: S3_ENDPOINT (for R2/Spaces/MinIO),
 * S3_PUBLIC_URL_BASE (CDN/custom domain in front of the bucket — set this
 * for R2, which has no public bucket URL of its own without one).
 */
export class S3StorageProvider implements StorageService {
  private client: S3Client;
  private bucket: string;

  constructor() {
    const region = requireEnv("S3_REGION");
    const bucket = requireEnv("S3_BUCKET");
    const accessKeyId = requireEnv("S3_ACCESS_KEY_ID");
    const secretAccessKey = requireEnv("S3_SECRET_ACCESS_KEY");
    const endpoint = process.env.S3_ENDPOINT || undefined;

    this.bucket = bucket;
    this.client = new S3Client({
      region,
      endpoint,
      forcePathStyle: Boolean(endpoint),
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  private publicUrlFor(key: string): string {
    const publicBase = process.env.S3_PUBLIC_URL_BASE;
    if (publicBase) return `${publicBase.replace(/\/$/, "")}/${key}`;
    const endpoint = process.env.S3_ENDPOINT;
    if (endpoint) return `${endpoint.replace(/\/$/, "")}/${this.bucket}/${key}`;
    const region = process.env.S3_REGION;
    return `https://${this.bucket}.s3.${region}.amazonaws.com/${key}`;
  }

  async upload({ buffer, filename, contentType, folder }: UploadInput): Promise<UploadResult> {
    const ext = path.extname(filename) || "";
    const key = `${folder}/${randomUUID()}${ext}`;

    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: contentType })
    );

    return { url: this.publicUrlFor(key), key };
  }

  /**
   * The preferred path per the direct-to-R2 architecture: the browser PUTs
   * bytes straight to this URL, never through our server. Scoped to one
   * object key, expires in 5 minutes.
   */
  async presignUpload({
    filename,
    contentType,
    folder,
  }: {
    filename: string;
    contentType: string;
    folder: string;
  }): Promise<PresignedUpload> {
    const ext = path.extname(filename) || "";
    const key = `${folder}/${randomUUID()}${ext}`;

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: 300 }
    );

    return { uploadUrl, publicUrl: this.publicUrlFor(key), key };
  }

  async delete(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} for S3StorageProvider`);
  return value;
}
