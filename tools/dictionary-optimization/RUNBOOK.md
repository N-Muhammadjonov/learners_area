# Dictionary maintenance runbook

Status: the owner explicitly authorized merging the prepared code into main on 26 October 2026. Production database cleanup remains blocked until backup, live QA and separate destructive-operation approval are complete. Run operator commands from tools/dictionary-optimization in an existing full checkout.

## Source and patch

The code merge is based on main at adb66249b36517d401d57c5987b9d14e4f9e329f. The discovered arena/learners-area-next branch remains at ba1671c724da389ba373e494d71241230500afb9. The owner directed this change to main. Review any new main drift before merging; preserve existing preview work. No preview reset, force push or unrelated branch merge is part of this change.

The runtime patch adds three lines to each of two read adapters. Existing worker traffic follows the same query path. A missing index permits SQL fallback only for a validated legacy release. Worker, building and retired releases fail closed. To revert that code change after any approved deployment, revert the two-file read-adapter change in this commit. The code rollback does not reverse a later data cleanup.

## Required evidence before cleanup

1. Reauthenticate the existing Railway connection through its normal login flow. Its saved access token is expired. Keep credentials in the existing private runtime. Do not paste credentials into this chat, create replacement secrets or reset the database password.
2. Run operations/audit.READ_ONLY.sql against production tuoeabrrnsiuxpjmslxp. Confirm current active/previous manifests and no running publisher. Refresh captured evidence if any state changed.
3. Obtain a recovery-grade database snapshot through the supported Supabase backup mechanism or a reviewed full schema/data/roles export. Preserve policies, functions, triggers, extensions, auth data and the required platform encryption/configuration material. A dictionary manifest export alone is insufficient. Save the backup privately and record checksums, version and capture time in a receipt without embedding user data or credentials in this package.
4. Restore into an explicitly approved isolated QA target that supports the same Supabase/Postgres features. The existing QA project is bpexpsugmuhwmztacbqd; its existing contents must be protected. Do not reset or overwrite it without separate approval. Verify row inventories, constraints, RLS, auth behavior, active/previous pointers and dictionary read/publish/rollback operations. No local PostgreSQL restore was possible in this session: PostgreSQL client/server binaries were absent and Docker access was denied.
5. Capture deployed Dictionary Worker version/configuration and private R2 inventory/checksums. The repository config is included; live Cloudflare version/access is still required. Export existing configuration securely, without exposing secrets. Do not create a Worker, bucket or D1 database.
6. Run the read-only R2 verifier using the existing backend environment. It reads every protected shard, checks every entry's hash and sense/example identities against PostgreSQL, verifies every search object's compressed/raw hash and rechecks channel/publisher drift at the end. It writes only the local evidence output:

```sh
LA_REPO=/existing/learners-area python3 scripts/dictionary_optimization.py inventory --inventory evidence/manifests.json.gz --out evidence/inventory-check.json
python3 scripts/dictionary_optimization.py verify-r2 --repo /existing/learners-area --inventory evidence/manifests.json.gz --out evidence/r2-check.json
```

Use the existing backend dependency environment. The verifier requires its existing DATABASE_URL and R2 variables. Its reported logical read calls do not include SDK retry traffic; obtain actual R2 request counts separately from Cloudflare telemetry. Refresh the snapshot before running if live manifests changed.

7. Run authenticated EN/UZ search, detail, autocomplete, variants, idioms, phrasal verbs, empty/invalid inputs, release mismatch, owner/editor and user isolation checks. The supplied 24-case search cohort is a starting cohort. Validate complete expected ordering/translations through the canonical native index and full entry fixtures. Current APIs return a fixed top 20 search results; they have no pagination cursor to migrate. Do not add one.
8. First rehearse cleanup in the restored isolated QA environment and collect paired before/after metrics there, using identical data, network, region and device cohorts. That paired evidence is required before production approval. Then capture the production baseline and, after any approved production cleanup, measure production again. Keep an existing production student session in LA_EXISTING_SESSION_COOKIE. For QA, set LA_APPROVED_QA_ORIGIN to its verified HTTPS origin and use the separate LA_EXISTING_QA_SESSION_COOKIE with the --api-base and --cookie-env options. The benchmark rejects sending the production session to QA. It stores response hashes, status and timings, without cookies or response payloads:

```sh
python3 scripts/dictionary_optimization.py benchmark --cases fixtures/queries.json --release rel-v1-977bce7f8dab7e773955238e --stage before --cohort desktop --network same-runner-region --out evidence/before-desktop.json
```

Use the corresponding stage after command only after an actual approved change, with identical release, cohort, network and queries. Repeat the mobile cohort. Compare with the compare subcommand. Require at least 100 samples per observed temperature, zero parity failures, no increased error rate and p95 at most baseline × 1.10. The first pass does not prove an empty isolate/CDN cache. Confirm cold starts and Worker errors from actual telemetry; do not flush production caches or redeploy to manufacture a cold run.

9. Create independently reviewed JSON evidence receipts in evidence/attestations.json, referencing existing artifacts and their SHA-256 hashes. Run the gates command. A missing artifact, altered artifact or missing approval remains BLOCKED. Fixture PASS results cannot stand in for live production evidence.

```sh
python3 scripts/dictionary_optimization.py gates --audit evidence/audit.json --inventory-result evidence/inventory-check.json --attestations evidence/attestations.json --out evidence/gates.json
```

## Proposed cleanup and risk

The review copy operations/cleanup.PROPOSED.sql begins with an unconditional exception. It is intentionally not executable as a maintenance operation. Replace that stop only in a separately reviewed revision after every receipt is approved and the owner explicitly authorizes the exact destructive action.

The proposed operation acquires the publisher's existing transaction advisory lock 387384, pins control metadata, verifies release/count/dependency drift, retires only the unprotected legacy release through the existing guarded registry transition, then truncates only dictionary_search_terms with RESTRICT and CONTINUE IDENTITY. Retain its structure, indexes, FK, immutable trigger and RLS. Keep all dictionary_entries, sense mappings, stable and previous releases. Do not use CASCADE, disable triggers, change secrets or delete R2 artifacts.

Expected storage reduction is approximately 282,279,936 bytes less the empty relation overhead. The real result must be measured after commit. TRUNCATE needs ACCESS EXCLUSIVE on this table; existing reads/writes may block briefly. The draft aborts if lock acquisition exceeds 2 seconds or the statement exceeds 30 seconds. Actual lock duration/downtime is unmeasured and must be rehearsed. Its control-table locks also pause publisher/activation writes during the transaction. Existing worker reads continue to use the protected immutable releases.

DELETE in small batches is the alternative when the table ceases to be wholly obsolete. It leaves file allocation in place until an appropriate reclaim. VACUUM FULL rewrites the table and needs exclusive locks and extra disk capacity. Never switch strategies automatically after a preflight failure.

## Rollback and monitoring

Before COMMIT, rollback the transaction on any failed invariant. After a successful cleanup, the retired registry row cannot be unretired through the existing trigger. A data rollback therefore requires the verified full recovery procedure into the approved QA/recovery target followed by an explicitly approved database cutover. A term-only INSERT/COPY rollback into the retired release would be rejected. Do not promise a quick in-place unretire or bypass its trigger.

For dictionary availability, the protected previous R2 release remains available through the existing guarded rollback operation. Validate that rollback in QA; do not flip production channels just to test it.

After an approved cleanup, compare the recorded database size, term count, entry/mapping inventories, API response hashes and p50/p95/p99 immediately and for 0–15 minutes. At 1 hour and 24 hours, repeat error, latency, R2 usage, cache and user isolation checks. Schedule those checks only when the actual cutover time is known. Any missing object, EN/UZ mismatch, backup/restore failure, publisher activity, increased 5xx or p95 regression stops the change.
