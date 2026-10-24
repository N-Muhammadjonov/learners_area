# Python backend for arena/learners-area-next

The canonical entrypoint is `app.asgi:application`, not `app.main:app`.
`main.app` retains the uploaded package's public route inventory for baseline
regression tests. The ASGI entrypoint adds the private renderer adapter and
request-local compatibility behavior for this preview's existing frontend.

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
| SQL migrations | 53 | 66 | First 53 byte-identical; added 0053–0065 and synced the journal/typed schema |
| UI | Existing campus and module pages | Later backend contracts | Current React pages and campus assets preserved |

Compatibility adjustments preserve the preview's inline Listening runtime,
vocabulary/resource response fields, reversible Listening archive, 120-character
vocabulary limit, existing Telegram widget signup, material deletion semantics
and required contextual video vocabulary examples. New session revocation stays
authoritative. Later course-sequence restrictions are not enabled by the preview
API adapter; the existing UI progression selectors remain unchanged.

Shared fixes include stable dependency versions, real asyncpg JSON/UUID codecs,
a single concurrent pool initializer, transaction-pooler-compatible statements,
verified Supabase TLS, portable ICU collation and PDF fonts, and preserving the
Listening sandbox's route-specific CSP. Vocabulary region failures remain
retryable 503 responses, including when acquiring a connection fails.

The original `PORT_STATUS.json` and `MIGRATION_AUDIT_*.json` files are historical
package reports. They are not claims that every endpoint has live integration
coverage. `contracts/preview-adaptation.json` records this adaptation separately.

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

The code does not apply migrations on startup. Review and apply 0053–0065 to the
intended preview database with the existing migration process before serving the
new backend. No live database changes or service deployment were performed as
part of this code migration. A Next-only Vercel deployment cannot run the managed
Python subprocess; configure an external Python service there.

## Verification

Checks performed for this migration:

- 733 Python tests: 706 uploaded baseline checks and 27 preview integration cases.
- 8 Node transport/read-adapter tests; includes all 207 original API exports.
- 337 UI tests, including updated server-contract assertions targeting Python.
- All 66 migrations applied to embedded PostgreSQL (PGlite); all columns of the
  126 typed Drizzle tables found. Nine actual ASGI HTTP checks cover bcrypt login,
  fresh identity, typed reads, database-enforced read-only behavior, inline
  Listening data/CSP, reversible archive and logout revocation.
- TypeScript, ESLint, backend import/native-dependency check and production build.

```bash
npm run backend:test
npm run backend:test:postgres
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

PGlite verification uses a PostgreSQL engine with a stdio test-driver adapter;
it does not prove the live asyncpg network/TLS path. Live Supabase, R2, Telegram,
Google and external AI roundtrips, authenticated browser QA and a deployed preview
were not verified here. Endpoint inventory coverage is not production parity
certification. Live-provider and deployment verification remains necessary.
