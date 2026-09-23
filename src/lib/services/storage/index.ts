import type { StorageService } from "./types";
import { LocalDiskStorageProvider } from "./local-provider";
import { S3StorageProvider } from "./s3-provider";
import { CloudinaryStorageProvider } from "./cloudinary-provider";

export * from "./types";

let cached: StorageService | null = null;

export function getStorageService(): StorageService {
  if (cached) return cached;

  const provider = (process.env.STORAGE_PROVIDER || "local").toLowerCase();

  if (provider === "s3") {
    cached = new S3StorageProvider();
  } else if (provider === "cloudinary") {
    cached = new CloudinaryStorageProvider();
  } else {
    cached = new LocalDiskStorageProvider();
  }

  return cached;
}
