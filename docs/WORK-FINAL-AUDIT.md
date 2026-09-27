# Independent QA 2 — work in progress

Baseline verified 2026-09-27: GitHub connector branch listing returned
`arena/01a0cf7b-learners-area` at `ad21acc29491ec64a7254d24f6cfdfa1dc25cb5f`.
Production `/api/version` independently returned the same SHA, `sin1`,
`production`. Work branch: `work/final-qa2-hardening`, separate clone.
The user's Desktop checkout and its modified import report were preserved.

## Evidence and scope

- Retrieved all 333 turns of the referenced conversation (34 pages). Latest
  user requirements supersede earlier instructions. Private context is outside Git.
- Inspected all 23 screenshots in `news.zip`; only original Learners Area code
  is used. Booster images are clean-room interaction references only.
- Baseline unit suite independently reproduced: 265 total, 262 pass, 3 skip.
- Safari's existing production tab initially displayed digest `3152247017`.
  Reload recovered; authenticated Dashboard and Audit subsequently rendered.
  This is evidence of an observed error, not proof of its root cause or repair.
- Production audit lists `support.reported`, matching the user's report that a
  message was submitted. Inbox visibility and replies require separate testing.
- Local PostgreSQL startup is currently blocked by macOS sandbox `shmget`.
  A loopback-only workspace database launcher is prepared for the user to run.
  No production credentials, migrations, seed, or cleanup have been used.

## Initial root-cause matrix

| Finding | Code evidence | Required verification |
|---|---|---|
| Navigation waits without feedback | No loading boundary; prior performance document explicitly deferred it based on localhost | Delayed RSC navigation in browser, then remote timings |
| A dropped request can wait indefinitely | `requestJson` has no deadline; body-read failures become empty successful responses | Stalled headers/body and aborted request tests |
| Notifications never become read in UI | Inbox only renders; existing POST mark-read endpoint is never called there | Read specific visible items, persist, badge and second-tab refresh |
| Reading search needs a button; clear only changes input | `ReadingFilters` state is disconnected from route until link click | Type, delete, clear, history, combined filters |
| Lookup uses personal vocabulary only | `ClickableText` searches saved words and asks for definitions | Canonical contextual lookup and ownership-safe save |
| Popover is below the entire passage | `absolute left-0 top-full` | Word anchoring, collisions, scroll, mobile |
| Support lacks learner history/replies | `problem_reports` + resolve button only | Atomic submit, deduplication, staff reply, learner visibility |
| Audit limited but not paginated | `listAudit(80)` | Cursor pagination, invalid cursor, refresh and recovery |
| Retention calendar and lock hazards | `setMonth` overflow; session advisory lock via pooled execute | Month-end/leap-year and concurrent cleanup tests |

## Remaining acceptance

All product areas in the supplied QA2 requirements remain open until their
implementation, integration/browser evidence, responsive/localization checks,
and architecture/retention evidence are recorded. No final QA2 pass is claimed.
RIWI V2, Dictionary implementation, main merge and production promotion are excluded.

## Checkpoint resumed: request transport verified (2026-09-27)

Existing changes were present; the recovery patch was NOT reapplied. The request
helper retains the shared API result shape and performs no retries. Its 25-second
default covers headers and body; caller cancellation remains separate, invalid
custom deadlines fall back safely, and listeners/timers are released. A timeout
cannot undo a server write. Current callers are short auth/admission/search/support
and attempt-creation requests, not AI generation or media uploads.

Fresh post-edit evidence: `npm test` 271 total / 268 passed / 3 skipped / 0 failed;
`npm run typecheck`, `npm run lint`, `npm run build` passed. Six new transport
regressions cover stalled headers, stalled body, interrupted body, caller abort,
pre-aborted signal and resource cleanup. This does not establish browser speed
or DB integration correctness. Production and local DB remain unchanged.
