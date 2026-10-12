# Reviewed QA schema reconciliation — 12 October 2026

Target: existing Supabase `learners-area-qa`, project `bpexpsugmuhwmztacbqd`, PostgreSQL 17.6. This package never targets Production, RIWI or Railway.

## Confirmed cloud execution

Safari confirmed the exact 38-entry primary baseline (0000–0037). The durable backup committed 98 public tables and 672 existing rows in private `qa_recovery_20261012`, plus the original migration journal and catalog metadata. All recovery tables ENABLE and FORCE RLS; PUBLIC, anon and authenticated permissions are revoked. The separate enum transaction added `video` safely. Main returned `qa_schema_reconciled`, 53 migrations, 30 canonical Typing texts, zero assignment targets and zero private lesson notes. Independent read-only verification passed; exported CSV contains the exact 53 canonical hashes, 98 backed-up tables and 672 original rows. No authenticated browser acceptance is claimed here.

## Script contract

Execute stages in numeric order only after reconfirming the named QA target. Never rerun backup/main blindly; guards deliberately reject duplicate execution. The exact five file checksums are in `prepared-file-sha256.json`.

1. `01-backup.sql`: locks the existing application tables, rejects altered/missing/extra baseline history or incompatible catalog, commits a durable internal backup with row fingerprints, and verifies RLS on every recovery table.
2. `02-enum.sql`: separately commits the additive upload enum value, requiring the baseline and durable backup.
3. `03-apply-primary-0038-0052.sql`: one transaction applies the 15 canonical primary migrations and original hashes/timestamps, protects all 21 new public application tables with ENABLE/FORCE RLS, rejects client roles that bypass RLS, verifies the final catalog and original-row preservation, then commits. The extra RLS DDL is documented operator hardening in the same transaction; original canonical migration hashes are unchanged.
4. `04-readonly-verify.sql`: independently rechecks journal, columns/defaults/nullability, foreign keys/CHECKs, valid/ready indexes, enums, dictionary triggers/functions, all original-row fingerprints and RLS.
5. `05-export-evidence.sql`: exports only journal identities and table counts/hashes; no learner row values.

PostgreSQL 18 represents NOT NULL in pg_constraint; PostgreSQL 17.6 does not. Catalog comparisons exclude contype n while preserving exact pg_attribute.attnotnull checks for every affected column. The original preflight correctly failed before backup creation; the revised contract passed locally and in the live backup/main stages.

## Authored data changes

0040 adds legacy_runtime classification while preserving original package payloads. 0049 copies historical notes only when exact text is preserved, clears only identically copied legacy notes and preserves differing duplicates. Oversized notes fail atomically. 0048 creates 30 owner-authored Typing texts and retains historical run/model identity. 0042 preserves historical mock attempts while changing content-deletion behavior to SET NULL. No existing row/table/column is dropped, reset, truncated or deleted.

## Rollback and recovery

Main failure rolls back all 15 schema/data/journal changes; the compatible separately committed enum remains. Preserve every backup. After successful commit, prefer a reviewed forward fix. Do not downgrade the schema, replace current tables, clear new notes, or overwrite newer learner writes. Any exceptional row restoration requires a narrowly reviewed UPDATE by original primary key with current-value comparison.

Local `dryrun-proof.json` proves all stages, a forced late-failure atomic rollback, historical-note/typing/mock preservation and duplicate-run refusal in disposable PGlite PostgreSQL. It is distinct from native PostgreSQL and cloud/browser acceptance. Native PostgreSQL bootstrap on this host is blocked by shmget Operation not permitted.

## App candidate

Runtime source `0f405f41d7d385f07f93cfb8478cec1db4b972e7` is Ready in Vercel Preview at https://learners-area-6ja40cayk-learners-area.vercel.app. Safari /api/version confirms that commit, region sin1 and environment preview. Authenticated manual QA remains pending; /app correctly redirects an unauthenticated browser to login.
