/**
 * Upload error contract — PURE, safe for client and server.
 *
 * Server routes answer failures with
 *   { error: code, code, message, field?, retryable, correlationId? }
 * (`error` is kept for existing callers). The browser never shows `code`; it
 * maps it through the dictionary with `uploadErrorMessage`. A response that
 * is not JSON at all (an HTML 500 page, a proxy 413/504) is classified from
 * its HTTP status — that is exactly the case that used to surface as the raw
 * string "intent_failed".
 */

export const UPLOAD_ERROR_CODES = [
  "unauthenticated",
  "forbidden",
  "unsupported_type",
  "dangerous_type",
  "file_too_large",
  "missing_file",
  "type_mismatch",
  "size_mismatch",
  "rate_limited",
  "storage_not_configured",
  "storage_unavailable",
  "database_unavailable",
  "server_error",
  "network_error",
  "upload_timeout",
  "cancelled",
  "storage_rejected",
  "intent_expired",
  "already_finalized",
  "not_found",
  "unknown",
] as const;

export type UploadErrorCodeAll = (typeof UPLOAD_ERROR_CODES)[number];

export type UploadFailure = {
  code: UploadErrorCodeAll;
  /** The server's technical code, kept for logs/diagnostics only. */
  technical?: string;
  retryable: boolean;
  correlationId?: string;
  /** Size ceiling label for file_too_large. */
  max?: string;
};

const RETRYABLE: ReadonlySet<UploadErrorCodeAll> = new Set([
  "rate_limited",
  "storage_unavailable",
  "database_unavailable",
  "server_error",
  "network_error",
  "upload_timeout",
  "storage_rejected",
  "intent_expired",
  "size_mismatch",
  "unknown",
]);

/** Technical server codes (existing routes) → user-facing families. */
const ALIASES: Record<string, UploadErrorCodeAll> = {
  invalid_input: "unknown",
  invalid_purpose: "forbidden",
  invalid_size: "missing_file",
  invalid_block_kind: "unsupported_type",
  missing_block_kind: "unsupported_type",
  missing_attempt_id: "not_found",
  attempt_not_found: "not_found",
  attempt_already_submitted: "already_finalized",
  material_not_found: "not_found",
  invalid_upload_id: "not_found",
  upload_not_found: "not_found",
  expired: "intent_expired",
  object_missing: "size_mismatch",
  upload_expired: "intent_expired",
  upload_not_active: "intent_expired",
  upload_not_found_in_storage: "size_mismatch",
  upload_type_mismatch: "type_mismatch",
  upload_size_mismatch: "size_mismatch",
  upload_not_owned_or_finalized: "not_found",
  rate_limit: "rate_limited",
  too_many_requests: "rate_limited",
};

export function isRetryable(code: UploadErrorCodeAll): boolean {
  return RETRYABLE.has(code);
}

export function normalizeUploadCode(raw: unknown): UploadErrorCodeAll {
  const s = typeof raw === "string" ? raw : "";
  if ((UPLOAD_ERROR_CODES as readonly string[]).includes(s)) return s as UploadErrorCodeAll;
  if (s.startsWith("file_too_large")) return "file_too_large";
  if (ALIASES[s]) return ALIASES[s]!;
  return "unknown";
}

/** Classify a non-OK HTTP answer, JSON or not. */
export function failureFromResponse(status: number, body: unknown): UploadFailure {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const technical = typeof b.code === "string" ? b.code : typeof b.error === "string" ? b.error : undefined;
  let code: UploadErrorCodeAll;
  if (technical) code = normalizeUploadCode(technical);
  else if (status === 401) code = "unauthenticated";
  else if (status === 403) code = "forbidden";
  else if (status === 404) code = "not_found";
  else if (status === 413) code = "file_too_large";
  else if (status === 429) code = "rate_limited";
  else if (status === 504 || status === 408) code = "upload_timeout";
  else if (status >= 500) code = "server_error";
  else code = "unknown";
  if (code === "unknown" && status >= 500) code = "server_error";
  return {
    code,
    technical: technical ?? `http_${status}`,
    retryable: typeof b.retryable === "boolean" ? b.retryable : isRetryable(code),
    correlationId: typeof b.correlationId === "string" ? b.correlationId.slice(0, 64) : undefined,
  };
}

/** Dictionary lookup with placeholder filling. Never returns the raw code. */
export function uploadErrorMessage(
  failure: Pick<UploadFailure, "code" | "correlationId" | "max">,
  messages: Record<UploadErrorCodeAll, string> & { reference: string },
): string {
  const template = messages[failure.code] ?? messages.unknown;
  return template.replace("{max}", failure.max ?? "").replace("{ref}", failure.correlationId ?? "—");
}

/** Dangerous executable / script extensions — rejected anywhere in the name chain (audio.mp3.exe). */
const DANGEROUS = /\.(exe|msi|dmg|pkg|app|apk|ipa|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|jse?|wsf|wsh|hta|cpl|jar|sh|bash|zsh|csh|ksh|command|run|bin|elf|dll|so|dylib|lnk|reg|gadget|msc|php\d?|phtml|py|pl|rb|cgi|asp|aspx|jsp)$/i;

export function isDangerousFilename(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  if (DANGEROUS.test(lower)) return true;
  // Any executable segment inside a multi-extension name ("notes.exe.pdf" is
  // allowed to be a PDF only if the bytes say so; "audio.mp3.exe" is never ok).
  const parts = lower.split(".").slice(1);
  return parts.slice(0, -1).some((p) => DANGEROUS.test("." + p) && ["exe", "bat", "cmd", "ps1", "sh", "msi", "scr", "vbs", "js", "jar", "apk", "dmg"].includes(p));
}

/**
 * Display helper for places that hold an upload code as a string (a preflight
 * result like "file_too_large:50 MB", or an outcome's normalized code).
 * Recognized codes become the localized message; any other text is returned
 * unchanged, so an already-localized message is never replaced by "unknown".
 */
export function describeUploadError(
  raw: string | undefined | null,
  messages: Record<UploadErrorCodeAll, string> & { reference: string },
): string {
  if (!raw) return "";
  const [head, ...rest] = raw.split(":");
  const code = normalizeUploadCode(head);
  if (code === "unknown" && head !== "unknown") return raw;
  return uploadErrorMessage({ code, max: rest.join(":") || undefined }, messages);
}
