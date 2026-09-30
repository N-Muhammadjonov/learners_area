# Runtime Stability Architecture

## 1–2. Baseline

- Runtime baseline (owner-designated, ARENA-VERIFIED + integration-verified, **not yet OWNER-VERIFIED**):
  `0f4a6eaed94da4254789c3c89f8c2871ab96959e`. The owner explicitly deferred Preview verification until Part 1 +
  Runtime Stability are both complete; final owner verification happens once on the combined SHA.
- Runtime starting SHA: `0f4a6eaed94da4254789c3c89f8c2871ab96959e` (branch `arena/01a0f1a0-learners-area`).
- Historical ancestry: `ea1d580262680bec1e08746c180b530b23900e66` is an ancestor of the baseline (verified after unshallowing).

## 3. Architecture before (evidence from source at the baseline)

```
CLICK → InstantLink / InstantInteractionProvider (immediate pending frame, Part 1)
      → Next router: RSC request; (app)/loading.tsx bounds default prefetch to the loading boundary
      → (app)/layout: getCurrentUser() (DB, per request) + locale  → section page RSC
      → Vocabulary: RSC renders frame only; VocabStudio client effect fetches the selected tab's
        resources independently (library page 50, summary, folders | due 40) — already view-specific
      → client render with per-region skeleton / error / retry (Part 1)
      → mutation → narrow component reload (Words: library+summary+folders)
```

Real defects found (evidence = source + local measurement):

| Concern | Before | Defect | Change |
|---|---|---|---|
| Repeat navigation (Vocabulary → Grammar → Vocabulary) | VocabStudio state lived only in the component; remount refetched library, summary and folders and showed skeletons again | every return repeated all first-entry reads | user-scoped memory cache: fresh (≤30 s) snapshot reused with **no request**; older snapshot shown immediately and revalidated in background |
| Client read deadlines | Vocabulary GETs used bare `fetch` with no timeout | a hung socket left a region "loading" indefinitely | `fetchPrivateJson`: 12 s deadline, classified errors |
| Retries | none on reads | a single 502/503 from a pooler failed the region | max 1 retry on reads (hard cap 2), only network/timeout/502/503/504 |
| Duplicate reads | per-component `inFlight` set only | concurrent consumers of the same key could double-fetch across mounts | cache-level in-flight dedupe by `[user, resource+params]` |
| Cross-section invalidation | saving a word from Reading/Writing/Games/Use It had no effect on Vocabulary snapshots (there were none) | would become stale once caching exists | each such mutation calls `privateResources.invalidate("vocabulary:")` — nothing else |
| Retention hub | 4 serial awaits (live → payload → summary → history) | 3 unnecessary serial DB round-trip groups | independent owner-scoped reads run concurrently, each with its own failure scope |
| Retention link prefetch | Dashboard + Reading hub links used default prefetch | defensive gap (loading boundary already prevented the page RSC) | explicit `prefetch={false}` |

Already correct at baseline and retained: DB pool deadlines (`src/db/client.ts`: connection 8 s, statement 15 s,
query 20 s, max 5), mutation deadlines (`requestJson`, 25 s), view-specific Vocabulary fetching, library
pagination (50/page offset), region-level error isolation, server-authoritative gates.

## 4. Architecture after

Layers: persistent shell (unchanged) → section frame (unchanged) → core resource regions → secondary regions →
**user-scoped memory cache** (new) → server-authoritative security (unchanged) → narrow invalidation (new
prefix-based) → bounded read failure (new) → prefetch policy (Retention hardened) → diagnostics hook (new).

## 5–6. Resource taxonomy and map

See `docs/RUNTIME-RESOURCE-MAP.md`.

## 7. Client/server boundary

Security, identity, role, accountStatus and ownership are read from the database on every request in the
`(app)` layout and every API handler. The client cache holds only presentation copies of idempotent GET payloads.
No new endpoints were added.

## 8–10. Cache, cache-key and freshness contracts

- Implementation: `src/lib/client/private-resource.ts` (no dependency added; React/Next primitives plus ~150 lines).
- Storage: module memory only. No localStorage/sessionStorage/IndexedDB/service worker. Reload = empty.
- Key: `JSON.stringify([userId, resource])` where `resource` encodes name + normalized params
  (e.g. `vocabulary:library:first:50`). Locale is not part of the key because these payloads are locale-independent
  user data; labels come from the dictionary.
- Scope: `<PrivateResourceScope scope={user.id} />` in `(app)/layout.tsx`, rendered only after
  `getCurrentUser()` + `hasPrivateAccess(accountStatus)` pass. A different id clears everything and bumps a
  generation counter so in-flight results from the previous user are discarded. No scope = nothing stored.
- Freshness: Vocabulary library/summary/folders `FRESH_MS = 30 s`; the revision queue, leaderboard, Use It lists and
  all Retention data are never cached.
- Authority: cached data never decides auth/role/status/ownership; a 401 triggers `router.refresh()` → server gate.

## 11. Invalidation contract

| Mutation | Invalidates | Not invalidated |
|---|---|---|
| Words panel save/delete/move/folder ops | `vocabulary:*` then reloads library, summary, folders | everything else |
| Save word from Reading popover / Writing feedback | `vocabulary:*` | Reading/Writing state |
| Game answer (verified), Use It sentence, SRS review | `vocabulary:*` | — |
| Logout (both logout controls) | whole cache (`setScope(null)`) | — |

`router.refresh()` retentions: logout/login/onboarding/locale/profile name (identity- or locale-wide server
state), 401 handling (sends the route back through the gate), existing non-vocabulary forms (unchanged; outside
proven scope). None were added.

## 12–13. Static/common vs user overlay

Audit result: common content (Reading/Listening catalogs, Grammar topics, packs) is already server-rendered with a
small overlay and bounded queries. No server-global cache (`unstable_cache`, module promises) was introduced for
private data; a shared server cache for common catalogs was judged not justified by measurements (catalog RSC
renders 30–100 ms locally) and would add publication-invalidation risk. Retention bank content is never common.

## 14–16. Timeout, retry, dedupe

- Reads: 12 s deadline (capped 60 s), terminal states only (success / classified error). Tested with a hung fetch.
- Retries: default 1, hard cap 2, linear back-off; never for 400/401/403/404/409/422/500, never for mutations,
  and `/api/retention|/api/owner/retention|/api/admin/retention` URLs are refused outright.
- Dedupe: identical `[user, resource]` reads share one promise; different params never share.
- DB: existing pool deadlines unchanged (no retry by design).

## 17. Error-boundary contract

LEVEL 1 auth/shell (layout redirect, `(app)/error.tsx`), LEVEL 2 section core region, LEVEL 3 secondary region.
A failed background revalidation keeps a valid snapshot on screen (logged via diagnostics) instead of replacing it
with an error; a failed first load still shows the region error + retry.

## 18. Prefetch contract

CLASS A/B (route code, frame up to `(app)/loading.tsx`): default `InstantLink` behaviour. CLASS C: none beyond RSC.
CLASS D (private data): no prefetch. CLASS E (Retention Start/allocation, attempt payloads): never — Start is a
POST from a button; Retention links use `prefetch={false}`.

## 19. Retention runtime exception

Nothing in Retention's server logic changed. The only Retention edits: hub reads made concurrent (still fresh,
server time, owner-scoped) and links marked `prefetch={false}`. Retention UI does not import the client cache and
the cache refuses Retention URLs. Timer/phase/deadline/version/rotation/scoring/draft semantics untouched.

## 20. Observability

`setPrivateResourceDiagnostics(sink)` receives `{event: hit|miss|dedupe|retry|clear|invalidate, resource, detail}` —
stable labels (paths without query, resource keys) only; no payloads, text, tokens or ids beyond the key names.
Server-side `timed()` slow-operation logging is unchanged.

## 21. Security invariants

All invariants in the master prompt §28 hold: server validates identity/role/status/ownership on every request;
cache cannot grant access; logout and account switch clear the cache; no credentials reach the browser; Retention
privacy and allocation untouched.

## 22. Testing model

`tests/runtime-stability.test.ts`: user isolation, logout clear, no-scope no-store, in-flight discard after account
switch, freshness/force, dedupe, param separation, narrow invalidation, failure not cached, timeout terminal state,
bounded retries, permanent-status exclusion, Retention URL refusal, memory-only storage, layout/logout wiring,
view-specific Vocabulary contract, mutation invalidation scope, Retention prefetch + concurrent hub reads.

## 23. Measured evidence (sandbox, local production build, curl)

- Server route timings, 3 visits each (s): dashboard 0.125/0.075/0.083, reading 0.071/0.096/0.063,
  vocabulary 0.034/0.032/0.030, grammar 0.036/0.031/0.031, writing 0.041/0.031/0.031, retention 0.037/0.030/0.033.
- Vocabulary first-entry API payloads: library 2.6 KB (50 rows max), summary 175 B, folders 24 B, due 2.5 KB.
- Unauthenticated `GET /api/vocabulary/summary` → 401.
- Retention: 3× `Next-Router-Prefetch` + 3× plain GET of `/reading/retention` → `retention_attempts` count 0 → 0.
- Browser metrics (first response, usable view, async settled, client cache hit on return): **EXTERNALLY
  UNVERIFIED** — no browser could be installed in the sandbox (CDN blocked).

## 24. Future-module template

Every new learner module must document before merge:
UI FRAME · RESOURCE MAP (row in RUNTIME-RESOURCE-MAP.md) · CORE DATA · SECONDARY DATA · CACHE (none / privateResources
/ RSC) · CACHE KEY (`[userId, name:params]`) · FRESHNESS · INVALIDATION (prefix, triggering mutations) · TIMEOUT ·
RETRY (reads only, transient only) · ERROR SCOPE (L1/L2/L3) · PREFETCH CLASS · OBSERVABILITY labels · SECURITY
(server checks) · PRIVACY (what must never be cached) · TESTS.
