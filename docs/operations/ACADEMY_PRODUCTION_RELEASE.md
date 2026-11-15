# Academy production release

This operator command runs before the web process starts. It creates no HTTP
endpoint and sends no external notifications, payments or test records.

```bash
cd /srv/app/services/backend
python -m tools.academy_release \
  --project tuoeabrrnsiuxpjmslxp \
  --account d953f7ff0eedad092d7059969125244d \
  --bucket learners-area
```

## Required configuration

- The existing `DATABASE_URL`, or an explicit `ACADEMY_MIGRATION_DATABASE_URL`,
  must identify the expected Supabase project's `postgres` database on a direct
  or session connection. Transaction-pooler port 6543 is rejected.
- TLS uses the application's verified Supabase CA. SSL bypass is rejected.
- The existing R2 endpoint, bucket and credentials stay inside the runtime.
- `ACADEMY_BACKUP_KEY` is an independent random 32-byte key encoded as 64 lowercase
  hexadecimal characters. Keep this Railway variable separately from R2 archives.
  Preserve it in owner-controlled recovery storage before rotating/removing it.
- `ACADEMY_FEATURES_ENABLED=1` takes effect in the new web process only after the
  pre-deploy gate exits successfully. Set it to `0` to disable the module without
  erasing financial records.
- Use a pre-deploy deadline of 1800 seconds. PostgreSQL tools are version 17 in
  the backend image. No persistent PostgreSQL service or volume is created.

## Release gates

1. Verify all 17 checked-in migration hashes against the private journal. A fully
   installed chain is an invariant-checked no-op. Untracked or partial Academy
   tables stop the command.
2. Export a consistent, read-only serializable snapshot of the application
   schemas (`public`, `drizzle`). Export only role names, never role credentials.
3. Stream the native custom-format dump through AES-256-GCM. The plaintext dump
   is never published on disk. Upload the ciphertext to the existing private R2
   bucket under `operational-backups/academy/`. Download it again and verify its
   SHA-256 before proceeding. Existing backups are never overwritten or pruned.
4. Start a temporary PostgreSQL server bound exclusively to loopback. Restore the
   authenticated archive into a new `learners_recovery_` database. Source row
   counts, constraint count and RLS flags must match the exported snapshot.
5. Apply the real migrations to that restored database and check the journal,
   RLS, revoked direct API grants, finance accounts and balanced journal. Stop
   the temporary server and remove its private files on every exit path.
6. Store the backup manifest (no keys or student records) next to the ciphertext.
   Then apply production DDL and its journal in one transaction, with a five-second
   lock timeout. Existing application row counts must remain unchanged inside
   that transaction. Any failed invariant rolls the whole upgrade back.
7. Log only sanitized progress and the final backup digest, object key, table
   count and verification result. The backup remains durable if rehearsal or
   production DDL fails. Diagnose with the failed stage and schema checks, never
   by printing connection strings, SQL rows or provider credentials.

The existing offline recovery tool restores only to an empty local database.
It cannot restore over production. Recovery needs both the R2 archive and the
separately retained `ACADEMY_BACKUP_KEY`. Platform-managed Supabase Auth, Storage,
Vault and role passwords are outside this application-schema backup.

## Automated evidence

`tests/test_academy_release.py` performs a native PostgreSQL 17 dump, authenticated
restore and 17-file upgrade. It verifies idempotency, API privilege revocation,
existing-row preservation, and that corrupted downloads or a failed final
migration leave the source database unchanged. The storage adapter is a local
file store in this test. Production R2 upload/download verification runs in the
actual pre-deploy command. `tests/test_recovery_backup.py` covers key permissions,
tampering, plaintext authentication, bounded export and restore-target guards.
