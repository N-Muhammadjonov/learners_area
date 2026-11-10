# Phase 2: scope and operating boundaries

Only tasks 15–27 in the owner's Phase 2 request. Phase 1 presentation remains the visual baseline. No main merge/push, production deployment, schema/data migration, permission or scoring change is authorized here.

## Product changes

- Reading answer changes and save badges patch existing nodes. Source-HTML choice groups keep their native handlers. Old save acknowledgements cannot label newer pending edits Saved.
- Listening keeps one attached audio element across notes, sections and error presentation; pending play requests coalesce. Successful full-exam playback hides the redundant recovery button. Rejected playback remains visibly recoverable.
- Opening another document no longer announces an account mutation. Actual login/logout/profile mutations still announce their existing hints. The authority watcher, server authorization, expiry and revocation are unchanged.
- Catalogue/MCQ opening no longer downloads all unlocked private recordings. Deliberate authorized audio acquisition stays in place. Shell intent prefetch loads public module code, with Save-Data/3g/low-resource constraints.
- Dock WebP derivatives total 212,396 bytes versus 9,275,458 original JPEG bytes. Originals and the SVG crop/extent remain intact. At a 64-pixel presentation, the largest mean RGB difference is about 1.04/255. No CSS/design-token change.
- Landing-only module/style preloads no longer run in every document. The landing module still loads its own stylesheet.
- Static Range requests use Starlette FileResponse streaming, preserving existing asset/CSP/private-document rules.
- The generated site-guide snapshot was refreshed to the already-shipped 131 routes. Existing route roles and actual router/authorization code are unchanged. The old snapshot listed 125 routes and a removed window-opening source.

## Verification boundaries

Node/jsdom dispatch timings are not INP. In-process ASGI/tracemalloc measurements are not network/RSS/production capacity measurements. The local HTTP load uses one real Uvicorn worker, asyncpg pool5, PostgreSQL18.6 and a small disposable synthetic database. Python3.12 locally differs from the configured Python3.14 deployment image.

Chrome CUA and internal managed preview are available. DevTools trace/CPU/network throttling, Safari/WebKit, physical devices and field RUM are unavailable. A resized iframe is responsive-layout coverage, not a simulated mid-tier phone/network certificate. Mentora is a visual reference, not a measured performance competitor.

R2 inspection is read-only. Returned metadata for 34 referenced audio objects matches their committed size/MIME descriptions. Original first/middle/last full tracks were read inside the connector for SHA-256/MPEG-frame preflight. This does not certify native decoding or signed Worker playback. No capability/signing secret was read or created.

The broad backend suite exposes inherited inventory/public-page/fixture disagreements. Failures must remain visible in the final receipt; do not remove actions or edit API contracts to make an inventory green.

## Read-only release smoke

Run with the existing backend requirements:

```sh
python scripts/phase2_readonly_smoke.py --base https://learnersarea.uz --expected-commit REVIEWED_MAIN_SHA --output smoke.json
```

For an operator-owned staging session, supply `QA_READ_ONLY_COOKIE` through the operator's environment. The script never logs it and never logs response bodies. It only sends bounded GET requests. No login or permission grant is created. It checks liveness/readiness, version, public policy, denied anonymous session, an existing session/catalogues when supplied, immutable assets, ETag304, Range206 and stale revision404.

The local real-ASGI receipt is separate from the public-origin receipt. This workspace could not connect to the public origin; that is not evidence that the service is down. Railway deployment success and GitHub/Vercel status are also not authenticated feature-health proofs.

## Future operator runbook — documentation only

1. Check `/healthz`, `/readyz`, `/api/version` and the HTML asset revision separately. Compare the expected production SHA with the production branch, not an undeployed arena commit.
2. Run the read-only smoke twice before classifying a transient timeout. Alert on repeated readiness/5xx failures, unexpected private cache headers, revision mismatch, or failed media Range checks.
3. Use an approved staging account for signed-media and authenticated feature checks. Never put cookies/capabilities in logs, query-string telemetry or artifacts.
4. Inspect pool waits, admission reasons, CPU, memory and stream counts before changing workers/pool limits. A 429 is an application policy result; a request-capacity503 is distinct from database outage.
5. For a reviewed rollback, revert the relevant source commit through normal Git history, rebuild and repeat the same gates. Do not force-push or roll back customer answers/schema as part of a frontend rollback.
6. Production deployment, routing/alarm changes, external credentials and any main merge need a separate operator decision. None is executed by this work.
