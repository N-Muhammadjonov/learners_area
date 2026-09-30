/**
 * Stable, machine-readable Retention errors.
 *
 * Every refusal in this feature answers with one of these codes instead of a
 * generic "something went wrong", and never with a raw SQL message, a stack
 * trace or a connection string. The learner/admin UI maps the code to a
 * localized sentence (`dict.retention.errors.*`); the code itself is what the
 * API returns, so a client can branch on it without parsing prose.
 */

export const RETENTION_ERROR_CODES = [
  "retention_no_content",
  "retention_invalid_level",
  "retention_attempt_not_found",
  "retention_wrong_phase",
  "retention_expired",
  "retention_invalid_structure",
  "retention_word_count_out_of_range",
  "retention_forbidden",
  "retention_conflict",
  "retention_scoring_failed",
  "retention_invalid_input",
] as const;

export type RetentionErrorCode = (typeof RETENTION_ERROR_CODES)[number];

/** HTTP status for each code — one table, so routes never invent their own. */
export const RETENTION_ERROR_STATUS: Record<RetentionErrorCode, number> = {
  retention_no_content: 404,
  retention_invalid_level: 400,
  retention_attempt_not_found: 404,
  retention_wrong_phase: 409,
  retention_expired: 410,
  retention_invalid_structure: 422,
  retention_word_count_out_of_range: 422,
  retention_forbidden: 403,
  retention_conflict: 409,
  retention_scoring_failed: 500,
  retention_invalid_input: 400,
};

export class RetentionError extends Error {
  readonly code: RetentionErrorCode;
  readonly status: number;
  /** Safe, non-sensitive detail (an issue list from the validator, a count). */
  readonly details?: unknown;

  constructor(code: RetentionErrorCode, message?: string, details?: unknown) {
    super(message ?? code);
    this.name = "RetentionError";
    this.code = code;
    this.status = RETENTION_ERROR_STATUS[code];
    this.details = details;
  }
}

export function isRetentionError(error: unknown): error is RetentionError {
  return error instanceof RetentionError;
}
