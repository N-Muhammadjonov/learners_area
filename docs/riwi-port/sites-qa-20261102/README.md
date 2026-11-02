# RIWI Sites QA — 2026-11-02

**Outcome: partial implementation; live integration remains blocked. No main
merge, production deployment or model training was performed.**

## Completed

- Preserved arena head `2da939fea47b3bb688b99de4a1588cd0966d9518` as
  `checkpoint/arena-next-before-riwi-sites-20261102` and fast-forwarded
  `arena/learners-area-next` to the RIWI candidate containing all commits from
  current main `d62a2302a8dee9e72ccd6e7812a5ca7c7e4f50ec`.
- Configured **only that branch's Preview environment** with a new independent
  session secret, the private Site origin, password authentication,
  `APP_ENV=preview`, PostgreSQL rate limits, and
  `RIWI_EVALUATION_MODE=independent-v1`. Existing branch DATABASE_URL retained;
  its sensitive value was not returned by the connector and was not copied.
- Vercel preview `dpl_5mxz6HNc7vtgZjRrayRjJGnx8LiF` reached READY at commit
  `81a389f4506fadc5d8ed7066ec32c1f859059157` (before the vocabulary fix below).
  An authenticated GET of `/api/frontend/public` returned 200 and confirmed
  password auth enabled, Telegram-only disabled and diagnostics disabled.
  This is a public-config smoke check, not a successful login or DB write.
- Found existing Supabase `learners-area-qa` (`bpexpsugmuhwmztacbqd`). Its 66
  journal entries match repository hashes and timestamps exactly. Read-only
  inspection found one existing user, so it is not an empty disposable database.
- Created owner-private Site `appgprj_6ae812aa05a48191a4cca62debe8de65` and
  persisted the identity. Access inspection found one allowed user, no groups,
  no external visitors. Version remains 0; no live/preview URL exists.
- Prepared a dependency-free ESM gateway in `qa/riwi-sites-20261102`. It reports
  a clear 503 without an approved backend secret, preserves native app auth,
  strips unrelated identity/cookies, pins the upstream, and never follows
  redirects carrying preview credentials. It is not an active deployment.

## Defect repaired

The independent Vocabulary path used word-presence heuristics to label the
river-bank sentence correct against a financial-bank definition. It now
withholds positive correctness and calibrated confidence when meaning in
context has not been checked, marks its criteria limited, and requests a
definition/context review. Missing target words still produce an evidence-based
correction. The legacy default evaluator is unchanged; semantic inference is
still absent and must not be described as trained or fully capable.

Validation: **144 backend tests + 38 subtests passed**, covering independent
Coach, independent evidence, actual Basebook completion contracts, Basebook
runtime and the educational gateway. **9 Sites gateway tests passed**, and its
build/ESM artifact validation passed. These checks do not prove live DB-backed
login, RIWI persistence, full browser behavior or model quality.

## Blockers and exact actions that did not run

1. Automatic approval review rejected applying 13 pending journal migrations
   and two platform scripts to the existing QA database. Reason: broad schema
   and data changes, including attendance consolidation, without established
   contents and recovery state. No retry or alternate SQL execution was used.
   A follow-up read confirmed journal count still 66 and no
   `riwi_conversations` table.
2. Automatic approval review rejected a seven-day Vercel protection-bypass link
   for that preview. Reason: access would extend beyond the approved testing
   boundary. No such link/secret was created, protection was not disabled, and
   no `BACKEND_ACCESS_TOKEN` was configured in Sites.
3. The supported Sites source helper failed with `Could not resolve host:
   git.chatgpt-team.site` before source push, packaging or native publication.
   The expected Site origin is not a deployed URL. Source is retained here for
   review/resumption. No alternate transport or sandbox bypass was attempted.
4. Browser automation is unavailable in this environment. No browser QA claim.

The migration review manifest and activation plan are in this directory.
Live RIWI acceptance remains incomplete; the conditional main-merge gate is
therefore closed.
