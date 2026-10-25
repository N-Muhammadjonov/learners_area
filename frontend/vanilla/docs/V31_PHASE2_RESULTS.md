# V31 Phase2 results — fixed twelve-run series, acceptance OPEN

## Actual decision

**12 PASS /0 FAIL /0 SKIP**, exactly the twelve predefined original strict repetitions, no retries or replacement runs. This answers the bounded question: historical immediate-stage intermittence **did not recur in this series**. It does not establish that intermittence is gone, prove universal resource safety or authorize gate closure. Phase2 remains **OPEN** and Review **PARTIAL**.

The unchanged preseal mandatory baseline independently passed544 unit/499 Chromium/418 original-source/14 timing cases, no failed/skipped baseline cases. The preseal original Phase2 case separately passed496→518 nodes (+22),152→152 listeners. Its observation is not added to the predefined twelve-run denominator. Final exact-ZIP regression and four matched controls are separately reported after sealing in deliverables/V31_VERIFICATION.json and V31_VALIDATION.txt; its original Phase2 case is not a replacement or thirteenth diagnostic repetition.

## Original-stage observations

Same pinned Playwright1.51.1/Chromium133, fresh context each repetition in a single browser process,1440×900 EN/day synthetic authorized fixtures. Original initial reports route and three-switch warmup, original pre-GC counters, ten cycles of app/mocks/reports (30 measured switches), original post-GC counters and original assertions.360 measured samples total;36 warmup switches are separate. No added settling/frame/GC cycle, delay, cancellation, runtime GC, dependency upgrade or altered timeouts. No concurrent browser study. Main-document connected-element/frame/dialog/loading observations were taken AFTER original assertions, not as substitute budgets.

| Run | Strict | Nodes before→after | Delta | Listeners before→after | Post connected elements | Frames/dialogs/loading | Shell same |
|---|---|---|---:|---|---:|---|---|
| 1 | PASS | 496→494 | -2 | 152→152 | 278 | 0/0/0 | True |
| 2 | PASS | 495→476 | -19 | 152→152 | 278 | 0/0/0 | True |
| 3 | PASS | 495→473 | -22 | 152→152 | 278 | 0/0/0 | True |
| 4 | PASS | 495→473 | -22 | 152→152 | 278 | 0/0/0 | True |
| 5 | PASS | 472→476 | +4 | 152→152 | 278 | 0/0/0 | True |
| 6 | PASS | 472→485 | +13 | 152→152 | 278 | 0/0/0 | True |
| 7 | PASS | 472→495 | +23 | 152→152 | 278 | 0/0/0 | True |
| 8 | PASS | 495→518 | +23 | 152→152 | 278 | 0/0/0 | True |
| 9 | PASS | 495→473 | -22 | 152→152 | 278 | 0/0/0 | True |
| 10 | PASS | 473→508 | +35 | 152→152 | 278 | 0/0/0 | True |
| 11 | PASS | 473→473 | +0 | 152→152 | 278 | 0/0/0 | True |
| 12 | PASS | 496→508 | +12 | 152→152 | 278 | 0/0/0 | True |

Every original +50 allocated-node/+5-listener budget and stable-shell assertion passed at its original immediate stage. Node deltas−22…+35; all documents2, listeners152 and post connected elements278. Frames/dialogs/loading0. Original allocated counters were captured before observational DOM queries. Those queries count connected main-document elements, not text/shadow/opaque-child/native allocations.

## Ownership / stop / repair decision

No new contradiction in shell identity, connected-element counts, frames/dialogs/loading or listener growth appeared. No application-owned surviving callback/resource or new retaining owner was demonstrated. **The conditional one matched ownership followup was not used.** No general resource sweep, heap/blank-page/cancellation/inspector/controller/timer/MutationObserver/dirty-debounce study was reopened. Stop occurred after exactly12, as planned; no unexpected non-assertion fault or unsafe-access stop occurred. No runtime repair is justified or made.

Flat connected counts and bounded allocated counters are compatible with existing native/transient findings but do not exclusively attribute all resources to the browser or prove the absence of an application leak. The historical219/232 shortest CSSAnimation retaining paths remain scoped;13 original raw target identities remain unavailable without their original heap. The accepted Playwright frame-handle444→348 allocation attribution, connected291/listeners184 unchanged, is a different test-process/native-owner finding, not a Phase2 main-document counter baseline or permission to delete runtime owners.

## Historical instability and release acceptance

Both historical3PASS1FAIL series remain failed in immutable evidence. Earlier V25/V26 failures and other diagnostic series remain preserved too. V28's fourPASS, V29's strictPASS and V30's strictPASS stay separate. Twelve new PASS observations do not mathematically remove nondeterminism, explain inaccessible owners, retroactively change any failure or define a new release stability policy. No existing finite-run closure criterion was provided or shown met; **Phase2 OPEN / Review PARTIAL** is retained.

Original strict outcomes, historical instability, app attribution, native explanation and release acceptance are separate categories. Full/Retry frontend code complete retained; Script NOT ADVANCED; Reading GATED. Broader native/opaque/decoder/GPU/hardware/Safari/original-recording acceptance remains unverified. No external permissions, backend policy or rendering acceptance are invented.

## Evidence / reporting integrity

All `evidence/v31/phase2/run-1.json` through `run-12.json`, `series-progress.json`, `browser-v6-results.json` and `preseal/phase2.txt` are retained; every run stores original before/after counters and all30 raw samples, including failures had any occurred. No outcomes were selected away. `harness-identity.json` pins driver hashes. Final independent verification reconstructs the entire original V6 driver byte-identically after removing only declared output/repetition/after-assertion wrappers, checks all prior unit/browser/source/timing names, original test-file bytes and runtime identity.

The initial preseal convenience-summary restoration issue is disclosed in `evidence/v31/preseal/reporting-note.md`: all twelve per-suite Chromium stdout/case reports remain intact,499PASS; no suite was repeated for logging. The current-version exclusion correction is reporting-only. All historical evidence is restored after baseline drivers; the newly generated V24 performance observation was copied under `v31/generated/` rather than overwriting history. Fresh original25-asset/CSS identity and deterministic CSS compilation passed in `evidence/v31/assets-css.json`.
