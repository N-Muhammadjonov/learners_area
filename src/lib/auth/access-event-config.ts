/** The event relay uses one session-scoped connection per Railway Node process.
 * `AUTH_EVENTS_DATABASE_URL` can override the main database connection.
 * If the normal `DATABASE_URL` is a SESSION pooler (as configured in production),
 * reuse it rather than requiring a second copy of the database secret.
 * Transaction poolers cannot reliably support LISTEN; a direct/session
 * connection must be used and confirmed by the deployment owner.
 */
export function accessEventsConnectionString(): string | null {
  return process.env.AUTH_EVENTS_DATABASE_URL?.trim() ||
    process.env.DATABASE_URL?.trim() || null;
}
