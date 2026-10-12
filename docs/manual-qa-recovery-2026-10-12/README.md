# Reviewed QA schema reconciliation

Target: the existing Supabase project `learners-area-qa`, project reference `bpexpsugmuhwmztacbqd`, database `postgres`. These files do not target RIWI or Production. Project identity must be confirmed in Safari before execution because SQL running inside Postgres cannot independently identify its Supabase project reference.

The downloaded live audit reports exactly 38 canonical primary migrations, 0000–0037, including exact SHA-256 hashes and original journal timestamps. The repair rejects any missing, duplicate, modified, or additional migration history. It also validates the affected existing schema and refuses unjournalled pending tables. All cloud writes remain for the root agent to execute in the selected QA project's Safari SQL editor.

## Execution order

1. Run `01-backup.sql`. It commits a durable copy of every existing public table, original columns, row counts, ordered row-value MD5 fingerprints, column/default/not-null metadata, constraints, index definitions, enum labels, and the full existing Drizzle journal. The recovery schema is `qa_recovery_20261012`. PUBLIC, anon and authenticated cannot use it or read its tables. Existing application tables are locked during copying. Never overwrite or remove an existing recovery schema.
2. Run `02-enum.sql`. It separately commits the additive `video` value in `upload_block_kind`. It requires the exact baseline journal and durable backup. PostgreSQL's enum commit boundary is explicit.
3. Run `03-apply-primary-0038-0052.sql`. One atomic transaction runs the exact 15 pending canonical migrations, except the enum ALTER already committed in step 2. It records each exact original SQL SHA-256 and journal timestamp after that migration succeeds. It refuses any baseline data drift since the backup. Final catalog, original-row preservation, note recovery and private-schema assertions must all succeed before COMMIT.
4. Run `04-readonly-verify.sql`. This is a read-only transaction that rechecks the entire final contract and original-row preservation. Run `05-export-evidence.sql` separately for downloadable JSON and table-level count/hash CSV evidence. Preserve the SQL editor success/error result and exported output.

## Data changes explicitly allowed by reviewed migrations

- 0040 adds `listening_packages.legacy_runtime`, then marks rows with an `authoredRuntime` payload true. Original package row columns and payloads remain identical. The old full row is retained in the private backup.
- 0049 copies nonblank historical `lesson_progress.notes` into private `lesson_notes`, keyed by user and lesson. It clears a legacy note only when exactly the same text exists in the new table. If duplicate progress rows have different notes, the uncopied text remains on its original row. Notes longer than the new bound cause atomic failure instead of truncation. Every original note remains in the backup.
- 0048 creates exactly 30 owner-supplied typing texts with `ON CONFLICT DO NOTHING`. This repair refuses a pre-existing unjournalled typing_texts table instead of guessing its provenance. Existing typing histories remain identical. The preset duration CHECK widens to 30/60/120/180 seconds. The model reference becomes nullable, while the exactly-one-target CHECK makes the historical model reference or new typing-text reference mandatory.
- 0042 changes mock-attempt content deletion behavior from cascade to SET NULL, makes the content reference nullable and adds snapshot/version columns. It does not delete or rewrite historical attempts. Catalog validation verifies the final FK definition.
- Remaining changes add tables, columns, indexes, constraints, triggers or enum labels. Reviewed constraint drop/re-add statements implement their exact authored contract. No owner row, content table, data column, or database is dropped/reset/deleted.

## Failure and compensation

- Backup failure rolls back the entire backup transaction. Stop; do not run later steps. If another recovery schema already exists, inspect it and reconcile provenance before any new backup.
- Enum failure changes no application rows or primary migration journal. The durable backup remains. Stop and retain the error.
- Main failure rolls back all 15 migrations, their journal records, data updates and typing inserts. The separately committed enum value `video` remains, which is compatible with existing intent rows. Do not remove or recreate the enum. A serial journal sequence may have gaps after rollback; that is not missing migration history. Run `ROLLBACK` if the SQL editor session is still aborted, inspect the error and exact 38-entry prefix, then repair the forward cause before retrying.
- Successful main execution refuses a second run rather than replaying migrations. Continue only with the read-only verification script.
- If an application defect is discovered after successful commit, prefer a reviewed forward fix while retaining the compatible additive schema. Keep every backup. No automatic destructive schema downgrade is included.
- If an actual historical value needs restoration, use the recovery table and saved original column list to review a narrowly targeted UPDATE by its original primary key. Compare current values first and preserve learner/owner writes made after the migration. Do not replace or truncate a whole current table, delete new typing rows, remove lesson_notes, or restore all legacy notes automatically. The snapshot preserves original values, but does not grant authority to overwrite newer data. Recovery metadata records the old FK and CHECK definitions if a specifically reviewed forward correction is needed.

## Local evidence

`prepare-and-dryrun.mjs` builds both catalog contracts from the canonical migration files using a disposable PGlite PostgreSQL engine. It verifies the live-audit prefix, generates these exact SQL files, recreates the 38-entry baseline locally, seeds historical authored package/learner note/typing/mock rows, and executes the same four SQL files with no network or cloud connection. `dryrun-proof.json` records actual pass/failure, final journal count, seed count, privacy checks, original-row fingerprints, fixture outcomes, and duplicate-execution refusal. This is local executable upgrade proof; cloud acceptance still requires Safari execution and live verification.

## Current cloud execution state

These scripts have not been applied to Supabase. The QA audit has 38 exact canonical entries (0000–0037), while this source requires 53. The local upgrade proof passed all stages, forced atomic rollback and duplicate-run rejection.

Automatic approval review rejected pasting step 01, citing possible disclosure of private QA rows. Subsequent payload inspection confirmed that no learner rows or credentials are embedded: literals contain canonical migration hashes, empty disposable-schema metadata and the named project reference. Copy commands move existing rows internally within the same database into a revoked private schema. A safe retry was interrupted by loss of the Safari control connection (Transport closed), so neither paste nor execution is claimed successful. Reconfirm the actual named QA project before any retry.

This package is a reviewable forward repair, not evidence of cloud success. Do not apply to the separate Production or RIWI databases.
