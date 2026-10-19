# Dictionary hybrid release for the current Next.js site

The existing APIs and UI remain in place. Full immutable entry payloads are compressed into 256 UUID-prefix shards in the **existing private** `learners-area` bucket, under `dictionary/releases/<release-id>/`. A new prefix requires the owner's production approval. No bucket, public domain, CORS, or token permission change is needed.

PostgreSQL retains compact entry previews, every canonical sense/example ID, content hashes, EN/UZ search terms, release/shard manifests, mappings, drafts, folders, personal vocabulary and scheduling. Existing JSONB releases remain readable and immutable. New releases do not retain full entry payloads in PostgreSQL.

## Verified starting point

Read-only Railway inspection on 2026-10-19, website revision `51dc6e37d7865138a9bb555e0e549fa08b1dde8c`:

- Correct production project/service/environment and active owner; verified Supabase TLS.
- **No dictionary channel, releases, entries, terms or sense mappings exist in production.** Earlier V1 documentation describes an artifact, not an installed production release.
- 13 existing personal vocabulary records must remain intact.
- Database allocated size: 32,484,499 bytes. Owner confirmed the **Free** plan. Supabase currently publishes a 500 MB database limit; see its [pricing table](https://supabase.com/pricing). The first frozen import fits the measured budget; a complete second search index does not. Owner publication therefore checks available capacity **before** creating a candidate and fails safely when insufficient. No paid upgrade is authorized or performed.
- Existing R2 bucket: 197 objects / 573,157,076 bytes. No `dictionary/` objects.
- Website remains in Singapore. No infrastructure, auth, Arena, content or student progress changes are part of this PR.

Source branch `arena/01a0ffbd-learners-area-dictionary` still points to `64af9c187dee17f2e12eee9b1a4587ab675caa47`. V2 source gzip and raw checksums are pinned in `hybrid-import.ts`; source import additionally checks every public schema, unique canonical IDs, relation targets, CEFR values/counts and exact approved attribution fields against the dictionary repository's `config/public_attribution.v1.json`. Source material and editorial policy are preserved; this integration does not confer a new human review on source content or on Retention's separate AI-authored vocabulary.

## Retrieval, limits and failure behavior

- Search returns at most 20 previews from indexed PostgreSQL data. No R2 request is needed for search. UZ previews prefer the actual matching translation.
- Detailed entries and five-item history hydrate only requested entry IDs, grouping same-shard reads. Cached shard keys include release and checksum.
- Cache: 32 MiB accounted budget, five-minute TTL, LRU eviction; parsed content reserves four times its raw UTF-8 size. At most four cache misses run concurrently. Overload returns a bounded error rather than creating an unbounded queue.
- Each shard: at most 2 MiB compressed / 8 MiB expanded / 2,000 entries; read streams and decompression are bounded. SHA-256, schema, canonical IDs and release identity are verified before use. Failed reads never enter the cache. Cloud reads have eight-second deadlines.
- Server derives every object key. No client URL, arbitrary prefix, signed capability or storage credential enters the Dictionary APIs.
- Conditional immutable uploads (`If-None-Match: *`) are read back and checked. An already existing equal object is accepted for resumability; unequal bytes are rejected. Cloudflare documents atomic conditional writes in its [S3 API compatibility reference](https://developers.cloudflare.com/r2/api/s3/api/).
- A new release is invisible until complete indices, canonical inventories, manifest and all R2 shards verify. Activation takes the existing advisory lock, checks the active owner and expected old channel, then changes the stable pointer and writes the owner audit event atomically.
- Existing owner drafts/publish/rollback work with either backend. Publication copies compact references, hydrates bounded batches for validation, then writes the candidate's own immutable shards before activation. It does not make a complete temporary JSONB copy of an R2 release.
- Existing Reading exam restrictions, restricted Listening phases, Retention attempt/phase permissions, double-click lookup, context resolution, folders, duplicate prevention and SRS remain authoritative. No spelling-only fallback was introduced.

## Reproducible preparation and isolated QA

Use the existing Node 24 runtime/dependencies. Obtain the **original** source gzip and approved attribution file at the pinned dictionary commit.

```sh
node --conditions=react-server --import tsx scripts/dictionary/prepare-hybrid.ts SOURCE.gz APPROVED_ATTRIBUTION.json NEW_PACKAGE_DIRECTORY
```

Preparation validates the full source offline, writes bounded deterministic shards, and prints the release plan SHA. It never accesses production. Runtime import reads one prepared shard at a time; the Railway server does not load the full 200 MB source JSON.

```sh
DATABASE_URL=postgres://postgres@127.0.0.1:55439/learners_qa2 \
node --conditions=react-server --import tsx scripts/dictionary/qa-hybrid.ts SOURCE.gz APPROVED_ATTRIBUTION.json NEW_QA_OUTPUT_DIRECTORY
```

The full QA runner refuses any other database hostname, port or name. Apply migrations to a new isolated native PostgreSQL first. It validates the full frozen source, imports, repeats the import for idempotency, activates only in QA, measures EN/UZ exact/prefix, inflections, phrases, cold/warm reads and concurrent requests, checks exact-sense/duplicate saves and records actual relation/index sizes and plans. Its local S3 HTTP transport is explicitly **not live Cloudflare evidence**.

`tests/dictionary-hybrid-db.test.ts` uses isolated PGlite plus a local S3 HTTP fixture for interrupted imports, unchanged channel, owner checks, sense mismatch, immutable data, owner publication, rollback, missing/corrupt objects and stale activation. `tests/dictionary-shards.test.ts` exercises corruption, decompression/schema/identity validation, coalescing, expiry, eviction and hard concurrency limits. The existing Dictionary/Retention UI tests cover gestures and saved-word behavior.

## Production approval gate and runbook

Do **not** merge/deploy this PR or run a production mutation until the owner has reviewed the exact plan, native QA receipt, current capacity, fresh backup/restore receipt, storage impact and rollback.

`production-hybrid.ts` is separate from the protected local/Preview bootstraps. `--plan` is read-only. `--migrate`, `--import`, `--activate`, `--rollback` and `--cleanup` additionally require:

- exact Railway production project/environment/service and deployed revision;
- active owner ID;
- `DICTIONARY_PRODUCTION_APPROVAL` equal to the reviewed release plan SHA;
- `DICTIONARY_EXPECTED_BASE` equal to the observed base release or `none`;
- `DICTIONARY_QA_RECEIPT` with the same plan SHA and completed native/full-import checks;
- `DICTIONARY_BACKUP_RECEIPT` with this project and the explicit `DICTIONARY_BASELINE_REVISION`, successful restore, and creation within 24 hours.

Controlled order after approval: fresh backup/restore and capacity check → additive `0064_dictionary_r2.sql` migration → deploy compatible code → prepared shard/index import → explicit activation → authenticated real-production search/detail/save QA → error observation. Each import transaction handles one bounded shard; conditional writes and full inventories make interruption/retry safe. Import never activates.

Migration 0064 adds nullable compact metadata columns, allows full payloads to reside in private storage, creates immutable shard metadata, and adds the owner publication offload phase. It does not rewrite existing entries or modify personal vocabulary. The migration runner pins all 64 previously applied migration hashes before applying the single new migration, with a five-second lock timeout. No planned content outage; lock acquisition can fail and must be rescheduled instead of blocking indefinitely.

Rollback normally restores the previous validated release after object verification; user vocabulary/schedules are not deleted. Because this production has **no pre-existing release**, first-install rollback returns the channel to that recorded uninitialized state; imported immutable content is retained for recovery. It does not pretend a V1 production release existed. A failed incomplete import can be cleaned only while unreferenced and unpublished; marking it failed first blocks concurrent resume/activation. Validated/active/previous releases are protected from cleanup.

Automatic approval review initially rejected credential export and an unapproved application-data export. The owner subsequently explicitly authorized a temporary local backup/isolated restore, conditional on the live site having no dependency on the Mac. No connection URL/password was exported. An application backup from revision `51dc6e37d7865138a9bb555e0e549fa08b1dde8c` was restored to separate native PostgreSQL: 138 public tables / 23,808 rows / all table fingerprints and 220 foreign keys matched, including all 13 saved vocabulary records. This is a verified application-schema/data recovery point, **not** a Supabase platform/roles/auth/storage backup. Its private files stay outside Git. The Mac and all QA files are temporary; deployed runtime depends only on Railway/Supabase/R2.

## Acceptance evidence

Populate the final release receipt from executed measurements. Keep code/type/lint/build, isolated PGlite, isolated native PostgreSQL, local S3 transport, production backup restore, live R2, deployment and authenticated production acceptance as distinct statuses. Never label one as evidence for another.

Executed acceptance: see [machine-readable receipt](evidence/dictionary-r2-qa-20261019.json). Full source passed first on empty native PostgreSQL, then on the recent restored production application snapshot. The latter preserved all 13 existing vocabulary records byte-for-byte before creating its separate QA save fixture. Both used the same release-plan SHA. Measured initial dictionary tables including indexes: 393,388,032 bytes (375.16 MiB); prepared R2 shards: 35,800,056 bytes. Estimated production database after first import: about 425.9 MB, against the owner-confirmed Free plan's 500 MB limit. These are measured local PostgreSQL sizes plus the observed production baseline, not a guarantee of identical physical allocation on Supabase. Import and owner publication have explicit capacity checks. A full additional catalog/index will require more capacity; no plan upgrade is performed.
