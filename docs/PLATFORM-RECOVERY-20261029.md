# Task 12: platform recovery package

**Task 12 automated acceptance: PASS. One-off encrypted production set verified on
the owner's Mac, separate from the application. Scheduled backups are not active.**
The owner approved the temporary read-only two-bucket token and encrypted backup.
The token was revoked and verified absent after copying; its local credentials
were removed. The separate encryption key and authenticated archive catalog remain
private on the owner's Mac. They must be retained together through a controlled
recovery procedure, with the key protected separately from archive storage.

## Accepted production set

- Actual `public`/`drizzle` custom dump: **59,517,738 encrypted bytes**, ciphertext
  SHA-256 `052c07c1653faf30365eea0e868fe7a3227ab15c7f2831b557652731539ff0cb`.
  Verified TLS and an explicit serializable READ ONLY snapshot were used.
- Restored offline into a temporary network-isolated PostgreSQL container with
  no host ports or persistent data volumes: **141 tables / 378,153 rows / 468
  constraints / 141 RLS tables**. Table ACL/RLS and all seven public functions'
  ACL/security flags match the source fingerprints. Restore plus row counting
  took 60.246 seconds; this is not a full-service recovery-time promise.
- R2: **8,116 media objects / 1,305,326,365 bytes** plus **5 Dictionary objects /
  28,824,814 bytes**, across 17 authenticated shards. Every object was hashed after
  decryption. A final source inventory found zero missing/changed/extra objects.
- The database reference scan covered 49 candidate tables / 338,412 rows / 718
  references. It found 194 distinct R2 objects and one old local-upload audio
  reference belonging to an inactive Listening item. R2 did not contain that
  object. Two local originals match the database-recorded filename and 16,450,918
  byte size and have identical SHA-256. One was archived as an explicitly separate
  local-original supplement and its local extraction/content hash verified.
  The historical server checksum was not recorded; the owner retains manual audio
  identity acceptance. Production data/R2 was not changed to conceal this gap.
- The accepted catalog covers 38 payload/manifest archives plus its own encrypted
  catalog. Referenced backup objects total 195; no unresolved reference remains
  after including the documented local-original supplement. The plaintext
  production restore was removed with its temporary container.
- A temporary-CLI export path stopped with `PQgetCopyData() failed` / `SSL
  connection has been closed unexpectedly`. Failed/unfinished exports were not
  accepted. The verified existing service connection completed the accepted
  export. Temporary/operational connections and stale partials were cleaned up;
  source database configuration was unchanged.

No daily scheduler, off-device key-vault copy, whole Supabase-cluster restore or
production recovery was performed. Those are distinct from this verified one-off
application recovery set. RPO is not promised until a scheduled policy is active.

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
- Fourteen targeted tests pass: production/nonempty restore rejection, interrupted
  export, corruption/wrong-key rejection, key isolation, tar traversal and CLI
  secret redaction, exact flat-key preservation, interrupted-stream retries and
  disjoint shard coverage. After reconciling current main's retired Writing
  fixtures and missing Vocabulary route manifest, the current backend suite is
  **3,057 passed**. Frontend: **1,168 passed / 11 skipped**; native build and backend
  check pass. The 13 backend failures and one Vocabulary UI failure were reproduced
  against exact read-only main `f46da15d1e38512bba49c05b5245234fc355cd6f` before repair.
  A 12-check PostgreSQL HTTP probe verifies the selected-delete alias's ownership,
  mixed-ID atomic refusal, authentication, CSRF and acknowledged deletion.

## Executable tooling

`services/backend/tools/recovery_backup.py` runs offline, outside web/bot startup.
Use an isolated operations environment with `requirements-recovery.txt` and
PostgreSQL clients at least as new as the source server. Production credentials
must be supplied through a private environment/secret store, never command-line
arguments, Git, screenshots or chat.

The tool streams custom `pg_dump` output directly into AES-256-GCM encryption.
Only a complete, authenticated archive is published; existing archives are never
overwritten. The key must be a private 32-byte file outside the backup directory.
Explicit READ ONLY serializable snapshots, exact source host, verified TLS/CA for remote sources,
connection/lock/overall deadlines and one backup connection are enforced.
The default overall dump deadline is 900 seconds. For a reviewed slow one-off
export, `--overall-timeout` can raise it to at most 3,600 seconds; the 300-second
statement timeout is requested at connection startup, but native pg_dump resets
statement/transaction timeouts internally. It must not be reported as an enforced
per-query bound during dump. The external deadline, 10-second lock/connect limits,
verified TLS, read-only startup, size ceiling and atomic publication remain.
See the [PostgreSQL implementation](https://github.com/postgres/postgres/blob/REL_18_STABLE/src/bin/pg_dump/pg_dump.c).
R2 objects are streamed into an encrypted tar, using `If-Match` against the listed
ETag so changed/missing files fail the export. Object paths and MIME metadata stay
inside the encrypted archive. No cloud-delete or pruning command is implemented.
At most four downloads run concurrently. Their private unnamed temporary files
are closed on success/failure; free space is checked for the archive, the four
largest objects and a reserve before copying. Tar/encryption writes remain serial.
Disconnected response streams retry the same object at most three times using
the original ETag; integrity/permission failures still stop the export. Optional
`--shard-count N --shard-index I` partitions keys by SHA-256 modulo N (1–64 shards).
Retain every shard's receipt and encrypted manifest. Resume only completed archives
whose ciphertext checksums match; never overwrite or accept an unfinished shard.

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
For larger media, use the deterministic shard options or reviewed disjoint
`--prefix` shards and retain a complete inventory. A single shard/prefix archive
does not represent the complete bucket. Reconcile their union against a fresh
source inventory before acceptance. A database
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

## Proposed recurring activation, not yet enabled

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

Historical Railway receipt (2026-10-29): Railway marked the Task 12 follow-up deployment
`e3509bad-c02d-4f6a-b8df-73aa4b2d1f0f` / SHA
`7cab6ad233ab5557f0323ba2c4de943ef1bbd4ec` as rollback/redeploy capable. Record fresh
IDs immediately before an incident: provider image-retention limits apply.
Railway rollback restores image **and custom variables**, so verify both; it does
not restore PostgreSQL or R2. The next source-only operations release can fall
back to that release if the provider still retains it. On 2026-11-01 the owner
reported deleting that Railway account and temporarily moved the web application
to Vercel. The old deployment ID is historical evidence, not a currently usable
rollback target. The Telegram bot remains separately hosted/offline until restored.

On Vercel or another host, retain the previous tested Git SHA and its deployable
Python/container artifact plus the matching secret/configuration version before
releasing. Rebuild/redeploy that compatible version if a provider rollback is
unavailable. Restore no database/media merely to roll back application code.
Record fresh `/api/version` and `/readyz` results after restarting. A new domain
requires host-only cookie sign-in again and reviewed callback/CORS settings;
copying an old Railway origin-verification secret without its matching edge
route can block access. See [portable deployment](DEPLOYMENT-PORTABILITY.md).
This recovery set and its isolated tools are independent of the web host; its
original archive/key/catalog must remain protected together under owner control.

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
