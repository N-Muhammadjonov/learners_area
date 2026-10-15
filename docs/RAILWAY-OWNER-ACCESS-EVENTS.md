# Railway access-change events (event driven, not a role poller)

Purpose: Owner/Admin can promote, demote or suspend someone. That decision updates the durable `users` row once. Connected browsers receive an invalidation event, then refresh their own role/status once. Browser navigation never polls for role changes.

## Production deployment requirements

1. No database schema migration is needed. Owner/Admin role and admission actions explicitly publish one lightweight `pg_notify` **after the database mutation commits**; the two-user Owner transfer publishes to both affected accounts.
2. Configure `AUTH_EVENTS_DATABASE_URL` in **Railway website service** with a secure PostgreSQL direct or session-pooled URL. `LISTEN` does not work reliably through a transaction pooler. Keep credentials in Railway secrets. Never expose them as NEXT_PUBLIC values.
3. Redeploy `main` to Railway after configuring the URL. No Vercel deployment configuration is involved. Without the setting the SSE component does not mount and existing database-authoritative authorization remains unchanged.
4. Verify in two independently logged-in browsers: Owner changes Teacher→Student; second session receives `access-changed`, calls `/api/auth/state` once, refreshes, hides Management. For suspension, the second browser clears private client resources and goes to `/pending`. Re-approval must preserve learning data. Direct requests to admin APIs must remain 403 on demotion/suspension, including with a stale signed cookie.
5. Verify a lost/reconnected SSE connection rechecks once, that different user IDs do not receive one another's events and no role/status poller runs on ordinary button clicks.

## Invariants and limits

- Application handlers publish only after successful role/status/admission/ownership changes. The message contains only the target user UUID. No trigger or migration is needed; publication failure does not undo or grant access. The server authorization gate remains the fallback.
- The Node relay maintains ONE dedicated LISTEN connection per Railway web process. A client SSE tab requires one HTTP stream but never one DB connection. SSE heartbeats are comments with no DB reads.
- LISTEN/NOTIFY is **not** durable: a browser offline or a crashed subscriber can miss an event. Reconnect sends a new one-shot status read, and all existing server DB access guards stay authoritative. UI push is not an authorization boundary.
- Owner modifications themselves do not delete progress, retained writing, attempts, notes or role history. The existing six-month genuine learner inactivity policy is unchanged.
- Auth cookie TTL remains **30 days** (existing `session.ts`). Six months is the learner inactivity cleanup window, not a promise of an eternal session.
- Current application still performs a database role/status lookup for a new server request. Eliminating that check while retaining immediate revocation requires an additional shared, strongly consistent revocation/authorization store (for example managed Redis with atomic mutation fencing). This PR does NOT fake that security property. It removes background polling, not the necessary access control.

Manual owner QA and observed Railway p50/p95 latency measurements are required before considering this fully deployed.
