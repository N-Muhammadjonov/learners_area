# Retention audit — Work QA 2

Status: **FINAL QA 2 — IN PROGRESS**. This is implementation evidence for the
activity/cleanup checkpoint, not full lifecycle acceptance. Production cleanup
has not been run, and cloud R2 behavior is **EXTERNALLY UNVERIFIED**.

## Reproduced defects and fixes (2026-09-28)

1. An old account with a recent vocabulary review but a null activity summary was
   anonymised (`active` -> `suspended`). A real isolated PostgreSQL regression
   failed before the fix and passed afterwards. Listening had the same exposure.
2. Cleanup relied only on `users.last_meaningful_activity_at` or registration.
   Vocabulary and Listening did not update the summary. They now do; duplicate
   vocabulary additions and rejected repeat submissions do not refresh it.
3. Summary writes can fail after academic work is saved. Destructive eligibility
   now also checks actual learner-owned records via `hasRecentLearningActivity`.
   This protects legacy work without fabricated timestamps or a backfill.
4. A recently submitted Listening attempt with a 20-month-old start date could
   expire immediately. Work expiry now uses the latest relevant source timestamp
   (submitted/updated/finished as applicable), including recordings. The delete
   also rechecks its age and evaluation/reference protection.
5. `activity_events` contains academic history, not raw RIWI chat. It now follows
   18 months instead of 2. A 3-month review survives; 20-month history expires.
6. Pooled session advisory locks could acquire and release on different database
   connections. One transaction now owns the transaction-scoped lock and DB work.
   Concurrent runner/release behavior is covered against actual PostgreSQL.
7. Failed object deletion previously discarded retryable DB references, and the
   local provider swallowed non-ENOENT failures. Failures now preserve references.
   Own recording upload intents no longer prevent their recording from expiring;
   other resource references still protect it. Cleanup claims compete atomically
   with finalization/attachment. A failed deletion and successful retry are tested.
8. Calendar subtraction clamps UTC month ends; exactly six full months remains
   protected at the boundary, older genuine inactivity expires. Staff is excluded.

## Meaningful activity evidence

| Source | Authoritative evidence used by the cleanup guard |
|---|---|
| Vocabulary | Saved entry creation or `last_reviewed_at`; sentence usage; server points ledger |
| Vocabulary games | Persisted `VOCAB_GAME_PRACTICED` event, even an incorrect answer; never advances SRS |
| Listening | Completed attempt `submitted_at`; staged MCQ work after `listen` |
| Reading | Completed attempt `submitted_at` |
| Writing | Nonempty saved content with submitted/updated date; nonempty typing run |
| Speaking | Attempt `submitted_at` |
| Grammar | Attempt `attempted_at` |
| Assignments | Nonempty response `updated_at` |
| Lessons | Completed lesson `completed_at` |
| TED/video | Progress with actual watch/answer/response content and `updated_at` |
| Live classes | Persisted attendance `joined_at` |
| Mock | `finished_at` |

Login, session refresh, dashboard/page views, teacher feedback, and merely
opening an unfinished Listening attempt do not extend the account clock.
The summary is an optimization/additional signal; it is not the sole authority.
Source-specific clocks still need the remaining lifecycle audit (including video
progress updates and partially recorded Speaking work); this table is not a claim
that every possible concurrent write has been verified.

## Policy and remaining work

| Policy | Current implementation / verification |
|---|---|
| Inactive student: 6 calendar months | UTC boundary + source guard + actual DB/HTTP regression verified locally |
| Raw RIWI messages: 2 months | No persisted RIWI chat table in this phase; do not invent or start V2 |
| Academic work/history: 18 months | Existing attempt/evaluation rules and activity history fixed; exhaustive table coverage remains open |
| Recordings: 18 months | Reference checks and storage-failure retry verified with local provider |
| Security/audit: 18 months | Existing audit rule; broader security-data inventory still open |
| Generated reports: 7 days | No export-object implementation found in this phase; existing explicit no-op, not a proven storage sweep |
| Course/business content | Excluded from ordinary learner cleanup; verify-retention compares content counts |

Remaining: finalized orphan uploads, objects without intents, recording replacement
and attachment races, all history/snapshot tables, index/query scale evidence,
bounded transaction duration, concurrent submission vs anonymisation, recovery and
R2 lifecycle configuration. No migration was created for this checkpoint.

## Evidence

- `tests/retention-db.test.ts`: four actual DB tests, including stale clock,
  old-start/new-submit, six-month boundary, staff exclusion, game/SRS separation,
  genuine eventual inactivity, transaction lock, storage failure and retry.
- `scripts/verify-activity.ts`: 13 actual HTTP/DB checks, loopback + isolated QA
  database guard; fixture cleanup only. Login/start do not fabricate activity;
  completed submission/add do; rejected/duplicate calls do not.
- Fresh broader run: 286 passed, 0 failed, 0 skipped. Typecheck, lint and production
  build passed, including a fresh build and 286-test run after the defensive
  delete recheck. Existing retention HTTP acceptance: 10/10.
- Real browser on the new local build: Listening start -> three answers -> submit
  -> 0/3 analysis. DB confirmed three persisted answers, completed status and an
  activity timestamp at/after submission. Console warning/error list was empty.
- Private/local raw logs live outside Git under `work/qa2-activity-*.log`.

## Derived Grammar privacy

Migration `0019_grammar_source_privacy.sql` adds a durable source owner, backfills
existing linked exercises and installs a trigger so source deletion cannot make
private exercise text public. Local actual DB and 21 HTTP checks pass before and
after source deletion. Source-linked rows created by older application code are
also covered by the database trigger. Already-null legacy source links cannot be
reconstructed without historical evidence. Do not guess their former owner.
This migration is local-only so far; production rollout must migrate before the
new Grammar queries. Retention of the derived private exercise text itself remains
part of the outstanding exhaustive lifecycle coverage audit.

## Fresh recording on an old draft

A further actual DB regression reproduced an old student account becoming
suspended immediately after a new Speaking recording was attached to an old draft.
Attachment now locks/validates the intent lifecycle, attempt and active account in
one transaction and commits the recording plus activity clock together. Persisted
finalized/attached Speaking upload timestamps also protect a missed summary.
Recording expiry consults the current object's actual upload/finalize/attach dates,
including a second reference check after the attempt lock. Unattached old drafts
with a recent finalized recording or an unexpired pending upload are protected
from the old-work sweep. No retention window was disabled or extended forever.

Five actual retention DB tests now pass, including four simultaneous attachment
calls with one winner, account protection, retained attempt and object existence.
Broader automated suite: 288 passed, zero failed/skipped; typecheck/lint/build pass.
No additional migration in this recording checkpoint. Cloud R2 remains EXTERNALLY
UNVERIFIED; the tested storage provider is local. Recording replacement orphan
reconciliation and the separate submit/evaluation race remain open audit work.
