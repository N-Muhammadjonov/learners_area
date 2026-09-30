/**
 * Recognising "the database is not there" — and saying so.
 *
 * When a deployment points at a database that has not been migrated yet, every
 * query fails with a Postgres error, Next turns the unhandled exception into a
 * generic 500, and the operator sees a stack trace in the logs while the visitor
 * sees an HTML error page. That is exactly the state this repository was in
 * against its production database (`relation "users" does not exist`, 42P01).
 *
 * The classification below is deliberately narrow. It covers conditions that are
 * *deployment* problems, not request problems:
 *
 *   42P01 undefined_table     — migrations never ran
 *   42703 undefined_column    — code ahead of the database
 *   3D000 invalid_catalog     — the database name does not exist
 *   28P01 / 28000 auth failed — wrong credentials
 *   08000–08006 connection_*  — host unreachable, connection dropped
 *   53300 too_many_connections, 57P03 cannot_connect_now — server-side capacity
 *
 * Everything else is left exactly as it was: a bug in a route must stay a loud
 * 500, not be relabelled as an outage. Nothing here is returned to the client
 * beyond a fixed code — the driver's message can contain the host and the user.
 */

export type DatabaseFailureReason =
  | "schema_missing"
  | "column_missing"
  | "database_missing"
  | "auth_failed"
  | "unreachable"
  | "capacity";

const BY_CODE: Record<string, DatabaseFailureReason> = {
  "42P01": "schema_missing",
  "42703": "column_missing",
  "3D000": "database_missing",
  "28P01": "auth_failed",
  "28000": "auth_failed",
  "08000": "unreachable",
  "08001": "unreachable",
  "08003": "unreachable",
  "08004": "unreachable",
  "08006": "unreachable",
  "53300": "capacity",
  "57P03": "capacity",
  "ECONNREFUSED": "unreachable",
  "ECONNRESET": "unreachable",
  "ETIMEDOUT": "unreachable",
  "ENOTFOUND": "unreachable",
  "EAI_AGAIN": "unreachable",
  "EHOSTUNREACH": "unreachable",
  "ENETUNREACH": "unreachable",
  "EPIPE": "unreachable",
};

/** Postgres error codes that also travel as `cause.code` through Drizzle. */
export function classifyDatabaseError(error: unknown): DatabaseFailureReason | null {
  const seen = new Set<unknown>();
  const pending: unknown[] = [error];
  // Drizzle wraps driver errors, and the code can sit on `cause` one or two
  // levels down; walk the chain instead of guessing the depth.
  while (pending.length) {
    const current = pending.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && BY_CODE[code]) return BY_CODE[code];
    // A connection that never opened surfaces as an AggregateError of attempts.
    const nested = (current as { errors?: unknown[] }).errors;
    if (Array.isArray(nested)) {
      pending.push(...nested);
    }
    pending.push((current as { cause?: unknown }).cause);
  }
  return null;
}

/**
 * One JSON body for every "the deployment cannot serve this yet" answer.
 *
 * 503, not 500: the request was well formed and the code is not broken, the
 * service behind it is not ready. It is also what a platform health check and a
 * load balancer understand.
 */
export function databaseUnavailableResponse(reason: DatabaseFailureReason) {
  return {
    status: 503 as const,
    body: {
      error: "service_unavailable",
      reason,
      // Deliberately no driver message, no host, no user, no SQL.
      hint:
        reason === "schema_missing" || reason === "column_missing"
          ? "The database has not received this deployment's migrations."
          : "The database is not reachable with the configured credentials.",
    },
  };
}
