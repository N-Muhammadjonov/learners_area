# Learners Area — Phase 2 performance report

Status: PARTIAL. P1 Reading DOM churn is fixed and measured. P0 Listening media lifetime, repeated play and recovery presentation are fixed and exercised with real Chrome decoding of synthetic audio. Protected original CD IELTS playback remains unverified end to end. This is not full acceptance or a production capacity certificate.

Scope is the owner's later Phase2 request, tasks15–27 only. Phase1 presentation remains the baseline. No production deployment, main merge/push, infrastructure mutation, schema/content/scoring change or permission relaxation was performed.

## A. Git and baseline

| Item | Recorded value |
|---|---|
| Repository / branch | `N-Muhammadjonov/learners_area` / `arena/learners-area-next` |
| Starting arena SHA | `76f73b81d731a11348b91082e4e42e3402f923f7` |
| Product source SHA | `6abe47bbca3dbaf4733d10db17c91d7267fbbceb` |
| Source tree | `b9c5507a0e70caa0c135898c2e95bcba10a577ab` |
| Final report commit | Commit containing this report; exact SHA/remote verification in delivered `final-git-receipt.json` |
| Main at start | `68b0faeb4e1033c24d87ad2198102bc4ed584462` |
| Main at final preparation | `bc48ac44ebb8dc65df69d3e477a1494845b60938`, external advance, not merged into arena |
| Starting comparison | DIVERGED, ahead84/behind1; merge base `00a8ebdd24d35afa480528fc3bae87bdf1ad1fe5` |
| Final comparison | Captured after final push in `final-git-receipt.json` |
| Push safety | Complete remote base tree, actual remote parent, expected-head guard, `force:false` |
| Main / production | No writes by this work; main is not asserted globally unchanged because another commit appeared |

The partial checkout has synthetic materialization commits. None of that ancestry was pushed. All46 source-change blobs and the complete returned tree were hash-checked before the product commit. The final QA commit changes documents and isolated instrumentation only. Runtime revision remains `8bd607b35dfe5b24cb0c`.

## B. Mandatory performance comparison

PASS means the specified coverage only. PARTIAL identifies missing acceptance dimensions. Mentora latency is NOT VERIFIED for every row: supplied PDF/production ZIP are reference sources, not a controlled running competitor benchmark.

| N | Performance advantage / why | Before LA | Mentora reference | Implemented optimization | Measured after LA | Winner / evidence | QA / status |
|---|---|---|---|---|---|---|---|
| 15 | Initial loading, fewer unnecessary bytes | Dock JPEGs9,275,458 B; three landing-only eager preloads | NOT VERIFIED | WebP derivatives; remove unconditional landing preloads | Referenced Dock212,396 B, 97.71% smaller; originals retained | Asset transfer improves; cold LCP winner NOT MEASURED | Build/assets PASS; controlled cold/throttle acceptance PARTIAL |
| 16 | Navigation speed, stable lifecycle | Router already lazy-loads beside authoritative preparation | NOT VERIFIED | Preserve router; remove false startup account refresh | Foreground20-route proxy p50/p95100.2/220.9 ms versus100/233.2 ms | No significant speed winner established | History/unit lifecycle PASS; per-route readiness PARTIAL |
| 17 | Warm navigation without private speculation | Private view prewarm and blanket unlocked-audio warming | NOT VERIFIED | Code-only imports; constrained-device suppression; no blanket audio | Five new policy tests pass; max2 concurrent imports; existing6-target/minute budget | Less speculative work by code/tests; hit/miss bytes NOT MEASURED | Scoped PASS; adverse-network/device acceptance PARTIAL |
| 18 | DOM rendering, stable controls/media | 1,000 edits created107,000 elements and replaced1,000 panes/inputs | NOT VERIFIED | Answer/save patches, fresh choices, stable media host | 0 new elements/pane/input replacements; synthetic p954.110→1.785 ms | Improved DOM benchmark, not INP | Widgets/ACK + Chrome200 edits PASS, scoped |
| 19 | Delivery, bounded Range work and valid revisions | 10-byte Range on32 MiB allocated33,689,925 traced B | NOT VERIFIED | FileResponse streaming; regenerate stale site guide | 157,593 traced B; p5021.744→3.669 ms, p9522.525→5.193 ms | Improved in-process allocation/latency | HTTP/build gates PASS; old-deploy browser/proxy matrix PARTIAL |
| 20 | API caching, identity/freshness | Existing identity cache; dynamic attempts excluded | NOT VERIFIED | Preserve policies/authority; remove automatic private DTO warming | Existing cache/identity tests green; no new cache latency claim | No API speed winner claimed | Policy/unit PASS; live all-role acceptance NOT VERIFIED |
| 21 | Audio stability, actual playback and recovery | Redraw detached audio/created replacement; repeated pending play possible | NOT VERIFIED | Attached audio, single-flight play, native playback state/recovery | Chrome synthetic progression/resume37:41; one audio; no metadata reset on notes/sections | Scoped lifecycle fixed; originals integrity preflight only | PARTIAL: protected Worker/native original/Safari unverified |
| 22 | Long sessions, no false tab refresh | New document broadcast remounted other exams | NOT VERIFIED | Remove startup mutation hint; keep real mutation/cleanup | Listening37-min, Reading35-min segments; resume/expiry verified | Resume verified; continuous60-min NOT VERIFIED | PARTIAL; Writing/nav about26 min |
| 23 | Capacity, separate streams/policy/saturation | Already SSE, ordinary64/streams256, pool5 | NOT VERIFIED | Keep API budgets; add real-PG load/SSE harnesses | 150 SSE +400 requests:400×200 both; high mixed tiers still busy503 | No causal capacity gain claimed | Matrix executed; production/multi-worker acceptance PARTIAL |
| 24 | Errors, preserve work through recovery | Existing retries; old ACK could label newer edit saved | NOT VERIFIED | Fix ACK presentation and media recovery host; read-only smoke | ACK/widgets/audio rejection and existing region tests pass | Correctness improves; latency NOT MEASURED | Scoped PASS; full browser offline/status matrix PARTIAL |
| 25 | Multi-tab, new tab must not reset exam | Startup emitted refresh without account mutation | NOT VERIFIED | Remove initial publish only; preserve actual mutation hints | New-tab audio stable; real two-tab logout clears private UI; attendance tests pass | Reproduced remount cause removed | Scoped PASS; offline reorder/concurrent submit PARTIAL |
| 26 | Health, distinguish deploy status/features | No Phase2 bounded GET smoke receipt | NOT VERIFIED | Read-only smoke, runbook, provider inspection | Local16/16; public0/6 ConnectError; source Vercel success | Better diagnostics; production feature health NOT VERIFIED | Local PASS; public/authenticated health BLOCKED |
| 27 | Real responsiveness, reproducible measurements | Preserved baseline | NOT VERIFIED | Paired DOM/Range/assets/load; Chrome layout/interactions | Stable input identity, unchanged CSS;360/390/768/1440 layouts | DOM/Range/assets improve; full A–D winner NOT VERIFIED | PARTIAL: no Safari/throttles/physical devices/field RUM |

## C. Root causes and reproduction

### P0 Listening

`modules/listening/exam.js:draw()` invoked generated render, which created an audio element even when an old element existed. It then substituted the old media inside a replacement tree. Notes/section/confirmation/error redraws detached live media and created speculative media loads. Pending `.play()` requests were not single-flight and recovery presentation could disagree with actual playback.

The controller now owns a permanent hidden media host and a separate view host. Generated `renderMedia` creates audio once. `playFlight` coalesces pending playback; native media events determine playing/paused presentation. Full-exam recovery hides after actual playback and remains available after rejection. No autoplay restriction is bypassed. Question data, timing policy, playback rate, save/submit/scoring contracts are unchanged.

Reproduce in the isolated full attempt: start real media, toggle notes/sections, observe element identity/attachment and native events. New tests exposed two baseline failures before passing. Chrome's resumed document recorded one loadedmetadata, one seek to2261.084 seconds and one playing event. Notes/section changes added no second metadata/playing cycle. Final capture:3500.815/3660 seconds, one audio, readyState4, no media error, recovery hidden. Initial resume autoplay was rejected: playback stayed at37:41 until the labelled recovery click; no phantom timer advancement was observed while paused.

Read-only R2 listing returned46 academic-prefix objects,34 audio/mpeg and30 full.mp3 tracks. All34 referenced object size/MIME checks matched. Pagination was not established; this is a bounded known inventory, not exhaustive live database mapping.

First/middle/last known full tracks01/18/32 were hashed and MPEG LayerIII frame-parsed inside the connector. No original recording bytes are in the package. Tracks18/32 match committed SHA256 digests;01 has no expected committed digest, recorded null rather than mismatch. Parsed durations1645.087/1437.362/1506.456 seconds, no unparsed/truncated frames. This is integrity preflight, NOT native decoding or protected Worker playback. Signed URL expiry/CORS/seek against protected originals remain unverified without an approved live QA session. Synthetic Chrome playback does not close that gap.

### P1 Reading

Old `setAnswer()` and save-state handling called `draw()` and replaced the questions pane. Existing focus restoration prevented losses in the synthetic benchmark but replaced control identity. Reproduction:20×50 edits, same fixture. Baseline107,000 created elements/112,000 removed nodes/1,000 pane and input replacements. New path0 created elements/pane/input replacements,20 removed counter-text nodes. Both versions had0 focus/selection losses in that benchmark.

`paintAnswer()` updates value, answered counter and question navigation. `paintSave()` owns a stable badge slot. Choice/checkbox/heading handlers read current state. Source HTML keeps native Choose TWO and independent radio groups sharing a row. An old save ACK cannot label newer pending edits Saved. Passage navigation, expiry, submission and real layout transitions retain existing scoped redraw.

Serial paired warm Node/jsdom dispatch p50/p95/p99 before2.329/4.110/14.654 ms, after1.115/1.785/2.865 ms. These are synthetic dispatch timings, not paint/INP. Chrome after-only200 synthetic edits retained control identity/focus/selection; two-rAF proxy33.2/34.3/38.8 ms. New tests cover text/IME events, radio chips, multi-select, heading choices, native source groups and delayed ACK. They do not certify physical drag/drop, native platform IME or Safari.

### Cross-tab resets

Initial workspace setup published `refresh` to other documents with no account mutation. New observation tabs reproduced exam remount/media restart. Removing that one publish preserves the existing authority watcher, expiry/revocation and explicit login/logout/profile mutation hints. Later Chrome playback stayed stable while tabs opened. In a separate real-auth two-tab journey on disposable PG, logout in one tab brought both frames to login and removed private profile controls. Propagation latency was not measured precisely.

### Backend503 / SSE

Historical25-second long-poll does not describe current source. `/api/auth/changes` is asynchronous SSE with a separate budget and dedicated PostgreSQL listener. In150 held streams, ordinary active slots stayed0; five idle pool connections plus one listener were observed, not150 leased connections. All streams returned to0 on disconnect.400 ordinary and40 recovery requests returned200 both builds.

Existing `RequestBudget` limits ordinary64, streams256, media64, bulk4 per process. Controlled100/150-client mixed tiers hit bounded admission and returned `503 busy`. Presence429 is rate policy, not DB outage. No request timeouts or lost acknowledged drafts occurred in the controlled matrix. API/SSE/admission code is unchanged; lower after503 counts are not attributed to a fix. No worker/pool/timeout limit was raised or error masked.

## D. Metrics and environment

Comparisons use source-before76f73b81 and source-after6abe47b. Final docs/probe correction does not change runtime assets. Linux6.18.57 x86_64/glibc2.41, Node24.22.1, Python3.12.14, FastAPI0.121.3, Starlette0.50.0, asyncpg0.32.0, Uvicorn0.54.0, PG18.6. Deployment config Python3.14 differs. Nine logical CPUs visible; cgroup CPU/memory caps not exposed; no per-app caps configured. Shared-runner noise limits timing conclusions.

| Profile | Browser / conditions | Cold / warm | LCP / INP / CLS | Route p50 / p95 | Input / other |
|---|---|---|---|---|---|
| A available | CUA Chrome, exact build not recorded; real loopback ASGI/PG; normal shared CPU, no throttle | Warm routes; mixed/uncontrolled cache for individual renders | Raw lab snapshots only; no repeated cold LCP/trusted INP/field p75 | Before100/233.2 ms, after100.2/220.9 ms, N20/build | After synthetic two-frame33.2/34.3/38.8 ms |
| B incomplete | iframe360/390/768/1440; no mobile CPU/4G emulator | Layout only | NOT MEASURED | NOT MEASURED | No physical touch claim; eight after views scrollWidth=clientWidth |
| C incomplete | SaveData/3g/2GB/2CPU unit fixtures | Policy only | NOT MEASURED | NOT MEASURED | Optional code speculation suppressed |
| D unavailable | Safari/WebKit/mobileSafari absent | NOT VERIFIED | NOT MEASURED | NOT MEASURED | Native WebKit audio NOT VERIFIED |
| DOM benchmark | Node/jsdom30.1.1, serial20×50, warm modules, no layout | Warm dispatch | Not CWV | N/A | p50/p95/p99 before2.329/4.110/14.654, after1.115/1.785/2.865 ms |
| Static Range | In-process ASGI, warm OS cache,3 warmups +20 requests;32MiB/10-byte Range | Warm file | N/A | N/A | Traced peak33,689,925→157,593 B; p99 N/A sample limit |

Navigation probe: synthetic anchor click until pathname/h1/non-busy plus two frames. Aggregate Dashboard/Listening/Reading/Progress proxy, not per-route complete interactive readiness. An earlier background run was rAF-throttled (~2 s), retained raw but excluded from foreground comparison. No navigation winner. Browser ResourceTiming includes QA instrumentation and synthetic private media, not initial bundle transfer. Single render paint/LCP/EventTiming is not field CWV or a repeated cold cohort. Cold20–30-run distributions, prefetch hit/miss bytes, traces and network waterfall were not captured.

### Delivery and critical path

Source-derived chain: no-store HTML → six shared stylesheets + local preloaded Geist font; module main → router/lazy workspace; public module loading overlaps authoritative preparation; authorized mount/commit → module data/visible content. This is code inspection, not a captured waterfall. Existing serial/abort/staging/stable-shell handling stays intact; public code import grants no private mount permission.

All-build JS source4,435,063→4,439,614 B; packed1,380,193→1,381,530 B. CSS source469,311 B unchanged; packed87,874→87,875 B due revision text. Packaged transfer115,931,099→116,144,560 B because originals remain and13 derivatives are additional. It includes101,260,210 B of optional speech-model parts, not initial-load bytes. Optimization is smaller referenced Dock assets, not smaller total archive. Runtime files583→596, routes131 unchanged. Final native build and Chrome after revision match. No Brotli runtime dependency/framework/animation library added.

Existing gzip/ETag/Vary/immutable revisions, private no-store, MIME, HEAD, Range206/416 and CSP/nonce tests pass. Stale revision404 is HTTP-tested. Dual-version preview serves both revisions and is not a real old-deploy chunk-recovery browser proof. Live proxy-header comparison unavailable from restricted workspace. Design CSS was intentionally preserved rather than split without controlled CLS evidence.

### Cache classification retained

| Class | Existing policy / boundary |
|---|---|
| Stable learner route catalogues | Identity-scoped TTL120s, no stale catalogue TTL; fresh authorizers remain |
| Dashboard/progress | Existing10s freshness/50s stale presentation snapshot; no permission grant |
| Vocabulary summary/folders/packs | Existing10s/120s; other catalogue reads30s |
| Assignments/notifications/attempts/answers/submit/grading/auth | Not admitted as stale route cache |
| Staff/owner/mutations | No new caching/speculation permissions; API authorizers unchanged |
| Optional public code | Max2 concurrent imports; existing6 targets/minute,750ms gap; private DTO/audio auto warming removed |

Identity/role/status/mutation invalidation and idempotent GET dedupe remain covered in frontend tests. Router/cache policy/API client and role authorizers are unchanged. A complete live all-role/account-switch/offline matrix was not executed.

### Controlled capacity

Real Uvicorn1 worker + asyncpg pool5 + owned PG18.6; no production requests. Tiers1/10/25/50/100/150, each3×20s, think1s. Synthetic157 users,40 Reading questions,48 Listening questions,151 Writing drafts, empty vocabulary/dictionary. CSV has p50/p95/p99, per-API samples, statuses, pool waits, RSS and CPU. N<100 p99=null. Initial matrix ran beside broad tests and is confounded; use `capacity-controlled/`.

| Clients | Before requests /429 /503 | After requests /429 /503 | Before p95 range ms | After p95 range ms |
|---|---|---|---|---|
| 1 | 60/0/0 | 60/0/0 | 10.975–19.243 | 12.246–20.085 |
| 10 | 600/0/0 | 600/0/0 | 41.689–48.971 | 43.672–55.231 |
| 25 | 1500/0/0 | 1500/0/0 | 71.470–97.262 | 72.035–75.062 |
| 50 | 3000/3/0 | 3000/3/0 | 116.806–137.257 | 112.693–161.754 |
| 100 | 6000/3/32 | 6000/3/13 | 254.584–562.802 | 274.151–482.532 |
| 150 | 8757/9/28 | 8570/9/5 | 492.757–1656.892 | 468.605–1893.020 |

Zero lost acknowledged drafts/timeouts across36 rows does not mean every attempted save succeeded, high-tier SLO passed or production/multi-worker capacity certified. Raw RPS/pool/RSS/CPU are retained rather than misleading pooled percentiles.150 SSE +400 requests both builds400×200 +40×200 recovery; disconnect streams0. Before/after handshake p95369.755/451.047 ms; burst p953766.909/2388.069 and p993909.513/2529.610 ms. Shared-host/single-run variance, not proven backend acceleration. Separate unpaced400-request tests returned400×200 both builds.

### Long-session boundaries

Canonical Chrome runs start after07:25Z browser clock. Listening07:27:03–08:04:03 (~37min), DOM235, approximate heap6.41–7.84MB, one audio/no recorded errors. Reading07:29:19–08:04:19 (~35min), DOM179–181, heap6.23–6.79MB, timer3598→1498sec/no recorded errors. Writing untimed local practice07:37:51–08:03:51 (~26min), DOM249, not server-autosave evidence. SPA navigation observed~26min. Finite heap ranges are not no-leak proof.

Documents closed before45/60 markers; exact cause not established. Resume was verified separately: Listening37:41→beyond58min logical media; Reading retained `word199`, remaining time and later00:00 with disabled fieldset. Old probe encoded numeric0 as null; explicit DOM expiry evidence records0. Final isolated probe fixes that encoding, not product timing. Logical elapsed across restart is NOT uninterrupted60-minute browser/heap soak. Listener counts, retained-node/GC snapshots, CPU traces, sleep/wake/offline/mobile background and pending-save handoffs are NOT VERIFIED.

## E. Test receipts

Commands relative to repository root except stated cwd. Venv/environment in `environment.json`. Product bytes tested were committed as6abe47b; local synthetic ancestry is not substituted for the remote source SHA.

| Command / check | Total | Pass | Fail | Skip | Elapsed | Receipt |
|---|---|---|---|---|---|---|
| `cd frontend/vanilla && node --test tests/*.test.mjs tests/staff-final30/*.test.mjs` |1396|1385|0|11|68.889s|`frontend-final.log`|
| `cd services/backend && python -m pytest -q`, isolated venv |5912|5895|17|0|59.38s|`backend-final.log`, additional282 subtests pass/1 warning|
| Exact17 failing pytest node IDs on baseline after site-guide setup regeneration only |17|0|17|0|1.74s|`backend-baseline-matching-failures.log`|
| New + existing native media/timer subset |26|26|0|0|.877s|`media-after-tests.log`|
| New Reading widgets/ACK/source groups |4|4|0|0|3.856s|`reading-regression.log`|
| New prefetch + intent/bounded request subset |38|38|0|0|1.231s|`prefetch-tests.log`|
| Workspace + authority/identity/media subset |11|11|0|0|.893s|`workspace-authority-regression.log`|
| Pytest smoke/static/Range/multitab release subset |16|16|0|0|.76s|`phase2-release-gates.log`|
| Native production builder |1|1|0|0|Not timed|`build-source-checkpoint.json`,596 files/131 routes|
| Bounded GET smoke on owned real ASGI/PG |16 checks|16|0|0|Per-check JSON|`local-readonly-smoke.json`|
| Public-origin smoke |6 checks|0|6 transport failures|0|Per-check JSON|`public-readonly-smoke.json`, ConnectError, no outage inference|
| Final probe `node --check`, Python harness compile, `git diff --check` |Syntax/whitespace|PASS|0|0|Not timed|Final QA receipt|

Targeted totals overlap full suites; do not add them. Eleven skipped tests need missing `LEGACY_LISTENING_FIXTURE`; not executed. Original broad baseline had15 failures and22 site-guide setup errors. To compare all17 current failures, only the unchanged generator refreshed baseline site-guide setup, then exact failing nodes reran. No product/assertion changed for that comparison.

Inherited17 backend failures: ten route-inventory tests expect340 while existing runtime has345; five SEO tests expect older Phase1 copy/logo/markup; two Listening fixtures omit existing required `audio_url` (`test_listening_order`, `test_ux_corrections`). Exact IDs/stack traces appear in current and baseline logs. No API methods were removed or tests suppressed. No fully green backend/full integration acceptance claim. The alternate legacy browser driver was not executed; browser work used managed preview/CUA Chrome.

## F. Changed files

Paths repository-relative. The46 source-file manifest with Git blob hashes is `source-changed-files.json` in the package; final QA additions follow. Test harnesses are excluded from production runtime.

| Path | Precise reason | Task | Validation |
|---|---|---|---|
| `frontend/vanilla/modules/listening/exam.js` | Stable media, single-flight play/native recovery state |18,21,24|Media suite/Chrome resume|
| `frontend/vanilla/js/generated/NativeListeningExam-v7.js` | First-render-only media construction |18,21|Identity/attachment tests|
| `frontend/vanilla/modules/reading/exam.js` | Answer/save patches, stale ACK guard |18,24|1000-edit A/B, widgets, Chrome200|
| `frontend/vanilla/modules/reading/questions.js` | Fresh values/scoped patch/native source groups |18|New4 tests/existing Reading|
| `frontend/vanilla/js/workspace.js` | Remove false initial account mutation hint only |22,25|Authority/workspace/Chrome tabs|
| `frontend/vanilla/modules/listening/tests-catalogue.js` | Remove blanket recording warming |17,21|Prefetch/media|
| `frontend/vanilla/modules/listening/mcq-index.js` | Same private audio speculation removal |17,21|Prefetch/source suite|
| `frontend/vanilla/js/module-prewarm.js` | Constrained optional import policy |17|SaveData/3g/memory/CPU tests|
| `frontend/vanilla/modules/shell/layout.js` | Stop private DTO prewarm installation |17,20|Intent/identity/full suite|
| `frontend/vanilla/modules/shell/dock-icons.js` | Smaller references, unchanged SVG crop |15,19|Assets/visual comparison|
| `frontend/vanilla/images/dock/neon/{assignments,dashboard,grammar,listening,live-classes,management,mocks,progress,reading,speaking,video-lessons,vocabulary,writing}.webp` |13 derivatives704×384 q90, JPEG originals retained|15,19|At64px max mean RGB error1.041/255|
| `frontend/vanilla/index.html` | Remove3 landing-only preloads |15|Build/landing tests|
| `services/backend/app/frontend_static.py` | FileResponse instead of full Range allocation |19|Range/headers/allocation|
| `services/backend/app/data/riwi_site_catalog.json` | Stale hashes/125-route guide→existing131 routes/490 sources |19,26|Unchanged generator/build, common route roles unchanged|
| `scripts/optimize_dock_assets.py` | Optional offline generator; no runtime Pillow |15,19|Output/image metrics|
| `scripts/phase2_readonly_smoke.py` | Bounded GET diagnostics, no cookie/body logs |26|Five unit/local16 checks|
| `frontend/vanilla/tests/dock-interactions.browser.mjs` | JPG→WebP assertion, same extent |15,27|Parser/source assertions; legacy driver not run|
| `frontend/vanilla/tests/phase2-{media,reading,prefetch,workspace,assets}.test.mjs` |14 new regression tests |15–25|Full frontend|
| `frontend/vanilla/tests/performance-phase2/bench-reading.mjs` | Reproducible DOM/dispatch A/B |18,27|20×50 serial|
| `frontend/vanilla/tests/performance-phase2/browser-probe.js` | Isolated metrics/soak; final numeric0 encoding correction |16,18,21,22,27|CUA-triggered probe/syntax|
| `services/backend/tests/test_static_range_phase2.py` | Range/IfRange/HEAD/allocation test |19|Pytest|
| `services/backend/tests/test_phase2_readonly_smoke.py` | HTTP/privacy/failure contracts |26|Five pytest cases|
| `services/backend/tests/performance_phase2/isolated_db.py` | Disposable TCP PG/synthetic seed |22,23,25|Real preview/load startup|
| `services/backend/tests/performance_phase2/preview_runtime.py` | Dual-revision managed preview, real auth/synthetic3660s media |21,22,27|Chrome journeys|
| `services/backend/tests/performance_phase2/capacity_worker.py` | Test-only pool/admission/CPU observation |23|Real HTTP matrix|
| `services/backend/tests/performance_phase2/capacity.py` | Repeated mixed load/ACK integrity |23,27|36 rows +burst/recovery|
| `services/backend/tests/performance_phase2/capacity_sse.py` |150 held streams +400 requests/cleanup |23,25|Before/after receipts|
| `services/backend/tests/performance_phase2/bench_static_range.py` | ASGI/tracemalloc comparison |19,27|20 samples/build|
| `docs/qa/performance-phase2/00-work-log.md` | Actual checkpoint replacing stale WIP |All|Receipt cross-check|
| `docs/qa/performance-phase2/01-invariants-and-operations.md` | Scope and future operator runbook |20,23,26|Code/read-only review|
| `docs/qa/performance-phase2/02-final-report.md` | A–I report |All|Raw evidence|
| `docs/qa/performance-phase2/03-qa-summary.json` | Machine-readable status/metric index |All|JSON/source checks|

## G. Artifacts and visual evidence

`Learners-Area-Phase2-Performance-QA.zip` contains this report, test outputs, Git/source receipts, paired Reading/Range JSON, asset/build receipts, controlled load JSON/CSV, SSE receipts, local/public smoke, bounded R2 metadata/hash/frame preflight, raw browser metrics and explicitly limited soak summaries. README identifies canonical versus older/confounded runs. Databases, credentials/cookies, recording bytes and full repository are excluded.

Before/after screenshots: Dashboard Day/Night1440, Speaking Night390, Reading catalogue Night360. After-only: Listening catalogue390, Vocabulary390, Progress768, Writing1440, Listening exam, Reading resume/expiry. Eight measured after layouts had no document horizontal overflow. Dashboard pair, Speaking pair and Reading catalogue pair were inspected: cards/gradient actions/skill colors/Dock/original mascot retained. Source hashes verify unchanged CSS/design system/mascot/Dock interaction/router/cache/API client. Not pixel-perfect: wrapper/scroll/capture scaling vary, Dock raster format intentionally changes. Owner Management was not re-rendered with this student fixture; Phase1 proof is not claimed as new acceptance.

Browser trace, network waterfall, forced-GC heap snapshots, CPU/network profiles, Safari and fieldRUM are NOT AVAILABLE. Raw single first-render LCP/EventTiming must not be read as repeated cold-start, true INP or field p75.

Read-only topology: Railway source main, one asia-southeast1 replica, successful deployment snapshot/no staged changes/tracing off. Cloudflare proxied apex CNAME to Railway; no zone Worker routes returned. Media Worker has R2 binding; names/types only, no signing secret value read. Query-string logging redaction was false with invocation logs off: review item, not evidence of a leak. No configuration changed. Idle CPU/memory do not prove capacity. Source6abe47b Vercel status success; final report commit status saved separately. Public-origin ConnectError leaves authenticated production health unknown.

## H. Remaining issues

| Severity | Precise gap / reproduction | Next action within Phase2 | Operator decision? |
|---|---|---|---|
| P0 acceptance | Original CD IELTS not played through signed Worker;01/18/32 integrity only | Approved QA session; Chrome/Safari original decode/start/Range/seek/CORS/expiry/error matrix | Yes for account/access, never bypass guards |
| P1 acceptance | No continuous four-journey60min; documents closed before45/60 markers | Persistent browser0/15/30/45/60 run, save integrity and controlled background/reconnect | Persistent test environment, no production writes |
| P1 acceptance | Native IME/physical drag, close-before-ACK/unmount/reauth/offline reorder/concurrent submit browser matrix incomplete | Extend isolated fixture coverage while preserving save/submit semantics | Browser/hardware access |
| P1 release |17 inherited backend failures | Review stale inventory/SEO/row-fixture assertions against authoritative behavior | No infra change; preserve API methods |
| P1 capacity |100/150 mixed tiers busy503; after150 p95 up to1893ms | Production-like staging caps/data, traces/pool/admission review before tuning | Yes for worker/plan/pool production changes |
| P2 measurement | No controlled cold cohort/all-route readiness/throttles/fieldRUM/Mentora live A/B | Collect missing A–D profiles and explicit cold/warm distributions | Tools/hardware; live telemetry setup approval |
| P2 monitoring | Public smoke ConnectError, provider green is not feature health | Run bounded read-only gate from reachable operator environment with expected production SHA | Approved network/session |
| P2 operations | Worker query redaction false at snapshot | Review capability-URL log handling/redaction | Yes for production config |

## I. Final status and stop

PARTIAL. Branch contains measured DOM/allocation/asset improvements and scoped media/tab fixes with passing targeted regressions. Frontend passes with11 declared skips. Backend17 inherited failures remain. Original protected media E2E, continuous60-minute stability and full device/network acceptance are open, so Phase2 is not COMPLETE.

Final code/report push is arena-only with expected-head verification. No main update/merge, production deployment or next product phase. Stop here.
