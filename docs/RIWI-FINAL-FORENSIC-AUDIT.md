# RIWI final forensic audit — Security V2

Date: 2026-10-05 (Asia/Tashkent)

Starting checkpoint: `37f431eb15bedd769f053d76c816e37098569447`

Verified implementation checkpoint: `6d0fd2e6c27f8b45486e66d0b8b378cdbf0f72f3`

## Scope and source recovery

All four authoritative sources were read in full from the read-only document source and extracted as `/tmp/RIWI_SOURCE_A.txt` through `D`. No source branch was merged or cherry-picked. The 17,021-record sentence/fragment ledger is `RIWI-FINAL-REQUIREMENT-LEDGER.jsonl`: 16,804 PASS, 208 OWNER ACTION REQUIRED, 9 EXTERNAL REQUIRED, and zero GAP/PARTIAL/BLOCKED/UNVERIFIED records after local closure. Informational source fragments are retained so line coverage is inspectable.

## Implemented closure

- Closed tri-mode table/object classification with mandatory Mode A/B/C scope and no unsafe default.
- Deterministic canonical JSONL manifests, per-table row/byte/SHA-256 evidence, manifest self-hash and schema/core/assessment/Speaking versions.
- Bounded export batches, transactional import, dry-run, conflict rejection, rollback/retry and identity-map plumbing.
- O1 keep-R2 and O2 byte-length/SHA-256-verified object copy; private Speaking data excluded from RIWI-only export.
- Streaming AES-256-GCM private archive envelope with out-of-band 32-byte key and authentication-failure rejection.
- Provider-independent PostgreSQL destination adapter, migration/backup/DR/cutover/integrity specifications and three mode runbooks.
- Sanitized, deduplicated RIWI security-learning persistence, owner API/dashboard, gateway denial recording and regression-gated promotion. Runtime self-modification is absent.
- Migration `0048_condemned_pyro.sql` adds the constrained security-signal table and indexes.
- Prompt Base assessment-contract and Speaking security/retention documentation preserve the accepted architectures.

## Verification receipts

Two fresh canonical gates passed on the final source/test tree:

| Gate | PGlite unit | UI | Native PostgreSQL | Typecheck | Lint | Build | Diff |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/tmp/qa-gate-v2-1` | 1,207 / 1,116 pass / 0 fail / 91 skip | 232 / 232 / 0 | 1,207 / 1,204 / 0 / 3 | PASS | PASS | PASS | PASS |
| `/tmp/qa-gate-v2-2` | 1,207 / 1,116 pass / 0 fail / 91 skip | 232 / 232 / 0 | 1,207 / 1,204 / 0 / 3 | PASS | PASS | PASS | PASS |

Both gates applied all 49 migrations to fresh native PostgreSQL and verified the pinned 880-row Speaking bank. The three real-PG skips were two unavailable owner Listening-source fixtures and the separately gated portability destination database.

Additional evidence:

- Portability/security focused suite: 10/10 pass.
- Fresh `learners_portability` PostgreSQL migration plus import test: 1/1 pass; dry-run wrote zero, apply reconstructed one row, duplicate retry conflicted and rolled back.
- Enabled real-PostgreSQL DB suite: 75 pass, 6 initially failed because `STORAGE_PROVIDER` was omitted; rerun of all six with the required isolated local storage setting passed 6/6. This setup error is not represented as a product pass.
- Resource leak scan: 12,000 iterations; handles 2→2 and active requests 3→3, PASS.
- Streaming encryption round trip and wrong-key rejection passed with a 2 MB fixture.
- Mode fixtures include 1,205 users and 1,210 total rows, exceeding the 1,000-row acceptance threshold.

## Skips and external evidence

The Listening owner source ZIP was not supplied, so its two source-dependent tests remain external. A real R2/S3 O2 move, full-data A/B/C destination rehearsals, authenticated browser role QA, provider backup/PITR receipt, restore drill receipt, shared Preview migration and Production cutover were not performed. No provider credentials were available or required for local closure.

## Owner actions

The owner must approve retention periods, authorize any Preview/Production migration or cutover, provide external source assets/credentials, approve backup/restore objectives, and accept consequential policy changes. See `RIWI-OWNER-MANUAL.md` and the ledger’s OWNER ACTION REQUIRED records.

## Safety statement

Production touched: **no**. Shared Preview migration applied: **no**. Production deployment performed: **no**. Existing Prompt Base, 68-contract workflow and Speaking architecture were preserved rather than rebuilt.
