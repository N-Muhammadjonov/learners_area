# Campus, study profile and native navigation

This change reduces the search field's preferred width from 270 to 135 px and
maximum width from 600 to 300 px. Nested workspaces show `← Main`, their module
name, search and account/preferences in one row. Main shows the brand and white
slogan. The sidebar and hamburger remain absent as requested.

Campus badges now test their actual world anchor against foreground building
geometry. Previously a roof touching any badge edge hid the entire badge, even
when the anchor and facade were visible. The badges still follow the buildings
and become inaccessible when their anchor is genuinely hidden. The central
rocket is another 20% larger, with the emblem raised to keep it clear. The
castle's middle cone is taller and its doubled waving Uzbekistan flag stands on
a separate pole with visible clearance above the roof.

Dashboard's course line uses its translated `IELTS` label once. Profile now
shows Main's complete study form, prefilled from `onboarding_profiles`: language,
English level, current/target IELTS band, explicit day/month/year date inputs,
daily study minutes and strongest/weakest skills. It uses the existing
`PATCH /api/profile/study`, including strict validation, a transaction and locale
cookie. The new browser projection reads only the authenticated user's profile
and verified Telegram contact. Linked Telegram identity, student replacement
and the staff restriction match Main. Date drafts and save confirmation survive
refresh. The common browser dictionaries include Main's newer labels.

## Navigation and authority

The native router uses URLs, `history.pushState`, `popstate` and lazy browser
module imports. It stages a new view before committing it and aborts superseded
navigation. There is no `go{id}` dispatcher or full document reload for ordinary
internal links. Direct document requests remain protected by the Python gate.

The first private entry reads `/api/frontend/session`. The persistent workspace
uses that session presentation until expiry or an authority refresh. The
existing authority watcher handles logout, role/status changes, session expiry,
visibility/online reconciliation and optional access events. Each API operation
still authorizes the current user and resource on the server. A cached label or
page never grants access to a protected write or media resource. PostgreSQL
stores accounts, roles and learning records. R2/Storage serves media; it is not
the source of user authority.

Code prewarming now also supports campus buttons. Deliberate hover/focus can
warm allowlisted catalogue reads, with one request group at a time and the
existing bounded intent budget. Selected landing-page DTOs use a bounded,
identity-scoped memory cache for 15 seconds. No localStorage/IndexedDB private
cache is added. Exams, attempts, answers, staff reads, arbitrary searches and
realtime state are excluded. Logout/authority changes clear the scope. Mutation
start AND completion invalidate the snapshots and advance transport epochs,
so an older request cannot seed a later identity or mutation's cache.

## Production stack

Production is HTML5 + CSS3 + browser JavaScript, Python FastAPI, PostgreSQL and
R2/Storage. `python3 scripts/build_native_assets.py` copies reviewed CSS and
browser modules, validates the static allowlist and emits the route/asset
manifest. `css/global.css` is the canonical plain stylesheet; deployment does
not run a CSS compiler. `routes.json` is checked against the JavaScript router.
Vercel and both application Docker stages use Python; no npm install or Node
build/server is needed. The standalone Live Partner relay is now Python
FastAPI/Uvicorn/wsproto, retaining the browser protocol and token/participant,
origin, TURN-only candidate, size and rate limits. An existing standalone relay
host must be rebuilt/restarted from `services/live-signal` to adopt that change;
pushing the Vercel app does not update a separate host.

Next/React production dependencies and legacy npm start commands were removed.
Historical `src` and migration comparison tools remain as test references, are
excluded from deployment, and are not browser assets. Optional developer tests
still use Node; this is not a site runtime. The PDF font now lives with Python
backend assets. No live database migration, content deletion or seed was performed.

## Verification

- Main reference: `b62b78f469e4f73aa80f441f630b012dc422af39`.
- All 118 Main page routes resolve to native implementations (119 browser
  routes including the separate campus/dashboard homes); none resolves to the
  unavailable module. All 218 Main API path patterns exist in FastAPI. These
  inventories verify coverage, not every visual or interaction detail.
- Native frontend suite: 948 passes, 11 existing skips, zero failures.
- Campus geometry, camera, world anchor, false-edge occlusion, flag and rocket:
  32 passes.
- Backend suite from its documented working directory: 2,564 passes.
- Python signalling protocol: 7 tests, plus real Uvicorn/WebSocket health,
  authentication, peer join, offer, TURN relay and disconnect checks.
- Packaging works with Node/npm absent from PATH; rejects framework imports and
  excludes symlinked/private files. Static build: 444 runtime files, 119 routes.
- Python application import/startup check passes. Lockfile has no Next/React or
  production npm dependencies. `git diff --check` passes.
- Captured ASGI/PostgreSQL responses mount 96 native DOM cases in EN/UZ,
  including management role fallback. The real PostgreSQL-engine gate passes: 66 isolated migrations, 126 schema
  tables, 295 HTTP checks, 146 native decoder checks and 96 native DOM mounts.

The controlled Node/jsdom benchmark used captured ASGI payloads and 40 ms
simulated read latency. Ten warm mounts per route produced these results:

| Route | First DOM mount ms | Warm median ms | Warm p90 ms | Warm API requests |
| --- | ---: | ---: | ---: | ---: |
| Dashboard | 74.35 | 3.47 | 4.48 | 0 |
| Listening lessons | 65.55 | 7.64 | 10.13 | 0 |
| Reading lessons | 51.01 | 0.27 | 0.32 | 0 |
| Grammar lessons | 41.18 | 0.22 | 0.27 | 0 |
| TED / Podcast | 42.46 | 0.80 | 0.88 | 0 |
| Progress | 59.00 | 8.64 | 12.03 | 0 |

These numbers exclude browser layout/paint, GPU work, production network,
database round trips and media transfer. They are not a production 10–100 ms
SLA. First loads, cold functions and time-sensitive exams still need network
work. Current device screenshots and a browser-by-browser visual comparison
are not certified: local Chrome previously terminated before CDP startup.
