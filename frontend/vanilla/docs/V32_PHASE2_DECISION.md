# V32 formal Phase2 decision — existing assertions found; release criterion unresolved

## Sources and authority

Read V32_ACCEPTANCE_CRITERIA_MATRIX.md C01–C11 and its29 exact file/line/hash citations. The search covered835 tracked text specifications, ledgers, tests and root/migration documents, plus the original package's63-page paired visual PDF. `evidence/v32/criteria-search.json` records the reproducible search scope. The latest V32 owner instruction governs this work; repository agent handoffs do not themselves constitute stakeholder release approval. No policy outside the available material is presumed absent worldwide.

## Actual criterion that exists

`tests/browser-v6.mjs`, original case “Phase2 repeated real content navigation retains shell and bounded DOM/listeners”: after the original reports entry/three-switch warmup, original diagnostic GC and before counters, perform30 measured app/mocks/reports switches, original post-GC counters, then require the same shell, listeners<=before+5 and nodes<=before+50. Fixture environment1440×900 EN/day, pinned Chromium133/Playwright1.51.1. Original assertion sequence/timeouts/animations remain unchanged.

This defines one invocation's strict result. It does not define an approved population sample count, confidence/reliability bound, maximum historical failure rate, native-transient exception or rule for superseding a historical failure. Those missing fields cannot be filled by a new agent-selected12/20/50/100-run series.

## Existing evidence applied, not rewritten

- Historical V25 first full Phase2 failure and V26 diagnostic failures remain preserved, with their original scope/limitations.
- `evidence/v27/phase2-heap-baseline-marker/browser-v6-results.json`:3PASS/1FAIL. Each actual failed invocation still fails C01.
- `evidence/v27/phase2-heap-rejected-cancel-marker/browser-v6-results.json`:3PASS/1FAIL, failed cancellation mode retained and withdrawn; not an accepted runtime repair.
- `evidence/v28/phase2-heap-v28-original/browser-v6-results.json`:4PASS/0FAIL.
- V29/V30 original strict passes remain separate in their final reports.
- V31 predefined series:`evidence/v31/phase2/browser-v6-results.json`,12PASS/0FAIL/0SKIP. Immediate node deltas−2,−19,−22,−22,+4,+13,+23,+23,−22,+35,0,+12; listeners152, connected elements278, documents2, stable shell and observed frames/dialogs/loading0. The observations were after assertions, not an added pre-assertion settling stage. These PASS observations satisfy C01 for those invocations.
- V31 preseal and independent exact-ZIP original cases passed separately. They are not added to a diagnostic denominator or used to erase a failed series.

219/232 historical detached targets had a shortest strong path through CSSAnimation→DocumentTimeline→HTMLDocument; the isolated blank-page proof is accepted only in that scope. The remaining13 raw identities are unavailable without the original heap. The accepted Playwright pointer-hit-test inspector-handle causal finding is a different test-process owner, not a reason for app cleanup. Neither supports a universal exclusion of application leaks or an automatic release exception.

## Formal decision

**Per-run strict acceptance:** apply the original assertions to each actual invocation; named passes pass, named failures fail. **Stability/release acceptance: OPEN — EXTERNAL CRITERION REQUIRED.** V31's12/12 is not declared automatically sufficient OR automatically insufficient; no applicable decision rule authorizes either conclusion. Historical failure alone is not proof of a permanent application leak.

**Review: PARTIAL**, because a required release decision is unresolved; not because every implemented feature is treated as defective from hypothetical native internals. Supported application cleanup, modal ownership, writer fencing and normal frame lifetime have scoped implemented/verified evidence. Broader native observations are classified separately as unavailable/unsupported, not invented application defects. No runtime defect has been newly demonstrated by the criteria audit; no speculative repair is justified.

## Precise missing decisions / responsible authority

The project acceptance/release owner (no named delegate or signed policy found) must provide or identify the EXISTING applicable criterion specifying:

1. Which repeated-run stability population/environment and pass threshold govern this exact immediate-stage test, if any.
2. How preserved historical intermittent failures affect present release, and what existing remediation/recency or native-attribution exception, if any, may permit a release decision. No historical FAIL may be rewritten.
3. Which scoped native/opaque observations are mandatory release obligations; whether unsupported universal decoder/GPU/OOPIF accounting is actually required, and what authorized observable defines acceptance. No acceptance from parent counters alone.
4. Who is authorized to sign Review aggregate acceptance and which comprehensive catalogue/previous-attempt/publication/visual/live/hardware states must be supplied.

These are requests for authoritative existing decisions, not proposed new thresholds. An unobservable hypothetical allocation does not independently establish an incomplete application feature. A newly demonstrated implementable frontend defect still must be fixed even while external acceptance is blocked.

## V32 bounded execution decision, before testing

- **Additional Phase2 diagnostic runs:0.** No discovered applicable criterion requires another repetition population. No blank-page/cancellation/inspector/heap/timer/observer/native-resource research is reopened.
- No new runtime implementation; no preseal full-suite duplication. Run the complete mandatory verification once from the final exact V32 ZIP:544units,499Chromium including its ONE unchanged original strict case,418actual-source,14timing and4equivalent benchmark cases. The existing source suite includes supported lifecycle regression; this is not a newly selected resource study. Original budgets/timeouts and media/security boundaries unchanged.
- Environment: fresh standalone npmci/build; exact extracted source preview4173 and pinned sealed V31 reference4178; same package pins and local authorized API fixtures. Controls retain20samples/condition by existing benchmark contract, not a Phase2 release N.
- Failure: retain all raw outcomes/changed observations; if any new mandatory command fails, stop expansion and write a finite causal plan classifying application/harness/fixture/environment/contract/unattributed cause. No unchanged retries or weaker assertions. Only demonstrated owner repair may justify focused verification and a new full mandatory run.
- No PASS from old reports: final actual V32 results are `deliverables/V32_VERIFICATION.json`/`V32_VALIDATION.txt`, outside the source ZIP by the unchanged packaging policy. They distinguish mandatory results, the one original strict case, historical outcomes and the unresolved release decision.
