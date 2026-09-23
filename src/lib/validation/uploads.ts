/**
 * Upload policy — PURE, no Node built-ins, safe to import from client code.
 *
 * This is the single source of truth for "what may be uploaded and how big".
 * The client uses it for instant pre-flight feedback; every server route uses
 * the same functions as the authoritative check, so the two can never drift and
 * no magic size constant is scattered across components.
 *
 * Server-only helpers that need `node:crypto` / `node:path` (object-key
 * generation) live in `src/lib/uploads/keys.ts` instead — importing them here
 * would pull Node built-ins into the browser bundle and break the build.
 */

export type UploadCategory = "primary" | "image" | "audio" | "file";

/** Object-key segment per block type. `primary` is a resource's main file. */
export const KEY_KIND: Record<UploadCategory, string> = {
  primary: "primary",
  image: "images",
  audio: "audio",
  file: "files",
};

export type UploadRules = {
  /** Ceiling in bytes. */
  maxBytes: number;
  /** MIME prefixes always accepted for this category. */
  mimePrefixes: string[];
  /** Exact MIME types accepted for this category. */
  mimeTypes: string[];
  /** Extensions accepted for this category. */
  extensions: string[];
};

const DOC_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/zip",
  "text/plain",
  "text/csv",
];

const DOC_EXTENSIONS = [".pdf", ".doc", ".docx", ".ppt", ".pptx", ".xls", ".xlsx", ".zip", ".txt", ".csv"];

const MEDIA_MIME_PREFIXES = ["video/", "audio/", "image/"];

const MEDIA_EXTENSIONS = [
  ".mp4",
  ".webm",
  ".mov",
  ".m4v",
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".opus",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
];

function mb(value: number): number {
  return Math.round(value * 1024 * 1024);
}

/**
 * Ceilings. Env overrides exist so ops can tighten them per deployment without
 * touching code; the defaults are the product's actual policy. Note this module
 * is imported by the browser too, so only `NEXT_PUBLIC_*`-safe values may be
 * read here — and these are ceilings, not secrets, so reading them is fine.
 */
function envMb(name: string, fallbackMb: number): number {
  const raw = typeof process !== "undefined" ? process.env?.[name] : undefined;
  if (raw === undefined || raw === "") return mb(fallbackMb);
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? mb(parsed) : mb(fallbackMb);
}

export const UPLOAD_RULES: Record<UploadCategory, UploadRules> = {
  primary: {
    maxBytes: envMb("MAX_UPLOAD_MB", 500),
    mimePrefixes: MEDIA_MIME_PREFIXES,
    mimeTypes: DOC_MIME_TYPES,
    extensions: [...MEDIA_EXTENSIONS, ...DOC_EXTENSIONS],
  },
  image: {
    maxBytes: envMb("MAX_IMAGE_UPLOAD_MB", 10),
    mimePrefixes: ["image/"],
    mimeTypes: [],
    extensions: [".png", ".jpg", ".jpeg", ".webp", ".gif"],
  },
  audio: {
    maxBytes: envMb("MAX_AUDIO_UPLOAD_MB", 50),
    mimePrefixes: ["audio/"],
    mimeTypes: [],
    extensions: [".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".webm"],
  },
  file: {
    maxBytes: envMb("MAX_FILE_UPLOAD_MB", 50),
    mimePrefixes: [],
    mimeTypes: DOC_MIME_TYPES,
    extensions: DOC_EXTENSIONS,
  },
};

export type UploadErrorCode =
  | "unsupported_type"
  | "file_too_large"
  | "missing_file"
  | "size_mismatch"
  | "type_mismatch";

export type UploadValidation =
  | { ok: true; category: UploadCategory; extension: string }
  | { ok: false; error: UploadErrorCode };

/**
 * Authoritative check. A browser-reported MIME type is a hint, never proof —
 * several browsers send `application/octet-stream` or an empty string for
 * perfectly ordinary files — so an allow-listed extension is accepted even when
 * the MIME is unhelpful. What is never accepted is an unknown extension.
 */
export function validateUploadFile(input: {
  filename: string;
  contentType: string;
  size: number;
  category: UploadCategory;
}): UploadValidation {
  const { filename, contentType, size, category } = input;
  if (!filename) return { ok: false, error: "missing_file" };

  const rules = UPLOAD_RULES[category];
  const ext = extensionOf(filename);
  const normalizedMime = (contentType || "").split(";")[0]!.trim().toLowerCase();

  const mimeAllowed =
    rules.mimePrefixes.some((p) => normalizedMime.startsWith(p)) || rules.mimeTypes.includes(normalizedMime);
  const extAllowed = rules.extensions.includes(ext);
  const genericMime = normalizedMime === "" || normalizedMime === "application/octet-stream";

  if (!extAllowed && !mimeAllowed) return { ok: false, error: "unsupported_type" };
  // Recognised MIME but a mismatched extension (a .exe served as audio/mpeg)
  // is rejected rather than guessed at.
  if (!extAllowed && !genericMime) return { ok: false, error: "unsupported_type" };
  if (!Number.isFinite(size) || size <= 0) return { ok: false, error: "missing_file" };
  if (size > rules.maxBytes) return { ok: false, error: "file_too_large" };

  return { ok: true, category, extension: ext };
}

/** Lower-cased extension including the dot, e.g. ".pdf". */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  if (dot <= 0 || dot === filename.length - 1) return "";
  return filename.slice(dot).toLowerCase();
}

/** Human-readable ceiling, e.g. "10 MB" — for client-side copy. */
export function maxBytesLabel(category: UploadCategory): string {
  const bytes = UPLOAD_RULES[category].maxBytes;
  return bytes >= 1024 * 1024 ? `${Math.round(bytes / (1024 * 1024))} MB` : `${Math.round(bytes / 1024)} KB`;
}

/**
 * `accept` attribute for a native file picker, so the OS dialog pre-filters.
 * Extensions are listed too, because several browsers (Safari notably) filter
 * poorly on MIME alone.
 */
export function acceptAttribute(category: UploadCategory): string {
  const rules = UPLOAD_RULES[category];
  return [...rules.mimePrefixes, ...rules.mimeTypes, ...rules.extensions].join(",");
}

/**
 * Object keys are generated server-side from a UUID, so this is a
 * defence-in-depth check rather than the primary control: it rejects anything
 * that could escape the storage root or reach outside the caller's own
 * namespace before it ever touches the filesystem or the bucket.
 */
const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

export function isSafeObjectKey(key: string): boolean {
  if (!key || key.length > 400) return false;
  if (!SAFE_KEY.test(key)) return false;
  if (key.includes("..")) return false;
  const segments = key.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return false;
  return true;
}

/**
 * Stable, non-expiring public path for an object. This is what goes in the
 * database — never a signed URL, which expires and must not become the
 * authoritative reference. The route behind it does the authorization.
 */
export function resourceHref(objectKey: string): string {
  return `/api/resources/${objectKey}`;
}
