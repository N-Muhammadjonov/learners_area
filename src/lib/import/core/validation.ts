import { z } from "zod";
import type { ContentModule } from "./envelope";

/**
 * Validation is layered, and every layer produces the same normalized issue so
 * the admin UI, the logs and the tests read the same reason.
 *
 *   LEVEL 1  JSON / envelope / content structure      (schema)
 *   LEVEL 2  domain semantics                         (module rules)
 *   LEVEL 3  assets                                   (declared, finalized, owned, MIME)
 *   LEVEL 4  database / business                      (duplicates, permissions, publication)
 */

export type ValidationLevel = 1 | 2 | 3 | 4;

export type ImportErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "invalid_json"
  | "invalid_input"
  | "payload_too_large"
  | "unsupported_schema_version"
  | "unknown_content_type"
  | "schema_invalid"
  | "semantic_invalid"
  | "executable_markup"
  | "asset_missing"
  | "asset_not_finalized"
  | "asset_not_owned"
  | "asset_mime_invalid"
  | "asset_hash_mismatch"
  | "content_hash_mismatch"
  | "source_conflict"
  | "source_already_imported"
  | "duplicate_asset"
  | "legacy_requires_review"
  | "conversion_ambiguous"
  | "schema_not_ready"
  | "unknown";

export type ImportIssue = {
  level: ValidationLevel;
  code: ImportErrorCode;
  /** Stable machine detail, e.g. `content.questions.3.evidence.at`. */
  path?: string;
  /** Human message; safe to show staff (never a stack trace). */
  message: string;
  /** Blocking issues stop the import; non-blocking are surfaced as warnings. */
  blocking: boolean;
};

export type ValidationReport = {
  ok: boolean;
  issues: ImportIssue[];
  warnings: ImportIssue[];
};

export function issue(
  level: ValidationLevel,
  code: ImportErrorCode,
  message: string,
  path?: string,
  blocking = true,
): ImportIssue {
  return { level, code, message, ...(path ? { path } : {}), blocking };
}

export function report(issues: ImportIssue[]): ValidationReport {
  const all = [...issues];
  return {
    ok: !all.some((entry) => entry.blocking),
    issues: all.filter((entry) => entry.blocking),
    warnings: all.filter((entry) => !entry.blocking),
  };
}

/** Merge reports, preserving order; used when a handler adds layers to the base. */
export function mergeReports(...reports: ValidationReport[]): ValidationReport {
  return report(reports.flatMap((entry) => [...entry.issues, ...entry.warnings]));
}

/** A Zod failure becomes level-1 issues with the exact path that broke. */
export function issuesFromZodError(error: z.ZodError, level: ValidationLevel = 1): ImportIssue[] {
  return error.issues.map((entry) =>
    issue(
      level,
      "schema_invalid",
      entry.message,
      entry.path.length ? entry.path.map((part) => String(part)).join(".") : undefined,
    ),
  );
}

const HTML_LIKE = /<\s*(script|iframe|object|embed|style)\b|javascript:|<\s*\/\s*script/i;
const HANDLER_ATTRIBUTE = /\son[a-z]+\s*=\s*["']/i;
const CSS_DECLARATION = /(^|[;{]\s*)(color|background|font-family|margin|padding|display|position)\s*:/i;

/**
 * Educational data is data. Generated markup must never become the learner UI,
 * so executable-looking strings are refused at validation time (level 2) instead
 * of being sanitized later, and never executed.
 */
export function executableMarkupIssues(value: unknown, path = "content"): ImportIssue[] {
  const found: ImportIssue[] = [];
  const visit = (node: unknown, trail: string) => {
    if (typeof node === "string") {
      if (HTML_LIKE.test(node) || HANDLER_ATTRIBUTE.test(node)) {
        found.push(issue(2, "executable_markup", "Executable markup is not allowed in educational data", trail));
      } else if (CSS_DECLARATION.test(node)) {
        found.push(
          issue(2, "executable_markup", "Style/CSS declarations are not allowed in educational data", trail, false),
        );
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => visit(entry, `${trail}.${index}`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, entry] of Object.entries(node as Record<string, unknown>)) visit(entry, `${trail}.${key}`);
    }
  };
  visit(value, path);
  return found;
}

/** HTTP status for a normalized import failure — one place, one contract. */
export const IMPORT_ERROR_STATUS: Record<ImportErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  invalid_json: 400,
  invalid_input: 400,
  payload_too_large: 413,
  unsupported_schema_version: 400,
  unknown_content_type: 400,
  schema_invalid: 400,
  semantic_invalid: 400,
  executable_markup: 400,
  asset_missing: 400,
  asset_not_finalized: 400,
  asset_not_owned: 403,
  asset_mime_invalid: 400,
  asset_hash_mismatch: 400,
  content_hash_mismatch: 400,
  source_conflict: 409,
  source_already_imported: 409,
  duplicate_asset: 400,
  legacy_requires_review: 422,
  conversion_ambiguous: 422,
  schema_not_ready: 503,
  unknown: 500,
};

export const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;

/** One normalized failure body. Raw server stacks are never returned. */
export function failureBody(code: ImportErrorCode, detail?: string, correlationId?: string) {
  return {
    error: code,
    ...(detail ? { detail: detail.slice(0, 240) } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}
