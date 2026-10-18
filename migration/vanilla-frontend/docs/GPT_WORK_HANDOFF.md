# GPT Work handoff — PARTIAL MIGRATION CHECKPOINT

## 1. Identity, baseline and non-negotiable safety

Repository: private `https://github.com/N-Muhammadjonov/learners_area`.
Starting branch: `arena/96836bcf-learners-area`, assigned to this Arena session; not renamed.
Starting commit and last verified remote main/source-of-truth:
`9a7d9fc5a93608078644d61cd9f9850c05c4ddc8` (checked 2026-10-18 UTC).
Commit subject: “Stream private media after Listening hub paint and enforce session revocation (#41)”.
Migration directory: `migration/vanilla-frontend/`.
Delivery branch: `arena/96836bcf-learners-area`.
Branch URL: `https://github.com/N-Muhammadjonov/learners_area/tree/arena/96836bcf-learners-area/migration/vanilla-frontend`.
Use the final response and `git ls-remote` for the delivery commit (a file cannot include its own commit hash).

No original application/backend/content file was changed. No deploy, merge, production service call,
database mutation, content import, DNS/Railway/Cloudflare/Telegram configuration change was performed.
**Do not deploy this checkpoint.** The production app must stay untouched until all acceptance gates pass.

## 2. Actual status — no complete migration claim

115 page files, 206 component files, 214 API handler files and 13 layout/loading/error boundaries
were structurally discovered. The active-route semantic count is not established. Two page candidates
are implemented (`/`, `/auth/recovery`), plus not-found and route alias normalization. Zero pages
are fully visual+functional parity verified. 113 source page entries are unavailable, explicitly labeled.
Unimplemented interfaces are unfinished work, not fake external blockers or approved simplifications.

The full requested conversion exceeds this execution's implementation budget. This handoff preserves
actual tested code, not a proposal masquerading as completion. See KNOWN_LIMITATIONS.md.

## 3. Original architecture

Next.js 15 App Router, React 19, TypeScript/TSX, Tailwind 3.4.14 and global variable-driven CSS.
Server components obtain DB-backed user authority and data; API routes use the existing TypeScript
backend. Supabase PostgreSQL, Railway, private R2/Worker media and Telegram stay outside this task.
`src/app/app/layout.tsx` provides the DB authority gate for sibling shell/focus layouts.
`src/app/app/(shell)/layout.tsx` provides persistent independent sidebar/content scroll containers.
Listening focus pages host authored content with opaque sandbox isolation and authorized media controls.

## 4. Candidate architecture and key files

- `index.html`: root document, native module bootstrap, original-font preload, global CSS.
- `js/main.js`, `router.js`, `routes.js`: lazy native imports, safe same-origin History API,
  cancellation/stale-render protection, delegated links, explicit unavailable entries.
- `js/navigation.js`, `private-modules.js`: copied canonical aliases with query/fragment handling;
  retired Shadowing redirects to lessons, no Shadowing activity is added.
- `js/api-client.js`: native Fetch, same-origin cookies, no-store, JSON enforcement,
  bounded request timeout, concurrent GET dedup and per-subscriber cancellation. No retries/cache.
- `js/session.js`: presentation destination check only; not a capability grant or session lifecycle.
- `js/preferences.js`, `js/i18n/`: original Uzbek/English dictionaries, cookie-based choices.
- `js/components/`: safe DOM, original brand/SVG geometry, auth shell and preference controls.
- `modules/landing.js`: touch welcome, desktop intro with fallback; state resolved on activation.
- `modules/recovery.js`: real password-recovery administrative login form using existing endpoint.
- `modules/not-found.js`: original localized not-found structure.
- `modules/unavailable.js`: migration-status disclosure; never count as converted UI.
- `css/source.css`, `tailwind.source.mjs`: original stylesheet/config inputs.
- `css/global.css`, `fonts.css`, `fonts/`: compiled CSS and original licensed font files/roles.
- `scripts/build.mjs`: refresh safe source inputs in checkout or build independently from archive.
- `scripts/preview.mjs`: local build-only server, deep-link fallback, private APIs deliberately 503.
- `scripts/inventory.mjs`: AST structural scan; not a replacement for semantic/manual inspection.
- `scripts/package.py`: deterministic source ZIP, file manifest and SHA256SUMS verification.

The final browser runtime imports no React/Next/JSX or replacement framework. Build/test dependencies
are development-only. The backend is not embedded behind a wrapper.

## 5. Exact mapping and what the inventory does not prove

`ROUTE_MIGRATION_MATRIX.md` lists every discovered page pattern, parent layouts, imported component
closure, API literal candidates and current conversion state. `source-inventory.json` holds expanded
server dependencies, layouts, assets and API source checks. `COMPONENT_MIGRATION_MATRIX.md` covers
all component files; partial candidates do not count as exact conversions. `API_COMPATIBILITY_MATRIX.md`
lists every discovered handler and the small reviewed contract subset.

First finish semantic classification: Next config aliases precede pages; unconditional and conditional
redirects differ; role/layout gates and dynamic IDs affect reachability. Static literal extraction does
not capture every computed URL or response/body schema. Do not mark all 115 “active routes”.

## 6. APIs and missing adapters — existing vs proposed

Existing candidates use:
- GET `/api/auth/state`: `{ok,role,accountStatus,expiresAt}`, 401 for anonymous, private no-store.
- POST `/api/auth/recovery/login`: JSON email/password, server enforces ACTIVE owner/admin recovery.
- POST `/api/theme`: JSON theme, server cookie transport authority.
- POST `/api/locale`: JSON locale, server cookie transport authority.

These contracts were inspected; live integration was not exercised. The preview does not proxy them.

Missing **proposed**, not existing, API boundaries:
1. Public presentation bootstrap: server-selected locale/theme, brand defaults, auth release policy,
   public Telegram configured/mode/bot username and Google availability. Only public fields; never tokens.
   Normal login/register/reset must not infer release policy from local flags.
2. Authenticated shell DTO: DB-verified user identity/name/email/photo flag/onboarding, role/status/expiry.
   Existing `/api/auth/state` lacks identity, so cannot safely scope a full private cache or render shell.
3. Route-specific DTOs for direct service/DB reads in each page dependency closure. Define exact payloads
   only after inspecting the relevant page/service permissions and answer redaction. Never general SQL APIs.

Do not modify the existing backend in this Arena migration task. A subsequent GPT Work integration
must obtain/observe its separate backend authorization before implementing missing adapters. Prefer
existing endpoints whenever they already satisfy an exact contract. Preserve all request schemas,
server validation, CSRF/origin handling, ownership and failure semantics.

## 7. Authentication, session, roles and data isolation

No new auth provider or client role authority was introduced. Recovery uses native same-origin cookies.
Normal Telegram intent flow/widget/OIDC are NOT converted. Study `LoginForm.tsx`, `TelegramIntentLogin.tsx`,
`TelegramButton.tsx`, `public-auth-policy.ts`, and safe redirect handling before conversion.
Never ask the owner to paste passwords/cookies/secrets. Use authorized fixture environments.

Before enabling private views, convert `AccessChangeListener`, `PrivateResourceScope`, expiry timers,
SSE `/api/auth/changes` behavior, reconnect authority checks, logout, cross-tab invalidation and cache
clear/media teardown. Maintain DB-authoritative role/status/session revocation. Do not introduce eager
state polling on every click or localStorage privileges. Currently no settled private cache exists.

## 8. Media, Listening and exam security

Original latest Listening source is untouched. No protected content was statically bundled.
Do NOT treat this as a converted Listening module. Inspect current `authored-media-controller.ts`,
`private-resource.ts`, Listening hub/focus components, API redaction and authored runtime protocol.
Preserve Test 1's nine activities and latest tests from source, never rebuild content from guesses.
Hub must paint before audio preparation. Reuse authorized progressive streaming, revoke resources
on authority changes and keep original playback restrictions. Do not preload all media.
Authored iframes must remain opaque-origin sandboxed; never add allow-same-origin, weaken CSP or
postMessage source checks. Keep answers/server grading behind authenticated boundaries during exams.
R2/Worker production remains unchanged; no permanent private URLs or secrets in bundles/archives.

## 9. Verification and measured evidence

- `npm run build`: PASS.
- Foundation tests: 22 PASS, 0 FAIL, 0 SKIP, 0 BLOCKED.
- Chromium 133 smoke checks: 27 PASS, 0 FAIL, 0 SKIP, 0 BLOCKED.
- Source-vs-candidate visual comparisons: 0; baseline access BLOCKED.
- Live API group: BLOCKED; Safari and microphone groups SKIP.
- Screenshots: candidate-only, 390×844 / 768×1024 / 1440×900; both recovery themes.
- Performance: narrow local route benchmark in PERFORMANCE_REPORT.md; misses/proves no 1–100 ms goal.
  No original timing comparison or production performance claim.
- npm audit: 7 dev-only findings (5 high, 2 moderate), not a clean dependency audit.

See VISUAL_PARITY_REPORT.md, FUNCTIONAL_PARITY_REPORT.md and evidence/ for exact limits.
Two discovered preview defects were fixed: hidden desktop video-error fallback and dotfile SPA fallthrough.
Font binaries/roles were added after inspecting the Next/font configuration; no metric parity claim.

## 10. Exact safe commands

```sh
git status --short
git branch --show-current
git ls-remote origin refs/heads/main refs/heads/arena/96836bcf-learners-area
# Inspect/reconcile intervening main changes, without reset/rebase/stash/clean or overwriting work.
cd migration/vanilla-frontend
npm ci --ignore-scripts
npm run build
npm test
npm run preview
# second terminal, same directory:
node tests/browser.mjs
node scripts/performance.mjs
npm run package
python3 scripts/package.py --verify
```

Run inventory only in a source checkout. Archive independently builds from included source inputs.
Preview has no backend connection; do not point it at production to obtain a misleading “test”.
Use isolated approved fixtures with no real student records. Test one role/account scope at a time.

## 11. Remaining implementation order / acceptance gates

1. Verify latest legitimate main and preserve any intervening Listening/session/Reading/RIWI work.
2. Finish semantic route/component/API contracts, including query state, retired routes, errors and roles.
3. Obtain baseline screenshot/test access and separately authorized API adapters, if needed.
4. Convert exact shell/focus scrolling/nav/theme/locale/session lifecycle and auth flows first.
5. Convert all remaining educational and staff components from their actual state/effect contracts.
6. Reuse authored HTML securely behind existing runtime; migrate real media controls/autosave/grading.
7. Test all routes/deep links/roles/reloads/Back/Forward; include MCQ Choose TWO/A–E/Day 8,
   retention expiry/no-cache, Reading evidence, Writing typing/autosave and actual Speaking mic/upload.
8. Perform matching original/candidate screenshots and investigate every visible regression.
9. Compare matched-cache performance; measure visual/data/media readiness independently.
10. Rebuild archive, verify manifest/checksums/local-remote commit identity and all acceptance gates.
11. Only after explicit final integration authorization and acceptance may any deploy/merge be considered.

Current gates: runtime independence/source isolation/local build pass for the subset; complete active
inventory, full route/interaction/visual coverage and backend/session/media acceptance DO NOT pass.

## 12. Rollback considerations

There is no production migration to roll back. Ignore this directory/branch to keep the original app.
Do not delete original content or replace deployments. Later integration requires its own reviewed
rollback design retaining the original frontend and existing backend contracts until acceptance.

## Ready-to-paste GPT Work prompt

> Inspect private N-Muhammadjonov/learners_area branch arena/96836bcf-learners-area, directory
> migration/vanilla-frontend, beginning with README, GPT_WORK_HANDOFF, KNOWN_LIMITATIONS and all matrices.
> This is PARTIAL: 2 page candidates, 113 source page entries unconverted, 0 fully parity-verified routes.
> Do not call it complete, production-ready, or deploy it. Compare actual latest main against source
> 9a7d9fc5a93608078644d61cd9f9850c05c4ddc8 and reconcile legitimate intervening changes without resetting,
> rebasing, stashing, cleaning or overwriting work. Preserve accepted Listening hub-first streaming,
> all nine Test 1 activities, session revocation, Reading, MCQ semantics and RIWI workstreams.
> Complete semantic route/component/API contracts and convert every remaining active interface into
> actual HTML/CSS/native ES modules, with original visuals/states/interactions and all roles.
> Repair verified candidate defects; passing foundation tests is not application parity. Prefer existing
> API contracts; after separate backend authorization, implement the minimal missing public/auth shell
> and per-page server DTO adapters, preserving DB authority, ownership, answer redaction and media rules.
> No client role bypass, protected static content, allow-same-origin sandbox relaxation, secrets, fake
> data or simulated recordings. Test all modules with authorized isolated accounts/data, Chrome and
> Safari, both languages/themes, desktop/tablet/mobile, real media/mic where possible. Capture matching
> baseline screenshots and image diffs, measure matched-condition performance separately for UI/data/media,
> audit security/dependencies, verify package and Git delivery. Report every unverified gate honestly.
> Production backend/data/content/Railway/Cloudflare/Telegram and main remain untouched until explicit
> integration authorization and all acceptance gates pass. No deployment or merge by assumption.
