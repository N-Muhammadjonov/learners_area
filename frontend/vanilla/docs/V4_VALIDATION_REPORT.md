# V4 validation report — PARTIAL, independent gates

## Source workspace

Build PASS. Unit **181PASS/0FAIL/0SKIP** (historical142 preserved +39new). Chromium **162PASS/0FAIL/0SKIP**: original27+V2 14+V3 49+V4 72. Source logs/JSON/screenshots: `evidence/v4/`. Native browser matrix covers1440×900/768×1024/390×844, EN/UZ and day/night for reset/recovery/register and search journeys; other scenarios are targeted probes, not a claim of every state×matrix combination.

V4 new probes:12reset journeys,12registration/admission/logout,12recovery,7adversarial policy/draft/acknowledgement cases,7malformed-login successes,12shell-search journeys,1drawer resize,9landing destination/history/duplicate-ended,1confirmation invalid-token/malformed-ack journey =72. These are fixtures only. JSDOM181 and Chromium162 are separate test counts, not unique source-state coverage or343 accepted features.

## Original assets/CSS and visual gates

25files in fonts/brand/images byte-compared to original. Raw source CSS exact SHA256 `b91507c391d30d49d1f9c2882fa10ae5835409f43866d9bedc578d6a26156ce2`; compiled CSS deterministic SHA256 `8c7ca2feb28e2a9a25488c6fb326c4db8a5c774feb3c8213d947428a387ea834`. Reviewed source search skeleton/empty and headings/breadcrumb expressions are generated at build time; no framework runtime. Source-template/CSS equivalence is NOT a rendered visual comparison. Native screenshots are evidence of rendering only. Original source-versus-native rendered comparisons **0**; visual acceptance **0**. Safari, actual audio/microphone/brand-intro device acceptance **NOT VERIFIED**.

## Measured performance — no guarantee

Chromium133,1440×900 EN/day; local HTTP, warm imports,30synthetic rows per catalogue,15switches each at controlled0/50ms added fixture latency; no CPU/network throttle, no original baseline.

| Controlled extra fixture latency | Pending-frame DOM median | Actual30-row content DOM median | After two rAF opportunities median |
|---|---:|---:|---:|
| 0ms | 0.9ms | 34.0ms | 481.2ms |
| 50ms | 0.8ms | 82.0ms | 461.4ms |

59script resource entries, 360774decoded JS bytes across initial/warm workload (not cold/warm compressed production-bundle acceptance). Full encoded/transfer bytes and API read counts are in JSON. Observed long tasks: 0. After explicit GC: DOM nodes 703→674; listeners 73→73; documents1→1. A bounded sample is not proof of leak freedom. API/media live readiness not measured; double-rAF is not hardware pixel paint. Content, not pending skeleton, is the readiness gate. Some frame opportunities are hundreds of milliseconds; no universal1–100ms claim.

## Security/dependencies

`dependency-audit-before.json`:5high development-chain advisories; runtime-only audit0. Investigated registry latest braces3.0.3 and Tailwind3 latest3.4.19; new braces stack-exhaustion advisory affects the available chain. No safe semver/minor resolution established; no blind force-fix/major Tailwind rewrite, CSP weakening or false vulnerability-free claim. Production dependencies were not touched. Original server auth/status/role/ownership/revocation/media/grading remain authoritative; no secrets or raw driver messages in diagnostics/storage/fixture logs. No fake production APIs/data/recordings/grading.

## Independent deliverable validation

Package uses sorted members, fixed timestamps/permissions, SHA256SUMS and exact manifest verification. Historical archives are not overwritten. Extraction is under excluded node_modules, no original source tree; run npm ci/build, all181unit and all162Chromium probes, archive-captured25asset/source-CSS hashes, compiled-CSS rebuild, before-test manifest verification and archive reproducibility. **Final independently executed results and exact ZIP SHA live in external `deliverables/V4_VALIDATION.txt`/logs** so changing an extraction report cannot create a recursive hash inside the ZIP. Do not infer acceptance from this procedure description: read that result supplement.

## Acceptance gates

- Scoped frontend CODE COMPLETE:3canonical recovery/reset candidates;6source components. Rest remains ordinary frontend work.
- UNIT PASS:181; BROWSER FIXTURE PASS:162.
- ORIGINAL-RENDERED VISUAL VERIFIED:0. LIVE ACCEPTED:0. PRODUCTION ACCEPTED:0.
- Overall application status **PARTIAL**, not CODE COMPLETE or externally blocked otherwise-complete.

PRODUCTION CHANGES: NONE.
