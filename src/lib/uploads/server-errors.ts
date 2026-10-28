import { safeDatabaseDiagnostic, safeErrorLabel } from "@/lib/observability/errors";
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
  return Response.json(uploadErrorBody(code, extra), { status });
}

type Dependency = "database" | "storage";

/** Causes carry the pg/socket error hidden by Drizzle's outer Failed-query error. */
export function classifyThrown(err: unknown, dependency?: Dependency): { code: UploadErrorCodeAll; status: number } {
  const pending: unknown[] = [err];
  const seen = new Set<unknown>();
  const records: { name: string; message: string; code: string }[] = [];
  while (pending.length && seen.size < 32) {
    const value = pending.shift();
    if (!value || typeof value !== "object" || seen.has(value)) continue;
    seen.add(value);
    const item = value as { name?: unknown; message?: unknown; code?: unknown; cause?: unknown; errors?: unknown };
    records.push({ name: typeof item.name === "string" ? item.name : "", message: typeof item.message === "string" ? item.message : "", code: typeof item.code === "string" ? item.code : "" });
    if (item.cause) pending.push(item.cause);
    if (Array.isArray(item.errors)) pending.push(...item.errors);
  }
  const message = records.map((item) => `${item.name} ${item.message}`).join(" ");
  const { sqlState } = safeDatabaseDiagnostic(err);
  if (sqlState && /^(08|28|53)|^57P0[123]$/.test(sqlState)) return { code: "database_unavailable", status: 503 };
  if (sqlState || records.some((item) => item.code === "SCHEMA_NOT_READY")) return { code: "server_error", status: 500 };
  const databaseError = dependency === "database" || /Failed query:|postgres|database|\bpg\b|neon|DrizzleQueryError/i.test(message);
  const network = records.some((item) => /^(ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN)$/.test(item.code)) || /connect|timeout|terminat|Connection/i.test(message);
  if (databaseError && network) return { code: "database_unavailable", status: 503 };
  if (/STORAGE_PROVIDER|Missing required env var|S3StorageProvider|credential/i.test(message)) return { code: "storage_not_configured", status: 503 };
  if (/relation .* does not exist|column .* does not exist|invalid input value for enum|violates/i.test(message)) return { code: "server_error", status: 500 };
  if (dependency === "storage" || /S3|R2|presign|bucket|endpoint|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) return { code: "storage_unavailable", status: 503 };
  return { code: "server_error", status: 500 };
}

export async function withUploadErrorBoundary(route: string, run: () => Promise<Response>, dependency?: Dependency): Promise<Response> {
  try {
    return await run();
  } catch (err) {
    const correlationId = crypto.randomUUID().slice(0, 8);
    const { code, status } = classifyThrown(err, dependency);
    // Drizzle's message can contain SQL and bound values. Log only safe classes/codes.
    console.error(`[uploads] ${route} failed`, { correlationId, code, error: safeErrorLabel(err), ...safeDatabaseDiagnostic(err) });
    return Response.json({ ...uploadErrorBody(code, { correlationId }), stage: route }, { status });
  }
}
