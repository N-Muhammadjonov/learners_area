# Proposed Preview migration 0044 — owner approval packet

**Status: OWNER APPROVAL REQUIRED — NOT APPROVED, NOT APPLIED.** No shared Preview or Production database was contacted for this packet. Do not run the shared migration apply until the owner explicitly approves this exact migration and the recovery gates below have been freshly verified.

## Identity and scope

- Repository branch: `arena/01a10332-learners-area`.
- Migration: `drizzle/0044_riwi_owner_history_indexes.sql`.
- Journal entry: index `44`, after `0043_riwi_target_cursor_indexes` at index `43`.
- SQL SHA-256: `27a2ebe3dbc7518e829a03f4c70f2a46fb24ebf50b167badaa7c5b13c0627690`.
- Snapshot: `drizzle/meta/0044_snapshot.json` (Drizzle version 7).
- Preview target identity/fingerprint: **must be freshly read and recorded at approval time; intentionally not guessed or copied from an older target**.

The only migration effects are B-tree history indexes for stable `(timestamp, id)` owner pagination:

1. `audit_log (created_at, id)`.
2. `riwi_knowledge_sources (updated_at, id)`.
3. `riwi_learning_signals (created_at, id)`.
4. Rebuild `riwi_provider_experiments_actor_created_idx` as `(actor_user_id, created_at, id)`.

No table rows, application columns, constraints, policies, roles, or content are backfilled or changed. The fourth operation drops and recreates the existing provider-experiment index under its current name.

## Local migration validation

- The migration was generated from `src/db/schema.ts`; the 0043 entry and all earlier accepted journal entries were left in place.
- The new entry's timestamp is `1791500000009`, one millisecond after accepted entry 0043 (`1791500000008`). This corrects Drizzle's strict-increasing timestamp requirement without changing or renumbering prior history.
- `drizzle-kit check --dialect=postgresql --out=drizzle` reported `Everything's fine` without a timestamp warning after that correction.
- Local PGlite and real-Postgres full-chain results will be recorded here only after the final gates complete. Local test application is not a Preview apply and is not owner approval.

## Operational risk and rollback

The migration uses ordinary `CREATE INDEX` (not `CONCURRENTLY`) and drops/rebuilds the provider-experiment index. Index creation can hold write-blocking locks while it runs; the provider index is briefly absent between the drop and recreation if the runner does not wrap the file atomically. Table sizes, lock duration, maintenance-window need, and Preview write traffic must be checked against the actual target before approval. No duration is asserted here.

A recovery plan must be prepared from a fresh, target-matched backup and independently restored before any apply. If rollback is approved, restore the prior provider index definition `(actor_user_id, created_at)` and remove only the three new indexes and rebuilt composite index after confirming no later approved migration depends on them. Do not rewrite or delete Drizzle journal history to roll back.

## Required owner gates before any Preview apply

- [ ] Record the current Preview project/database identity and a fresh fingerprint; confirm Production is not the target.
- [ ] Create a fresh native recovery backup and verify an isolated restore, including application table/row-count checks and the current migration journal.
- [ ] Confirm migration 0044 is the sole pending migration and 0043 is applied; compare the reviewed SQL hash above.
- [ ] Review table sizes, expected lock impact, and a maintenance window; stop if the non-concurrent index build is not acceptable.
- [ ] Receive explicit owner approval for **only** migration 0044 on the freshly identified Preview target.
- [ ] Apply through the approved Preview migration procedure/allowlist; do not apply Production changes.
- [ ] Verify the four index definitions, Drizzle journal state, application smoke checks, and recovery receipt; record the result and immutable receipt path.

**Approval record:** none. **Apply receipt:** none. **Production mutation:** prohibited/out of scope.
