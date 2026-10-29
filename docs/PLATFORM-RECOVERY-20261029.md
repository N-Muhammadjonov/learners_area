# Task 12: platform recovery package

**Source and isolated recovery: verified. Production backup activation: pending.**
Do not begin Task 13 until a real production recovery set has been created,
verified and stored separately from the application. The owner confirmed that no
separate full database/media backup currently exists. This package does not turn
that missing backup into a PASS merely by documenting it.

## Current receipts

- Production Supabase backup listing on 2026-10-29: `backups: null`,
  `physical_backup_data: {}`, `pitr_enabled: false`, `walg_enabled: true`.
  The API did not provide a usable recovery timestamp. WAL-G being enabled is not
  proof of an accessible restore point. No production restore was attempted.
- Cloudflare buckets: `learners-area`, `learners-area-dictionary`,
  `learners-area-preview`. No dedicated backup bucket was identified. Production
  media has no bucket-lock rules; its lifecycle only aborts incomplete multipart
  uploads after seven days. It is not a deletion backup.
- Real R2 recovery drill used only an 81-byte synthetic object under
  `learners-area-preview/task12-recovery-20261029-3ab3808/`. A separate copy survived
  deletion of the source and restored exactly the original bytes/ETag. Both test
  objects were then deleted and verified absent. Production objects were untouched.
- Native PostgreSQL 18.6 tools against isolated PostgreSQL 17.6: all **141
  application tables**, **31 populated tables / 167 synthetic rows**, **468
  constraints**, RLS flags and the AI function ACL matched after encrypted custom
  dump and restore. **151 checks passed**. This is a full application schema drill,
  not a copy or certification of the current production dataset.
- Nine targeted tests pass: production/nonempty restore rejection, interrupted
  export, corruption/wrong-key rejection, key isolation, tar traversal and CLI
  secret redaction. Existing Task 11 runtime suite is 3,100 passed; runtime source
  is unchanged and was not needlessly retested.

## Executable tooling

`services/backend/tools/recovery_backup.py` runs offline, outside web/bot startup.
Use an isolated operations environment with `requirements-recovery.txt` and
PostgreSQL clients at least as new as the source server. Production credentials
must be supplied through a private environment/secret store, never command-line
arguments, Git, screenshots or chat.

The tool streams custom `pg_dump` output directly into AES-256-GCM encryption.
Only a complete, authenticated archive is published; existing archives are never
overwritten. The key must be a private 32-byte file outside the backup directory.
Read-only DB sessions, exact source host, verified TLS/CA for remote sources,
connection/statement/overall deadlines and one backup connection are enforced.
R2 objects are streamed into an encrypted tar, using `If-Match` against the listed
ETag so changed/missing files fail the export. Object paths and MIME metadata stay
inside the encrypted archive. No cloud-delete or pruning command is implemented.
At most four downloads run concurrently. Their private unnamed temporary files
are closed on success/failure; free space is checked for the archive, the four
largest objects and a reserve before copying. Tar/encryption writes remain serial.

Restores are restricted to a fresh local `learners_recovery_` database or a new
`learners_recovery_media_` directory. Authentication completes before plaintext
is given to PostgreSQL/extraction. Private temporary plaintext is unlinked and
removed on exit. A fresh local database's empty `public` schema is removed without
CASCADE before its archived definition is restored; populated targets are refused.
PostgreSQL restore uses one transaction and preserves ACLs/RLS. It does not disable
triggers or strip permissions. Media restore only extracts locally, never uploads
over production objects.
An extracted media set has a separate private `.metadata.json` sibling recording
original keys, content types, sizes and source ETags for the controlled upload.
Media archive filenames are opaque SHA-256 names; the encrypted metadata retains
the exact original R2 key, including legal folder markers/repeated slashes. Restore
uses the metadata mapping without interpreting an object key as a filesystem path.

Limits: 32 GiB plaintext per encrypted archive, 10,000 media objects by default.
For larger media, use reviewed disjoint `--prefix` shards and retain a complete
inventory; a prefix archive is explicitly reported as partial scope. A database
larger than this bound needs a reviewed sharded/physical backup solution. Do not
raise limits blindly.

From `services/backend`, after supplying secure configuration:

```sh
python tools/recovery_backup.py init-key --key-file "$RECOVERY_KEY_FILE"
python tools/recovery_backup.py backup-db --expected-host "$BACKUP_EXPECTED_HOST" --archive "$DATABASE_ARCHIVE" --key-file "$RECOVERY_KEY_FILE"
python tools/recovery_backup.py backup-media --bucket learners-area --expected-bucket learners-area --archive "$MEDIA_ARCHIVE" --key-file "$RECOVERY_KEY_FILE"
python tools/recovery_backup.py backup-media --bucket learners-area --expected-bucket learners-area --archive "$MEDIA_ARCHIVE" --key-file "$RECOVERY_KEY_FILE" --apply
```

Database configuration: `BACKUP_DATABASE_URL`, `BACKUP_CA_FILE` and exact reviewed
`BACKUP_EXPECTED_HOST`. The DSN must not contain arbitrary query options; TLS is
fixed separately. Use a reviewed SELECT-only backup identity that can read the
private application tables; ordinary RLS-limited browser credentials are
insufficient. The current web pool is not reused. R2 configuration:
`BACKUP_R2_ENDPOINT`, `BACKUP_R2_ACCESS_KEY_ID`, `BACKUP_R2_SECRET_ACCESS_KEY` using a
bucket-scoped **read-only** source token. Back up the dictionary bucket separately
as well; its immutable release objects are not in the main media bucket.

Record each successful command's JSON receipt (ciphertext SHA-256, size, source
fingerprint/scope) alongside the encrypted files. Keep an independently protected
copy of the key in the owner's recovery vault. Copy completed archives and
receipts to a separate owner-controlled backup destination; a file on the same
application volume is insufficient. No automatic schedule or remote destination
is configured by this source change.

Local verification:

```sh
python tools/recovery_backup.py restore-db --archive "$DATABASE_ARCHIVE" --sha256 "$DATABASE_ARCHIVE_SHA256" --key-file "$RECOVERY_KEY_FILE"
python tools/recovery_backup.py extract-media --archive "$MEDIA_ARCHIVE" --sha256 "$MEDIA_ARCHIVE_SHA256" --key-file "$RECOVERY_KEY_FILE" --target "$NEW_LOCAL_MEDIA_DIRECTORY"
```

`RESTORE_DATABASE_URL` must identify a new local recovery database. The key and
archive receipts must be from the same recovery set. Inspect restored table
counts, constraints, RLS and function privileges, then resolve **every persisted
object key** against the media/dictionary inventory before accepting the set.
Database and R2 snapshots are not one distributed transaction: initial backup
acceptance needs a reviewed write-quiescence window or an explicit reconciliation
of objects created/deleted during the copy. A successful DB dump alone does not
certify media consistency. Test credentials must never contact real Telegram,
email or paid AI services.

## Proposed activation, not yet enabled

Start with an initial verified encrypted recovery set, then one off-peak daily
run and seven retained daily sets. This targets an RPO of at most 24 hours **only
after** the job runs successfully and failed/missing runs are monitored. No RTO is
promised from the small synthetic drill; measure it on an actual accepted set.

Choose a separate private backup destination and approve its storage/compute
cost before activation. A dedicated bucket and separate limited credentials
protect against application-level deletion; a separate provider/account also
protects against loss of the primary Cloudflare account. Seven full media copies
can approach seven times the live data size, so inventory storage before enabling
retention. Do not enable locks on the application's source media bucket or change
normal learner deletion behavior. Any retention lock belongs on the reviewed
backup destination only.

## Recovery order and service degradation

1. Identify the incident, stop further harmful writes through a reviewed incident
   procedure, preserve logs and record the latest accepted recovery set/time.
2. Restore first into a separate environment. Never overwrite production merely
   to test a backup. Restore application schema/data plus required extensions and
   platform roles; this archive covers `public`/`drizzle`, not the whole Supabase
   cluster, Auth service, Storage objects or global role passwords.
3. Restore matching media/dictionary objects under their original keys to a
   separate bucket. Verify references, byte checksums, private permissions and
   expiry/revocation before a controlled cutover.
4. Restore configuration from the owner's secret vault. Keep AUTH_SECRET, bot
   identity/webhook secret, BOT_SERVICE_SECRET, origin-verification secret and
   MEDIA_SIGNING_SECRET mappings consistent across services. Never recover them
   from Git. Rotate credentials after compromise; changing AUTH_SECRET invalidates
   existing sessions. Do not silently replace the existing bot identity.
5. Start DB-dependent backend, verify `/readyz`, then bot `/ready`, then routing.
   Check public SHA and private access before allowing normal traffic. Manual
   learner/device acceptance remains with the owner.

Railway currently marks the Task 11 deployment
`f3a19285-3cd6-4747-9219-f438e222dad7` / SHA
`3ab3808e45ba70188bc6feea384601a8a2a5c1ff` as rollback/redeploy capable. Record fresh
IDs immediately before an incident: provider image-retention limits apply.
Railway rollback restores image **and custom variables**, so verify both; it does
not restore PostgreSQL or R2. The next source-only operations release can fall
back to Task 11 without removing its security fixes.

For migrations, prefer a reviewed forward repair and retain additive schema when
rolling back compatible application code. Do not drop 0071/0072 while runtime or
readiness depends on them. Destructive production restore/migration remains a
separately approved incident action, with target identity and current backup.

Telegram login intents/drafts/processed updates are in the database backup.
Restore their original expiry; do not revive expired or consumed intents or replay
administrative side effects. The Task 10 restart proof still applies. Outbound
Telegram sends with lost acknowledgements can be ambiguous; do not claim
exactly-once external delivery.

Previously verified Task 6 graceful shutdown and Task 11 partial-widget/provider
failure tests cover application restart and bounded degradation. Missing AI or
media must preserve saved educational data, return controlled errors and retain
retry paths; it must not cause a destructive reset.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups),
[PostgreSQL pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html),
[pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html),
[R2 durability and deletion](https://developers.cloudflare.com/r2/reference/durability/),
[Railway rollback](https://docs.railway.com/deployments/deployment-actions#rollback).
