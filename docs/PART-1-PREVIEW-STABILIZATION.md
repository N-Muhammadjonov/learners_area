# Part 1 — Preview stabilization and verification

**Implementation status: local code and automated checks pass. Closure status: BLOCKED pending authenticated Preview/browser and isolated QA2 database verification.** This document covers Part 1 only.

## Environment and safety

The owner reports a separate Singapore-region Supabase QA database, 21/21 migrations including 0020, 62 application tables, and a QA owner. Those are owner-provided facts; this workspace did not connect to that database. `DATABASE_URL` is unset, so QA2-gated PostgreSQL tests remain skipped. Production was not queried, migrated, modified, or deployed. No auth/protection gate was bypassed.

The available Preview remained inaccessible to this agent (Protected Deployment / sandbox `ECONNRESET`). No browser executable or Playwright/Puppeteer installation was available. Therefore no current Preview request timings, owner-browser multi-run timings, or 320/390/768/1024/1440 viewport overflow/clipping measurements are claimed. The repeatable measurement method and current capture status are in `docs/part-1-navigation-measurements.md`.

## Navigation and route loading

- Private navigation links retain the accessible pending indicator (60 ms anti-flash threshold; feedback remains within the requested 50–100 ms window). The shell stays mounted. Private RSC prefetch is explicitly disabled to avoid stale content crossing an account suspension/status change; there is no claim that this improves route latency. Layout and APIs continue checking the authenticated active user.
- Locale/auth work and independent page loads are parallelized. Dashboard data uses SQL counts rather than transferring every historical row, and its independent roadmap query runs alongside the dashboard queries. Writing loads live prompts plus attached resources with one join and computes typing summary in a database aggregate instead of loading every typing run. Grammar loads independent catalogue data concurrently. Notifications remain post-shell and authenticated.
- These are source-level critical-path reductions, not a measured Preview speedup. Cold-start, Vercel-to-Supabase latency, and actual click-to-usable-route improvement still need browser traces. Do not infer p50 or worst-case latency from code or build output.

## Vocabulary Games and points

Games is a library with separate history-aware routes for Flashcards, Multiple Choice, Matching Pairs, Fill the Gap, Typing Race, Translation Challenge, and Sentence Builder. Each route fetches its selected game data, provides a semantic back action/title/source/progress, and does not load the whole Vocabulary Studio payload. Empty-set cards remain navigable and dedicated routes retain set controls and Back to Games. Flashcards now use a definition-first front, an answer-hidden remaining queue, selected-set/source heading, true CSS 3D body flip, lexical details and separate pronunciation/self-assessment controls; no permanent Finish/Show-result button is shown. These interactions are code-level only until browser verification. Typing Race uses progressive character boxes, server-verified green/red verdicts with staggered transitions, answer corrections, automatic advance and input refocus; the clock begins on the first non-whitespace character and skips award zero. Browser timing/focus remains unverified.

Legitimate game, revision and Usage actions dispatch a board-refresh event; the Vocabulary board fetches fresh, uncached server-ledger points and recent award history. Revision updates its local due count and refreshes the full route only when the due queue ends, avoiding a broad RSC reload after every card. A game answer does not force an unrelated game-page RSC refresh. This is implemented locally; immediate visible update is pending browser/QA2 verification.

The server ledger contract is: saved word 0; genuinely scheduled revision +1; correct server-verified game answer +1; RIWI-accepted sentence +2. Request booleans and point values are not trusted. Game answers must match the selected game mode and server-derived set membership; Matching Pairs submits both selected entry identities for server validation. A game-answer point is deduplicated per learner + saved word + Tashkent day across all game modes and sets. The effective leaderboard maps historical values by event kind and collapses legacy multi-mode game rows without mutating the provenance rows. Revision keys identify a scheduled occurrence. Accepted sentence keys identify learner + saved word + normalized sentence, so a new usage ID cannot replay its award. `docs/vocabulary-points-ledger.md` documents the exact rule.

## Current check results

- `npm test`: **334 tests; 310 passed, 24 skipped, 0 failed** on 2026-09-29. The 24 skips include QA2 PostgreSQL/migration and other guarded database fixtures; the Vocabulary point-history and Writing zero/populated DB cases did not run because no isolated local `localhost/learners_qa2` connection is configured. No remote database substitution was made.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, zero warnings.
- `npm run build`: PASS; optimized build compiled and 77 static pages generated, private app routes remain server-rendered.
- `git diff --check`: PASS at final source/test check.
- Structural/unit tests cover navigation feedback/prefetch policy, game routes, race timing/reveal/skip/WPM/auto-advance contracts, flashcard flip/pronounce boundaries, server score gates, dedupe helpers, and effective ledger-derived leaderboard totals. They do not replace real browser interaction or database integration tests.

Listening content was not fabricated. An empty QA Listening catalogue is a content-state result, not automatically a defect.

## Follow-up audit and current limitations

`npm audit` was rerun without `--force`: the starting report was 6 moderate + 1 high. The direct dev dependency `tsx` was upgraded within its declared major to 4.23.15, removing that moderate advisory. Six remain (five moderate, one high): the high PostCSS advisories enter through Next 15.5.26's exact `postcss@8.4.31` dependency, and npm offers Next 16.3.7 as the fix (a major upgrade). An out-of-range PostCSS override was tested only for dependency-tree resolution, found invalid against Next's exact dependency, and removed; no such override remains. Four moderate findings involve the Drizzle Kit / archived esbuild-kit toolchain. No destructive audit fix or major framework/ORM upgrade was applied. The remaining high advisory needs a separately reviewed framework/toolchain upgrade.

The protected Preview did not yield a usable authenticated session or server trace in this workspace. The three supplied screenshot paths are not mounted here. No QA2 database URL/connection or local PostgreSQL was available, and the browser executables/Playwright command are absent. Thus Writing's fixed UUID-to-UUID query join, empty/populated Writing DB behavior, saved score/history rows, game navigation, empty game states, flashcard flip/pronunciation isolation, Race focus/auto-advance and visual breakpoints remain externally unverified. No Production deployment, migration, data write, or broader phase was performed.

## Manual regression checklist — pending authenticated browser/QA2 access

- [ ] Perform ≥15 warmed Dashboard → Writing → Reading → Vocabulary → Grammar → Dashboard navigations; separately report click feedback, request/RSC, usable content, cold versus warm, environment, median, p95 and approximate worst. Do not combine local and Preview results.
- [ ] Open Writing with zero typing runs and with saved attempts/resources; inspect browser console, Preview trace for digest `349261419`, and empty/populated QA2 results.
- [ ] Exercise each game from the library with a populated set and a truly empty/zero-eligible set; verify set selector, explicit Back to Games, browser Back, and truthful source label.
- [ ] Flashcards: definition-only queue, heading/source, click/tap/Enter/Space 3D flip, answer lexical details, pronounce without marking/flipping/advancing, Learned/Not yet feedback, auto-advance, Review not-yet/Review all completion; verify no permanent Finish/Show-result control.
- [ ] Typing Race: progressive character boxes; correct green and incorrect red stagger; correction reveal; skip with zero points; no Next control; same input focused after automatic advance; timer remains zero until first non-whitespace character.
- [ ] After a real game point, scheduled revision and RIWI-accepted sentence, assert total and recent history refresh from the private server ledger; wrong/skipped/self-assessed/unevaluated actions remain zero.
- [ ] Reading: attempt resume/expiry/submission and answers; filter-selection close, Escape/outside close, readable counts, timer state and bottom-of-content scroll; no empty tail.
- [ ] Vocabulary regression: save/duplicate/source add, folders/ownership, Reading source snapshots, revision schedule and idempotence, Games, Usage/RIWI history, leaderboard and honest API failures.
- [ ] Grammar: list → topic → exercise → submit; assert learner ownership, stored submission/history/progress, and responsive labels.
- [ ] At widths **320, 390, 768, 1024 and 1440 px**, inspect bottom scroll, horizontal overflow, clipped controls, card/queue overlap, Race boxes, Reading filters, Writing and floating utilities.

These are intentionally unchecked: source tests/build and this matrix are not browser acceptance evidence.
