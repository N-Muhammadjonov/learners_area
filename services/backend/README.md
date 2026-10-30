# Python backend for arena/learners-area-next

The canonical entrypoint is `app.asgi:application`, not `app.main:app`.
`main.app` retains the public route inventory for regression tests. The ASGI
entrypoint adds the private renderer adapter. Public routes now follow the pinned
`main` backend contract (`b62b78f469e4f73aa80f441f630b012dc422af39`);
the initial migration's older-preview behavior overrides have been removed.

## Runtime boundary

- All HTTP actions, session authority, storage signing, grading and database
  connections run in Python. The 171 existing Next API files and the new catchall
  only forward requests and stream responses. There is no legacy handler fallback.
- Same-origin browser URLs and cookies stay unchanged. The relay retains separate
  Set-Cookie headers, multipart/binary bodies, Range reads and redirects. FastAPI
  validates origins and adds API security headers; page middleware remains Next's.
- Existing server-rendered Drizzle selectors still describe view reads in
  TypeScript. `src/db/client.ts` sends those prepared reads to Python. PostgreSQL
  enforces a read-only transaction, including for writable CTEs. UUID, JSON,
  arrays, decimal and date values preserve the previous view types.
- Reading schedule activation, Writing timeout finalization, Listening starts
  and Retention lazy finalization are explicit Python actions scoped to the
  authenticated user. A renderer request cannot supply another user identity.
- `src/db/tooling-client.ts` is a CLI-only maintenance connection. Seed/import
  commands use `tsconfig.tooling.json`; arbitrary legacy TS maintenance commands
  that import shared helpers must set `TSX_TSCONFIG_PATH=tsconfig.tooling.json`.
  The frontend runtime does not import that connection and its supervisor removes
  DATABASE_URL from the Next child process.

Private `/_frontend/*` routes require a shared server-only token of at least 32
characters. The `/api` catchall cannot reach them. Forwarded public origins are
trusted only when that token matches. Keep the backend on a private service
network where possible; use HTTPS for any cross-host service traffic.

## Input comparison

Input ZIP: `Learners_Area_FastAPI_cb6b3cdf_265_of_265_PARITY_HARDENED_V2.zip`.
SHA-256: `ead8bf6a8e523a3562194460bdc7b1f9a2252a97d8ca14e0dbc0bfe5ae164ef6`.

| Item | Preview before migration | Uploaded backend source | Result |
| --- | --- | --- | --- |
| Source commit | `184e33d103861922125655e23bb56e6b978fa1a5` | `cb6b3cdfdab8909c8d172df4714dba2bfe1a7b2e` | Compared all 171 current API files; 132 shared files identical, 39 different |
| Explicit API methods | 207 | 265 | All 207 paths/methods covered; additional Python methods reachable through the relay |
| SQL migrations | 53 | 67 | First 53 byte-identical; added 0053–0065, then the idempotent notification event index in 0066 |
| UI | Existing campus and module pages | Later backend contracts | Current React pages and campus assets preserved |

The latest comparison uses all 218 API files and all 466 shared backend library
and schema files from the pinned main commit. All 265 public methods are covered
by the Python inventory. The first 66 migrations match main; this branch adds
one additive partial unique index (0066) for idempotent in-app notifications.
`contracts/main-reference.json` pins the original files by
Git blob SHA, and the differential runner refuses a modified reference checkout.

Corrections include canonical sequence checks, Telegram account rules,
history-preserving content deletion, native Listening persistence, vocabulary
sense identity/SRS, Reading grading, Structures word boundaries, validation
messages, and Writing/Speaking feedback. All 32 original Listening browser
runtimes and the main dictionary presentation shards are shipped with checksums;
Python serves them without starting Node. Explicit dictionary context bindings,
translation revisions and immutable Retention wording revisions are available
as trusted Python maintenance helpers, not public learner endpoints.

Content authoring preserves published lesson blocks and past attempts. Reading
drafts own new physical targets and revisions; Vocabulary and Lesson authors
pin the same canonical snapshots/provenance as main. Snapshot text is preserved
verbatim while hashes use main's canonical normalization. Real PostgreSQL
parameter-inference errors in SRS review and content publication are corrected.

Shared fixes include stable dependency versions, real asyncpg JSON/UUID codecs,
a single concurrent pool initializer, transaction-pooler-compatible statements,
verified Supabase TLS, portable ICU collation and PDF fonts, and preserving the
Listening sandbox's route-specific CSP. Vocabulary region failures remain
retryable 503 responses, including when acquiring a connection fails.

The original `PORT_STATUS.json` and `MIGRATION_AUDIT_*.json` files are historical
package reports. They are not claims that every endpoint has live integration
coverage. `contracts/preview-adaptation.json` is the superseded initial migration
record; `contracts/main-parity.json` records the current checks and limitations.

## Performance and future frontend

Listening vocabulary enrichment fetches all candidate senses, pronunciation and
occurrence metadata in one indexed query instead of querying each word. The
100-word differential fixture reduces total endpoint SQL calls from 307 to 5,
including identity and content access checks. See the parity contract for raw
local timing samples; embedded PostgreSQL and different test transports are not
a deployed latency benchmark. Other endpoints have no blanket speed guarantee.

Password hashing/checking runs in worker threads, leaving the async event loop
available to other requests. Auth-change SSE streams share one dedicated LISTEN
connection per Python worker, with bounded queues and reconnect handling. The
normal query pool remains bounded and transaction-pooler compatible.

A future HTML/CSS/JavaScript frontend can use the same `/api/*` URLs, JSON,
multipart uploads and HttpOnly session cookies. Serve it on the same public
origin through a reverse proxy to FastAPI; keep private `/_frontend/*` routes
server-only. React/Next is only the current renderer and transport. Browser
Listening assets contain JavaScript because they execute in the browser.

## Start and deploy

From the repository root, use the root `.env.example` for the complete existing
configuration. Keep the same DATABASE_URL and AUTH_SECRET to preserve user data
and compatible sessions. Python 3.14 and the ICU native library are required;
`services/backend/Dockerfile` installs the library.

```bash
npm ci
npm run backend:setup
npm run backend:check
npm run dev
```

The local supervisor creates an ephemeral service token shared by both children
when no token is configured. It waits for Python before starting Next and stops
both on exit. `npm start` uses the same supervisor after `npm run build`.

For two separately hosted services, configure the frontend:

```dotenv
BACKEND_MANAGED=external
BACKEND_INTERNAL_URL=https://your-private-python-service.example
BACKEND_SERVICE_TOKEN=the-same-random-secret-of-at-least-32-characters
```

Set that same token on Python, plus the existing database, auth, storage and AI
configuration. Run Python from `services/backend`:

```bash
python -m uvicorn app.asgi:application --host 0.0.0.0 --port 8000 --no-access-log --no-proxy-headers
```

Set PUBLIC_BASE_URL to the public frontend origin and TRUSTED_ORIGINS to the
exact trusted frontend origins. For local storage, STORAGE_LOCAL_DIR must point
to the existing private upload directory. Remote storage keeps the existing R2/S3
settings. Do not expose a local uploads directory as frontend static files.

`compose.preview.yml` is a two-service self-hosting option:

```bash
docker compose -f compose.preview.yml up --build
```

Compose requires BACKEND_SERVICE_TOKEN in `.env`. It exposes frontend port 3000;
Python is internal to the Compose network. It persists local uploads in the
repository's `.data/uploads` directory. Docker images were not built or launched
in the restricted verification environment.

The code does not apply migrations on startup. Review and apply 0053–0066 to the
intended database with the existing migration process before serving this
revision. No live database changes or service deployment were performed as
part of this code migration. A Next-only Vercel deployment cannot run the managed
Python subprocess; configure an external Python service there.

## Verification

Checks performed for this migration:

- 2,556 Python tests, including 1,531 fixtures captured by executing actual main
  functions and 288 Listening/dictionary asset integrity cases.
- 2,120 differential HTTP cases: all 265 methods across anonymous, student,
  teacher, admin, owner, pending, suspended and rejected identities. These cover
  authentication, authorization, empty bodies and missing-resource contracts;
  they are not 2,120 successful content workflows.
- 119 sequential workflow cases run the real main handlers and canonical Python
  ASGI app against separate freshly migrated PostgreSQL engines. They cover
  Vocabulary/SRS, Structures, Reading, Listening, Writing, Speaking, Retention,
  all 17 registered content authors, publication, immutable live lesson edits,
  editorial bindings and Retention revisions. All responses and 29 database
  state/hash checks match. Generated UUIDs and timestamps are normalized only
  across independent runs; each content hash is also checked against main.
- 8 Node transport/read-adapter tests; includes all 207 original API exports.
- 337 UI tests, including updated server-contract assertions targeting Python.
- Baseline verification applied the 66-migration chain to embedded PostgreSQL
  (PGlite); migration 0066 was added afterward and still requires focused
  fresh-database QA. All columns of the 126 typed Drizzle tables were found.
  Nine actual ASGI HTTP checks cover bcrypt login,
  fresh identity, typed reads, database-enforced read-only behavior, inline
  Listening data/CSP, history-preserving deletion and logout revocation.
- TypeScript, ESLint, backend import/native-dependency check and production build.

```bash
npm run backend:test
npm run backend:test:postgres
npm run backend:test:main
node --conditions=react-server --import tsx --test tests/backend-proxy.test.ts tests/backend-read-client.test.ts
npm run test:ui
npm run typecheck
npm run lint
npm run build
```

`BACKEND_PYTHON` can override the interpreter for the supervisor and PostgreSQL
probe. `backend:test` runs in `services/backend` because baseline inventory tests
read package reports relative to that directory. The broad legacy `npm test`
suite still includes tests coupled to retired Next handler source; it is not the
migration gate listed above.

To reproduce the differential comparison, create an independent main checkout
at the pinned commit with its original content files. The reference needs the
same installed Node dependencies (for example, link its `node_modules` to this
checkout's `node_modules`). Then run:

```bash
git worktree add ../main-reference b62b78f469e4f73aa80f441f630b012dc422af39
MAIN_REFERENCE_ROOT=../main-reference npm run backend:test:main
```

The runner writes reports under `/tmp` (`PARITY_OUTPUT_DIR` overrides it), exits
nonzero for any response/state mismatch, and never contacts a live database or
external provider. `tools/generate-main-fixtures.mjs` and
`tools/build-main-listening.mjs` rebuild fixtures/assets from that same reference
using `TSX_TSCONFIG_PATH` set to the reference's `tsconfig.json`.

PGlite verification uses a PostgreSQL engine with a stdio test-driver adapter;
it does not prove the live asyncpg network/TLS path. Live Supabase, R2, Telegram,
Google and external AI roundtrips, authenticated browser QA and a deployed preview
were not verified here. Endpoint inventory coverage is not production parity
certification. Live-provider and deployment verification remains necessary.
