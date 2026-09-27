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
