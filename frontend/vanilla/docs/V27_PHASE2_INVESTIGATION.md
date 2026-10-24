# V27 Phase2 investigation — intermediate milestone, NOT a V27 release

Continuation: assigned branch `arena/96836bcf-learners-area`, accepted V26 final `49c19cc1cbcf64f78713e24b11f99cef278a54d2`. V26 source/seal/archive identities and all historical evidence remain unchanged. Review remains PARTIAL; Script not advanced; Reading gated. No V27 ZIP, source seal, full-suite result, resource closure, or completion claim is made here.

## Observed retaining owner

Four predetermined serial marker-mode runs captured heaps immediately after the preserved Phase2 immediate GC/counter measurement, **before** frame settlement. No retry-until-pass, increased budget, arbitrary sleep, runtime GC, or assertion deletion. Counter values stayed identical across snapshot capture in all four runs, including the failing high-water case.

| Unchanged V26, run | Baseline nodes | Immediate nodes | After snapshot | Final frame/GC nodes | Immediate assertion |
|---|---:|---:|---:|---:|---|
| 0 | 630 | 999 | 999 | 468 | FAIL |
| 1 | 491 | 472 | 472 | 468 | PASS |
| 2 | 630 | 630 | 630 | 468 | PASS |
| 3 | 491 | 514 | 514 | 468 | PASS |

Documents remained 2 and listeners 139 in these samples. This diagnostic is additional to, not a replacement for, the preserved mandatory 499-case suite.

In failing run0, offline parsing found 232 detached native DOM targets. Shortest strong paths for 219 passed through CSSAnimation. A specific detached reports-loading skeleton has this incoming-owner path:

`<div data-reports-loading class="… animate-pulse …"> ← CSSAnimation ← InternalNode ← DocumentTimeline ← HTMLDocument ← Window ← NativeContext ← Global handles`

Snapshot SHA256: `50446cc01855703da8efe9cd4407da3c788953692a7eefc567f5200b87620dfb`, 6,360,572 bytes. See `evidence/v27/baseline-retainers.json` for exact heap IDs, edge kinds/names and the path. The other13 targets have other strong paths; the representative reports status node is retained through the current form's event-listener context/native select roots. They must not be called unreachable or folded into the animation count. A shortest path is not an exclusive-owner/dominator proof.

This directly identifies a browser animation owner for the observed loading-node spike; it is not evidence for the previous cancelled-timer hypothesis. It does not identify every resource owner in Review, every allocation in the snapshot, or every historical failing run.

## Isolated browser reproduction, no application runtime

`tests/phase2-browser-animation-v27.mjs` creates and removes the same40 sections/200 divs in twelve fixed samples: four plain, four animated, four animated-and-cancelled. It uses a blank page, no application modules, routes, API fixtures, Playwright locators or heap snapshots. Animation creation is explicitly observed via `getAnimations`. The immediate measurement uses diagnostic GC; subsequent measurements await actual animation-frame callbacks, not elapsed-time sleeps.

| Mode | Immediate nodes, four runs | Nodes after first frame | Nodes after second frame |
|---|---|---|---|
| plain | 7,7,7,7 | 7,7,7,7 | 7,7,7,7 |
| animated | 447,450,7,7 | 7,7,7,7 | 7,7,7,7 |
| cancelled | 447,447,7,7 | 7,7,7,7 | 7,7,7,7 |

Animated modes created200 animations per run; plain created0. Baseline nodes were10 except the last cancelled sample7. Full document/listener counts are preserved in `evidence/v27/browser-animation/results.json`. No application callback closure is necessary to produce this timing-dependent spike. These fixed samples demonstrate transient browser-owned animation retention; they are not a statistical guarantee or universal no-leak proof.

## Rejected runtime trial — NOT shipped

An exploratory helper cancelled animations only on outgoing owned subtrees, preserving incoming targets and live hosts; it was wired into dashboard/report replacement and shell/workspace disposal. Six focused mock-based helper tests passed, but that was insufficient browser evidence. Four fixed Phase2 trials still produced3PASS/1FAIL with the same +50-node/+5-listener assertions. Nodes before were523/522/523/522, immediate522/630/507/561, final468 in all four. The failing snapshot retained135 detached DOM targets,122 through CSSAnimation; its representative path went through document-owned internal nodes rather than DocumentTimeline, consistent with additional pending animation-event ownership after cancellation. InternalNode labels alone do not identify the exact C++ container.

Therefore cancellation is **not** reported as a repair. Its runtime changes and helper tests were withdrawn; all tracked application source is unchanged from accepted V26. The rejected patch/helper text, raw failures and retainer metadata are retained under `evidence/v27/`. Raw snapshots remain outside Git at the locations/hash pins in `snapshot-manifest.json`; they contain only synthetic Phase2 fixture state and are intentionally not bundled as large deliverables.

## Reproduction and limitations

- `PREVIEW_URL=http://127.0.0.1:4173 PHASE2_MODE=marker PHASE2_RUNS=4 PHASE2_LABEL=baseline HEAP_DIR=/chosen/scratch node tests/phase2-heap-v27.mjs`
- `node tests/phase2-browser-animation-v27.mjs`
- `python3 scripts/heap-retainers-v27.py /chosen/scratch/heap-0.heapsnapshot /chosen/output.json`

Baseline preview4173 serves independently extracted V26. The temporary cancellation preview4183 was rebuilt from restored V26 application source after rejecting the trial. Sampling was sequential, not concurrent browser load. Snapshot/protocol instrumentation can alter scheduling; isolated reproduction deliberately excludes snapshots. Heap raw timestamps are machine-clock observations, not release dates.

Harness setup chronology retained: first trial write used the wrong cwd and did not edit application files; its build completed after the tool wait timed out. A preview invocation using unsupported `--port` arguments tried4173 and failed EADDRINUSE; `PORT=4183` then started correctly. A helper-test write also used the wrong cwd before correction; the six tests subsequently passed but were withdrawn with the unsuccessful implementation. None of these setup failures is a product pass or mandatory-suite result.

## Remaining V27 work — OPEN

This milestone does not close Phase2 acceptance wholesale: immediate assertions remain unchanged and failed runs remain failures. The observed dominant retaining path is now identified and independently reproduced as transient native animation ownership. Matched Review stages (beforeReview, firstRender, hydration, part/question, lexical, dismissal, media, replacement, disposal, all-owned-callbacks-settled, diagnosticGC), broader listener/observer/timer/transport/media attribution, explicit15 mixed journeys, expanded30-source modal/focus/scroll/media verification, precise10/25 external handoff,12 viewport/locale/theme conditions, equivalent performance, complete mandatory regression runs, independent exact-ZIP proofs/two repacks, V27 release docs/seal/report and final A–T response remain unfinished. Do not promote Review or infer live/original/hardware equivalence from this result.
