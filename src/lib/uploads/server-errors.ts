import { NextResponse } from "next/server";
import { isRetryable, normalizeUploadCode, type UploadErrorCodeAll } from "@/lib/uploads/errors";

/**
 * Server half of the upload error contract.
 *
 * Root cause of the owner's "intent_failed": when anything inside the intent
 * route THREW (storage provider construction with a missing R2 variable,
 * STORAGE_PROVIDER unset in production, the presigner, or the database
 * insert), Next answered with an HTML 500. The client could not parse it and
 * fell back to the literal string "intent_failed". Now every throw becomes a
 * classified JSON failure with a correlation id; the technical message goes
 * to the server log only.
 */

export function uploadErrorBody(code: string, extra: { field?: string; correlationId?: string; message?: string } = {}) {
  const normalized: UploadErrorCodeAll = normalizeUploadCode(code);
  return {
      error: code,
      code: normalized,
      message: extra.message ?? normalized,
      ...(extra.field ? { field: extra.field } : {}),
      retryable: isRetryable(normalized),
      ...(extra.correlationId ? { correlationId: extra.correlationId } : {}),
  };
}

export function uploadError(code: string, status: number, extra: { field?: string; correlationId?: string; message?: string } = {}) {
  return NextResponse.json(uploadErrorBody(code, extra), { status });
}

export function classifyThrown(err: unknown): { code: UploadErrorCodeAll; status: number } {
  const message = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  if (/STORAGE_PROVIDER|Missing required env var|S3StorageProvider|credential/i.test(message)) {
    return { code: "storage_not_configured", status: 503 };
  }
  if (/ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connect|timeout|terminat|Connection/i.test(message) && /postgres|database|pg|neon|sql/i.test(message)) {
    return { code: "database_unavailable", status: 503 };
  }
  if (/relation .* does not exist|column .* does not exist|invalid input value for enum|violates/i.test(message)) {
    // Schema drift (a migration not applied on this database) — not retryable by the user.
    return { code: "server_error", status: 500 };
  }
  if (/S3|R2|presign|bucket|endpoint|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
    return { code: "storage_unavailable", status: 503 };
  }
  return { code: "server_error", status: 500 };
}

export async function withUploadErrorBoundary(route: string, run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    const correlationId = crypto.randomUUID().slice(0, 8);
    const { code, status } = classifyThrown(err);
    // Technical detail stays in the log (no secrets are part of these messages).
    console.error(`[uploads] ${route} failed`, { correlationId, code, error: err instanceof Error ? err.message : String(err) });
    return uploadError(code, status, { correlationId });
  }
}
