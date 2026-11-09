# Phase 2 — Reading integrity follow-up

Status: tested code/regression follow-up completed. Overall Phase 2: PARTIAL.

Branch: `arena/learners-area-next`. Parent: `5906c9107c08b9c1d2dbaa588ba3611c119bc306`. Exact source hashes and raw result indexes: `08-followup-summary.json`. The evidence archive contains the final push receipt. No main update, production deployment, paid infrastructure change or database migration was performed.

The user reserved the continuous hour-long stability run for manual testing. This follow-up did not start or schedule it.

## Fixes

- Reading sends the latest draft on immediate route exit, before the autosave debounce. The browser reproduced an empty server draft before the fix and persisted answers after it.
- A dispatched idempotent draft has a bounded lifetime independent of its route. A newer exit snapshot waits for the older write to settle and uses its acknowledgement token. Unacknowledged requests expose recovery after timeout.
- Hidden-page flush failure retains dirty data. Rejected transport preserves the input and focus. The save label changes as soon as an edit becomes pending.
- A 401 uses the existing authentication gate and stops retries.
- Token-aware native Reading requests carry a server-computed draft hash. The backend checks it under the existing attempt row lock. Stale edits return `409 draft_conflict`; local answers remain available to copy and automatic overwrites stop. Identical retries recover lost acknowledgements. Legacy requests without a token keep their prior API contract, so the concurrency guarantee applies to token-aware native clients.
- Attempt DTO/adapter token validation and generated site-guide source hashes are updated. Routes, scoring and Phase 1 layout/styles remain unchanged.

## Checks

| Run | Passed | Failed | Skipped |
|---|---:|---:|---:|
| Full backend | 5,923 + 282 subtests | 0 | 0 |
| Full frontend | 1,393 of 1,404 | 0 | 11 |
| Owned real PostgreSQL + real ASGI/auth | 67 checks | 0 | 0 |
| New Reading recovery unit cases | 8 | 0 | 0 |
| Complete Python static build | 843 files, 131 routes | 0 | — |

Targeted checks overlap the full suites. Backend JUnit includes subtests. One dependency deprecation warning is retained. The eleven skips require the original owner file `Listening_Test_1.html` with embedded recording; the repository HTML lacks that recording and no substitute fixture was fabricated.

Database checks cover all five formerly unlisted endpoints, role/assignment boundaries, private exports, idempotent contact removal, linked-account protection, archive retention, active-exam restrictions, draft ownership, stale/concurrent writers and concurrent submission. Duplicate submit leaves one completion event and forty final answer rows.

Live browser checks confirmed immediate exit, failed-save recovery with focus retained, pending-save exit ordering, and a two-tab conflict. The database receipt records 200 for the acknowledged tab, 409 for the stale tab, and the acknowledged value remaining stored. A logout attempt crossed an intermediate build replacement and was excluded from final logout UX acceptance.

## Final-source Reading benchmark

Serial runs used the same Node/jsdom fixture, 20 runs × 50 edits. This measures synthetic DOM event dispatch, without browser layout/paint; it is not INP.

| Metric | Before | Final source |
|---|---:|---:|
| Input dispatch p50 | 3.170 ms | 2.769 ms |
| Input dispatch p95 | 10.394 ms | 7.072 ms |
| Full question-pane replacements | 1000 | 0 |
| Input identity changes | 1000 | 0 |
| Focus / selection losses | 0 / 0 | 0 / 0 |
| Created elements | 107000 | 20 |

The final pending-save badge can create a small bounded number of nodes; no zero-allocation claim is made. Raw per-run timings and the exact final source hash are retained.

## Saved dashboard browser comparison

Forty valid samples, five per cell, alternated before/after. Baseline frontend: `76f73b8`. Measured after asset revision: `db0c43658f007772e9cb`. These rows predate the final draft-token and pending-label changes and are not a final-build cold/warm browser rerun.

| Profile | Cache | Before ready median | After ready median | Before transferred | After transferred |
|---|---|---:|---:|---:|---:|
| desktop | cold | 754.1 ms | 733 ms | 8,953,689 B | 591,748 B |
| desktop | warm | 174 ms | 162.7 ms | 6,465 B | 6,459 B |
| latency150 | cold | 3880.2 ms | 3685.7 ms | 8,920,667 B | 558,626 B |
| latency150 | warm | 351.1 ms | 330.2 ms | 6,436 B | 6,477 B |

Desktop uses a 1440px iframe. The second profile uses 390px and adds 150ms per static response. Both use the same real backend and synthetic data. Cold module graphs receive unique URL prefixes; warm runs reuse primed prefixes. These are DOM readiness and Resource Timing values. Five samples do not support reliable tail percentiles; p95/p99 are omitted. Paint timing entries were unavailable. No field CWV, trusted INP, physical-device, CPU-throttle, full-4G or universal speed claim is made. All forty rows captured zero page errors.

## Build and public origin

All six previously missing large assets were restored and matched to existing Git blob hashes. All 828 expected publishable source blobs are present. Final build: 843 files, asset revision `0430f94650af2562004c`. Restored assets are already on the remote and are excluded from this push.

The cloud browser observed healthy liveness/readiness JSON, production version `bc48ac44ebb8dc65df69d3e477a1494845b60938`, and anonymous session denial. These observations expose neither HTTP headers/statuses nor production capacity. Executor GET-only smoke returned ConnectError. No production login or write was attempted.

## Remaining acceptance

Manual continuous stability is deferred by the user. Original protected Worker audio playback, Safari/WebKit and physical devices, genuine offline/CPU-throttle and full adverse-network lifecycle checks, authenticated production/capacity acceptance and the eleven owner-fixture cases remain unverified. The saved browser cohort has the revision limitation stated above. No next product phase was started.
