# Native frontend + FastAPI integration

Source frontend: `669a5ab5da9fccc2f39d2473d70b35e85c9f5d36`.
Authoritative target: `5016012c9fae3cc59ba27d011f45ed0bda7e0a0c`.
Reference main: `b62b78f469e4f73aa80f441f630b012dc422af39`.
Destination: `arena/learners-area-next` only. Neither main nor the source branch is merged.

## Runtime

`frontend/vanilla` contains the 1,032 active V63 files, plus narrowly scoped
integration changes. The historical deliverables archive is excluded. The
119-route static build contains no Next server, React hydration, database
connection or private renderer token. Generated presentation modules are
reviewed build inputs, not regenerated from a different Next source tree.

The original target's complete campus v2 is copied byte-for-byte. The native
campus passes the freshly verified role into its existing management option.
Only active teachers, admins and owners can see the detached Management castle;
the 12 learning modules and their circuit network retain the target geometry.
Management and all protected reads also enforce server authority independently.

Default execution: browser -> same-origin Python `app.asgi:application` ->
existing PostgreSQL/storage/provider services. `npm run build` uses Node only
to produce static assets. `npm start` and `npm run dev` invoke the Python
launcher. After building, Node is unnecessary on the application host.

```sh
npm ci --ignore-scripts
npm run backend:setup
npm run build
npm run backend:check
services/backend/.venv/bin/python scripts/serve.py
```

Configure the existing `.env.example` settings for the chosen environment.
OS environment values take precedence over literal dotenv files. Startup does
not migrate or seed a database. Keep existing asyncpg TLS and transaction-pool
settings. No live database, storage object or provider configuration was changed.

`compose.preview.yml` builds one application container and maps port 3000 to
Python's 8000, retaining the existing local storage mount. The final Docker
stage contains Python and the built assets, without a Node runtime. Vercel
uses `server.py` with the same ASGI application and core lifespan. These host
configurations require verification on their actual hosts; no deployment is
claimed here. Existing Next source/dependencies remain available for tooling
and rollback using `legacy:*`, `Dockerfile.legacy-next`, and the explicit legacy
backend Docker/Compose/Vercel copies.

## Browser boundary and modules

Added GET contracts: `/api/frontend/public`, `/api/frontend/session`,
`/api/frontend/view?route=...&region=...`, and `/api/frontend/staff/{kind}`.
The private token-protected `/_frontend/*` renderer is unchanged and separate.
Existing `/api/*` mutations retain their handlers, ownership checks, origin
validation, publication rules, rate limits and server grading.

Browser read models cover Dashboard, Progress, Mock catalogue/history,
Assignments, Coach, Live Classes, Profile, Grammar and lesson authoring,
Reading/Listening catalogues and attempts, MCQ programme/stages, Vocabulary
through existing APIs, course roadmap/lessons, Video, Speaking, all eight
Writing tabs and owned workflows, Management, teacher operations, materials,
Admin Content, and Owner Audit. Notifications/Support use their existing APIs.

Identity and role always come from current database-backed session authority.
Changing role/status or revoking a session invalidates its old cookie. Answer
keys remain hidden until the existing server workflow releases them. Derived
grammar exercises, notes, drafts, assessments and feedback remain user scoped.
Optional widget failures return explicit unavailable/null states, not fabricated
zeroes or scores. External grading unavailability saves the essay with a failed
status and no invented band. Integration status distinguishes configured from
verified connections and never sends provider credentials.

Static serving accepts only build-manifest assets and registered SPA routes.
It reserves API/private/repository paths, prevents traversal, protects direct
navigation, and gives HTML a fresh CSP nonce and private/no-store headers.
Legacy routes and Reading query aliases redirect without a Next handler.

Compatibility fixes include cross-window cancellation without global patches,
24/60-card lesson paging and media-note flags, global MCQ progress independent
of pagination, Listening catalogue pagination, exact 41-to-40 Reading omissions,
stale Reading Check invalidation, and filter-bound Writing pattern cursors.

One existing business file needed a narrow SQL correction:
`exam_lifecycle_port.py` now casts the repeated duration parameter to integer.
PostgreSQL previously rejected exam creation because that parameter was inferred
as both integer (stored duration) and double precision (`make_interval`). Exam
modes, durations, deadlines, ownership and revision rules are unchanged.

The 75 Retention v2 texts are copied from the source's reviewed staging files.
Their existing 49 calibration anomalies are preserved and tested. The private
admin review says `QA_HOLD_DO_NOT_PUBLISH`; this integration never publishes,
seeds, or changes their rubric or scores.

## Verification and preservation

See `verification.json` for exact current pass/skip/blocked counts. The new
integration gate uses the real Python ASGI application and 66 migrations in a
disposable embedded PostgreSQL engine, with production frontend decoders and
native DOM mounts of captured ASGI responses. It is not a live-provider or
browser/device certification. HTML layout, WebGL rendering, Safari, mobile
hardware, live Supabase/PostgreSQL, R2, Telegram, Google and external AI/STT,
performance/load and actual Vercel/Docker deployment still require their
appropriate test environments. TCP/browser automation is unavailable here.

```sh
npm run test:frontend
npm run backend:test
npm run test:integration
npm run backend:test:postgres
services/backend/.venv/bin/python scripts/audit-vanilla-preservation.py
git diff --check
```

`target-baseline.json` records every original target file's SHA-256 and Git
blob. `source-runtime-baseline.json` records each imported active file.
`target-divergence.json` records all 44 target-only commits relative to main;
`target-only-files.json` inventories their resulting differing files.
`preservation.json` verifies original files, all migrations, campus geometry,
and the complete 265-method API inventory. `changed-files.json` lists every
intentional existing-file change and every added file. Unexpected protected
changes fail the audit. No merge, reset, rebase or force push is used.
