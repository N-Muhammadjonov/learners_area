# Deployment portability — Work QA 2

Vercel remains the production host. No domain purchase, DNS change, production
promotion, database migration or storage migration was performed in this pass.
`learnersarea.uz` is only a possible future domain, not an active authority.

## Public origin and environment

`src/lib/config/site.ts` is the URL authority. `PUBLIC_BASE_URL` wins over the
legacy `NEXT_PUBLIC_APP_URL`. New deployments should set only `PUBLIC_BASE_URL`.
It must be a complete HTTP(S) origin with no credentials, path, query or fragment.
Invalid explicit configuration fails rather than silently choosing another host.
A generated `VERCEL_URL` never becomes the canonical origin.

Home canonical/OpenGraph metadata, root metadataBase, robots and sitemap use this
same value. Canonical metadata is intentionally limited to the public home page;
private paths have noindex and are absent from the sitemap. Sitemap/robots are
dynamic so their origin is evaluated by the running deployment. Rebuild and
redeploy when changing the legacy NEXT_PUBLIC alias, as Next may inline it.

Use `APP_ENV=development|preview|production`. Vercel's `VERCEL_ENV` is a fallback,
not a requirement. On generic hosts set APP_ENV explicitly, particularly preview:
`NODE_ENV=production` describes an optimized build, not resource isolation.
Preview robots disallow all paths, preview metadata is noindex, and its sitemap
is empty. It may retain the configured production canonical without adopting its
own transient hostname as production.

Same-origin UI/API links and Telegram callback paths remain relative. Redirects
use the incoming request URL, not a fixed production domain. Upload objects are
identified by opaque keys and `/api/resources/<key>`, not by the web host.

## Security and reverse proxies

CSRF compares scheme, host and port; HTTP and HTTPS on the same host are not the
same origin. `TRUSTED_ORIGINS` is an explicit comma-separated allowlist; the
configured canonical origin is also trusted. Do not add a wildcard. A cross-site
browser request with neither Origin nor Referer is rejected using Fetch Metadata.
Headerless non-browser clients still require each route's normal authentication.

Plain Node ignores forwarded Host/Proto for the CSRF origin. Behind your own TLS
proxy set `TRUST_PROXY_HEADERS=true` only if the proxy overwrites those headers
and direct access to the Node listener is blocked. Vercel's managed proxy is
recognized by its deployment flag. Configure the proxy to preserve the public
Host and send the public scheme; this also matters for framework redirects and
Secure cookies. Test through the public HTTPS URL, not just the internal port.

Session cookies remain HttpOnly and host-only (no fixed Domain). HTTPS uses the
existing Secure/Partitioned/SameSite=None policy required by embedded previews;
HTTP local testing uses SameSite=Lax. CSRF validation remains mandatory. Moving to
another domain requires signing in again: a host-only cookie is not transferable.
`AUTH_SECRET` is stable across replicas of one environment and separate between
production and preview. Never copy production cookies into preview.

Framing defaults to self on every host. An embedding shell must be named explicitly
in `ALLOWED_FRAME_ANCESTORS`; merely being a preview/custom host no longer permits
all HTTPS sites to frame the application.

The audit found that the previous reset endpoint returned its raw token in every
environment. This Work change gates that shortcut to `next dev` AND
`ALLOW_DEV_RESET_LINKS=true`. Production/preview return the same 503 for every
email until actual email delivery is implemented; the UI shows a localized
unavailable message. This closes a credential leak, but email recovery remains an
OPEN functional requirement. Never re-enable raw token responses as a workaround.

## Custom domain on Vercel (future operator actions)

1. Buy the chosen domain and add it to the existing Vercel project.
2. Use the exact DNS records Vercel displays for that domain; do not copy stale
   example A/CNAME records from a document.
3. Verify ownership and HTTPS certificate issuance. Keep the old URL available
   while testing; configure the desired canonical redirect at the hosting layer.
4. Set production PUBLIC_BASE_URL to the new HTTPS origin; remove or align the
   legacy alias. Audit explicit trusted origins and iframe allowlists.
5. Add the new origin to the private R2 bucket's CORS policy for signed PUT/GET,
   preserving methods/headers required by the upload flow.
6. Update Telegram's allowed website domain and any configured website/bot
   PUBLIC_SITE_URL, INTERNAL_API_URL, WEBHOOK_BASE_URL as applicable. This pass
   did not touch the separate bot branch. Email sender/provider and external
   callback allowlists must also be updated when those integrations exist.
7. Redeploy, then verify sign-in/out, admission, direct URLs, uploads/downloads,
   canonical/OpenGraph, sitemap/robots, and reset delivery availability.

No application feature rewrite or R2 object relocation is needed for this switch.

## Another Node host (future operator actions)

- Runtime tested in this workspace: Node 24.21.0 (`.nvmrc`), npm lockfile install.
- Install: `npm ci`; build: `npm run build`; serve: `npm run start -- --hostname
  0.0.0.0 --port 3000` (choose the provider's port). Keep `.next`, `public`, package
  files and production dependencies. No Vercel CLI or API is needed to start.
- Run under a process manager/container with restart policy and graceful shutdown.
  Terminate HTTPS at a trusted reverse proxy; expose only the proxy publicly.
- Configure PUBLIC_BASE_URL, APP_ENV, AUTH_SECRET, DATABASE_URL, STORAGE_PROVIDER
  and the existing R2 credentials/endpoint/bucket. Match optional AI/STT/email and
  Telegram configuration to the intended environment. Keep secrets server-side.
- `/api/version` is a lightweight liveness/build-identity endpoint, not a database
  readiness check. APP_COMMIT_SHA and APP_REGION are portable metadata; Vercel
  values are optional fallbacks. Confirm readiness using authenticated page/API
  smoke tests and a separate private DB check. Never expose database credentials.
- PostgreSQL/Supabase connects through DATABASE_URL using pg/Drizzle. Size the
  per-process pool against the total replica count. Use the provider's supported
  TLS/pooler settings; never disable certificate verification as a migration fix.
- The private R2/S3 bucket stays where it is. Its signed URLs depend on storage
  credentials/endpoint, not the web host. Keep CORS aligned with website origins.
  R2/S3 origins are allowed for browser connection and signed media playback.
- Set STORAGE_PROVIDER explicitly. Unknown or missing production configuration
  fails closed instead of silently falling back to ephemeral local disk. Local
  storage is only an explicit development or durable single-node option outside
  `public/`, with a backed-up mounted volume; the intended production remains R2.
- Do not run db:seed or db:push against production. A hosting-only move requires
  no schema migration. Any separately required migration needs review, backup
  and the user's production approval.

`vercel.json` (region `sin1`) is provider deployment configuration and may be
ignored on another host. VERCEL_REGION / VERCEL_GIT_COMMIT_SHA are optional log or
version metadata; business logic has no Vercel KV/Blob/API dependency. The only
Edge component is standard Next middleware, supported by `next start`; DB work
runs in Node. No cron service is silently assumed: schedule retention explicitly.

## Environment separation and operational boundaries

The app cannot infer whether two independently supplied DB credentials point to
the same production database. Operators must provide separate preview DB, R2
bucket/credentials, AUTH_SECRET and external service credentials. Never seed or
run destructive retention against a production-connected preview. This pass did
not inspect/change the deployment provider's secret settings and makes no claim
that the existing remote preview is isolated.

Current rate limits are process-local. A multi-replica deployment must add a
shared enforcement layer or an equivalent gateway limit before claiming global
abuse resistance. Retention concurrency, backup/restore drills, R2 lifecycle and
full QA acceptance are still tracked in the original QA2 work; portability is
not evidence that those separate requirements passed.

## Hard-coded host inventory

Search scope: runtime src, next.config, scripts, tests, README, docs and tracked
configuration (not dependency/build output or private .env). Classification:

| Match location | Class | Decision |
|---|---|---|
| docs/PRODUCTION-MIGRATSIYA.md | A: historical deployment evidence/examples | Preserve historical Vercel URL; not runtime authority |
| docs/MANUAL-CHECK.md | A: historical production verification | Preserve measured target and explicit example command |
| docs/READING-PRODUCTION-STABILITY.md | A: incident and measurement evidence | Preserve original host; do not rewrite history |
| scripts/verify-production-reading.mjs | A: operational test; former unsafe default removed | Require explicit PROD_BASE_URL or PUBLIC_BASE_URL; example remains |
| tests/cookie-policy.test.ts, tests/security-http.test.ts | B: localhost fixtures | Retain; not a production redirect |
| tests/deployment-portability.test.ts | B: generated-preview and custom-domain fixtures | Assert no VERCEL_URL canonical fallback |
| README.md localhost URLs/CORS sample | C: local run/test instructions | Retain examples; production CORS must use actual origin |
| scripts/verify-uploads.mjs localhost comment | C: local testing | Retain |
| next.config.mjs allowedDevOrigins | C: Next dev/legacy Arena preview only | No production effect |
| .env.example legacy localhost canonical default | C: removed ambiguous default | Both public-origin variables now blank with explicit setup guidance |
| src/instrumentation.ts and api/version | A: optional platform diagnostics | Generic version fields added; no business dependency |
| src/lib/http/request-origin.ts host-only comparison | D: runtime security defect | Compare complete origins; forwarded headers require trusted proxy |
| src/lib/config/site.ts permissive normalization/framing | D: runtime deployment security defect | Validate origins, explicit embedders, one canonical configuration |
| reset endpoint unconditional raw token | D: runtime authentication defect | Development-only opt-in; production unavailable until delivery exists |

There is no hard-coded Vercel production origin in runtime application links.
Provider URLs for YouTube, Telegram widget and R2/S3 are service endpoints, not
Learners Area's canonical domain. Website callbacks are relative; bot variables
are an integration contract, not newly implemented bot work.

## Domain migration checklist / rollback

Record old/new public origin, build SHA and provider settings. Verify DB and R2
backups independently; do not claim a backup exists from this document. Provision
TLS, configure trusted proxy/origins/CORS, redeploy, and check both locales/theme,
auth, secure host-only cookies, roles, private resource access, direct URLs and
canonical tags. Reauthenticate on the new host. Keep old-host rollback available
until acceptance; rolling back web hosting must not revert or re-seed the DB.

Zero-rewrite scope: changing a web host/domain needs deployment configuration,
not rewriting learning features. Remaining source work (email delivery, global
rate limiting if multiple replicas, and unresolved QA2 defects) is explicitly
separate and must not be mistaken for completed production readiness.

## Verification record

See docs/WORK-FINAL-AUDIT.md for exact fresh command outcomes. Acceptance is not
claimed until current typecheck, lint, tests, production build/start and direct
URL/browser checks have passed. No production promotion was performed.
