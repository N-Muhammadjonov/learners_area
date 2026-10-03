# Preview 0036 approval checkpoint — 2026-10-04

Status: **Owner approved and applied to shared Preview on 2026-10-04. Verification passed.** Production is excluded.

Target remains the previously approved Preview identity:

- URL fingerprint: `a4e4e19c00742afea56b97be5aa601262fe445ddcf5b8c758dbd686bde03bbfb`.
- Server identity: `d2ecefc6644a924472f61835fcd766aaed3fcbe493da5dcdb445241e8c0e9560`.
- Exact migration: `0036_speaking_study_support`.
- SQL SHA-256: `2287d37ada3bd0d542ecdc9fb966dd024c903f04f6f8d3c274294d73d3b071da`.

## Changes

1. Add `speaking_prompts.study_support` JSONB with empty vocabulary, model-answer and ideas defaults. Existing prompts keep their text and publication state. No reference questions are published by this migration.
2. Widen `vocab_folders.name` from 80 to 200 characters so a Speaking question can be the folder name. Existing names and learner entries remain unchanged.
3. Replace the Listening offset unique index with the same uniqueness rule including `segment_key`. A transcript, question or exercise can each have its own offsets; duplicate offsets inside one segment remain rejected. This drops/recreates an index, not stored occurrences.

The index and column alteration may briefly lock writes. Apply all statements atomically; a failed statement rolls back the entire migration.

## Local verification

The fresh canonical gate applies the full 0000–0036 chain. A separate native PostgreSQL 18.4 upgrade check applies 0000–0035, inserts existing prompts/folders/occurrences, then applies 0036. It confirms preserved data, empty helper defaults, a 200-character folder name, independent segment offsets and rejection of duplicate offsets within a segment. Receipt: `work/evidence/speaking-support-native-upgrade.json` outside the repository; reproducible script: `scripts/qa-speaking-support-upgrade.mjs`.

## Apply conditions

The user's original request requires approval for shared Preview migrations. Prior approval covered only 0029–0035. The owner separately approved 0036 on 2026-10-04; the guard accepts only the reviewed SQL hash.

After explicit approval, obtain a fresh native backup of the target application and migration schemas, verify restoration in an isolated local PostgreSQL database, and reconnect with strict TLS and both identity checks. The old October 3 backup is historical evidence only. Preserve separate storage recovery scope; database backup excludes R2 objects and Supabase Auth/Storage.

Update the guard only for this reviewed SQL hash and exact widening operation. Verify the migration journal, existing row counts, helper column/default, folder capacity and unique index after apply. Deploy the matching code only after these checks pass. No Production schema, variable, content or deployment mutation is included.

## Execution evidence

Fresh backup and native PostgreSQL restoration passed before apply: `receipts/QA-backup-0036-2026-10-04.json`. Strict target identity, TLS, exact journal hash/timestamp order, migration and schema checks passed: `receipts/preview-qa-migrate-2026-10-03T19-37-28-179Z.json`. Journal ordering uses migration timestamps because the previously approved 0021 reconciliation inserted its row after 0022–0024; exact hashes and timestamps remain checked.
