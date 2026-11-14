# Deleted Speaking activity — 2026-11-14

The Owner reported that RIWI still advertised Shadowing after the activity had
been removed. The stale guide was reproduced in source. Work continues on main
from `f735c4f48b2a6b16a2c8cb25a1b130c16369098c`, preserving intervening Listening
and dictionary work. The Owner's main/Railway production release approval applies.

## Removal

- Deleted the runtime route, server-build route, client alias and Speaking entry
  redirect. `/app/speaking/shadowing` is now a real HTTP 404, with no redirect,
  placeholder route, disabled button or hash destination.
- Removed the route/feature from the code-derived RIWI catalogue, bilingual site
  guide, UI context matcher, help keywords and assessment registry. The Speaking
  guide lists the supported Lessons, Practice Alone, AI, Speak or Die, Live Partner
  and History paths. AI readiness remains conditional on actual service status.
- Deleted the retired synthetic question from the active corpus and compiled
  answers. Original source-file hashes/counts remain provenance receipts;
  `retiredQuestionIds` records the excluded ID, not its teaching text.
- Deleted the seed material and obsolete verification program that used to require
  legacy rows. Learner/staff material reads and search accept only supported
  categories. No new feature-specific activity implementation remains.
- Read-only production checks found **0** `speaking_materials` rows in the category
  and **0** RIWI knowledge units/source titles containing the term. No database
  deletion or schema change was necessary. Applied migration bytes and historical
  compatibility enum remain intact; these are not routes or feature knowledge.

## Verification

- 3,714 backend tests and 282 subtests passed: all RIWI tests, HTTP contracts,
  SEO/static routes and material-create validation. Includes the removed URL's
  real 404 without authentication/database access, all-role/bilingual Speaking
  guide checks, no retired navigation and no retired assessment contract.
- 111 relevant frontend tests passed, including RIWI, route matching, safe links,
  Speaking controls and staff materials.
- Six native/Docker asset-build checks passed; the build and catalogue have 137
  routes. The build dependency was installed only in the temporary QA environment.
- A broader 116-test frontend run initially reported two failures: the old staff
  fixture asserted the deleted category label (updated to supported General and
  passed); the Live Partner ICE recovery test also fails on the earlier untouched
  baseline, as recorded in the 2026-11-13 baseline comparison. It is not presented
  as passing or fixed by this deletion.

Railway deployment and native Safari production acceptance are recorded separately
in the release receipt after the code has been deployed.
