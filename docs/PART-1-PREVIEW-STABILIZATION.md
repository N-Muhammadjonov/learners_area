# Part 1 — Preview stabilization and verification

**Implementation status: local code and automated checks pass. Closure status: BLOCKED pending authenticated Preview/browser and isolated QA2 database verification.** This document covers Part 1 only.

## Environment and safety

The owner reports a separate Singapore-region Supabase QA database, 21/21 migrations including 0020, 62 application tables, and a QA owner. Those are owner-provided facts; this workspace did not connect to that database. `DATABASE_URL` is unset, so QA2-gated PostgreSQL tests remain skipped. Production was not queried, migrated, modified, or deployed. No auth/protection gate was bypassed.

The available Preview remained inaccessible to this agent (Protected Deployment / sandbox `ECONNRESET`). No browser executable or Playwright/Puppeteer installation was available. Therefore no current Preview request timings, owner-browser multi-run timings, or 320/390/768/1440 viewport overflow/clipping measurements are claimed. The repeatable measurement method and current capture status are in `docs/part-1-navigation-measurements.md`.

## Navigation and route loading

- Private navigation links retain the accessible pending indicator (60 ms anti-flash threshold; feedback remains within the requested 50–100 ms window). The shell stays mounted. Private RSC prefetch is explicitly disabled to avoid stale content crossing an account suspension/status change; there is no claim that this improves route latency. Layout and APIs continue checking the authenticated active user.
- Locale/auth work and independent page loads are parallelized. Dashboard data uses SQL counts rather than transferring every historical row, and its independent roadmap query runs alongside the dashboard queries. Writing loads live prompts plus attached resources with one join and computes typing summary in a database aggregate instead of loading every typing run. Grammar loads independent catalogue data concurrently. Notifications remain post-shell and authenticated.
- These are source-level critical-path reductions, not a measured Preview speedup. Cold-start, Vercel-to-Supabase latency, and actual click-to-usable-route improvement still need browser traces. Do not infer p50 or worst-case latency from code or build output.

## Vocabulary Games and points

Games is a library with separate history-aware routes for Flashcards, Multiple Choice, Matching Pairs, Fill the Gap, Typing Race, Translation Challenge, and Sentence Builder. Each route fetches its selected game data, provides a semantic back action/title/source/progress, and does not load the whole Vocabulary Studio payload. Typing Race starts its per-item tenth-second timer on the first actual answer character, verifies answers server-side, reveals correct answers for incorrect/submitted or skipped prompts, gives skips zero points, and withholds misleading WPM for tiny/incomplete samples. Flashcard pronunciation is separate from marking/flipping/advancing.

The server ledger contract is: saved word 0; genuinely scheduled revision +1; correct server-verified game answer +1; RIWI-accepted sentence +2. Request booleans and point values are not trusted. Game answers must match the selected game mode and server-derived set membership; Matching Pairs submits both selected entry identities for server validation. Unique ledger keys deduplicate game replay by learner, game, set, word and Tashkent day. Revision keys identify a scheduled occurrence. Accepted sentence keys identify learner + saved word + normalized sentence, so a new usage ID cannot replay its award. `docs/vocabulary-points-ledger.md` describes historical behavior and why existing ledger rows are not rewritten.

## Current check results

- `npm test`: **320 tests total; 298 passed, 22 skipped, 0 failed**. Skips include QA2 PostgreSQL tests gated on isolated `localhost/learners_qa2`; no remote database substitution was made.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS, zero warnings.
- `npm run build`: PASS; 77 static pages generated, private app routes remain server-rendered.
- `git diff --check`: PASS at last check; rerun as final repository verification.
- Structural/unit tests cover navigation feedback/prefetch policy, dedicated game routes, race timing/reveal/skip/WPM logic, flashcard pronunciation boundaries, server score gates, dedupe helpers, and ledger-derived leaderboard query. They do not replace actual browser interaction or database integration tests.

Listening content was not fabricated. An empty QA Listening catalogue is a content-state result, not automatically a defect.
