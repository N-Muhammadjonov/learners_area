import { createHash } from "node:crypto";
import type { StorageService, UploadInput, UploadResult } from "./types";

/**
 * Real Cloudinary upload via their documented signed-upload REST API
 * (https://cloudinary.com/documentation/upload_images#authenticated_requests).
 * No SDK dependency — just a signed multipart POST.
 *
 * NOT tested against a real Cloudinary account in this environment (no
 * credentials available here) — written correctly to the documented
 * signing scheme, but review before first real use.
 *
 * No presignUpload: Cloudinary's browser-direct equivalent is unsigned
 * upload presets, a different trust model (anyone with the preset name can
 * upload) that doesn't fit this app's per-request authorization — so
 * Cloudinary uploads proxy through this server like the local provider
 * does, unlike S3/R2's presigned URLs.
 *
 * Required env vars: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY,
 * CLOUDINARY_API_SECRET.
 */
export class CloudinaryStorageProvider implements StorageService {
  async upload({ buffer, filename, contentType, folder }: UploadInput): Promise<UploadResult> {
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");

    const timestamp = Math.floor(Date.now() / 1000);
    const paramsToSign: Record<string, string | number> = { folder, timestamp };
    const signature = signParams(paramsToSign, apiSecret);

    const form = new FormData();
    form.append("file", new Blob([buffer], { type: contentType }), filename);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("folder", folder);
    form.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`, {
      method: "POST",
      body: form,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloudinary upload failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { secure_url?: string; public_id?: string; resource_type?: string };
    if (!data.secure_url || !data.public_id) throw new Error("Cloudinary upload response missing secure_url/public_id");
    // Encode resource_type into the key since delete needs it back.
    return { url: data.secure_url, key: `${data.resource_type ?? "auto"}:${data.public_id}` };
  }

  async delete(key: string): Promise<void> {
    const cloudName = requireEnv("CLOUDINARY_CLOUD_NAME");
    const apiKey = requireEnv("CLOUDINARY_API_KEY");
    const apiSecret = requireEnv("CLOUDINARY_API_SECRET");
    const [resourceType, publicId] = key.split(":", 2);
    if (!publicId) throw new Error(`Malformed Cloudinary key: ${key}`);

    const timestamp = Math.floor(Date.now() / 1000);
    const signature = signParams({ public_id: publicId, timestamp }, apiSecret);

    const form = new FormData();
    form.append("public_id", publicId);
    form.append("api_key", apiKey);
    form.append("timestamp", String(timestamp));
    form.append("signature", signature);

    const res = await fetch(`https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Cloudinary delete failed (${res.status}): ${text}`);
    }
  }
}

function signParams(params: Record<string, string | number>, apiSecret: string): string {
  const sorted = Object.keys(params)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
  return createHash("sha1").update(`${sorted}${apiSecret}`).digest("hex");
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name} for CloudinaryStorageProvider`);
  return value;
}
