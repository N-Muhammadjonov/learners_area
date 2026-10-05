# RIWI final portability acceptance

Status: **PARTIAL**. Code-level and isolated bounded-fixture evidence exists; full-data three-destination and real object-store acceptance does not.

## Existing evidence

- Explicit `full-system`, `riwi`, `learners-area`; no default scope.
- Closed Drizzle table classification and privacy canaries.
- Deterministic manifest/table hashes, bounded batches, dry-run and transaction rollback tests.
- 1,205-user / 1,210-row synthetic scale fixture.
- Fresh native PostgreSQL Mode A bounded-row import rehearsal, duplicate conflict and rollback.
- O1 no-copy and O2 pre-copy bytes/SHA checks through test adapters.
- Speaking transcript/audio excluded from Mode B fixtures.

## Not yet accepted

| Mode | Result |
|---|---|
| A full-system | PARTIAL — synthetic all-class fixture and one real PostgreSQL row; no accepted full-data destination/application boot receipt. |
| B RIWI-only | PARTIAL — deterministic privacy-canary fixture; no standalone real destination with grounded operation receipt. |
| C Learners-Area-only | PARTIAL — deterministic RIWI-exclusion fixture; no real destination boot/fail-safe RIWI surface receipt. |
| O1 keep-R2 | EXTERNAL REQUIRED — no real private object-store authentication/authorization receipt. |
| O2 move-objects | EXTERNAL REQUIRED — no real isolated-prefix copy/read-back/hash/auth/cleanup receipt. |

Final receipts must include migration count, clean pre-state, source/destination fingerprints, manifest SHA, dry-run zero writes, per-table counts/hashes, FK/unique/check/enum validation, identity mapping, deletion/expiry canaries, timestamps/relationships, sequence state where relevant, app boot and representative operations. No current local result is described as a full-data migration.
