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

## Portability phase and resumed product work (2026-09-27)

Remote re-fetched: Arena still ad21acc29491ec64a7254d24f6cfdfa1dc25cb5f;
Work remote 6d6db862f7dc2f3f85a0c2745985b73662a44855 before this phase. The first
transport checkpoint was pushed and verified. Existing WIP was preserved.

Portability changes and operational boundaries are in DEPLOYMENT-PORTABILITY.md.
No application runtime links hard-code the Vercel production domain. Origins are
validated centrally, CSRF compares scheme/host/port, framing requires an explicit
allowlist, preview metadata/robots/sitemap avoid indexing, storage misconfiguration
fails closed, and generic build identity is configurable. A discovered P0 raw
password-reset-token response was closed in Work. Email reset delivery is not yet
implemented and remains an open product requirement; this code is not promoted.

Fresh verification at this checkpoint:

- TypeScript and ESLint passed; production build passed after the final proxy
  origin change. Node 24.21.0 / Next 15.5.26.
- Real isolated PostgreSQL on loopback 55432, database learners_qa2: base
  migrations and demo seed applied locally only. Full current suite: 279 passed,
  0 failed, 0 skipped. Earlier DB-unavailable failures were ECONNREFUSED; after
  the user's restart the suite was rerun successfully, not relabelled as passed.
- `scripts/verify-portability.mjs` passed against `next start` on port 3101,
  PUBLIC_BASE_URL=https://portable-qa.example, APP_ENV=preview, no Vercel runtime.
  It checked canonical/noindex, robots/empty sitemap, reset-token protection,
  scheme mismatch rejection, real login, host-only cookies, direct/repeated
  dashboard/reading/notifications rendering, staff-page denial with no report
  content leaked, and generic version metadata. APP_COMMIT_SHA in that server
  was a synthetic test label, not a claim of a deployed Git commit.
- Real in-app browser: local seeded student signed in and dashboard survived
  hard refresh. Screenshot saved outside Git: outputs/qa2-node-hard-refresh.png.
- Browser before portability: Reading live search changed URL and results without
  submit; Clear restored the original list. Notification badge 3→0 after reading
  visible inbox entries; persisted state was reflected on reload. Cross-tab and
  full viewport coverage remain open.

Product WIP preserved outside the portability commit: actual router pending
indicator, route loading boundary, outer layout error boundary/storage-safe error
recovery, notification read flow/badge, Reading live search/clear, deterministic
ordering and question count correction. PostgreSQL exposed a separate real bug:
Drizzle removed the outer-table qualifier inside the SELECT subquery, comparing
q.passage_id to q.id and returning 0. Explicit outer reference now produces the
correct count; a DB regression tests two independent passage counts (2 and 1).

`scripts/verify-support.mjs` previously reported 25 pass / 1 fail. The failing
check expected a 30x HTTP code on a student request to a staff page. With a loading
boundary Next may stream a 200 followed by its redirect; the independent Node
portability check confirmed redirect and no report leakage. Update that older
verification to assert actual denial semantics before counting it as passed.
Support replies/composer improvements themselves remain unimplemented.

Performance is NOT accepted from these local results. No full remote browser
click-to-content distribution has been collected. Full product hardening,
retention/lexical/data lifecycle fixes and final three-gate QA remain unfinished.
No production DNS, credentials, database, storage, promotion, main merge, Telegram
branch, RIWI V2 or Dictionary implementation was changed.

## Search, Reading and notification checkpoint — 2026-09-27

- Browser reproduction before the search change: one Ctrl+K opened **two** dialogs because Topbar mounted both desktop and mobile controllers. One shared controller now owns the two responsive triggers. Confirmed one dialog after rebuild, two real results for `study`, clear returning zero results, Shift+Tab wrapping to Close, and Escape closing it. Stale requests are aborted and checked before publishing results; loading no longer retains selectable old hits.
- Reading now searches while typing (300 ms debounce), clears immediately and restores the original URL/order. Filter links cancel the draft timer and synchronise the input even when the server query did not change. Browser verified `zznomatch` -> 0 passages -> clear -> original one seeded passage.
- Found a real SQL correlation defect: Drizzle dequalified the outer passage id in SELECT subqueries, making question and hub attempt counts compare against the inner row id. Explicit outer references plus real DB regression assertions fix it. Browser now shows the seed passage's **6 questions**, not zero. Pagination now carries the `q` parameter instead of the internal name `query`. Cards start fetching concurrently with hub counts/facets after authorization.
- Notifications: empty ids are a no-op, writes are recipient-scoped and preserve original read timestamps; only visible inbox rows are automatically read. An explicit mark-all action remains. Badge updates across the current tab and visible sibling tabs; count-only refresh avoids fetching the whole inbox. DB tests cover recipient isolation, idempotence and empty requests. Prior browser evidence verified 3 -> 0 and reload persistence.
- Navigation links expose pending feedback, app routes stream an accessible loading state, and a root route error boundary catches layout failures. Error recovery tolerates unavailable sessionStorage.
- Actual 320 px screenshot exposed overlapping menu/search and clipped profile controls. The header now has two rows below lg. Checked Reading at 320/390/768/1024/1440: all visible topbar controls fit inside the viewport, no document horizontal overflow. This is shell/Reading coverage, not a claim that every product screen is responsive.
- Fresh validation of this workspace: typecheck and lint passed; production build passed; **279/279 tests, zero skipped**, including isolated PostgreSQL integration tests. The strengthened Reading test first revealed a fixture cleanup FK ordering error; cleanup was fixed and only those fixture rows were removed, then the suite passed.
- Support HTTP acceptance: **26 passed, zero failed**. The guard assertion now accepts an actual Next streaming redirect while also asserting that neither the report id nor its message was disclosed. No authorization rule was weakened.
- No new migration in this checkpoint. No production deployment, production data mutation, DNS or hosting change. Overall user-perceived production performance, full lexical/retention architecture and the full product matrix remain open. FINAL QA 2 has not passed.

## 2026-09-28 resume: diagnostics and measured regression fix

Recovered HEAD `67c74038a2f23132c6adbebc03543449cadf292e`, no newer commits.
Preserved the unfinished diagnostic and retention/storage changes; no patch
reapplied and no reset/stash/clean/checkout used.

Performance diagnostic now measures T0/T1/T2, reports their differences and is
explicitly blocked on production deployments. Real repeated browser evidence
identified an approximately 300 ms fallback delay caused by the newly added
blanket app loading boundary. Removed that boundary, preserved Link pending
feedback and added it to the notification bell. Same five-route browser sequence:
15 samples before median 338.1 ms, 15 after median 43.0 ms. Full methodology and
per-route values are in PERFORMANCE-AUDIT.md; production remains EXTERNALLY
UNVERIFIED. Search and local support-send timings also recorded.

All eight requested shell widths fit with no overlap/overflow (320, 360, 375,
390, 393, 768, 1024, 1440). At 320, search and profile panel interactions and
keyboard containment passed. This is not all-screen mobile acceptance.

Production build, typecheck and lint passed on the current working tree.
284 automated tests passed with real local DB (zero failures, zero skipped),
including two new real retention/lock/object-failure tests. Retention source
changes are a separate unfinished checkpoint; those results do not mean the
entire data-lifecycle audit is complete. No migration or production action taken.

## 2026-09-28 activity/retention continuation

Recovered branch work/final-qa2-hardening at 9a8210a; GitHub still reports that
Work HEAD and Arena ad21acc. Preserved all seven unfinished retention files;
no reset, clean, stash or patch replay. Latest attached continuation request read.

Reproduced active Vocabulary learner being anonymised when its summary activity
clock was null. Fixed destructive eligibility to consult real stored work, updated
Vocabulary/Listening clocks, persisted game practice separately from SRS, protected
recent submissions with old start dates, and preserved storage failure retries.
See RETENTION-AUDIT.md for precise coverage and remaining risks.

286 tests passed (0 failures/0 skipped), typecheck/lint/build passed. New actual
HTTP activity suite: 13/13. Real browser Listening submission displayed 0/3;
DB confirmed three answers, completed status and activity clock updated. Browser
console had no warnings/errors. A tool click timeout was resolved by observing
the successful result, not by submitting again.

Production: Reading/Vocabulary/Listening navigation rendered, but exact in-page
T0/T1/T2 measurements are still unavailable and deployed SHA is null. Existing
production Reading still displays 0-question cards. No promotion/migration/
production cleanup performed. FINAL QA 2 remains IN PROGRESS. Remaining master
product matrix, full lexical/data governance audit and production performance
acceptance are not complete.

## Grammar privacy and empty-state continuation — 2026-09-28

The Grammar content trace found a cross-student exposure: essay-derived exercises
were fetched without source ownership checks in both pages and all three learner
submission APIs. DB reproduction: another student saw two exercises instead of
only the one shared exercise. Also, source deletion used ON DELETE SET NULL,
which cannot by itself preserve the private/public distinction.

Added durable `grammar_exercises.source_owner_user_id`, backfilled from real
writing sources and maintained by a DB trigger. Source deletion keeps that owner.
Learner queries and all three submission routes enforce shared-or-owned access;
other-user exercise requests return 404 without creating attempts. Administrator
content authoring remains separately authorized. Missing source/topic authoring
returns 404 instead of a foreign-key 500. Migration 0019 applied ONLY to isolated
local QA PostgreSQL. Production requires a reviewed migration before this app
version is promoted; no production migration or promotion was performed.

Grammar and Listening lists now have localized, actionable empty states. A topic
with no accessible exercises shows an explanation and a back link instead of an
empty quiz. Staff author links are shown only to roles already permitted by their
existing destination guards; no role permission was widened.

Fresh validation: 287/287 automated tests, zero failed/skipped; typecheck, lint and
production build passed. Grammar privacy HTTP suite: 21/21, covering real admin
creation, cross-student HTML/RSC and API denial, source deletion, owner/shared
practice, invalid source and a real empty topic. Browser: populated Grammar list,
empty topic, UZ->EN, direct hard reload, and zero captured warnings/errors.
Current browser viewport override did not apply to the background tab (measured
1280, not requested 320), so these new screenshots are labelled desktop and no
new mobile pass is claimed. Earlier shell matrix remains historical evidence.

Limit: rows whose source had already disappeared before this migration cannot
be classified from the lost link alone. No fictional ownership backfill was made.
Full personal-derived-content retention and all remaining original QA items are
still open. FINAL QA 2 — IN PROGRESS.
