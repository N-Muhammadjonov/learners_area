# R04: chat retention operational acceptance

Current owner order (2026-10-11 10:29:23 Asia/Tashkent): publish current verified work in one combined owner-terminal push now, verify remote identity, then prepare original groups 20–25 for another AI. This replaces the earlier requirement to finish R04 before pushing. R04 remains PARTIAL; publishing its locally verified repair does not establish deployed retention acceptance. No hosting change or group-6 work is inferred.

Owner policy remains all messages from the rolling last 30 days, no count cap; strictly more than seven days of authenticated online inactivity deletes chats in day eight for student/teacher/admin/owner. This does not delete accounts or academic records and does not select Speaking retention.

## Candidate repair

A native PostgreSQL multi-connection regression reproduced false `complete=true` while an eligible user's row was held by another transaction. `SKIP LOCKED` returned no deletions, but an eligible chat still existed. The sweep now performs a read-only eligibility check before marking completion. Deferred old messages and expired conversations are also checked. The next successful sweep or a returning user's authenticated presence request performs the deferred deletion under existing locks.

The canonical retention service, machine endpoint, auth identity lookup and presence component are reused. No UI behavior, migration, Vercel schedule, hosting plan, existing database, Production or shared Preview was changed. The original complete 5492dfd8 handoff ZIP is preserved as a previous checkpoint.

## Executed local verification

Candidate source `c4ef35e59b9b41116fc2d0780edc8eaed7e18d98353cc247d1f2fdc6b905120b` contains 1,248 source files. Two full native-enabled rounds on separate fresh PostgreSQL 16.14 clusters each passed 1,476 backend tests and 261 UI tests with zero failures/skips, plus typecheck and lint. Both clusters stopped and both private app process groups were terminated. Source inventory and every source hash were unchanged through the gates and independently rechecked after both rounds.

Each round also passed 13 actual requests against the existing local Next development app: secret denial, anonymous and foreign-origin denial, authenticated late-return cleanup for student/teacher/admin/owner, protected cron apply and idempotent retry. Dry-run fingerprints were unchanged; 101 recent messages, six accounts and the separate completed Listening canary remained intact. The new native tests additionally exercised exact message/inactivity cutoffs, more than one deletion batch, locked rows, advisory-lock exclusion, simultaneous heartbeat/sweep and audit-failure rollback. The UI test covers hidden/offline/unmounted behavior in JSDOM; it is not a deployed browser receipt.

An earlier attempt at this same source had one Node/V8 WASM `SIGTRAP` in an unchanged Speaking integration test: 1,475 backend passes, one failure, zero skips. The isolated retry passed both cases, and the fault did not recur in the two successful full rounds. Its root cause remains unresolved; no product or dependency workaround was introduced. That failed attempt is preserved separately and never counts as a passed round.

The repair changes exactly four source paths relative to the previous `5492dfd8` checkpoint: the retention service, new native retention tests, the presence UI test and the local HTTP QA script. All other 1,244 baseline source files are byte-identical, with no source removals. The patch was applied to the old ZIP's files and its resulting hashes verified. Evidence and diagnostics are indexed in `docs/RIWI-R04-LOCAL-VERIFICATION.json`; raw secret-free receipts/logs are under `docs/evidence/riwi-r04-native/`.

These results establish local repair acceptance. Actual deployed scheduling, physical deletion on the identified hosting target, and authenticated real-browser acceptance remain unverified. R04 stays PARTIAL and earns no additional closed-group credit.

## Exact target required before operational acceptance

A read-only check confirmed branch `arena/01a10bac-learners-area` still points to `2f880809bf57ad3d37c373dc944b28037f20d0a0`; its Vercel status is failure and points to cron pricing restrictions. The configured schedule remains `0 * * * *` at `/api/cron/riwi-chat-retention`. Current official Vercel documentation states Hobby permits once-daily cron and rejects hourly expressions. A later authenticated dashboard read on 2026-10-11 directly confirmed the Learners_Area Hobby badge. Private failure logs remain unverified; the billing-plan observation does not establish the full cause of every failed deployment.

The owner previously deferred hosting/migration work and prohibited inferred shared Preview/Production changes. No authorized isolated hosting target has been identified. Local native PostgreSQL and Next development HTTP receipts cannot substitute for a deployed scheduler or authenticated browser receipt.

## Reviewable operational sequence after the target is identified

1. Record the exact isolated project/deployment and its non-production PostgreSQL identity, source SHA/tree and scheduler resource; keep secrets in platform configuration. Confirm no Production/shared database connection. An isolated deployment of the pinned candidate before the combined branch push requires explicit permission under the existing no-deploy boundary.
2. Verify the canonical migration journal and deployed schema against the pinned candidate. Record that 0049 established the online-clock baseline once; do not reset clocks or reapply migrations to simulate acceptance. Record pre-state and recoverable safety point before any authorized migration operation.
3. Confirm scheduler supports the unchanged hourly expression. Vercel invokes its project production deployment URL; a Preview URL alone is not deployed Vercel-cron evidence. Any dedicated test-project production-label deployment must be explicitly identified and authorized as isolated; existing Learners Area Production remains outside scope. An owner-authorized external hourly scheduler must have a fixed target and the same protected endpoint. Do not silently switch to daily or purchase/upgrade hosting.
4. Configure a platform-managed random `CRON_SECRET` of at least 32 characters and authenticate the scheduler. Do not put its value, cookies, tokens, credentials, or database URL in chat, commits or evidence.
5. Seed only disposable, identified QA accounts/canaries through authorized test operations. Cover all four roles, >60 recent messages, just-before/exact/just-after 30-day and seven-day cutoffs, expired conversation and independent academic/account canaries. Confirm dry-run leaves DB/audit fingerprints unchanged.
6. In actual browser tabs, check visible/online presence, hidden/offline inactivity and closed/unmounted silence. Exercise a returning user after a missed scheduled run. Record persisted timestamp and cascade-deletion evidence with no chat text.
7. Observe actual scheduler executions at the configured schedule, source/deployment identity, endpoint status and returned counts. `locked=false` or `complete=false` is deferred work, not full deletion acceptance. Verify retry drains deferred rows after locks release. Check overlapping heartbeat/sweep and overlapping scheduler invocations on native PostgreSQL.
8. Verify row/FK/account/result integrity, transactional audit and secret denial. Any failed audit must roll back cleanup and online-clock changes. Keep raw logs secret-free and pin receipt hashes to the exact candidate.
9. Mark R04 fully accepted only after mandatory deployed/browser/scheduler evidence passes. Publication is now separately authorized by the latest owner order before full R04 acceptance. Prepare the combined packet from the freshly verified remote base and preserve all prior WIP; the owner performs one non-force terminal push. Verify remote HEAD/blobs, then prepare the requested 20–25 handoff. Do not automatically begin R06.

## Acceptance boundary

R04 remains PARTIAL until the target's actual operational receipts exist. Original-group progress remains 20/34 (58.82%) locally accepted and 19/34 (55.88%) at the last verified publication. Overall RIWI and overall project percentages remain unknown. No commit, push, merge, deploy, production build or final GO is claimed by this document.

Official scheduler references checked on 2026-10-11: https://vercel.com/docs/cron-jobs/usage-and-pricing and https://vercel.com/docs/cron-jobs .

## Read-only hosting discovery on 2026-10-11

The authenticated Vercel dashboard showed one visible project, `learners-area`, in the current Learners_Area team. Its environment list showed Production, Preview and Development, with zero custom environments. This does not establish database isolation or exclude test projects in other teams/providers. No environment-variable secret values were read.

The existing RIWI Preview (`dpl_7tcYprgTUswYfZoi7dz1DauaG3UQ`) was Ready at source commit `e50a2a944f092c695711792b63dbfcf154739c65`. It is older than the freshly re-read remote HEAD `2f880809bf57ad3d37c373dc944b28037f20d0a0` and does not contain this local candidate. Its successful deployment cannot accept the current repair. The Cron Jobs page showed the feature Enabled and onboarding content, with no configured job rows or successful execution receipts observed. No job was triggered.

The exact missing decision is an owner-designated isolated test project/database and an authorized scheduler that supports the unchanged hourly schedule. Existing dashboard access alone does not authorize deployment or shared data changes. Structured observations are saved in `docs/RIWI-R04-TARGET-PREFLIGHT.json`. Product source hashes were rechecked and all 1,248 files still match the passed candidate; no QA rerun was needed for these documentation updates. No deployment, build, commit, push or group-6 work occurred.
