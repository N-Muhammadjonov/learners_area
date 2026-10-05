# Preview migration approval packet — candidate chain 0036–0044 (2026-10-05)

**Status: BLOCKED — NOT READY FOR OWNER APPROVAL; NOT APPROVED; NOT APPLIED.** This is a prepared evidence packet, not evidence of the current Preview state. No shared Preview or Production database was contacted in this session. A fresh target identity, applied/pending inventory, current backup/PITR proof, and independently verified restore are unavailable, so no exact pending range or recovery readiness is asserted. Do not run a migration apply from this packet.

## Repository and migration-chain identity

- Fixed session branch: `arena/01a10332-learners-area`.
- Source checkpoint when this packet was prepared: `27060cce28de4b637cba7a9a495dc24e27580af6`.
- Drizzle journal: 45 entries, indices `0`–`44`; final tag `0044_riwi_owner_history_indexes`.
- Candidate post-0035 chain: `0036`–`0044`, in journal order. This is a *conditional candidate only*, not a verified Preview pending range.
- Exact Preview pending range: **UNKNOWN — BLOCKER**.

## Fresh Preview target identity — required before this packet can be approved

| Field | Current value | Evidence/status |
|---|---|---|
| Verification time and operator | Not obtained | No connection made. |
| Preview project/database reference | Not obtained | Must be freshly read and matched to the intended Preview project. |
| Database/server identity fingerprint | Not obtained | Must be freshly computed by the guarded tool; historical hashes are not substitutes. |
| Production-exclusion check | Not obtained | Must positively establish that the target is Preview, not Production. |
| Applied migration tags and exact pending tags/range | Unknown | Must be read from the current target journal and reconciled against all 45 repository entries. |
| Target-side table sizes, row counts and duplicate/orphan checks | Unknown | Required for backfill, constraint and index risk assessment. |

The historical 2026-10-03 record through `0035` is not current approval or current target identity. If (and only if) a fresh read proves Preview is still applied through `0035`, the candidate pending range would be `0036`–`0044`. If the target is at another point, derive the exact pending range from the fresh journal; stop on gaps, unknown tags, checksum mismatches, or any Production identity.

No matching Preview/Database/Supabase connection-variable *names* were present in the session environment; the only repository-root env file is `.env.example`. No credential value was printed or stored. `scripts/preview-qa-migrate.mjs` currently allowlists pending tags only through `0035`, so it will reject `0036`–`0044`. That guard remains unchanged; do not expand its allowlist before explicit owner approval for a freshly identified target and exact range.

## Candidate migration inventory and impact

Classifications below describe the SQL in this branch; they are not a claim that any of these tags is currently pending. “Additive” means no planned table/row deletion. Constraint/index replacement and in-place backfills are called out separately because they can still be operationally disruptive or change stored values.

| Tag / SHA-256 | Purpose | Additive / destructive classification | Backfill and data impact | Lock / operational impact to verify on target |
|---|---|---|---|---|
| `0036_riwi_core` — `a129de5a2d1f29122cb89b2f6360d6a51efb5066bac62a95001683a1d85320c6` | Creates RIWI enum types, core conversation, knowledge, learning, provider-experiment, usage and confirmation tables, their foreign keys and indexes. | Additive schema creation; no existing-row backfill or row deletion. | New tables start empty; no data rewrite. | Many ordinary table/index/FK DDL statements. The new indexes are initially empty, but referenced-table FK checks and DDL locks still require observation. No runtime estimate is claimed. |
| `0037_riwi_governance_hardening` — `8b627da06582e72c18067c3f62b8b7deb9dfd28bc0524a77dd303be6bb41b980` | Adds regression evidence columns; replaces the learning-review approval check; adds source checksum uniqueness and scope/active-regression/signal-scope/cost checks. | Additive columns and hardening constraints; replaces one check constraint. No intended row deletion. | No backfill. Existing rows must satisfy the new checks and source uniqueness; otherwise the migration fails. | Unique-index construction and validated check constraints can scan/lock tables. Confirm duplicates and constraint violations first; confirm lock budget and maintenance window. |
| `0038_riwi_provider_experiment_idempotency` — `2d1914c78f8501b3220ddee71eb0d2593d55ec8a5315e3fe19aea8fb500cdc09` | Adds provider-experiment idempotency keys, makes them mandatory and enforces actor/key uniqueness. | Additive column/constraint with an in-place data backfill; no intended row deletion. | Sets null keys to `legacy-<experiment id>`, then sets `NOT NULL`; adds a unique index. Row counts and null counts are currently unknown. | `UPDATE` takes row locks and generates WAL; `SET NOT NULL` and ordinary unique-index build can scan/lock a large table. Confirm table size, null count, duplicates and available disk/WAL headroom. |
| `0039_riwi_learning_signal_pipeline` — `a040b9a77995610658c00d6f6159975d885f71843f63922bf759eba50bfd78e4` | Adds the `provider_failure` learning-signal enum value and a partial unique actor/type/source index. | Additive enum/index; no backfill or row deletion. | No row updates. Existing duplicate non-null actor/type/source tuples can make unique-index creation fail. | Ordinary unique-index build and scan; check duplicates and lock/write impact. |
| `0040_riwi_learning_signal_retention` — `8765feec063ce8ae4d4ea074fe65bc92759a79f32ac455c6fd5b37df8c49718c` | Supplies a source-id default, fills null source IDs, makes the column non-null, and replaces the signal-scope check. | Additive/default and stricter constraint with an in-place UUID backfill; replaces a check constraint; no intended row deletion. | Writes a generated UUID to every null `source_id`; affected count is unknown. The assigned UUIDs become persisted identity values and must be backed up, not guessed/reversed. | Full scan/update, row locks and WAL; `NOT NULL` validation and check replacement may hold DDL locks. Measure null-row count and test on a restored target-sized clone. |
| `0041_riwi_learning_signal_knowledge_link` — `107ab3b2fea2e476fdb7285e6e39be85b510cbc343fcbc20d7de2beb617b95d6` | Adds FK from learning-review resulting source to knowledge sources with `ON DELETE SET NULL`. | Additive FK; no backfill or row deletion. | Existing non-null references must validate; orphan count is unknown. | FK validation scans existing rows and takes DDL locks. Verify orphans and lock duration on the target. |
| `0042_riwi_knowledge_private_upload` — `bc03ec0d6efe597d1d7a5c3fbef4983a57c1989e87718099875a728a6a140c74` | Adds the `riwi_knowledge_source` upload-purpose enum value, nullable source-checksum column and checksum-format check. | Additive enum/nullable column/check; no backfill or row deletion. | Existing rows receive null for the new column; no content rewrite. Existing non-null values, if any, must satisfy the check. | Check validation and enum DDL require normal catalog/table locks; inspect table size and verify the constraint before apply. |
| `0043_riwi_target_cursor_indexes` — `a6b5e29bdb7e31998171e4b51ae3a82e5e92b99ccb39fc1df8fac6c5c71073bd` | Adds partial expression index for active student target ordering on `users`. | Additive index; no data rewrite or row deletion. | No backfill. | Ordinary (non-concurrent) index build scans `users` and can block writes; inspect row count, write traffic, disk/WAL and maintenance window. |
| `0044_riwi_owner_history_indexes` — `27a2ebe3dbc7518e829a03f4c70f2a46fb24ebf50b167badaa7c5b13c0627690` | Adds stable history indexes for audit, knowledge sources and learning signals; replaces provider-experiment actor/created index with actor/created/id. | Additive indexes plus explicit drop/rebuild of one existing index; no row backfill or deletion. | No row updates. Existing provider index is dropped before its replacement is created. | Ordinary non-concurrent index builds scan/lock target tables. The old provider index can be absent between statements if the migration runner does not make the file atomic. Confirm the exact runner/transaction behavior, table sizes, write-lock impact and recovery window. |

No migration duration, row count, lock duration, or low-risk status is asserted without target measurements. The local 45/45 isolated full-chain result verifies repository SQL application only; it is not Preview backup, restore, or load evidence.

## Required data, lock and recovery evidence

Before approval, collect from the freshly verified target (read-only first):

1. Exact applied tags, next pending tags and any journal gaps; compare every pending SQL file's SHA-256 with the table above.
2. Table sizes/row counts and migration-specific checks: null idempotency keys and duplicate actor/key pairs; null learning-signal source IDs and duplicate actor/type/source tuples; constraint violations; orphan resulting-source references; current index definitions; relevant write rates and disk/WAL capacity.
3. A new target-matched native backup, with backup timestamp, target fingerprint, retention/location and integrity evidence.
4. Verified PITR/WAL recovery range and a completed restore drill into an isolated Preview clone. Record restore time, restored target identity, journal state and application/table-count checks. A backup that has not been restored is not verified recovery evidence.
5. A lock/backfill rehearsal against a target-sized restored copy, with measured statement duration, blocking/replica effects and abort/recovery behavior. Do not extrapolate local PGlite/full-chain timings into Preview.

**Current backup/PITR readiness: UNVERIFIED — BLOCKER. Current restore evidence: NONE — BLOCKER.** No backup or restore was attempted in this session.

## Ordered plan — execute only after the blockers are cleared

1. Obtain approved Preview connection access through the owner-controlled environment. Use the guarded fingerprint-only read to freshly verify Preview identity and Production exclusion; record the verification time and fingerprint without recording credentials. Do not rely on the plan path to accept `0036`–`0044` yet; its current allowlist still stops at `0035`.
2. Read the target journal and compute the exact pending range. Stop if it is not a contiguous, reviewed subset of this candidate chain, if an unexpected tag appears, or if any SQL hash differs.
3. Run the target-side null/duplicate/orphan/constraint checks and record table sizes, write rates, available disk/WAL and index definitions.
4. Create a fresh target-matched backup; prove the PITR range and restore it to an isolated clone. Complete the migration rehearsal and lock/backfill review there.
5. Present the exact target fingerprint, exact pending tags and hashes, measured impact, restore receipt, maintenance window and rollback/recovery plan to the owner. Obtain explicit approval for this exact target and exact range. No self-approval.
6. Only after that approval, make a reviewed change that allowlists exactly the approved pending tags; run the guarded plan again, then apply those tags in journal order. Do not apply a larger range than approved.
7. Verify the complete journal, constraints, backfill counts, index definitions, application smoke checks and final target fingerprint. Save an immutable apply/verification receipt and update this packet. Do not deploy Production.

## Rollback and recovery

- Do not delete or rewrite Drizzle journal history and do not run an improvised reverse migration.
- For a failed or partial apply, stop further writes/migrations, preserve logs, and use the independently verified target-matched PITR/backup procedure to restore to a new isolated Preview target. Re-verify its identity, journal, row counts and application behavior before any traffic is directed to it.
- The `0038`/`0040` backfills write values into existing rows; the generated IDs/keys cannot be safely reconstructed by an ad hoc down migration. A restore is the authoritative rollback for those values.
- If restore is unavailable or unsuccessful, keep Preview blocked and prepare an owner-reviewed forward corrective migration; do not drop tables, truncate data, force the journal, or touch Production.
- If only `0044` index creation fails after an explicitly approved apply, do not assume the prior provider index exists; inspect current catalog state and recover from the verified restore or a reviewed index repair. Keep the application/migration runner paused until owner-directed recovery is complete.

## Approval record

- Owner approval for exact target fingerprint and exact pending range: **NONE**.
- Current Preview fingerprint and applied/pending inventory: **NOT VERIFIED**.
- Backup/PITR and restore receipt: **NONE**.
- Migration apply receipt: **NONE**.
- Preview apply: **PROHIBITED until every blocker is cleared and the owner explicitly approves**.
- Production migration/deployment: **PROHIBITED / OUT OF SCOPE**.
