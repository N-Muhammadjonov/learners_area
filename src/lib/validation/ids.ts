/**
 * Route parameters that stand for a database id.
 *
 * A hand-typed or stale URL can put anything in a `[id]` segment. Postgres
 * rejects a non-uuid literal with `invalid input syntax for type uuid`, which
 * the framework turns into a 500 — an internal error where the honest answer is
 * "no such thing". Every lookup keyed by a uuid parameter checks the shape first.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}
