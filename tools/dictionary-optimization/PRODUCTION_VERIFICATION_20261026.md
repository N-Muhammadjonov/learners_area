# Production Dictionary verification — continuation

Verified on 26 October 2026 UTC / 27 October 2026 Asia/Tashkent. This continues the earlier audit; it does not replace historical evidence.

Production runtime fix: `4c3a3f632b962361d322636304a046a4add94f2e` on `main`. The production Railway deployment and Vercel deployment both reported success, and live smoke checks passed. Legacy cleanup remains BLOCKED. Storage reclaimed: **0 bytes**.

## A. Completion matrix

| Previously blocked check | Result | Actual evidence and remaining limit |
| --- | --- | --- |
| Cloudflare R2 live verification | PARTIAL | All 3,821 protected objects read: 512 shards, 3,307 search objects and two manifests. Compressed/raw SHA-256, strict entry decoding, release identities and PostgreSQL entry/sense/example inventory hashes matched. 129,994 entries checked. Live signed Worker search and entry/range requests passed. Production Worker deployment version, live binding configuration and account-wide cache/error telemetry remain unverified because the available Cloudflare browser account differs from the production R2 account. |
| Authenticated EN/UZ functional QA | PARTIAL | 112 authenticated searches across 14 cases, plus 28 requests with concurrency two, passed. Each sequential case returned the same response hash across eight repetitions; concurrent responses matched. Exact/case/prefix, EN/UZ, phrasal verbs, idiom, collocation, common/rare and empty/missing cases passed. Live examples, multiple senses, synonyms, one Reading occurrence and Retention word/phrase/context selection passed. Complete Listening/Speaking/Writing/Vocabulary workflows and two-identity isolation are not proven. |
| Performance benchmark | PARTIAL | Real current API and signed Worker baselines measured below, with zero cohort errors. No paired before/after storage/performance cutover was performed. Actual cold cache, real mobile network and global Worker error-rate evidence remain missing. The ≤10% p95 comparison gate therefore remains unpassed. |
| Backup and restore | PARTIAL | Full logical database custom archive and role definitions captured through TLS verify-full, checksummed and completely decompressed with pg_restore. Auth tables, dictionary data, functions, triggers, policies/row security and constraints are present. Private backup saved outside GitHub. An isolated full restore has not been verified. |
| Legacy cleanup readiness/rehearsal | BLOCKED | Current active/previous releases are protected and publisher count is zero. Legacy terms are unchanged. Remaining recovery, full parity, performance, administrative telemetry, rehearsal and explicit destructive-approval gates prevent cleanup. The unconditional stop in cleanup.PROPOSED.sql is unchanged. |

Relevant receipts: [R2 verification](evidence/production-r2-verification.json), [API correctness](evidence/production-api-functional.json), [browser smoke](evidence/production-browser-smoke.json), [backup](evidence/production-backup-receipt.json), [gates](evidence/production-gates.json).

## B. Database storage

Before: 2026-10-26 18:58:39 UTC. After: 2026-10-26 19:53:40 UTC. The application remained live. Normal application/QA activity changed allocation; this is not storage reclaimed by optimization.

| Metric | Before | After |
| --- | ---: | ---: |
| Total database | 467,643,539 B (445.98 MiB) | 467,676,307 B (446.01 MiB) |
| Dictionary entry rows, all four releases | 256,986 | 256,986 |
| Active dictionary entries | 65,056 | 65,056 |
| Legacy search-term rows | 1,201,156 | 1,201,156 |
| Legacy search table total allocation | 282,279,936 B (269.20 MiB) | 282,279,936 B (269.20 MiB) |
| Legacy search index allocation | 160,636,928 B (153.20 MiB) | 160,636,928 B (153.20 MiB) |
| Headroom against application 500,000,000 B guard | 32,356,461 B | 32,323,693 B |

The guard headroom is calculated from pg_database_size. It is not a measurement of physical disk/WAL capacity or a claim about provider billing units. The earlier roughly 177 MiB post-cleanup figure remains an estimate, not an achieved result.

Active: `rel-v1-977bce7f8dab7e773955238e`. Previous: `rel-v1-cfadf47e87701f627f3270ce`. Their manifest hashes, entry counts, 219,736 combined sense records and 162,960 combined example records remained consistent. No dictionary content, meaning, translation, identifier, R2 object, grant or policy was changed.

## C. Performance

These rows measure different layers and are **not** a before/after comparison.

| Current measured cohort | Requests | p50 | p95 | p99 | HTTP/functional errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Authenticated production search, sequential, Railway edge totalDuration | 112 | 99 ms | 230 ms | 409 ms | 0 |
| Same search cases, concurrency two, Railway edge totalDuration | 28 | 90 ms | 142 ms | 247 ms | 0 |
| Signed Worker search, observed first pass, operator-to-Worker wall time | 100 | 292.50 ms | 503.42 ms | 541.72 ms | 0 |
| Signed Worker search, repeated pass, operator-to-Worker wall time | 100 | 289.31 ms | 361.56 ms | 446.63 ms | 0 |
| Comparable post-cleanup/optimization cohort | Not run | — | — | — | — |

API edge durations exclude browser last-mile latency. Raw timestamps and durations are in the two API evidence files; request counts exactly match the browser cohort windows. Identifiers, client IPs and cookies are omitted. Worker timings include the operator network/proxy and must not be compared numerically with API edge timings. Neither cohort proves a cold isolate/cache.

No search runtime, Worker or R2 index was changed to produce these baselines. The application change corrects a Retention error path and closes an unsafe legacy fallback. An equivalent healthy pre-fix Retention cohort was unavailable because that path failed with 503. No after measurements were invented. The supplied comparison tool and cleanup gate still reject incomplete paired evidence.

## D. Code, compatibility and production deployment

The live Retention probe found a real defect: `select_sense(sentence, word, candidates)` was called with only two arguments. That caused a TypeError and HTTP 503 whenever an unlinked word produced candidates. The fix passes the original word and existing candidates. It does not create or rewrite a meaning.

The same audit found a third legacy-reader fallback in Retention. SQL terms are now consulted only for an explicitly validated legacy release. A missing Worker index fails closed; an existing index with no route returns no candidates. Authored occurrences continue to take priority. The healthy Worker path adds no registry query.

Runtime files changed:

- `services/backend/app/retention_meaning.py`
- `services/backend/tests/test_dictionary_search_delivery_guard.py`

The operator follow-up adds the bounded read-only R2 verifier, its native-manifest parity/duplicate-identity tests, a read-only PostgreSQL projection query, current evidence and this report. The verifier keeps entry hashes/identity metadata instead of retaining complete dictionary payloads in memory.

84 relevant tests passed before the runtime push. After adding the operator verifier tests, **89 tests passed**, with one upstream deprecation warning and zero failures. [Test output](evidence/production-tests.log). Earlier missing dependency/fixture setup errors were resolved before these successful runs.

Existing API paths and payload contracts, Dictionary/Media Worker configuration, R2 buckets, secrets, release pointers and the Retention frontend/copy restrictions remain unchanged.

Production:

- Branch: `main`
- Runtime commit: [4c3a3f6](https://github.com/N-Muhammadjonov/learners_area/commit/4c3a3f632b962361d322636304a046a4add94f2e)
- Website: https://learnersarea.uz
- Railway production deployment: https://railway.com/project/fa66cadd-5364-47bd-95f9-0689b0562269/service/68f0cfac-8723-40e7-9c3c-52856dc06786?id=f0a721f3-e12d-4d72-90bc-6dbe04e49b23&environmentId=e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a
- Vercel success record: https://vercel.com/learners-area/learners-area/7UphHNrBxkVkayLDxACMkETtHCD4

Live Retention: “fuel” and “filled the tank” returned their exact authored English/Uzbek meanings, compared with PostgreSQL. “family” returned existing sense alternatives without 503. Native copy shortcut did not change a sentinel clipboard; computed user-select remained none. Two authorized browser QA attempts were created and left to the normal timer lifecycle. No progress/attempt rows were deleted and no dictionary word was saved by these probes.

Live Dictionary: “quality time” displayed its existing EN/UZ definitions and paired example. “bank” retained ten noun senses, displayed the river-bank definition and paired examples, and opened existing synonym links. A published General Reading occurrence for “malnourished” returned the exact bound definition/translation. Anonymous search returned 401/private/no-store; invalid direction and stale release returned their existing error bodies.

## E. Recovery and exact remaining blockers

The private package contains `database.dump` (58,276,845 B), `roles.sql` (6,173 B), archive inventory, checksum receipt and restore notes. The packaged file is 57,617,248 B, SHA-256 `8f17aa82579f5c6d18a6385d4d34ea7f06857a30ba49959f60b4e2b463742b08`. No backup data or credentials were committed to GitHub.

The custom archive passed full pg_restore decompression, not merely TOC listing. Role login passwords are intentionally excluded, as in the supported role export procedure; existing private platform credentials/configuration must be retained. A database dump does not include R2 objects. This is a captured backup with verified file integrity, **not proof of a working full restoration**.

1. Production Cloudflare account authorization is needed to inspect the deployed Worker version, exact live bindings/routes, cache behavior and global request/error analytics. The logged-in Google account exposes a different R2 account. No replacement account, Worker, bucket or secret was created.
2. A compatible isolated recovery target is still needed. Local Docker socket access is denied; the existing QA project's contents were preserved. No backup was restored over production. No paid infrastructure was created.
3. Full restoration, application/auth checks and the exact cleanup transaction must be rehearsed in that isolated target. Only then can recovery/maintenance gates pass.
4. A second authorized student/test session and complete live Listening, Speaking, Writing and Vocabulary workflow cases are still needed. The current authenticated active student session cannot prove two-user isolation.
5. A comparable paired production cohort after an actual approved performance/storage change, actual mobile conditions, cold-cache evidence and production Worker telemetry are still needed.
6. Explicit approval of the concrete destructive transaction has not been obtained. It must follow the passing prerequisite gates. No TRUNCATE, DROP, destructive DELETE, trigger disabling, release retirement or cleanup commit was executed.

Historical legacy application-search calls stayed at seven during these checks. Current active delivery is R2 and all three read adapters guard SQL fallback. This observation does not prove every historical/future legacy reader is decommissioned. [Current gates](evidence/production-gates.json) remain BLOCKED.

Pre-existing dictionary mutable-search-path advisories were recorded without changing immutable functions: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

Backup scope and platform requirements: https://supabase.com/docs/guides/platform/backups
PostgreSQL TLS verification: https://www.postgresql.org/docs/18/libpq-ssl.html
