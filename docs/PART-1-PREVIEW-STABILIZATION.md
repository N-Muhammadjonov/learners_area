# Part 1 — Preview Stabilization handoff

**Status: BLOCKED pending authenticated Preview/browser verification.** This is a Part 1 handoff only; no later V4.2 phase was started.

## Environment and database

The owner reports that the branch Preview is Ready and points to a separate Singapore Supabase QA database, with 21/21 migrations applied, migration 0020 present, 62 application tables, and a QA owner. Production was not migrated or modified. These are owner-supplied QA facts; this execution environment could not query that database or independently inspect Vercel's `DATABASE_URL` target/history.

The owner reports Vocabulary now loads after connecting the Preview to the migrated QA schema. This is strong evidence that the earlier Vocabulary crash was associated with the prior Preview database/environment schema state, but it does **not** prove the exact SQL/root cause or establish whether the previous target was Production. Grammar's fatal error is also reported as no longer reproducing; this agent could not inspect its Preview trace or independently retest the page.

The known branch Preview hostname still returned Vercel's **Protected Deployment** sign-in page through the available page fetcher; direct sandbox requests returned `ECONNRESET`. No Vercel/database credential values or environment variable names were available in the sandbox. No access control was bypassed.

## Navigation investigation and safe changes

Source audit found several potential critical-path costs:

- the private layout awaited a per-user unread-notification count after the database-backed user/admission check, before rendering the page;
- `getLocale()` was called from root/layout/page code but was not request-memoized;
- Grammar mastery loaded topics and visible exercises sequentially even though those reads are independent;
- private pages use request cookies and the database identity lookup; this authorization cannot be cached across requests or skipped.

Changes in this checkpoint defer the noncritical notification count to the existing authenticated count endpoint after the shell mounts, request-memoize locale only for the current React render, and parallelize the independent Grammar catalogue queries while keeping the user-specific attempt query dependent on the authorized exercise set. The private layout still reads the authoritative user from the database and immediately enforces admission status. The redundant layout-level `force-dynamic` declaration was removed; request-cookie reads still make this segment request-dynamic, and the production build verifies the routes remain server-rendered. No full private-page or user data is cached across requests.

Preview diagnostics now activate automatically only for Preview deployments (never Production). They measure link click → pending feedback → visible route completion and RSC/resource timings; server timings include correlation ID and operation name only. Slow DB/server operations log from 120 ms in Preview (400 ms elsewhere), without query contents, user IDs, or credentials. This instrumentation is ready for QA Preview observation, but this agent could not collect its Preview logs.

The historical local production-build benchmark in `docs/PERFORMANCE-AUDIT.md` records a 15-navigation median of 338.1 ms before versus 43.0 ms after removal of the blanket loading fallback. That result predates this checkpoint and is **not** a measurement of the present Preview or of the changes above. Actual before/after Preview navigation latency remains unmeasured and is a closure blocker.

## Reading and responsive verification

The earlier committed timer and dropdown fixes remain covered by unit/DOM tests: duration comes from `suggestedMinutes`; expiry freezes editing and server-side draft writes; timeout submission uses only persisted drafts; filter selections close menus, Escape restores trigger focus, outside clicks close them, and menu width is constrained/right-aligned.

They were **not browser-retested** in the QA Preview during this continuation because the Preview remained protected to the available tools. No fresh 320, 390, 768, or 1440 px visual/scroll measurements were obtained. The current shell source retains viewport-locked independent scrolling, but blank-tail behavior is not re-certified for this deployment.

## Regression and safety

- No migration was run from this environment. Migration 0020's QA presence is owner-reported; Production remains untouched.
- No Production deployment, Production data mutation, or `main` merge occurred.
- QA PostgreSQL integration tests could not run here; the known local QA endpoint refused connections and no QA connection variable was present. The migration-0020 and Grammar-privacy integration tests were skipped for lack of their QA DB gate.
- Full suite: **307 total, 288 pass, 0 fail, 19 skip**. Focused navigation/Reading/Grammar/Vocabulary unit checks: **53 pass, 2 DB-gated skips**.
- `npm run typecheck`, `npm run lint`, `npm run build`, and `git diff --check`: **PASS**.

## Explicit product/content follow-ups

### CONFIRMED FOLLOW-UP PRODUCT GAP — VOCABULARY GAMES / TYPING RACE

Owner's manual QA confirms the current Typing Race can show a definition, run a timer, accept typed input, and show card/accuracy/WPM state, but **does not** yet provide the agreed Booster-inspired answer/reveal/feedback interaction. This is a product gap, not a runtime crash. Games were not redesigned in Part 1 and must not be represented as final.

### Listening content state

The QA database reportedly contains no published Listening tests. “No listening tests are available yet” is therefore a current content-state result, not evidence of a runtime defect or proof that the later Listening product is complete. Listening redesign/content work remains outside Part 1.
