# Native deployment portability

The application is Python FastAPI/ASGI plus the packaged Vanilla JS frontend.
The same `app.asgi:application` runs on Vercel, Railway and other Python/container
hosts. There is no Next.js, React or Node backend. Node is used only for optional
local test/database tooling, not for the Python asset build or serving requests.

## Build and start

- Install Python dependencies from `services/backend/requirements.txt` (the root
  `requirements.txt` is the Vercel mirror). The container uses Python 3.14.
- Build: `python3 scripts/build_native_assets.py`. Keep the complete repository
  layout or the equivalent layout packaged by `services/backend/Dockerfile`.
- Container/generic host: `HOST=0.0.0.0 PORT=<host-port> APP_ENV=production python3 scripts/serve.py`.
  `BACKEND_PYTHON` may select a virtual environment. The launcher uses one Uvicorn
  worker, bounded admission and graceful shutdown; scale replicas with a reviewed
  total database budget rather than changing the worker count blindly.
- Vercel: `server.py` mounts the same ASGI application and owns its lifespan;
  `vercel.json` selects FastAPI and the native Python asset build. Do not restore
  a retired framework based on an old dashboard label.
- `/healthz` is process liveness; `/readyz` also checks PostgreSQL, the shared rate
  store/AI claim function and the asset manifest. `/api/version` reports release
  identity only. Configure `APP_COMMIT_SHA` and optionally `APP_REGION` on a host
  without the provider's commit/region variables.

## Environment identity and public URLs

Set `APP_ENV=production` or `preview` explicitly on a generic host. Accepted modes
are `development`, `test`, `preview`, `production`. Managed Vercel production and
preview flags, or Railway's production/non-development environment name, cannot
be downgraded to development by an accidental `APP_ENV=development`. Invalid mode
values fail closed. `NODE_ENV` does not select Python security behavior.

`PUBLIC_BASE_URL` is the explicit HTTP(S) public origin, with no credentials,
path (other than `/`), query, fragment or whitespace. It wins over the legacy
`NEXT_PUBLIC_APP_URL`; leave that alias empty on new deployments. The legacy
`https://learnersarea.uz/` default remains for compatibility. Set the real public
origin before a host/domain cutover. A generated preview URL or incoming Host/
forwarded-host header never becomes canonical authority.

The public home canonical, OpenGraph/JSON-LD URLs, robots and sitemap read the
same runtime setting. Invalid explicit origins return a no-store 503 instead of
silently falling back. Preview denies indexing and serves an empty sitemap.
Private documents strip public content/metadata and retain noindex, authentication
and role checks. Same-origin UI/API routes remain relative; changing a host does
not rewrite stored media keys or learner records.

## Database, storage and secrets

Keep `DATABASE_URL`, `AUTH_SECRET` (at least 16 characters), storage/provider
credentials and external provider secrets server-side. Use separate credentials,
database/buckets and signing keys for preview; the application cannot prove that
a supplied preview DSN is not the production database. Do not seed production.

`asyncpg` uses `DATABASE_POOL_MAX=5` by default (range 1–20), a five-second acquire
bound (`DATABASE_POOL_ACQUIRE_TIMEOUT`, 0.05–20 seconds), eight-second connection
and twenty-second query bounds. Size the sum of all replica/function pools against
the available PostgreSQL/Supabase connection budget. Supabase direct/session and
transaction pooler connections use verified TLS and disabled statement caching;
do not bypass certificate verification or add spaces before a DSN password. URI
reserved characters in credentials need percent encoding, not literal whitespace.

Use `RATE_LIMIT_BACKEND=postgres` in deployed environments. The operational table
from migration 0071 and AI claim function from 0072 must already exist. Memory
limits are for database-free development only and are rejected in preview and
production. See [rate-limit boundary](RATE-LIMIT-DEPLOYMENT-BOUNDARY.md).

Set `STORAGE_PROVIDER=r2` with the existing private R2 configuration, or an
explicit supported `s3` provider. A missing provider fails closed on managed or
explicit deployed environments. Local storage is an explicit development/durable
single-node option; ephemeral function/container disks are not persistent media.
`STORAGE_LOCAL_DIR` must not be publicly served. Preserve object keys and bucket
permissions; align CORS with the new exact website origins when a cutover is
approved. A hosting-only move requires no application schema migration.

## Proxy and authentication boundary

By default, CSRF uses the request's origin. Set `TRUST_PROXY_HEADERS=true` only
when an exclusive trusted proxy overwrites forwarded Host/Proto and direct
listener access is blocked. It is not automatically enabled by a hosting label.
`TRUSTED_ORIGINS` adds exact CSRF origins; no wildcards. Cookies stay host-only:
a new domain requires signing in again. Preserve HTTPS and stable signing keys
across replicas. Embedding requires explicit `ALLOWED_FRAME_ANCESTORS`; default
framing is self only. Production/preview disable development diagnostics, eval
permissions and raw password-reset-token responses. Email/password login and
password-reset delivery are separate capabilities; production reset delivery is
not implemented and returns `reset_unavailable`, never a raw token.

`CLOUDFLARE_ORIGIN_SECRET` is optional. When enabled, the edge must overwrite
`X-LA-Origin-Verify` with the same strong secret and every normal public request
must pass that edge; health/readiness probes have bounded exceptions. Do not copy
that setting onto a new direct Vercel/generic URL without its matching route, or
public requests will correctly be refused. Only this verified boundary permits
`CF-Connecting-IP` to identify a client. Otherwise the ASGI peer address is used;
a shared hosting proxy can therefore share an IP bucket. Do not trust arbitrary
forwarding headers to avoid that conservative behavior.

Keep email/password access available while the separate Telegram bot is offline.
Preserve bot identity, service credentials, callbacks and saved intents when
restoring it. No hosting migration, DNS change, bot creation or secret rotation is
performed by this source repair.

## Move, restart and rollback

1. Package a tested commit and record its SHA, required configuration names and
   existing migration compatibility. Retain the prior image/artifact and secret
   version in the owner's protected operations store.
2. Build/start against isolated preview resources, then verify the essential
   automated tests and liveness/readiness. Manual device/learner checks belong to
   the owner. Never load-test production as a substitute for an isolated test.
3. At an approved cutover, configure the exact public origin, HTTPS/proxy trust,
   media CORS and external callbacks. Keep a working email login path. Switch
   routing only after readiness and release identity are verified.
4. Roll back application code/config to the retained compatible release if
   readiness fails. Code rollback does not undo database writes or restore R2.
   Keep additive 0071/0072 while any runtime depends on them; prefer reviewed
   forward repair to schema deletion. Never run migrations from application startup.
5. Use the existing [recovery package](PLATFORM-RECOVERY-20261029.md) for isolated
   encrypted DB/media restoration and reference reconciliation. Production restore
   is a separate incident action, not part of a normal code rollback.

The controlled 200/500/1000-learner measurements are documented separately in
[load validation](PLATFORM-LOAD-VALIDATION-20261101.md). They establish the tested
resource/workload envelope, not unlimited capacity on every hosting plan. A new
host still needs its own connection/CPU/memory/concurrency budget.
