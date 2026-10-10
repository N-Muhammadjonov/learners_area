# Batch 18: atomic scheduled Vocabulary review

Continue from published `0524512a40f24a1d38e26f1728e247248916107b` on `arena/01a10bac-learners-area`. The preserved candidate was not restarted, reset or rebuilt. The native published checkout remains unchanged.

## Reproduced defects

The previous review service read the due word before its writes and saved schedule, activity and points separately. An isolated database seam, with the production default unchanged, allowed the old behavior to be tested without connecting to an unknown database. The six-test baseline had two passes and four failures.

- Rejected activity insertion left the schedule advanced.
- Rejected point insertion left partial schedule/activity evidence.
- Competing reviews consumed the same due slot twice.
- Forged extra service fields were accepted.

The baseline did not reproduce lost sentence-use mastery. The concurrent review/sentence assertion is a regression boundary, not a claim of an observed baseline failure.

## Resulting behavior

The service validates its input before opening a transaction, locks the active actor and owned word, and checks the current due slot under the lock. It commits the schedule, monotonic meaningful-activity timestamp, activity event and existing one-point review award together. A rejected write rolls everything back. A retry can consume the original slot once. A later duplicate receives `not_due`.

The actor lock is acquired before the word lock. An exclusive actor lock avoids concurrent shared-lock upgrades when updating the activity timestamp. This serializes reviews by the same actor. Sentence confirmation keeps its existing actor-before-usage-before-word order and cannot overwrite an obsolete review snapshot.

The HTTP body accepts only `outcome`. Client-selected time, points, stage and identity are refused. The authenticated route maps invalid input to 400, inactive actor to 401, missing/foreign word to 404 and an unavailable due slot to 409.

The existing 1/3/7/16/35-day ladder and one-point award for either recall outcome remain unchanged. A valid `now` is available only to trusted server callers and isolated fixtures. The endpoint does not accept it.

## Evidence and limits

Seven added regressions cover strict HTTP/service input, rollback of event and point failures, retry/due-slot fencing, review alongside accepted sentence use, ownership/account status, exact due boundaries, all existing intervals and monotonic activity time. The native PostgreSQL point test was extended with eight competing reviews and sentence confirmation without adding a skip or weakening any existing assertion.

Focused final run: 49 total, 44 pass, 5 skipped, 0 fail. PGlite concurrency is not independent native PostgreSQL connection acceptance. The five native cases remain unverified because a native PostgreSQL server is unavailable. Full exact-source non-build gates are recorded separately in `RIWI-BATCH-18-QA-RESULTS.json` after completion.

No migration, production database write, object deletion, live-provider call or hosting change was performed. The owner deferred hosting work while planning a move from Vercel. Chat and Speaking retention policies were not changed. Other Vocabulary writers are outside this transaction repair.

## Progress

Original remaining-prompt closure remains 17/34 = 50%. This repair contributes zero new fully accepted groups. Six additional complete groups are still required for the requested 17.65-percentage-point increment. RIWI-wide and project-wide percentages remain unknown without reconciled denominators and acceptance evidence. Native/source-bank/live-provider/browser/restore acceptance remains open.
