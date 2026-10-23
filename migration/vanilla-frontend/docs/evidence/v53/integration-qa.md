# Speaking V48 + Writing V50 integration QA — V53 candidate

Target: `arena/96836bcf-learners-area`, inspected at `6890554650dde1168e0f0654557f3e130f353db5` (Grammar V48). No GitHub commit or push from this staging environment.

### Scoped fixes carried from V52
- Real Exam PUT autosave now captures immutable revision + content per network request and does not acknowledge later in-flight edits as saved.
- `writing/prompts/:id` route is registered by collision-aware integration script.

### Additional V53 source-matched corrections
- Speaking History audio source `/api/resources/[...key]` now preserves object-key `/` path segment boundaries (percent encoding each segment separately). Original `src/app/app/(shell)/speaking/history/page.tsx` and `src/app/api/resources/[...key]/route.ts` both require the catch-all path to reconstruct the object key by joining segments.
- Speaking upload server errors with `{error:{code,...}}` now retain `error.code` rather than passing an object into `ApiError`.
- Speaking upload never starts XMLHttpRequest if its AbortSignal was cancelled after the upload-intent response.

### Executed from isolated staged directory
- `node --test tests/writing-v51.test.mjs` — PASS (12/12 strict ESM modules and contract checks, reported by script).
- `python tests/writing-v52-browser-smoke.py` — PASS 6/6 Chromium fixture checks.
- `node --test tests/speaking-v53.test.mjs` — PASS 3/3 network-boundary, cancellation and relay ICE tests.
- `python tests/speaking-v53-browser-smoke.py` — PASS 2/2 isolated Chromium fixture checks.
- `node --check modules/{speaking,writing}/*.js` — PASS for all staged modules.

These tests use synthetic fixtures. Full Arena branch build, npm full unit suite, existing V36–V48 browser regressions, asset pin and live backend/devices still require a full checkout. Do **not** push before these gates succeed. Main, backend, database and deployments are untouched.
