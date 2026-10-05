# Portability rehearsal evidence

Deterministic all-mode rehearsal: `tests/riwi-portability-v2.test.ts`. Real PostgreSQL destination rehearsal: `tests/riwi-portability-postgres.test.ts`.

Verified in code/tests: independent Mode A/B/C classification, Mode B private canaries absent, Mode C RIWI canaries absent, deterministic manifest, dry-run no mutation, transaction-bound import, manifest/table corruption rejection, O1 no-copy behavior, O2 object checksum before copy, 1,205-user scale without a 1,000 cap, injected rollback/clean retry, and streaming AES-256-GCM archive encryption with wrong-key rejection.

On 2026-10-05, migration 0048 and all 49 migrations were applied to isolated native PostgreSQL. A second fresh `learners_portability` database received a Mode A fixture through `createPostgresImportDestination`: dry-run wrote zero rows, apply reconstructed the row, and duplicate retry conflicted and left one row. This proves the real adapter path and transaction behavior with a bounded fixture, not production-scale data.

Still external/unverified: separate full-data A/B/C destination rehearsals, real R2/S3 copy, authenticated browser smoke, provider backup/PITR receipts, and Preview/Production cutover. Reports must record exact command, final SHA, database/object fingerprints and checksums.
