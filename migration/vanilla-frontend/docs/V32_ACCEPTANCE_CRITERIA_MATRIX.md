# V32 acceptance criteria and requirement matrix

A=IMPLEMENTED AND VERIFIED; B=IMPLEMENTED BUT ACCEPTANCE INCOMPLETE; C=DEMONSTRATED FRONTEND DEFECT; D=BLOCKED BY AUTHORITATIVE EXTERNAL INPUT; E=NOT MEASURABLE WITH AVAILABLE TOOLS; F=NOT ACTUALLY REQUIRED BY EXISTING CONTRACT. No row C: no newly demonstrated frontend defect. F is documentary prohibition, never silent removal of a required gate.

## Provenance / applicability

Search inventory: `evidence/v32/criteria-search.json` records835 tracked text sources at V31, SHA256/line receipts,29 exact citations and the paired63-page PDF inspection. Tests are authoritative for their executable assertions, not automatically stakeholder release policy. Earlier checkpoint/handoff statements are evidence/status, not invented signed approval. The current V32 owner instruction is authoritative for scope. No policy outside available repository/conversation is assumed.

## C01

- **Existing exact sources:** migration/vanilla-frontend/tests/browser-v6.mjs:53; migration/vanilla-frontend/docs/CHECKPOINT_V6.md:27
- **Observable requirement:** Original stable shell; after.jsEventListeners<=before+5 and after.nodes<=before+50 after original warmup/30 route switches and two original diagnostic GC commands.
- **Allowed environment:** Original synthetic authorized Chromium fixture1440x900 EN/day; original test helper/timeouts unchanged.
- **Required sample count:** One invocation defines one result;30 measured switches. No population/release sample count specified.
- **Pass threshold:** Every original assertion must pass in that invocation.
- **Historical failures:** Each failed invocation stays failed. Test contains no rule converting historical failures into release acceptance.
- **What is measured:** Allocated browser/harness/application counters plus shell identity; not retaining-owner attribution.
- **Responsible owner:** Frontend verifier can report test outcome; release acceptance owner not named.
- **Existing evidence:** Two historical3/1, V28 4/0, V29/V30 original PASS, V31 12/0 plus separately labelled baseline/exact PASS.
- **Decision:** Existing per-run requirement found and met by the listed PASS observations; historical FAIL observations still fail.

## C02

- **Existing exact sources:** migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md:38; migration/vanilla-frontend/docs/V31_PHASE2_DECISION_PLAN.md:19; migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15
- **Observable requirement:** Repeated-run stability/release decision beyond C01.
- **Allowed environment:** No applicable population/environment policy found.
- **Required sample count:** UNSPECIFIED; V31 twelve is diagnostic plan count, not release policy.
- **Pass threshold:** UNSPECIFIED; no reliability bound/confidence or allowed failure rate found.
- **Historical failures:** No approved supersession/native-exception or evidence-recency rule found.
- **What is measured:** Release policy, not a new application test.
- **Responsible owner:** Project acceptance/release owner; person/delegation not identified in repository.
- **Existing evidence:** Existing results are available; they do not contain the missing decision rule.
- **Decision:** EXTERNAL CRITERION REQUIRED. Neither12/12 sufficient nor12/12 insufficient is decided here; Phase2 release OPEN.

## C03

- **Existing exact sources:** migration/vanilla-frontend/tests/original-review-v27-journeys.mjs:9; migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:15; migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:13
- **Observable requirement:** At each equivalent route-disposed sample:0frames/URLs/requests/RAF; audio paused and no src; observer/timer counts do not grow vs first equivalent disposed stage. Legitimate shell timers and Playwright observer distinguished.
- **Allowed environment:** Actual read-only source; isolated authorized API fixtures; parent wrappers and sampled CDP; not every native realm.
- **Required sample count:** Existing test defines six cycles; V26 modal24 and V25 playing-media6 are separate existing evidence, not new stability policy.
- **Pass threshold:** Exact original assertions, plus unchanged authority/writer/source invariants in mandatory suite.
- **Historical failures:** V27 modal defect was demonstrated and repaired; old failures retained. Do not delete legitimate current-shell/harness owners.
- **What is measured:** Application-owned lifecycle observables, scoped.
- **Responsible owner:** Frontend implementation/verifier for executable checks; product acceptance owner separately.
- **Existing evidence:** V27 modal causal repair; preserved six-cycle/24-modal/playing-media reports and V31 full418-source PASS.
- **Decision:** IMPLEMENTED AND VERIFIED within stated scopes. Hypothetical unmeasured native objects do not make these features defective.

## C04

- **Existing exact sources:** migration/vanilla-frontend/docs/CHECKPOINT_V27.md:11; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:12; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19
- **Observable requirement:** Classify observed retaining paths without equating detached/allocated with abandoned app ownership.
- **Allowed environment:** Historical heap metadata and accepted normal CDP tools. Original historical raw heap unavailable.
- **Required sample count:** No universal native sample count specified.
- **Pass threshold:** No native-zero-allocation or all-target release threshold found.
- **Historical failures:** 219/232 shortest CSSAnimation paths and blank-page finding scoped; other13 not individually recoverable. Inspector causal release accepted.
- **What is measured:** Browser-native / test-process attribution, not universal app cleanup.
- **Responsible owner:** Project acceptance owner for scope; browser/tool vendors control unsupported internals.
- **Existing evidence:** Accepted CSSAnimation path and blank-page proof; V29 pointer-handle444→348,connected291/listeners184 unchanged.
- **Decision:** Scoped attribution accepted; universal/native release decision NOT MEASURABLE WITH AVAILABLE TOOLS; missing release scope requires external criterion.

## C05

- **Existing exact sources:** migration/vanilla-frontend/docs/V30_PHASE2_ASSESSMENT.md:3; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19
- **Observable requirement:** Current frame detaches/context terminal events after source exit, pending own checked bytes retained, PUT2→2 and no stale UI.
- **Allowed environment:** Original source fixture with normal CDP frame/context events; sandbox allow-scripts only.
- **Required sample count:** Existing V30 focused case; no universal OOPIF population specified.
- **Pass threshold:** Existing exact functional/frame-terminal assertions.
- **Historical failures:** Retain V30 invalid setups separately; accepted corrected result is not retroactive proof of every native resource.
- **What is measured:** Functional/normal lifecycle terminals, not decoder/GPU/whole-process disposal.
- **Responsible owner:** Frontend verifier for normal terminals; acceptance owner for broader native scope.
- **Existing evidence:** V30 disposal PASS preserved; V31 no new defect or expanded native proof.
- **Decision:** Scoped opaque-frame lifetime VERIFIED; universal native release NOT MEASURABLE, not presumed frontend defect.

## C06

- **Existing exact sources:** migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3; migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7; docs/RUNTIME-STABILITY-ARCHITECTURE.md:67
- **Observable requirement:** Fresh authoritative eligibility, exact own canonical identity/ACK snapshot bytes, pending ownership, explicit Retry/Adopt; stale source/UI epoch fencing; no automatic uncertain replay.
- **Allowed environment:** Existing ReviewAuthorityBarrier/ReviewJournal/CheckpointWriter/source bridge under fixture/native source tests.
- **Required sample count:** Existing functional tests define their cases; no invented sample count.
- **Pass threshold:** Unchanged exact assertions and timeouts, including both native Exam-readiness observations.
- **Historical failures:** V29/V30 actual failure chronology retained; accepted causal repairs remain unchanged.
- **What is measured:** Application correctness and authority boundaries.
- **Responsible owner:** Frontend implementation owner; server authority/backend policy belongs to existing external workstream.
- **Existing evidence:** V31 544/499/418 PASS; accepted V16 delivery fence and V14 observations;15 mixed journeys/30 source proofs.
- **Decision:** IMPLEMENTED AND VERIFIED in covered fixture scopes; live authorization is separate.

## C07

- **Existing exact sources:** migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V21.md:3; migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:10
- **Observable requirement:** Comprehensive original catalogue/previous-attempt/sequence/publication workflow verification beyond isolated source combinations.
- **Allowed environment:** Genuine canonical catalogue/attempt identities and authorized matching states, not invented DTO/IDs.
- **Required sample count:** No comprehensive product sample/closure set found; existing30 isolated-source proofs remain30.
- **Pass threshold:** Existing supported assertions cannot certify undefined/unprovided cross-catalogue/live requirements.
- **Historical failures:** Do not erase earlier OPEN catalogue requirements or claim32/32 from30.
- **What is measured:** Product/source integration coverage; distinct from native memory.
- **Responsible owner:** Project/content/media/catalogue authority; frontend verifier can execute only authorized defined cases.
- **Existing evidence:** V27 closed15 mixed journeys and30 valid-source checks; original workflow0/9; Test10/25 invalid boundaries; no authoritative previous-attempt/publication acceptance mapping supplied.
- **Decision:** BLOCKED BY AUTHORITATIVE EXTERNAL INPUT for comprehensive decision. Existing supported frontend checks remain executable and verified; no new frontend defect demonstrated.

## C08

- **Existing exact sources:** migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:12; migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15
- **Observable requirement:** Same original design/behavior in12 viewport-locale-theme combinations; CSS identity alone not matched rendered comparison.
- **Allowed environment:** 1440x900,768x1024,390x844 × EN/UZ × day/night; equivalent authorized original states.
- **Required sample count:** Twelve condition combinations, not a reliability count.
- **Pass threshold:** Original layout/behavior unchanged; equivalent original rendered reference required.
- **Historical failures:** Migrated-only screenshots cannot supersede missing original comparison.
- **What is measured:** Visual/product acceptance.
- **Responsible owner:** Project visual acceptance owner; original-reference access custodian, not named.
- **Existing evidence:** 25 original assets/source+compiled CSS exact; migrated geometry/focus/scroll proofs; no authorized matched original rendering.
- **Decision:** MATCHED-ORIGINAL VISUAL ACCEPTANCE UNVERIFIED; external reference/state required.

## C09

- **Existing exact sources:** docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:21; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:970; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:1647; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3829
- **Observable requirement:** Original product package requires browser acceptance twice and three cold/warm navigation rounds across>=10 representative routes with Back/Forward, tied to deployment SHA. Its resource-cleanup occurrence is WebRTC.
- **Allowed environment:** Explicit different branch arena/01a0f1a0-learners-area,dd23e0a original Next product/deployment; not this vanilla Phase2 +50/+5 fixture.
- **Required sample count:** Two browser acceptances/three performance rounds explicitly exist FOR THAT CONTRACT, not an inferred migration stability N.
- **Pass threshold:** Same-document navigation and separately measured feedback/usable-content/requests/recovery; no +50/+5 native-exception rule.
- **Historical failures:** Historical QA is not current deployment acceptance; PDF captions explicitly preserve that limitation.
- **What is measured:** Original deployment/integration QA, not Phase2 native population policy.
- **Responsible owner:** Original product owner/QA plus deployment authorization; not authority to switch this Arena branch or deploy.
- **Existing evidence:** PackageTXT lines21–23,970–973 and paired63-page visual PDF inspected. Current V32 instruction forbids branch/deploy/backend changes.
- **Decision:** Relevant external product requirements retained, NOT transplanted as a Phase2 repetition criterion. No unauthorized original-product tests/deployment.

## C10

- **Existing exact sources:** migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V31.md:11
- **Observable requirement:** Test10 forty invalid/unavailable timings; Test25Q30 end1236>1235.879 andQ40 end1525>1524.01 require authoritative correction.
- **Allowed environment:** Original sources1–32 read-only; no replacement recordings.
- **Required sample count:** Existing exact offending entries.
- **Pass threshold:** Finite positive ordered clips within authoritative part bounds; unavailable otherwise, never clamp.
- **Historical failures:** Preserve original bad values as evidence; do not rewrite them for PASS.
- **What is measured:** External content/media correctness.
- **Responsible owner:** Authoritative content/media owner; individual not established.
- **Existing evidence:** Preserved V27 timing handoff and V31 timingHandoff entries.
- **Decision:** BLOCKED BY AUTHORITATIVE EXTERNAL INPUT; frontend fail-closed behavior separately verified.

## C11

- **Existing exact sources:** migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15; migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md:38
- **Observable requirement:** Review aggregate promotion only after actual required gates close; Full/Retry code complete retained; Script not advanced/Reading gated.
- **Allowed environment:** Current owner V32 §§11,18,22 and inherited ledgers.
- **Required sample count:** No aggregate review release sample count or delegated signing authority found.
- **Pass threshold:** Do not promote from fixture-only success or declare a demonstrated feature broken solely from hypothetical native behavior.
- **Historical failures:** Historical failures remain evidence, not proof of permanent app leak.
- **What is measured:** Separate implementation/regression/release categories.
- **Responsible owner:** Project acceptance owner, no fabricated approval.
- **Existing evidence:** Full/Retry code complete, supported Review functionality verified, release policy and external scopes unresolved.
- **Decision:** Review PARTIAL while Phase2 release OPEN; EXTERNAL CRITERION REQUIRED, not a newly diagnosed code defect.

## Requirement decisions

| ID / requirement | Category / decision | Source | Workstream / implementation | Evidence | Remaining executable action / blocker | Owner |
|---|---|---|---|---|---|---|
| R01 Full IELTS frontend code | A — FRONTEND CODE COMPLETE | migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3; migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7; docs/RUNTIME-STABILITY-ARCHITECTURE.md:67 | Frontend: Existing native Full controller; no rewrite. | V31 actual-source journeys, preserved canonical/clock/checkpoint tests. | Run unchanged final mandatory regression only. Blocker: None | Frontend verifier |
| R02 Retry Weak Areas frontend code | A — FRONTEND CODE COMPLETE | migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3; migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7; docs/RUNTIME-STABILITY-ARCHITECTURE.md:67 | Frontend: Existing native Retry implementation. | V31 all40-source retry, history and authority fixtures. | Run unchanged mandatory cases only. Blocker: None | Frontend verifier |
| R03 Review aggregate frontend acceptance | B — PARTIAL | migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15; migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md:38 | Review / acceptance: Supported controls implemented; aggregate status not promoted. | 15 mixed journeys,30 valid-source proofs, V31 full418 PASS; open release/external categories below. | Verify mandatory cases; obtain exact missing acceptance decision rather than invent a feature defect. Blocker: C02 release policy plus R10–R13 external scopes | Project acceptance owner |
| R04 Mandatory fixture acceptance | A — V31 VERIFIED; V32 actual outcome post-seal | migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3; migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7; docs/RUNTIME-STABILITY-ARCHITECTURE.md:67 | Verification: 544unit/499Chromium/418source/14timing/4controls existing cases. | V31 independently exact-verified PASS; fresh V32 outcome authoritative in final reports. | Execute final exact V32 ZIP once; stop/plan any new failed mandatory case before expansion. Blocker: None | Frontend verifier |
| R05 Phase2 per-invocation strict test | A — PASS for named passing invocations; historical FAILs stay FAIL | migration/vanilla-frontend/tests/browser-v6.mjs:53; migration/vanilla-frontend/docs/CHECKPOINT_V6.md:27 | Frontend fixture QA: Original immediate +50nodes/+5listeners/stable shell unchanged. | V31 twelve PASS with deltas−22…+35; baseline/exact separate; historic failures retained. | One unchanged invocation within required499-suite, not another diagnostic series. Blocker: None | Frontend verifier |
| R06 Phase2 stability/release | D — OPEN — EXTERNAL CRITERION REQUIRED | migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md:38; migration/vanilla-frontend/docs/V31_PHASE2_DECISION_PLAN.md:19; migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15 | Acceptance authority: No new runtime defect established. | History provides outcomes but no applicable release reliability/supersession/native-exception rule. | Ask owner for existing applicable criterion and authority; do not propose arbitrary N. Blocker: Missing population, threshold, environment and historical-failure treatment | Project acceptance/release owner |
| R07 Application-owned DOM/listeners/timers/RAF/controllers/observers | A — IMPLEMENTED AND VERIFIED IN SCOPE | migration/vanilla-frontend/tests/original-review-v27-journeys.mjs:9; migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:15; migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:13 | Frontend lifecycle: Existing scoped owners; V27 modal repair retained; shell-owned timers legitimate. | Six equivalent route-disposed samples and24modal/6playing cycles; V31 full regression; harness observer distinguished. | Required existing regression only; investigate only new concrete owned callback/retaining path. Blocker: None | Frontend verifier |
| R08 Browser-native allocation and unknown13 historical targets | E — NOT UNIVERSALLY MEASURABLE; NOT AN APP DEFECT | migration/vanilla-frontend/docs/CHECKPOINT_V27.md:11; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:12; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19 | Browser/tooling / acceptance: No browser engine replacement or speculative app cleanup. | 219/232 CSSAnimation paths; original13 raw target identities absent; accepted isolated native reproduction. | Obtain authorized original target evidence and scoped criterion before an actionable new measurement. Blocker: Absent original raw heap and undefined native release scope | Acceptance owner / original-evidence custodian |
| R08a Playwright inspector handles | A — SCOPED ATTRIBUTION VERIFIED | migration/vanilla-frontend/docs/CHECKPOINT_V27.md:11; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:12; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19 | Test-process tooling: Accepted Playwright1.51.1 pointer-hit-test ownership, runtime untouched. | 444→348 allocated,291→291 connected,184→184 listeners after scoped15handle release. | None without concrete contradiction. Blocker: None | Frontend/tooling verifier |
| R09 Opaque-frame normal lifetime/dirty-write fences | A — SCOPED LIFETIME VERIFIED | migration/vanilla-frontend/docs/V30_PHASE2_ASSESSMENT.md:3; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19 | Source bridge / writer: Existing disposal fences and owned pending data preserved. | V30 frameDetached/context terminals,PUT2→2 and retained checked bytes; not every native allocation. | Existing mandatory source lifecycle coverage, no repeated focused disposal study. Blocker: None | Frontend verifier |
| R09a Universal OOPIF/decoder/GPU/SourceBuffer deallocation | E — NOT MEASURABLE WITH AVAILABLE TOOLS | migration/vanilla-frontend/docs/CHECKPOINT_V27.md:11; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:12; migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19 | Browser-native tooling: Media256KiB/8MiB/max2,MSE recovery/Blob fallback unchanged. | Normal CDP/media events and body-reader tests do not enumerate every native allocation. | No new study: no specified actionable available observation/criterion. Obtain scope/authorized tool capability first. Blocker: Unsupported universal native-memory observation; no permission expansion | Acceptance owner / browser vendors |
| R10 Comprehensive original-source product workflows | D — UNVERIFIED0/9 | migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V21.md:3; migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:10 | Catalogue/content/integration: Supported isolated flows verified; previous-attempt/catalogue/sequence/publication acceptance remains distinct. | 30 valid-source proofs;0/9 comprehensive; no invented published IDs or previous-attempt mapping. | Reconcile authoritative genuine IDs/attempt/publication scenarios with existing contract, then test only specified supported cases. Blocker: Authoritative cross-catalogue/previous-attempt states and complete acceptance mapping absent | Catalogue/content authority + acceptance owner |
| R11 Matched-original rendered visuals | D — UNVERIFIED | migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:12; migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15 | Visual QA: Original bytes/design unchanged. | 12 migrated conditions/25asset/CSS proof, not authorized matched-original product rendering. | Provide equivalent authorized original rendered states before paired comparison. Blocker: Missing equivalent authorized original reference/state | Visual acceptance owner |
| R12 Authorized live integration/vocabulary exam policy | D — UNVERIFIED0/9 | migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3; migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7; docs/RUNTIME-STABILITY-ARCHITECTURE.md:67 | Backend/GPT Work: Existing frontend barriers, APIs unchanged; static preview503 intentional. | Fixture authorization is not real backend acceptance. | Existing external owner supplies authorized matched environment/policy results; no live probe. Blocker: Authorization/environment/backend policy acceptance absent | Backend/GPT Work + project authorization owner |
| R13 Safari/hardware/original recordings | D — UNVERIFIED | docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:21; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:970; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:1647; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3829 | Device/media QA: Existing media controls/limits retained. | Chromium synthetic encoded fixtures only; no original audio capture. | Provide authorized device/browser/recording access and existing scenarios. Blocker: Authorized device/recording access unavailable | Device/media QA owner |
| R14 Original product two-browser/three-round deployment QA | D — SEPARATE EXTERNAL PRODUCT CONTRACT | docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:21; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:970; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:1647; docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3829 | Original product release: Different baseline/deployment; not an allocation-stability policy. | Exact package branch/SHA and repetition clauses located; PDF separates historical/current acceptance. | External owner reconciles applicability; this task does not switch branches/deploy or transplant N. Blocker: Different baseline/deployment and no authorization to exercise it | Original product acceptance owner |
| R15 Tests10/25 authoritative content timing | D — EXTERNAL INPUT REQUIRED | migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V31.md:11 | Content/media authority: Fail-closed unavailable clips; source untouched. | 40 invalid/unavailableTest10 entries;Test25Q30/Q40 boundaries pinned. | External authoritative correction only. Blocker: Authoritative times/original authorized recording reconciliation | Content/media owner |
| R16 Another arbitrary Phase2 repetition or settled-study replay | F — NOT REQUIRED / EXPRESSLY PROHIBITED | Current V32 owner instruction §§5,7,22 (conversation); migration/vanilla-frontend/docs/V31_PHASE2_DECISION_PLAN.md:19 | Optional diagnostics: Not implemented as a new V32 experiment. | Current V32 owner instruction §§5,7,22 explicitly forbids arbitrary series/blank-page/cancellation replay; V31 plan is diagnostic not release policy. | Do not execute; required original strict case remains in499. Blocker: Not used to waive any existing assertion or unknown native gate | Current V32 owner instruction |

## Exact citation receipts

### original-strict

`migration/vanilla-frontend/tests/browser-v6.mjs:53` SHA256 `46260dbf7089f85739dcdf03a2f8293b2c43ab72569688bb3fc674fd30f0b523`

> await check('Phase2 repeated real content navigation retains shell and bounded DOM/listeners',async()=>{const {context,page}=await fixture({handler:async({route,path,u})=>{if(path!=='/api/frontend/view')return false;const key=u.searchParams.get('route'),data=key.startsWith('/app/reports')?{reporter:{query:'',scopes:['student'],students:[]}}:{dashboard:summary(),openLessonsResult:{ok:true,lessons:[]},mock:mocks()};await route.fulfill({json:{version:1,route:key,region:u.searchParams.get('region')??undefined,data}});return true;}});try{await page.goto(base+'/app/reports');await page.locator('[data-reporter-form]').waitFor();await page.evaluate(()=>{window.__stableShell=document.querySelector('[data-shell]');window.__phase2Go=path=>{const a=document.createElement('a');a.href=path;document.querySelector('[data-shell-main]').append(a);a.click();a.remove();};});for(const path of ['/app','/app/mocks','/app/reports']){await page.evaluate(p=>window.__phase2Go(p),path);await page.locator(path==='/app'?'[data-dashboard-content]':path==='/app/mocks'?'[data-mocks-content]':'[data-reporter-form]').waitFor();}const cdp=await context.newCDPSession(page);await cdp.send('HeapProfiler.collectGarbage');const before=await cdp.send('Memory.getDOMCounters'),samples=[];for(let i=0;i<10;i++)for(const path of ['/app','/app/mocks','/app/reports']){const start=Date.now();await page.evaluate(p=>window.__phase2Go(p),path);await page.locator(path==='/app'?'[data-dashboard-content]':path==='/app/mocks'?'[data-mocks-content]':'[data-reporter-form]').waitFor();samples.push({route:path,usableContentAndHarnessMs:Date.now()-start});}await cdp.send('HeapProfiler.collectGarbage');const after=await cdp.send('Memory.getDOMCounters');assert(await page.evaluate(()=>window.__stableShell===document.querySelector('[data-shell]')));assert(after.jsEventListeners<=before.jsEventListeners+5);assert(after.nodes<=before.nodes+50);fs.writeFileSync(new URL('phase2-performance.json',out),JSON.stringify({conditions:'Chromium fixture 1440x900 EN/day, warm code, local transport, 30 switches; wall time includes Playwright locator overhead; not pixel paint/backend/media benchmark',before,after,samples,leakFreedomProven:false,liveBackend:false},null,2));}finally{await context.close();}});

### original-bounded-scope

`migration/vanilla-frontend/docs/CHECKPOINT_V6.md:27` SHA256 `87d1f8ce102a85e3ce6b477454a76975894fe3e02ec7b3ef6d0127a74d7ac1f4`

> Warm synthetic Phase2 navigation:30real route switches after code warmup; actual summary/mock/form readiness (not empty shell). Per-route min/median/max and DOM/listener/document snapshots in phase2-performance.json. Final fixture range23–106ms including Playwright overhead; a1–100ms target is NOT guaranteed. Before/after DOM476→518, listeners152→152, documents2→2. Bounded short run, NOT general leak-freedom proof, pixel paint, backend or media benchmark. No claimed Booster backend facts.

### application-cleanup-test

`migration/vanilla-frontend/tests/original-review-v27-journeys.mjs:9` SHA256 `dcd9e3275279ba83e2f5a9b164c034ffe62e87add0dac9d6d0c617da5db2a8ec`

>  await check('V27 six Review source route cycles attribute parent timers RAF observers requests URLs controllers and audio',async()=>{const {context,page}=await originalFixture({initial:submitted()});await page.addInitScript(installResourceProbe);const samples=[];const cdp=await context.newCDPSession(page);const sample=async stage=>{await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));await cdp.send('HeapProfiler.collectGarbage');const value={stage,counts:await cdp.send('Memory.getDOMCounters'),parent:await page.evaluate(()=>window.__v27probe())};samples.push(value);return value;};try{await page.goto(target);await open(page,'review');await ready(page);const initial=await sample('initial');for(let i=0;i<6;i++){await replace(page);await sample('source-replacement-'+i);await page.frameLocator('iframe').locator('#activity-review [data-back]').click();await page.frameLocator('iframe').locator('#hub:visible').waitFor();await page.locator('a[href="/app/listening"]').first().click();await page.locator('iframe').waitFor({state:'detached'});await page.locator('[data-shell]').waitFor();const settled=await sample('route-disposed-'+i);assert.equal(settled.parent.frames,0);assert.equal(settled.parent.urls,0);assert.equal(settled.parent.requests,0);assert.equal(settled.parent.rafs.length,0);assert(settled.parent.audio.every(a=>a.paused&&!a.hasSrc));if(i<5){await page.goBack();await open(page,'review');await ready(page);}}const disposed=samples.filter(s=>s.stage.startsWith('route-disposed'));for(const r of disposed){assert(r.parent.observers.length<=disposed[0].parent.observers.length);assert(r.parent.timers.length<=disposed[0].parent.timers.length);} }finally{fs.writeFileSync(new URL('../docs/evidence/v27/resources.json',import.meta.url),JSON.stringify({scope:'Six bounded real source/route lifecycles; parent instrumented realm only. CDP allocated counters do not prove all native/opaque iframe ownership. No universal no-leak claim.',samples},null,2)+'\n');await context.close();}});

### application-cleanup-scope

`migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:15` SHA256 `4de16d21b7d039a416ce46c8b9760aaf0fd7ebfb464070f28ae7e4728dac4765`

> Each of six route-disposed samples requires no iframe/URL/pending fetch/RAF, no active or sourced orphan Audio, and no growing observer/timeout count relative to the first equivalent disposed sample. Wrappers retain numeric handles/stack strings and WeakRefs, not target DOM nodes. WeakRef counts are sampled after diagnostic GC; dereferencing itself affects that job's liveness. The observer instrumentation stores numeric metadata and cannot prove the lifetime of every browser-native observer. ResizeObserver is instrumented where available; no separately observed active ResizeObserver is invented.

### shell-owner-exceptions

`migration/vanilla-frontend/docs/V27_RESOURCE_OWNERSHIP.md:13` SHA256 `4de16d21b7d039a416ce46c8b9760aaf0fd7ebfb464070f28ae7e4728dac4765`

> The two remaining timeout stacks identify the live shell authority-expiry scheduler (`js/authority.js`, watchAuthority) and code-only module prewarm (`js/module-prewarm.js`, createShell). Their current-route lifetimes are not old-source timers. The single remaining MutationObserver's constructor stack identifies Playwright `InjectedScript._setupGlobalListenersRemovalDetection`, not an application observer. This directly separates a harness-owned resource from application cleanup; do not “fix” the website to delete the harness observer.

### native-thirteen

`migration/vanilla-frontend/docs/CHECKPOINT_V27.md:11` SHA256 `b76a9f8c23ae20e05fa1747e65f28a1db6ae97aedcc86b87d865529ae15f6a16`

> Read V27_PHASE2_INVESTIGATION.md and its immutable evidence. Dominant captured path: detached skeleton → CSSAnimation → DocumentTimeline → HTMLDocument;219/232 detached native targets had a shortest path through CSSAnimation. Blank-page reproduction needs no application closure. The failed cancellation trial remains withdrawn. No CSS animation or motion changed. Both fixed four-run series3PASS1FAIL remain failures as recorded; historical failures are not overwritten by a later baseline pass. The strict +50-node/+5-listener original test is unchanged. Gate remains OPEN. Other13 native detached targets are not classified as animation targets. Snapshot paths are not exclusive-dominator proofs or attribution of all historical allocations. Raw snapshot locations were outside Git in the earlier environment; this restored sandbox retains the committed raw counter/retainer metadata and hashes, not those external heap binaries. No repeat investigation is used to manufacture them.

### inspector-attribution

`migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:12` SHA256 `6226753bb3a61e53617e8341c02b63a1112b99621445df5fa9aa75fea9babac7`

> Installed Playwright1.51.1 _checkFrameIsHitTarget acquires frame.frameElement() handles without disposing them. Its Chromium getFrameElement obtains DOM.getFrameOwner/DOM.resolveNode handles in the parent world. Source SHA/line evidence in driver-provenance.json. A scoped test-process wrapper records ONLY those handles with WeakRefs, protocol IDs and allocation stacks—no strong ElementHandle or website DOM reference added. Fifteen acquisitions were recorded. Releasing those owned inspector handles after6 cycles changes allocated nodes444→348, connected DOM291→291 and listeners184→184.12 iframe elements +84 attributes explain the96-node reduction, including the initial pair of frames. Public-ready sample then125 allocated/100 connected/37 listeners, versus222 or inspector-sensitive475 before cleanup. Exact extracted execution has its own raw results.

### native-tool-limits

`migration/vanilla-frontend/docs/V29_RESOURCE_OWNERSHIP.md:19` SHA256 `6226753bb3a61e53617e8341c02b63a1112b99621445df5fa9aa75fea9babac7`

> Native Audio Range terminal observations, controlled RangeMedia body-reader tests, and original encoded MSE/Blob/quota regression remain distinct resource scopes. Media.enable exposes only its events/properties; native decoder/GPU allocations and every SourceBuffer job are not universally observable. No private audio bytes captured/packaged. Existing256KiB chunks/8MiBLRU/two-transport contract unchanged. Native/callback settlement means observed fetch/RAF/media/source cleanup, not arbitrary sleeps or universal native-idle.

### frame-terminal-scope

`migration/vanilla-frontend/docs/V30_PHASE2_ASSESSMENT.md:3` SHA256 `6ed6502b1f904048ad62b5a45507d136f47efb11454c9e15cc24872853fe1b44`

> After V16 repair, first full417/1 exposed independent V14 pending-reload harness race; after justified native Exam gate, second full418/0/0 completed BEFORE resource work. New dirty-flush source-disposal case PASS: current-source Page.frameDetached observed after exit, retained own pending checked part, no additional PUT after exit or stale Review UI. Normal context terminal events recorded without universal process/decoder claims. Two resource-probe setup errors preserved separately: unescaped trace inside generated JS string, then incorrect expected redirect pathname (/app/listening is canonically redirected to /app/listening/lessons). Fixed TEST instrumentation/expectation only; no application cleanup patch, no sleeps/budget changes. Exact verification reruns this focused disposal regression, not completed inspector/animation research.

### snapshot-fence

`migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V31.md:7` SHA256 `9ff706e911bbefd9cc5c05fb0be53b231713a7a0a7dccfc5ba2ad340b807cefb`

> Authored parent checkpoint ACK adds acknowledged=original entry snapshot to the existing internal parent/opaque-child message only. Existing writer, server endpoint/DTOs/validators/authority/journal policy unchanged. Child accepts canonical hydration only if current local data's exact JSON matches acknowledged bytes. Initial fresh authorized hydration unchanged. Newer owned data preserves debounce and pending bytes; no automatic replay or additional mutation. Missing acknowledged field cannot hydrate. Source token/parent checks unchanged.

### canonical-fences

`migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V20.md:3` SHA256 `4a662676322bd450a8be877013ad0d970b983bf31acc80e3b297e349b5efffee`

> Review native authorized host now handles storage/focus/pageshow/visibility and existing SSE authority hints. Hints synchronously hide/inert the protected frame/recovery views, cancel selection/lookup and pause owned audio. Fresh session → canonical own state → existing progress availability → session → own state must match the captured submitted attempt. No material re-download. At most two rounds per burst; repeated churn/error fails closed with explicit Retry. Unchanged scope resumes the same frame without autoplay; changed/unconfirmed scope disposes frame/media/writers while pending own storage survives. Existing writer waits this barrier before ACK. Queued own drafts/course intents are retained without transport during concealment. Original part changes still change UI epoch, not route-owned writer disposal. Self-generated focus return cannot reenter the barrier. No polling, new endpoint or authority from browser events. Legacy/noncanonical identities are not guessed. Backend direct authored?vocabulary=1 policy remains external/unverified.

### comprehensive-open

`migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V21.md:3` SHA256 `97ec3a9d21e8a2cdf92cfcad427d8d71eac39efdd5a808a0f28ddb5aab4e6efd`

> New interface-only fragment grammar: #review/part/1..4 optionally /question/1..40, with strict question-to-part agreement. Bare #review retained. These are UI locations, NEVER canonical attempts or authorization. No new HTTP endpoint or server payload. Parent uses existing V20 metadata barrier for direct Review entry and same-document history/hash intent; initial sandbox stays at hub until fresh own canonical state/session/progress availability is validated. Existing source controls open the activity/select the part; no original HTML/grading engine rewritten. Latest navigation intent coalesces during validation without incrementing authority churn. Explicit applied→focus acknowledgments fence visible/noninteractive phase and focus restoration, with eight-second local failure deadline and explicit existing Retry. Parent/child source/window/token/sequence checks; stale frame load callback cannot publish a document into a replacement frame. One-shot load initialization, per-frame AbortController, owned RAF/debounced scroll timer cleanup. Generic authority hints do NOT refocus/reopen a location. Both existing writers/journals and UIepoch vs route-disposal distinction retained. Router onHistory is opt-in; other routes retain normal disposal. Only UI scroll/history keys enter history.state, not answers/identity/capabilities. Unsupported part URLs produce an explicit safe notice, no guessed part. Original activity hashes retained for native source controls. Previous-attempt selector/heterogeneous catalogue/sequence/publication comprehensive verification remains OPEN.

### earlier-executable-gates

`migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:10` SHA256 `1145eb34bef42ca13c33571653369178e60dbce84d466ed4cd3bccf3eb07a48f`

> Review remains PARTIAL. The V25 fresh pre-reveal defect is implemented, not deferred. Supported test01 original actions, long-response/keyboard/transcript/responsive matrix and bounded repeated route/source cleanup are exercised. Whole-catalogue equivalent modal/scroll/focus behavior, mixed recovery/lexical/retake/media stress across source variants, and browser-native timer/observer/media resource accumulation beyond the measured parent counters remain unclosed frontend acceptance/work gates. Six cycles do not prove unbounded leak freedom. These are not excused by missing live access; do not advance Script until closed. No unsupported previous-attempt mapping or API may be invented.

### v31-series-not-policy

`migration/vanilla-frontend/docs/V31_PHASE2_RESULTS.md:38` SHA256 `ee4b21a28deacb5e6b760767f598a7b7bda23d28efb64b4ac85cb2d8e74ac080`

> Both historical3PASS1FAIL series remain failed in immutable evidence. Earlier V25/V26 failures and other diagnostic series remain preserved too. V28's fourPASS, V29's strictPASS and V30's strictPASS stay separate. Twelve new PASS observations do not mathematically remove nondeterminism, explain inaccessible owners, retroactively change any failure or define a new release stability policy. No existing finite-run closure criterion was provided or shown met; **Phase2 OPEN / Review PARTIAL** is retained.

### v31-plan-sample-scope

`migration/vanilla-frontend/docs/V31_PHASE2_DECISION_PLAN.md:19` SHA256 `4b61499534b8da13e91c37ea9f7efcd5d13448cc50d319fc0462e0947ed78f84`

> I. Both historical3PASS1FAIL series remain failures; V28 four PASS and V29/V30 strict PASS stay separate. Existing gate was explicitly OPEN despite four PASS; no documented finite-run closure criterion authorizes promotion. Therefore even12 PASS cannot silently close Phase2. Final status separates original strict results, historical intermittence, app attribution, native transient explanation and Review acceptance. Gate stays OPEN unless existing objective acceptance is actually met and documented; no new policy invented.

### root-package-identity

`docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3` SHA256 `bbb9e9e0d7138944bf746b1ad1033b61d73891f186ed353c44fb555f7585f476`

> Current product feature branch: arena/01a0f1a0-learners-area

### root-package-rounds

`docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:21` SHA256 `bbb9e9e0d7138944bf746b1ad1033b61d73891f186ed353c44fb555f7585f476`

> 6. Run browser acceptance twice and navigation/performance three rounds. Use Safari or an

### root-package-navigation

`docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:970` SHA256 `bbb9e9e0d7138944bf746b1ad1033b61d73891f186ed353c44fb555f7585f476`

> - Performance three cold/warm rounds, >=10 representative routes +Back/Forward per round:

### root-package-phase2

`docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:1647` SHA256 `bbb9e9e0d7138944bf746b1ad1033b61d73891f186ed353c44fb555f7585f476`

> PHASE 2 — Navigation/performance + shell/UI defects

### root-package-webrtc

`docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt:3829` SHA256 `bbb9e9e0d7138944bf746b1ad1033b61d73891f186ed353c44fb555f7585f476`

> resource cleanup

### visual-evidence-limit

`migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V25.md:12` SHA256 `1145eb34bef42ca13c33571653369178e60dbce84d466ed4cd3bccf3eb07a48f`

> MATCHED-ORIGINAL VISUAL ACCEPTANCE: UNVERIFIED. No equivalent authorized rendered Next/React application reference is available here. Original source HTML/hooks are read-only and exercised under isolated API fixtures; this is not an authorized original product rendering.12 migrated geometry/keyboard/overflow screenshots are labeled migrated-only and are NOT fabricated side-by-side proof. Source/compiled CSS identity proves bytes, not pixel parity. No design change is allowed to mask a discrepancy.

### external-timing

`migration/vanilla-frontend/docs/SOURCE_STATE_INVENTORY_V31.md:11` SHA256 `5f158e27e4a7935178226c3346e6bb7f951ce0fc06f719d3af0055afff26b7cb`

> Test10 forty invalid/unavailable timing entries. Test25Q30 end1236>1235.879 andQ40 end1525>1524.01. External authoritative media/content correction only. No clamp/guess/source/key/transcript/audio/publication/identifier change; not32/32 acceptance.

### original-runtime-baseline

`docs/RUNTIME-STABILITY-ARCHITECTURE.md:8` SHA256 `3607ed5839a639b2ab8809100df554f29a09095f9e7005b36a5b05bd07c7e3ce`

> - Runtime starting SHA: `0f4a6eaed94da4254789c3c89f8c2871ab96959e` (branch `arena/01a0f1a0-learners-area`).

### original-runtime-authority

`docs/RUNTIME-STABILITY-ARCHITECTURE.md:67` SHA256 `3607ed5839a639b2ab8809100df554f29a09095f9e7005b36a5b05bd07c7e3ce`

> - Authority: cached data never decides auth/role/status/ownership; a 401 triggers `router.refresh()` → server gate.

### original-runtime-testing

`docs/RUNTIME-STABILITY-ARCHITECTURE.md:129` SHA256 `3607ed5839a639b2ab8809100df554f29a09095f9e7005b36a5b05bd07c7e3ce`

> `tests/runtime-stability.test.ts`: user isolation, logout clear, no-scope no-store, in-flight discard after account

### original-resource-map

`docs/RUNTIME-RESOURCE-MAP.md:4` SHA256 `5b8edd431193b6886810187d4838b0fb147e1d7519e667013e05f34f2555abf6`

> Measurements: local `next start` production build + PGlite socket DB, seeded demo data, `curl` against `127.0.0.1:3000`

### original-reading-scope

`docs/READING-PRODUCTION-STABILITY.md:1` SHA256 `3af158fcf4d4f74d0c34ff6028a62713e690d1e375f1f8f5972c8bc91172618c`

> # Reading production stability — the P0, its cause, and what changed

### riwi-stability-scope

`docs/arena/LEARNERS_AREA_ARENA_COMPLETE_NO_BACKGROUND_RIWI_SUPER_MASTER_META_PROMPT_2026_10_08.txt:18402` SHA256 `e2eb7780ce0fe31fdbb922e31871c8e1aae45a46404a17cee426b05526ee5921`

> 38.10 — STABILITY

### status-contract

`migration/vanilla-frontend/docs/ROUTE_LEDGER_V31.md:15` SHA256 `407c444f48b2790efa268dad389781bbb9b1bd62edae17337f60fa1714f9303a`

> Full IELTS and Retry Weak Areas FRONTEND CODE COMPLETE retained. Review PARTIAL; original Phase2 stability acceptance OPEN. Script NOT ADVANCED; Reading GATED. Matched-original rendering, authorized live integration and Safari/hardware/real-recording acceptance UNVERIFIED. No product-wide percentage claim.

## Important boundary

The original product package contains actual2-browser/3-navigation-round counts; they were not overlooked. They name another branch/dd23e0a deployment and distinct original product QA, with >=10 routes and deployment receipts. The PHASE2 heading there is navigation/performance/shell work, not the later migration's +50/+5 allocation criterion. Its WebRTC resource-cleanup clause is not a Review decoder deallocation specification. Current V32 forbids branch/deploy/backend changes. These clauses remain external product requirements, not an excuse to pick2,3,12 or another arbitrary Phase2 stability N.

The thirteen aggregate decisions requested by V32 map directly to R01–R13. Subrows separate scoped observed cleanup from universal native claims. Main R03 is aggregate acceptance-incomplete, not a claim that each demonstrated Review feature remains unimplemented because GPU objects are unobservable. The original catalogue/previous-attempt requirement in ADAPTER_CONTRACTS_V21 remains visible; thirty isolated sources do not certify an unspecified heterogeneous published/live workflow. No unsupported API/ID/selector behavior is invented.

## Other stability-named contracts, explicitly disambiguated

RUNTIME-STABILITY-ARCHITECTURE.md §§1–2,21–23 describes a different Next baseline, server authority, cache isolation, deadline/retry bounds and externally unverified browser metrics. Its existing applicable security invariants are retained through C06; its title does not supply a native-allocation stability threshold. RUNTIME-RESOURCE-MAP.md classifies data/cache resources under that same baseline, not a DOM-retainer release policy. READING-PRODUCTION-STABILITY.md is the original Reading incident/role/route production evidence, not Review native memory acceptance. The Oct8 RIWI master prompt §38.10 explicitly means provider/tool timeout, aborted/stale requests and no infinite loading; those provider/backend instructions are not a Phase2 node/listener repetition contract. SQL migration approvals and Content OS Phase2 reports have different schemas/workstreams and cannot authorize Review promotion or backend edits. Exact source/hash/line receipts are included above, so these superficially matching requirements have not simply been omitted.
