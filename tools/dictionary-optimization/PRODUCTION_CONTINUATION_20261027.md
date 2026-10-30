# Production continuation — 27 October 2026

Continuation of PRODUCTION_VERIFICATION_20261026.md. Production main only; Supabase tuoeabrrnsiuxpjmslxp; https://learnersarea.uz. Recovery continued from main 2c414ca8abf8978004221e38d4aa1e2196b9bbe7. Earlier computer/Safari access loss is resolved. Prior passed R2 object verification and benchmark cohorts were retained without rerunning.

| Previously remaining task | Status | Actual evidence | Remaining blocker |
| --- | --- | --- | --- |
| Authenticated EN/UZ module integrations | BLOCKED | Listening save defect reproduced, fixed, deployed and verified with exact canonical EN definition, UZ translation and example. Writing and Vocabulary checks preserved/completed. Two existing distinct authorized identities tested: foreign study returned not_found; foreign folder returned total=0/words=[] while owner saw total=8. | Production speaking_prompts contains zero rows; Part1 and Part2 both show 0 published topics. Speaking integration cannot be exercised without original authorized published source content. |
| Cold-cache/mobile/comparable performance | BLOCKED | Existing authenticated API sequential baseline 99/230/409ms p50/p95/p99,112 requests,0 errors; concurrent90/142/247ms,28 requests,0 errors. No search-path optimization and no manufactured after cohort. Responsive UI at390/768/1440 verified separately. | No proven cold-isolate condition or actual mobile-network measurement. Cloudflare aggregate telemetry is a different layer/cohort and exposes p90 rather than p95; it cannot prove the <=10% paired p95 gate. |
| Production Cloudflare configuration and telemetry | PASS | Authenticated Safari: active version prefix01a001d5 Ready/100%traffic, DICTIONARY_BUCKET=learners-area, production workers.dev URL enabled,0 custom routes, signing secret present/encrypted/value unread. Last24hours531 invocations,0 invocation errors,0 client disconnects. CPU and request-duration percentiles recorded in separate receipt. Prior protected R2 object verification retained without repeating. | None for inspected configuration/invocation-error telemetry. Full version UUID not exposed in inspected view; prefix is reported. HTTP5xx status breakdown and dashboard p95 were not exposed. |
| Private full backup isolated restore | BLOCKED | Existing private dump/roles/package physically available; fresh SHA256 values exactly match prior receipts. Full archive decompression previously passed and was not repeated. | Docker API socket access returns permission denied. libpq pg_restore/initdb/pg_ctl exist, but postgres server binary is absent. No authorized compatible isolated recovery target; production/default main and existing QA data cannot be used. |
| Legacy cleanup rehearsal and production approval | BLOCKED | Both protected releases validated/r2-worker-v1 with search indexes;256986 entries and1201156 legacy terms preserved;0 running publishers; immutable triggers enabled. Three production readers retain guarded validated-legacy fallback. cleanup.PROPOSED.sql unconditional stop unchanged. | Full isolated restore, missing Speaking QA, comparable cold/mobile performance, complete legacy-reader decommission evidence and isolated guarded rehearsal are unpassed. Exact destructive production approval has not been requested while prerequisites remain unpassed. |

## Storage

The before reading is at10:00:29UTC; after10:14:41UTC. Total index before reading is at10:08:24UTC. These are exact counts/bytes, not pg_stat tuple estimates.

| Metric | Before | After |
| --- | ---: | ---: |
| Database bytes |467717267|467717267|
| Dictionary entry rows |256986|256986|
| Legacy search-term rows |1201156|1201156|
| Legacy relation total bytes (including indexes) |282279936|282279936|
| Legacy index bytes |160636928|160636928|
| All application/auth/storage index bytes (pg_stat_user_indexes) |218808320|218808320|
| Headroom against existing500000000B application guard |32282733|32282733|

Database446.05MiB; storage reclaimed0B. Headroom is an application guard calculation, not a measurement of provider plan disk, WAL or billing capacity. Cleanup executed: NO.

Active release rel-v1-977bce7f8dab7e773955238e and previous rel-v1-cfadf47e87701f627f3270ce remain validated, delivery r2-worker-v1, each with its R2 search-index registry row. Manifest hashes remain3e2f1638bc4127da5fb359093ea97aeacdeebdc2d4d293dc161e174be4ad845c and756134d493381bae1bbf66f3c910f3590da1ef0ad2a8b1b92fcede2229eedfdf. Both immutable triggers remain enabled. All legacy terms belong to rel-v1-a834010a6ccc72c8b3cd8db9;0 active publish jobs.

## Performance

| Layer/cohort | Requests | p50 | p95 | p99 | Errors |
| --- | ---: | ---: | ---: | ---: | ---: |
| Existing authenticated API sequential baseline,26October |112|99ms|230ms|409ms|0|
| Existing authenticated API concurrent baseline,26October |28|90ms|142ms|247ms|0|
| Paired after search optimization |Not run|—|—|—|—|
| Cloudflare last24hours aggregate request duration |531 invocations|118ms|Not exposed|612ms|0 invocation errors|

Cloudflare exposes p90=499ms, not p95. Invocation error rate0% is not an HTTP5xx status breakdown. CPU p50/p90/p99=13.69/34.59/41.45ms. These metrics cannot be compared as a paired API before/after cohort. No dictionary search-path/runtime/storage optimization occurred in this continuation. The confirmed Listening source-membership save bug was fixed; it is not a search-latency optimization. Cold-isolate and real mobile-network performance remain unproven. Responsive browser checks at390/768/1440 do not establish mobile-network latency. The10% p95 gate remains unpassed.

## Confirmed defect fixed and functional results

Listening Vocabulary Builder displayed the correct curated sense but could not save it: published package vocabulary uses word/pos/def rows, while POST expected an embedded senseId. POST now resolves membership using the same authoritative vocabulary_session as the read endpoint. A UUID from another test remains rejected. Canonical meanings, UZ translations, examples and identifiers are retained; the older explicit-sense package contract remains supported.

Live production save/readback of desiccation succeeded into the existing Listening folder. EN definition: “the process of becoming completely dry or losing water”. UZ: “qurib qolish; suvsizlanish”. Example: “One danger is starvation; another is desiccation.” All match the pre-save server-authored DTO. The useful word remains in the authorized account's personal library. No dictionary meaning or ID was edited.

Two existing authenticated identities have distinct user IDs and roles student/owner. The student's own study was visible; the owner received not_found for it. An owner's private folder reported total8 to its owner; the student received total0 and words[]. No credentials, identity details or private folder identifiers are published. This is sampled real endpoint isolation, not an exhaustive authorization claim.

Writing's previously successful canonical pattern save is retained. New source-study controls were tested live:3 circular colour swatches above a selected word, no visible colour names; notes icon aligned under the profile; notes persisted after reload; test note restored to its initial empty state (revision5→7); initial/final highlight list empty; text readable in day/night; both body portals removed on leaving the essay route. Vocabulary readback confirms the new Listening word's source, canonical content and existing folder.

Speaking cannot be marked PASS: production speaking_prompts has0 rows, and Part1/Part2 each show0 topics. No source content was invented, republished or rewritten to manufacture a test.

## UI changes and verification

- Contextual essay highlight palette and route-scoped notes drawer under the profile.
- Remaining Dashboard/Progress/Management meters and weekly Writing/Speaking plots use4.0–9.0.6.0/7.0 lines remain explicit; true scores below4 retain their labels/down marker and table values.
- Previous plus-only Dictionary save, vertical pattern-folder chevron control, inline natural-pixel Writing graph frame and hidden empty Typing result are preserved.

43 focused backend tests and38 focused frontend tests passed,0 failures. Tests cover source membership, foreign UUID rejection, active-exam gate, canonical translation/example preservation, legacy contract compatibility, route cleanup, selection palette and band display. Native asset build passed (490files,119routes). Local390/768/1440 responsive checks use a stub study API; production notes/palette checks use the actual authenticated website. No full-project audit or unrelated test expansion was performed. Original Writing source images were not reconstructed or altered; existing source-image resolution remains an inherent limit.

## Backup and cleanup safety

Fresh SHA256 checks of the physically available private dump, roles and package match previous receipts. Package size57617248B. Database dump SHA2563c18ee44845dfc23d55727c37dfd2ab988b38b3276426681ed07fd7c7028f17d; roles14dfcfc5a4c4575ae29cfafd5505a059fc4934bfcb9189f216175e7bcdcb2b60; package8f17aa82579f5c6d18a6385d4d34ea7f06857a30ba49959f60b4e2b463742b08. No backup bytes or credentials are committed.

Full restoration, restored authentication and rollback remain unproven. Docker socket access is denied; client tools exist but no postgres server binary. No compatible isolated authorized recovery target was available. Production and existing QA data were not used for restore/rehearsal.

Three readers still contain guarded validated-legacy fallback (step17_dictionary_read_port,step26_dictionary_owner_read,retention_meaning). Protected production releases currently use R2. cleanup.PROPOSED.sql and its unconditional stop remain unchanged. No destructive SQL, trigger changes, schema/index removal, release retirement, Worker/R2/secret change or production cleanup occurred. Exact destructive approval is not requested before prerequisite gates pass. Production QA wrote one personal vocabulary entry and a temporary private note; the note was restored.

## Deployment

Verified runtime commit: 31bf99406aa67d6214cf4c1527c093f8f4437115, branch main. Railway production deployment cd9044e5-8cf1-4aa8-854f-9f72c358bbe3 in environment e3d24c78-ca7e-4e3b-89cf-aeb76eaa079a succeeded; Vercel succeeded. /api/version returned this exact commit and environment production. Live production smoke results above were obtained on that runtime. This report may be committed later as a documentation-only successor; its deployment is checked separately.

Runtime/test files changed:
- frontend/vanilla/modules/writing/source-study.js
- frontend/vanilla/modules/writing/writing.css
- frontend/vanilla/tests/writing-study.test.mjs
- frontend/vanilla/js/generated/mock-band.js
- frontend/vanilla/modules/progress/mocks.js
- frontend/vanilla/modules/staff-final30/people-detail.js
- frontend/vanilla/modules/progress/trends.js
- frontend/vanilla/tests/band-display.test.mjs
- services/backend/app/step21_vocabulary_create.py
- services/backend/tests/test_listening_vocabulary_session_save.py

Evidence: evidence/production-continuation-20261027.json, evidence/production-cloudflare-20261027.json and updated evidence/production-gates.json. Only Cloudflare configuration and invocation-error gates are newly closed; all remaining false safety gates remain false.
