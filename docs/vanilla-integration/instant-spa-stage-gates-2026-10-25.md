# MCQ and Instant SPA preparation — 25 October 2026

Work is local only. No push, PR, merge, preview/production deployment, Worker update, bucket creation or secret change was performed. The working baseline is local `7a5fad3`, corresponding to remote `arena/learners-area-next` commit `336f4c4701e2ad3f64e519fa10b3364b94e22b34`. Existing Main Worker sources were read at `b62b78f469e4f73aa80f441f630b012dc422af39`.

## Requested MCQ change

Removed the duplicate body heading `🎯 MCQ mastery`. The pinned module heading now displays `🎯 MCQ mastery`; its navigation tab retains its existing label and destination. Subtitles, published/completed counts, empty state, pagination, day locks and request contracts remain intact. EN/UZ and all four Day/Night–Focus combinations passed eight DOM/CSS cases and 80 direct-text contrast checks. These are DOM/CSS checks, not browser screenshots.

## V1 preparation and measured gate

Added opt-in User Timing marks/measures around the router's existing prepare, module load, mount and commit stages. No await was removed and no content/security boundary was moved. Samples identify registered route patterns, excluding actual user IDs, query values, media capabilities and URLs. Records are bounded to 100, copied on export and User Timing entries are cleared. Aborted, redirected, committed and failed navigations are distinguished.

The stage module is dynamically imported only when the existing server-approved diagnostics flag is on. Ordinary startup does not import it. The existing diagnostics continue to observe interaction feedback, pending regions and resource/long-task entries. A router commit is explicitly not called a paint, fully usable data, first audio sample or first video frame.

`scripts/summarize-navigation-metrics.mjs` accepts captured QA logs and optional metadata (`browser`, `device`, `network`, `cacheState`, `commit`). It reports stage p50/p95/max, sample counts and whether 30 samples are present. It does not turn missing browser/paint/media evidence into PASS.

A normal local Chrome headless capability check, with a temporary profile and no security-disabling options, exited with code -6 and produced no screenshot. No escalation or sandbox workaround was used. Therefore there are zero qualifying real-browser baseline runs. Chrome/Safari/mobile cold/warm p50/p95, useful paint, data-ready, first sound/frame, CPU and memory comparisons are NOT VERIFIED. There is no measured speed-improvement or 100 ms claim.

| Stage | Local result | Gate for next work |
| --- | --- | --- |
| V1 baseline | Instrumentation/tests ready; real-browser baseline NOT VERIFIED | Obtain 20–30 controlled runs per browser/device/cache/network scenario |
| V2 router lifecycle | Existing staging/authority/history preserved | BLOCKED by V1; no instant commit/snapshot lifecycle rollout |
| V3 preloading | Existing intent code/data policies preserved | BLOCKED by baseline request/byte/waterfall evidence; no new scheduler |
| V4 memory cache | Existing identity/mutation invalidation and TTL preserved | BLOCKED by baseline and authorization/staleness comparison |
| V5 module/media paths | Existing metadata, exam, recording and media gates preserved | BLOCKED by separate UI/data/media readiness evidence |
| V6 production assets | Existing Python packaging verified and sizes measured locally | Bundling/hash/cache/compression changes BLOCKED by measured gate |
| V7 Cloudflare | Existing-source/ASGI integration PASS; deployed edge NOT VERIFIED | Future explicit deployment approval plus environment validation |

## Existing Worker/FastAPI integration

The integration runner imports the actual existing Main Media and Dictionary Worker handlers and their protocol/descriptor dependencies from a separate reference checkout. Twelve source/configuration files are checked against the pinned Main Git blob hashes before tests run. No replacement Worker source is part of this change.

A separate Python child runs the actual FastAPI ASGI application and existing dictionary gateway signer. Test-only authority/database fixtures and an in-memory read-only R2 binding isolate the run from live users, databases and buckets. Fixed public fixture signing values exist only in this process; production secrets are neither read nor changed.

The Media test obtains a capability from FastAPI's existing resource endpoint. The existing Worker verifies it, creates its actual backchannel proof and calls the actual FastAPI `/api/media/authorize` handler before the R2 fixture can be read. The Dictionary test uses the actual Python gateway's serialized UTF-8 body/HMAC proof against the original handler and immutable object decoders.

97 assertions passed, including:

- Capability expiry/malformed token rejection before storage access.
- Session revocation, auth-version changes, suspension and unpublished content denied by the backchannel before R2 reads.
- Every media request/seek reauthorized; same allowed request works after the fixture authority is restored.
- Full GET, 206 ranges/suffixes/clamping, 416 invalid/multiple ranges, HEAD semantics, If-Range fallback and conditional R2 GET.
- Cross-origin rejection and failed/redirected authority responses fail closed.
- Private media responses retain `private, no-store` even when object metadata suggests public caching.
- EN/UZ dictionary search, full/ranged entry hydration, tampered proof body rejection and checksum/release mismatch rejection.
- Dictionary gateway responses remain private; immutable internal object validation is preserved.

This proves source/protocol integration with FastAPI, not deployed Cloudflare routing, production session ownership/database state, real R2 access, edge-cache propagation or real-device playback. Existing production Workers/configurations and backend API contracts were not modified.

## Validation and measurements

| Check | Result |
| --- | --- |
| Native frontend suite | 1,027 passed; 11 existing skips; zero failures |
| Backend suite | 2,578 passed; one existing dependency deprecation warning |
| New navigation diagnostics tests | Four passed: default OFF, bounded/copy/cleanup behavior, rapid abort/privacy and failing sink |
| MCQ EN/UZ × four palettes | Eight cases, 80 text checks passed |
| Existing Worker/FastAPI integration | 97 assertions passed; 12 pinned source/config hashes verified |
| Python static package | 462 runtime files, 119 routes; ASGI startup check passed; no Node server |
| Real browser performance acceptance | NOT VERIFIED; zero qualifying baseline runs |
| Deployed Worker/live R2 verification | NOT VERIFIED; no deployment performed |

Local package sizes, not network transfer measurements:

| Asset | Raw bytes | Local gzip bytes |
| --- | ---: | ---: |
| main.js | 2,216 | 956 |
| router.js | 5,533 | 2,074 |
| navigation-metrics.js (QA only) | 1,803 | 931 |
| global.css | 175,083 | 31,505 |
| campus.css | 14,791 | 3,876 |

The runtime package contains approximately 3.75 MB of JS across lazy modules. This is total packaged code, not initial-page transfer. No baseline/after byte or latency improvement is asserted.

Commands (Node is test/build tooling only):

```sh
# frontend/vanilla cwd
node --test tests/*.test.mjs tests/staff-final30/*.test.mjs
# services/backend cwd, project Python environment
python -m pytest -q
# repository cwd; existing reviewed Main checkout, no Cloudflare CLI/deploy
WORKER_REFERENCE_ROOT=/path/to/reviewed/main BACKEND_PYTHON=/path/to/python node --import tsx scripts/verify-existing-workers-fastapi.mjs
node scripts/summarize-navigation-metrics.mjs captured-console.log run-metadata.json
python3 scripts/build_native_assets.py
python scripts/serve.py --check
```

## Next environment and V7 verification plan

1. Obtain an executable Chrome/Safari test environment and a controlled authorized test account. Record baseline commit, browser/device, network, cache state and >=20–30 repetitions. Capture filmstrip/useful content, data readiness, media readiness, API request counts/timing and memory independently.
2. Use stage measurements to select one V2 change. Compare baseline/variant under the same conditions and retain it only when measured results and authority/lifecycle tests justify it. Repeat this gate for V3–V6; do not extend caches for exams, signed URLs, attempts, answers or owner data.
3. For future authorized Cloudflare deployment, confirm the existing Worker source version, bindings and configured API origin. The existing Media Worker authorizes through `https://learnersarea.uz/api/media/authorize`; the deployed FastAPI origin must expose that unchanged contract. Do not repurpose either Worker as a general private-API cache/proxy.
4. Against existing deployed infrastructure, verify authorized/unauthorized/revoked sessions, signed TTL, GET/HEAD/Range/If-Range, dictionary active/previous release and checksum behavior, CSP/CORS and private-cache headers. Test read-only objects with approved fixtures; do not create buckets or replacement secrets.
5. Report deployed checks separately from these local integration results. Merge/deployment remains blocked until the user explicitly approves that concrete reviewed result.

Rollback: revert the local task checkpoint to the `7a5fad3` baseline. No data migration or remote rollback is needed. Runtime changes are limited to MCQ presentation and optional diagnostics; cache, prefetch, media, dictionary and permission behavior have not been optimized or replaced.

References: [MDN User Timing](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/User_timing), [MDN Performance entries](https://developer.mozilla.org/en-US/docs/Web/API/Performance_API/Performance_data), [Cloudflare R2 Worker API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/). User-supplied prompt and screenshot are private review inputs, not published assets.
