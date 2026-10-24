# Learners Area — V61 + V62 native frontend candidate

**Status: STAGED / NOT PUSHED.** Candidate based on `main` b62b78f and the
Arena branch HEAD `844a1e97ba4eef0736e03daee91b8ce3a62ce375` observed when
this package was built. The integrator checks the actual checkout and refuses
unsafe overwrites. It does not change the Next.js source, backend, DB or main.

## Implemented

### V61 — learner Live Classes (`/app/live-classes`)

- Native upcoming/past class lists, teacher metadata, joined attendance, native
  student material renderer using the existing Vocabulary `clickableText`,
  authenticated media URLs, recordings, 15min pre-open/30min post-close window,
  live/cancelled handling, 409 / network errors, POST join and confirmed room link.
- **Read API is BLOCKED**, not live complete: the source page runs direct SQL;
  no existing `GET /api/live-classes` or `GET /api/frontend/view` projection
  has been verified live. This frontend uses Arena's existing proposed
  `viewData('/app/live-classes')` and fails closed without data.
- See `LIVE_CLASSES_VIEW_CONTRACT.md`. The server must authorize all output.

### V62 — Support (`/app/support`)

- Native Support page using the **existing shared native reportProblem** also
  used by shell utilities; same real POST `/api/support/reports`. Student form,
  staff-only inbox link, EN/UZ, abort and network error handling from shared
  implementation. No duplicate writer or fake submission.

### V62 — Notifications (`/app/notifications`)

- Direct existing GET `/api/notifications`; native inbox, empty/error/retry,
  internal safe links, current learner data; reuses shared `notificationRead`
  for visible-row automatic acknowledgement, mark-all POST, badge broadcast and
  cleanup. Does not use proposed `/api/frontend/view` for this route.

## QA evidence (only independent local fixtures)

- `node --test qa/unit.test.mjs` — **9/9 PASS** including idempotent integration,
  URL validation, full -15/+30 window boundary and DTO contract.
- `node qa/bundle.mjs && python qa/browser-smoke.py` — **10/10 isolated
  Chromium DOM PASS** (fixture-backed), join/recording/empty/error and roles.
- The included repository test `migration/vanilla-frontend/tests/v61-v62.test.mjs`
  passes in the independently created synthetic integration fixture (**7/7**).
- All 6 new native JS modules + integrator + CSS finalizer: `node --check` PASS.
- **Not run:** full Arena `npm run build`, `npm test`, `check:assets`,
  `check:content`, all other regression/browser suites, real live backend or
  device tests. These are mandatory before considering a push ready.

## Mac integration: no new repository clone (save disk)

1. Work in a clean Arena checkout (`git status --porcelain` empty). Fetch the
   branch HEAD, `git merge --ff-only FETCH_HEAD`; never reset it destructively.
2. Unzip this package into a separate temporary stage, then run:

   `node "$STAGE/integrate-v61-v62.mjs" "$REPO"`

3. Verify locally:

   `node --test "$STAGE/qa/unit.test.mjs"`

   `cd "$REPO/migration/vanilla-frontend"`

   `npm run build && npm test`

   `node --test tests/v61-v62.test.mjs`

4. The new utility classes may change Tailwind output. If `npm run check:assets`
   fails due a pin, run the enclosed safe selector-preservation script **once**,
   from `migration/vanilla-frontend`:

   `node "$STAGE/finalize-css-v61-v62.mjs"`

   The script imports `postcss` from the active project, not from the staging
   directory. It refuses silent rule deletions and unexpected baseline hashes;
   it updates the compiled CSS pin and, only if needed, safely safelists old
   selectors. Then `npm run build && npm run check:assets` must PASS.

5. Run `npm run check:content`. If its evidence output is generated, restore
   only that generated tracked evidence to avoid unrelated commits. Perform the
   other source/listening/reading/speaking/writing/vocabulary/mock regressions.
6. Review diff to ensure no deletions in existing audio/microphone, educational
   material, routes or other modules. Stage only `js/routes.js`, the new
   `modules/live-classes/`, `modules/support/`, `modules/notifications/`,
   `tests/v61-v62.test.mjs`, and CSS/pin/build files **if generated and audited**.
   Push to `arena/96836bcf-learners-area` only after all gates pass, no force push.

## Honest status

- V61 **client source ported; LIVE READ BLOCKED**.
- V62 Support **client source ported; fixture PASS; live not tested**.
- V62 Notifications **client source ported; fixture PASS; live not tested**.
- 100% Next.js parity or production readiness is **NOT established**.

## Staged files

- `migration/vanilla-frontend/modules/live-classes/{contract,resources,join,page}.js`
- `migration/vanilla-frontend/modules/support/page.js`
- `migration/vanilla-frontend/modules/notifications/page.js`
- `migration/vanilla-frontend/tests/v61-v62.test.mjs`
- `integrate-v61-v62.mjs` (guarded, idempotence refusal)
- `finalize-css-v61-v62.mjs` (selector preservation and pin, optional)
- `qa/{unit.test.mjs,bundle.mjs,browser-smoke.py}` (self-contained QA scripts)
