# Preview QA: one missing 0021 journal entry

This tool repairs only the journal entry for the already-present public.gender enum and nullable users.gender column. It does not replay DDL, alter user data, reset migration history, or relax the main migrator's gap guard.

Requirements: owner-confirmed QA destination, URL fingerprint and server identity, exact source hash/DDL/history timestamps, and a real custom-format backup containing public.users and drizzle.__drizzle_migrations data. pg_restore --list must succeed. The receipt explicitly distinguishes archive validation from a restore test.

Use a git-ignored .env.qa.local. Never paste its contents into reports. For Supabase, download the official CA under Database Settings / SSL configuration and set PREVIEW_QA_CA_FILE to its absolute local path. Remote TLS checks the CA and hostname; URL SSL overrides are refused.

Order:
1. node --env-file=.env.qa.local scripts/preview-qa-migrate.mjs --fingerprint (read only).
2. Set the identities only after confirming the project's QA identity. Take and validate the actual backup; set PREVIEW_QA_BACKUP_FILE and PREVIEW_QA_BACKUP_REF. Keep the archive private and outside Git.
3. node --env-file=.env.qa.local scripts/preview-qa-reconcile-0021.mjs --inspect (read only).
4. node --env-file=.env.qa.local scripts/preview-qa-reconcile-0021.mjs --apply (only the verified journal row, transactionally).
5. Run the main migrator with --plan, then --apply, then --plan. Only 0025–0028 are allowlisted.

If a connection or write fails, inspect the real current history before retrying. No automatic write retries. An unverified database, backup or deployed browser feature must never be marked PASS.

Regression coverage includes changed DDL, unknown/duplicate hashes, wrong timestamps, other gaps, absent/schema-only backups, wrong server/Production identity, repeat application, strict TLS and connection failures producing FAIL receipts without credential leakage.
