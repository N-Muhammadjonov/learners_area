# CURRENT V38 — Listening still NOT COMPLETE; audit and two repairs only

Baseline V37 **79a289298f25a26e4804168df9d228129294a024** on `arena/96836bcf-learners-area`. V38 did **not** deliver the working frontend for the six partial learner routes; it performed a read-only parity audit of all six, repaired two real divergences (legacy exam submit error mapping; MCQ Day reasoned completion focus), added a focused browser suite (5/0), and ran the full mandatory regression (exit 0: units 605/0/0; browser 499/0; actual-source 418/0/0; timing 14/0; equivalent controls 2/0). No route, component, or workflow promoted: routes 9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED; components 9/10/5. Six strict visual FAILs remain open and unexplained; not hidden, not tolerated.

Read V38_LISTENING_IMPLEMENTATION_REPORT.md, V38_LISTENING_ROUTE_CLOSURE_MATRIX.md, V38_LISTENING_BROWSER_VERIFICATION.md, V38_LISTENING_VISUAL_PARITY.md and V38_LISTENING_GPT_WORK_HANDOFF.md first. Unfinished source work per route is in the implementation report §13. Phase2 A–J remains an unsigned BLOCKED owner decision. Live integration UNVERIFIED. No main merge, deploy, ZIP, or new API. Do not run document-listening-v37.py (it rewrites this file from an older marker).

# CURRENT V37 — Listening priority; whole module NOT COMPLETE

Baseline **62076acc0178602c0bd87025f5c542510242bc1e**, same Arena branch. Listening supersedes course video/Grammar priority. **This is not whole-Listening completion or release approval.** No main merge, deployment, new backend, Staff implementation, educational reconstruction or ZIP. Human project owner authorizes implementation; separate unsigned Phase2 A–J release decision remains BLOCKED and does not block frontend work.

Historical counts are preserved, not silently relabeled: 16 canonical Listening routes = **9 CODE COMPLETE / 6 IN PROGRESS / 1 Staff NOT STARTED**. Target = 15 learner routes; historical frontend-code-complete count remains **9/15**, not 15/15 or 16/16. Full accepted/parity status is not established; do not confuse this historical code count with strict original/live acceptance. 24 components = **9 CODE COMPLETE / 10 IN PROGRESS / 5 NOT STARTED**. Global108 routes22/18/68;206components62/19/125;35 Staff routes reserved. CODE COMPLETE is historical frontend/fixture scope, not accepted production or comprehensive original parity.

Script source-owned navigation/accessibility/hydration and source-specific Matching history repair and revision attempt-identity repair implemented. New original-source Script12condition matrix, revision explicit vocabulary scope test,605units and mandatory verification reports in docs/evidence/v37. Strict six-route visual evidence has retained FAILs; no route/component promotions, ZIP, release, merge or deploy.

Read V37_LISTENING_COMPLETION_MATRIX.md, V37_LISTENING_FUNCTIONAL_VERIFICATION.md, V37_LISTENING_VISUAL_VERIFICATION.md, ADAPTER_CONTRACTS_V37.md and V37_LISTENING_INTEGRATION_HANDOFF.md before continuing. Listening supersedes V36 video/Grammar recommendation; continue remaining ordinary Listening work independently of Phase2 release. Staff imports/management reserved, audio-probe is import metadata only.

---
Historical handoffs follow.

# CURRENT V36 — course lesson implementation, independent work ACTIVE

BaselineV35 e8beca18e3bf9dd51a86691aaff4601d8f1e6bab. Native lesson detail/workspace/state actions/private-note pipeline and course material consumer now implemented in supported fixture scope; whole routePARTIAL. Existing ONE note writer reused and repaired for ACK-reversion stale pending + failed duplicate-flush automatic replay. Native workspace preserves textarea node/focus; no optimistic progress. SourceisOpen excludescompleted/locked/scheduled; preserve original page branch behavior.

595unitPASS;92actualcoursebrowserPASS; final browser/regression results in evidence/v36/verification.json and browser-course.json. V35entry33functionalPASS; fresh entryvisual17/7FAIL, historicalV35 18/6FAIL retained. Newlesson initialsourceReactvisual9/3FAIL,maxchannel1,geometry12/12equal. No tolerance change,originalNext/live acceptance or videoStudio completion. Recorded bounded unchanged-native A/Bcapture control is inconclusive for root cause; do not relabel historicalFAILs.

Routes22/18/68;components62/19/125;Staff35reserved;remainingnonStaff51,remainingcomponentfiles144. See V36_IMPLEMENTATION_HANDOFF.md,ADAPTER_CONTRACTS_V36.md,route-ledger-v36.json/component-ledger-v36.json,V36_DEPENDENCY_INVENTORY.json. No newZIP/seal. Source/backend/content/Staff/Dictionary unchanged.

NEXT V37: actual VideoLessonStudio course mode/provider/direct-media ownership→watchedprogress→authored answer/response tabs→transcript and applicable vocabulary dependencies (reflection is standalone-only). Read originals; do not replacewithiframe or invent materials. GrammarTopic/activities independent option after lesson priority. Human projectowner authorizes wholewebsite migration. Pending Review-specific release must NOT halt ordinary implementation. ReviewPhase2 remainsBLOCKED pending actualA–Jdecision,not approved.

---
Historical handoffs retained below; V36 above is current.

# CURRENT V35 — human owner correction: independent frontend implementation ACTIVE

The human project owner/original creator explicitly authorized whole-site migration within constraints. This supersedes V34's global external-input stop condition. Do not confuse human ownership with app roles. Review-specific release remains pending A–J decision, NOT approved; its unsigned packet/raw evidence remain. Pending Review acceptance MUST NOT halt independent ordinary frontend work.

V35 implemented native CourseRoadmap `/app/courses/ielts` and Grammar topics `/app/grammar?tab=writing|speaking`, retaining both PARTIAL. Global22/17/69 (108),components62/17/127(206),Staff35reserved unchanged. See V35_IMPLEMENTATION_HANDOFF.md, V35_DEPENDENCY_INVENTORY.json and route-ledger-v35.json/component-ledger-v35.json. Existing extracted source/Card/Badge/ProgressBar, shell/navigation/locale/theme reused; no educational/backend/Dictionary/Staff changes.575unitPASS incl31new; new33functionalbrowserPASS, strictvisual18/24PASS6FAIL(maxchannel1;geometryall24equal), not running originalNext/live. Browser visual gate remains nonzero. Relevant preserved browser v3/v5/v10 regressions49/52/53PASS (154total),0FAIL; historical evidence restored byte-for-byte. Current exact results in evidence/v35/regressions. No V35ZIP/seal and no full499/418run claimed.

NEXT: courseLessonWorkspace→reuse existing lessonNotes owner + original lesson-state API→materials/video provider consumers→courseLessonDetail; parallel GrammarTopic/activity clients. Inspect full source/dependencies. Can start without Review approval. Do not promote HTML-only route; explicit integration/visual gaps remain actionable without blocking other implementation. Owner message itself is authorization for this independent work; do not demand another owner-route search first.

---
Historical handoffs below are retained; V35 instructions above are current and supersede earlier GLOBAL stop language.

# V34 current handoff — stop at confirmed external blockers, no automatic V35

V33 remains the last independently verified packaged checkpoint: report d1919555b0f4a8d5587b50c12122840eede1ffde,source17d12f5fc0879db6f26ebdbdbc7403df9f0771fd,seal0c52da7b94f6a01fdf0fb979e79931ca5fbfba13;ZIP100443205bytes/2130members/SHA19aab9d9659fbd8e9f52b6ca2951e645cc0748e35ba14ea35061f8dbbb01b735. V34 reverified allZIPGitbytes/hashes/CRC,38archives,2104originals,1428historicalevidence. Runtime/tests/oldpacket/catalogue unchanged. No V34ZIP/seal or fresh mandatory suite/audit/performance run; do NOT call preservedV33PASS a freshV34run.

Current requester explicitly selected NO AUTHORIZED ROUTE AVAILABLE and NO NEW EVIDENCE AVAILABLE in Arena ask_user. This is not an owner decision or authority delegation. PHASE2BLOCKED—OWNERDECISIONREQUIRED;ReviewPARTIAL;ScriptNOTADVANCED;ReadingGATED. Reuse exact unsignedV33packet, do not duplicate/version-bump it. V34_EXTERNAL_BLOCKER_HANDOFF.md is concise A–J request and V35material triggers; V34_ACCEPTANCE_MATRIX.md splits17scopes; V34_CATALOGUE_ACCEPTANCE_STATUS.md clarifies actual contracts.

Original own-history/attempt-ID detail/revision behavior EXISTS via listUserAttempts/getAttemptDetail with ownuser and boundquestionversion. Migration historyDTO/route-v7 consumers already exist. Completed non-sectionAcademic package redirects to test-level activity2; authored-state current/latest fallback is NOT proof of arbitrary older authoredReview selection. Do not claim no historical contract anywhere; do not claim every prior authoredReview is supported. Need source-kind applicability/selection and authorized own data. No new frontend bug inferred. Test11/22keys remain both recorded/unresolved; waiting/draft repo declarations notlivefacts;10/25corrections externalonly.

Do not start identical V35 automatically. Require real authorized rule/decision, genuine catalogue/attempt/publication evidence, independently reproduced app defect, authorized access enabling a specific blocked verification, or an existing legitimate requirement naming a concrete action. Identify trigger/source first. Otherwise stop with precise owner handoff; no new arbitrary trials, no Script/Reading bypass, no redesign/backend/content/Staff/Dictionary/main/deploy/retention changes. Existing V33 package command targets a historical checkpoint: do not invoke it to overwrite V33 with these documentation additions.

---
## Historical handoff sections — preserved, V34 above is current

# V33 — BLOCKED acceptance checkpoint, no runtime implementation change

Current release disposition: **EXTERNAL RELEASE ACCEPTANCE BLOCKED**. Review PARTIAL; Full IELTS/Retry Weak Areas FRONTEND CODE COMPLETE; Script NOT ADVANCED; Reading GATED. No owner approval/rule/signature obtained. Human project-owner role documented; specific signer/delegation and established accessible Phase2 approval mechanism not identified. Source of truth: V33_PHASE2_OWNER_DECISION_REQUEST.md (unsigned A–J), V33_CATALOGUE_ACCEPTANCE_HANDOFF.md (32sources/9workflows), V33_ACCEPTANCE_STATUS_MATRIX.md (13decisions), V33_REMAINING_EXTERNAL_DECISIONS.md. Targeted18provenance receipts reuse V32's audit, no new broad search or arbitrary native/Phase2 diagnostic.

## CURRENT V33 HANDOFF (supersedes historical next tasks below)

V32baseline b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325 verified after safe359file75144582byte preservation and samebranch normalFF from9a7d. V32ZIP100238862bytes/2109members/SHA138fb550e9d28e4ec4ed266a6c53c8ea51f82dbf190646d88ac341cfaec69835 allCRC/Gitbytes/memberhash verified;37priorarchives preserved. V33tooling b17ec7be88e810a38e009106865257e029853408. Source/seal/final identities and fresh exact outcomes are external final V33_VERIFICATION.json/V33_VALIDATION.txt by existing source-only ZIP policy.

Main new work is an OWNER-READY UNSIGNED decision request with A–J and exact chronology/scope, and catalogue/previous-attempt/publication handoff32sources/9workflows. No actual rule or signoff obtained. Human owner role identified but named signer/delegation/channel not verified; no approval from GitHubownership/demoOwner/taskexecution/oldDBTasdiqlayman. Ready for requester to route; no external submission fabricated. Test1codeUUID known,2–32currentauthorizedUUID binding not supplied; draft/waiting manifest declarations notlivepublication. Test11/22manifeststorage differsruntimecatalogue, documented only; don'trewrite originals. Existing authored-state current/latest fallback not arbitrary historicalselector; GETmaynormalizecheckpoint so don'tprobeproduction.

ZERO extraPhase2/native studies. One mandatoryexact V33 verification544/499/418/14/4 with oldtests/names/timeouts,originalstrictinside499,4equivalent20samplecontrols,25assetsCSS,2104originals/history,tworepacks. Stop newmandatoryfailure, preserve evidence and write boundedplan; no unchangedretry. No newappdefect or runtime repair. No performanceimprovementclaim. V32−23nodes/152listeners/docs2;V31twelvePASSnotautomaticrelease;both3/1andallotherfailuresremainfailed. No blankpage/cancel/inspectorstudies, newGC/sleeps/budgets/security changes. 15mixed/30sourceproofspreserved, not additional matrices. Test10/25authoritativecorrectiononly. ExistingV16/V14/v27fixespreserved.

Exact V34 continuation is in V33_REMAINING_EXTERNAL_DECISIONS.md and final validation/report: verify V33 identities/results/history, prioritize actualmandatoryfailure ifany; otherwise route actualownerpacket, obtain authenticated authority/rule/datescope and missingoriginalcontextstates, applyonlyauthorizedfiniteobservations with prewrittenrule; ifunavailable keepBLOCKED/ReviewPARTIAL/ScriptNOTADVANCED/ReadingGATED. No redesign/content/backend/Staff/Dictionary/main/deploy/retention changes.

---
## Historical handoff (preserved, not current instructions)

# V32 current handoff — acceptance authority reconciled; supersedes older next-task instructions

Exact V31 baseline cf5df0d8bce7e8b22a203a7458a4ac54e787f3d6, source98fd7ef0aea78ef457808857c91d041094dd1850/seal3daf82bd8194827fa9040ca00b5e59de998937e3; ZIPeed242e11efd12bfbee617836b48741449a2eaadb3b18df0508389959539837a/99738886bytes/2089members verified every Gitbyte/CRC/hash. Initial local=remote clean; no unexpected work. V32 tooling bc28d715772ec145963da59cadb36467d0f1b64d; NO runtime/oldtest/content/CSS/backend changes. Source/seal/final report identity and fresh exact outcomes are post-seal deliverables/V32_VERIFICATION.json and V32_VALIDATION.txt, not copied V31 PASS.

Read V32_ACCEPTANCE_CRITERIA_MATRIX.md, V32_PHASE2_DECISION.md and V32_REMAINING_GATES.md.835 tracked text sources +63page pairedPDF/29 exact source-line-SHA citations inspected. Original per-run +50nodes/+5listeners/stable-shell criterion exists; applicable repeated-population/pass-threshold/history/native-exception/signed-release rule does not appear in available authoritative material. EXTERNAL CRITERION REQUIRED, not a decision that12/12 is sufficient or insufficient. Original product2-browser/3-navigation-round contract concerns another branch/deployment, not allocation stability; runtime-cache, Reading-production and RIWI/provider-stability contracts are disambiguated. No new release policy or approval invented.

ZERO added Phase2/native diagnostics. Mandatory exact V32 ZIP544unit/499Chromium/418source/14timing/4controls runs once, including original strict case and existing lifecycle regressions; actual final reports authoritative. Stop any new mandatory failure before expansion; preserve and bounded causal plan, never unchanged retries. Existing supported application cleanup and normal frame terminals are scoped verified, not incomplete solely from hypothetical native/GPU objects. Universal native release not measurable with available tools;13 historical target identities require original raw evidence. No speculative runtime repair.

Historical two3PASS1FAIL remain failures; V28fourPASS/V29V30originalPASS/V31twelvePASS separate. V16 exact acknowledged-snapshot fence, pending bytes/timers, exact own-byteACK, singleflight/manualRetryAdopt/canonicalforeign isolation and both V14 Exam-ready observations unchanged.15 mixed/30 valid-source proofs retained. No settled blank-page/cancellation/inspector re-study. Archive history/early duplicate bodies preserved; no dedup/exclusion/retention rewrite.

Full/Retry FRONTEND CODE COMPLETE; Review PARTIAL while Phase2 releaseOPEN; Script NOT ADVANCED; Reading GATED. All global/Listening/Staff/workflow inventories unchanged22/15/71,62/17/127;9/6/1,9/10/5;35reserved;2/9frontend,0/9comprehensive/live. Comprehensive previous-attempt/catalogue/sequence/publication verification still needs genuine authoritative IDs/states and acceptance mapping, not an invented API/selector or adjacent30-source proof. Visual original-matched/live/vocabularybackendpolicy/Safari/hardware/originalrecordings unverified. Tests10/25 external authoritative corrections only; no clamp/guess/content/audio/ID/publication change.

**Exact V33 task:** verify sealed V32 identities and immutable history first. If final V32 mandatory failures exist, investigate only the named failure with a written bounded causal plan, preserve failure/assertions and repair only a demonstrated owner; no unchanged retries. Otherwise obtain the existing owner-authorized Phase2 release criterion (population/environment/threshold/history treatment/native-exception and signing authority) and authoritative catalogue/previous-attempt acceptance states. Apply that actual rule to preserved V26–V32 outcomes; do not infer12/12 sufficient or insufficient, choose another arbitrary sample count or repeat settled native studies. Execute only a specifically required finite authorized observation with decision rule fixed beforehand. Preserve supported verified application features; do not label hypothetical unobservable native objects as app defects. Review PARTIAL while release OPEN; Script NOT ADVANCED/Reading GATED. Test10/25 corrections external authoritative only. No original design/content/backend/Staff/Dictionary/main/deploy/archive-retention changes.

---
# Historical handoff sections (preserved; V32 is current)

# V31 current handoff — authoritative over older next-task statements below

Evidence-only checkpoint from sealed V30 final ba4ec43474e5900a5520e70aa83913f05885d98e; no runtime/content/CSS/backend change. V31 tooling implementation015820ce30d1bfd06e944e1446d5f6e22eae09ab. Source/seal/report/ZIP identities and independent outcomes: deliverables/V31_VERIFICATION.json / V31_VALIDATION.txt (post-seal reports, outside source ZIP under unchanged policy).

Written A–J plan preceded tests. Preseal544 units/499 Chromium/418 original-source/14 timing PASS. Fixed original-stage12 repetitions:12PASS/0FAIL/0SKIP, no retry; node deltas−22…+35, listeners152, connected elements278, documents2, frames/dialogs/loading0, shell stable. No new ownership contradiction; conditional followup unused; no speculative repair or repeated settled studies. Final exact ZIP mandatory regression/four controls separately authoritative in final reports, not extra diagnostic runs. Reporting-only wrapper convenience-log issue disclosed; all499 case/stdout proofs retained, no rerun to recover it.

Phase2 OPEN despite12PASS: historical two3PASS1FAIL series remain failures, V28 fourPASS/V29PASS/V30PASS separate; no new finite-run acceptance policy.219/232 historical CSSAnimation shortest paths do not identify all13 unavailable targets. Accepted Playwright inspector handle attribution unchanged; no runtime cleanup or animation/dependency change. V16 acknowledged-snapshot fence and both403/V14 native Exam observation gates unchanged; original assertions/timeouts retained.

V29→V30 growth52,881,261bytes fully reconciled:52,632,221 compressed duplicate PARTIAL/V2/V3/V4 checkpoint bodies;249,040 remaining source/evidence/headers. Neither source ZIP directly contains the V29 ZIP. All history retained; no exclusion/dedup change; V31 resume uses references to existing deliverables so adds no duplicate bodies. See V31_ARCHIVE_SIZE_AUDIT.md.

Full/Retry FRONTEND CODE COMPLETE; Review PARTIAL; Script NOT ADVANCED; Reading GATED. Frontend workflows2/9; comprehensive original0/9/live0/9. Global routes22/15/71,components62/17/127; Listening9/6/1,components9/10/5; Staff35 reserved.15 mixed/30 valid-source proofs retained, no unnecessary extension rerun. Test10/25 external authoritative correction only; original source1–32/content/recordings/mappings/publication/IDs read-only. Matched-original12-condition visuals/live/vocabulary backend exam policy/Safari/hardware/original recordings/universal native release UNVERIFIED.

**Exact V32 task:** first verify sealed V31 source/seal/report/archive identities and preserve all prior failures. Diagnose any newly failed mandatory case with a written bounded causal plan and unchanged assertions, not unchanged retries. Otherwise continue Review only: obtain the existing objective Phase2/native acceptance criterion and evaluate whether available evidence meets it; if concrete contradictory app ownership is demonstrated, investigate only that owner/boundary with one matched causal proof and focused existing-controller repair. Do NOT launch another arbitrary stability series, repeat accepted CSSAnimation/blank-page/inspector/dirty-debounce studies, change animation/budgets, infer thirteen unavailable retaining-target identities, or close OPEN from twelve samples. Original heap/authorized evidence is required for unresolved identities; archive dedup policy requires explicit approval before any retention-format change. Keep Review PARTIAL, Script NOT ADVANCED, Reading GATED; Test10/25 corrections external authoritative only; no backend/content/design/main/deploy changes.

---
# Historical handoff sections (preserved; superseded where V31 states current status)

# Latest — V30 V16 existing storage-ACK owner repaired; Review PARTIAL

Read CHECKPOINT_V30, V30_V16_ROOT_CAUSE/PLAN, V30_TIMELINE_STAGES, SOURCE_STATE_INVENTORY_V30, ADAPTER_CONTRACTS_V30 and final V30_VALIDATION/V30_VERIFICATION. Final reports authoritative over preseal pending statements. V29417/1 and V28403 failure remain failures.

Native-order counterexample: older valid checkpoint delivery overwrites newly checked Review storage and cancels its debounce; response predicate was installed before Check, legitimate progress ACK separate. Existing paintedBridge now compares exact current child bytes against original acknowledged snapshot in internal checkpoint message. Newer bytes/timers survive; backend DTOs, writer/journal/authority,8000ms/original PUT predicate/UI assertions unchanged. No extra call/replay/forced state. Invalid instrumentation and CSP probes retained, not causal evidence. Historical untraced ordering unknown.

Focused ordinary+controlled original1440/uz/day PASS,27 V16 neighbors PASS,4 unit checks PASS; complete first-source and exact-ZIP results reported separately. Preserve accepted403 Exam-active guard, Playwright inspector ownership,15 mixed/30 source proofs. Do not repeat completed blank-page/animation/inspector studies without concrete new question. New dirty-debounce source-disposal check is bounded ownership regression, not universal decoder/GPU proof.

V31 continuation ONLY: follow final exact verification's remaining failures first if any; otherwise remaining Review original Phase2/native/opaque/hardware acceptance with a specific new question and objective closure criterion, no speculative cleanup or acceptance promotion. Historical13 IDs require original heap. Test10/25 corrections external. Full/Retry frontend complete; Review PARTIAL; Script NOT ADVANCED; Reading GATED. Comprehensive-original/matched visuals/live/Safari/hardware/original recordings/vocabulary backend exam policy UNVERIFIED. No V31 begun, merge or deployment.

V30 chronology update: first full after V16 repair417/1 exposed NEW V14 pending-submission reload score-hidden observation race. That branch (not accepted403 branch) now waits native Exam activity before original results. Focused/control PASS; second justified full418PASS0FAIL0SKIP before resource work. New dirty-state disposal regression PASS; own pending bytes and source frame/context terminals recorded, no further PUT after exit. Invalid resource instrumentation/redirect-expectation probes retained separately. Final exact-ZIP run remains authoritative, not inferred from preseal418.

## Historical handoff preserved

# Latest — V29 —403 native-navigation observer repaired; Review PARTIAL

Read CHECKPOINT_V29, V29_403_ROOT_CAUSE, V29_RESOURCE_OWNERSHIP/PLAN, SOURCE_STATE_INVENTORY_V29, ADAPTER_CONTRACTS_V29 and final V29_VERIFICATION.json/V29_VALIDATION.txt. Final reports override any preseal pending outcomes. Preserve exact V28417/1; do not relabel it PASS. The recovery observer now waits native Exam activity before original results action; focused and pre-resource whole418 suite passed, final exact run reported separately. Original8000ms/score visibility/value/two-PUT assertions remain.

The16-node slope is attributed at measured stages to orphaned Playwright1.51.1 pointer hit-target parent iframe inspector handles, not app callbacks:10 iframes+70 Attr added across5 further cycles; release12 iframe+84 Attr after6 cycles drops444->348 with connected291/listeners184 unchanged. Console clearing failed; retain negative control. Diagnostic scoped release is not website code or Phase2 policy, no dependency files changed. Preserve legitimate controllers/timers and sandbox allow-scripts only.

V30 continuation ONLY: remaining Review native/opaque/media/hardware acceptance and original Phase2 stability. Do not reopen repaired403 or16-node ownership without concrete regression. Historical13 identities only if original raw heap available, no invented reconstruction. Preserve15/30 accepted proofs and all failures. Original Phase2 OPEN, Review PARTIAL, Full/Retry implementation retained with fixture status separate; Script NOT ADVANCED, Reading GATED. Test10/25 authoritative content/media correction external. Comprehensive original/matched visual/authorized live/backend vocabulary exam-policy/Safari/hardware/real recordings UNVERIFIED. No V30 begun, merge or deployment.

## Historical handoff retained

# Latest — V28 ownership evidence, Review PARTIAL

Read CHECKPOINT_V28, SOURCE_STATE_INVENTORY_V28, ADAPTER_CONTRACTS_V28, V28_PHASE2_INVESTIGATION and V28_RESOURCE_OWNERSHIP plus final V28_VERIFICATION.json/V28_VALIDATION.txt. No application runtime change was justified. Four strict original diagnostic runs passed but historical failures remain, Phase2 OPEN. Historical thirteen identities not recoverable from absent raw heap; fresh full target lists and native/inspector scope limits retained. Four controllers and live-shell timers attributed, not arbitrarily deleted. Body fixtures and native network/media contexts improve coverage without claiming decoded/GPU release.

V29 continuation ONLY: continue precise unresolved native/opaque/inspection-sensitive retained-target attribution, including16-node per-cycle resource growth and exact historical13 identity only if original raw heap becomes available. Predefine new bounded diagnostic plan only for a concrete remaining question; no repeated blank-page/cancellation/motion/budget work. Fix actual demonstrated application lifecycle defect if established; do not invent one. Preserve accepted15 mixed/30 source proofs and all failures. Test10/25 external correction remains content/media owner; comprehensive original/matched visual/authorized live/Safari/hardware/recordings separate UNVERIFIED. Full/Retry retained, Review PARTIAL, Script NOT ADVANCED, Reading GATED. No V29 begun, backend/content/Staff/Dictionary work, merge or deployment.

## Historical handoff retained

# Latest — V27 Review ownership checkpoint, PARTIAL

Full IELTS and Retry Weak Areas FRONTEND CODE COMPLETE retained. Review PARTIAL; original Phase2 stability acceptance OPEN. Script NOT ADVANCED; Reading GATED. Matched-original rendering, authorized live integration and Safari/hardware/real-recording acceptance UNVERIFIED. No product-wide percentage claim.

Continue from final V27_VERIFICATION.json source/seal/report/ZIP pins. Read CHECKPOINT_V27, V27_PHASE2_INVESTIGATION, mixed/source/resource matrices and Test10/25 external handoff. Preserve the accepted native-animation retainer evidence and unsuccessful cancellation trial. Do not reintroduce cancellation or change original animations/budgets. Complete any exact unverified lifecycle combinations and remaining ordinary resource attribution before promoting Review; do not mistake bounded fixture samples for universal cleanup proof. Keep pending exact own bytes and existing controllers. No Script/Reading advancement, backend/content changes, deployment or main merge.

## Preserved earlier handoff

# Latest — V25 fresh pre-reveal Review actions; Review PARTIAL

Global routes22 COMPLETE/15 PARTIAL/71 NOT STARTED of108; components62/17/127 of206. Listening routes9/6/1 of16; components9/10/5 of24. Staff35 RESERVED, untouched. Full and Retry FRONTEND CODE COMPLETE retained; Review PARTIAL; Script NOT ADVANCED; Reading GATED. Frontend workflows2/9, comprehensive original0/9, authorized live0/9. Product-wide percentages UNDETERMINED.

## Implemented V25 changes
- Extend the existing Review navigation/source bridge and ReviewAuthorityBarrier; no checking/grading/media/persistence engine added. Window capture runs before original document course hooks and target handlers for Check, Retry-this-Part, retry-save, evidence buttons/clips and transcript summaries. Enter/Space/programmatic native control clicks share the same source action. Original control handlers, answer feedback and educational HTML are unchanged.
- Capture original target, source token, current part and navigation sequence. Immediately conceal/inert protected child content and pause audio before any original handler or course hook can run. Coalesce repeated activation of the same held intent. Parent captures exact iframe/document version/UI epoch/part/navigation and performs the existing five-read authoritative session/state/progress/session/state barrier. URLs, storage, focus and source messages do not grant access.
- After unchanged fresh eligibility, grant exactly one original control click; child also checks target connection, original part, active Review and navigation sequence. Source replacement, history/native navigation, disposal, denial and late messages cannot transfer/reuse that grant. All protected actions get a new round, not a cached acceptance. Canonical changes without storage/focus hints are denied before checking/revealing.
- Check captures only learner-entered current-part values into the existing own canonical-scoped ReviewJournal BEFORE authorization, without sending a write or marking feedback checked. Thus denial cannot discard learner bytes; it never relabels them as the replacement attempt. Existing original Check subsequently produces the original progress action only after validation. No aggregate counts treated as answer receipts.
- Transient authority-read failure conceals/detaches UI but does not abort a valid existing route writer; known session/ownership denial or actual route/canonical disposal retains the existing disposal boundaries. No automatic POST retry; uncertain bytes persist and explicit Retry is separately authorized. No exactly-once, CAS, abort-rollback or cross-device lock claim.
- An original non-clip protected action's already-playing same-part trainer resumes only after valid same-document/part authorization, via the existing media bridge. It pauses while eligibility is unknown. No clip/new-document/denied-scope resume; trainer identity retained. Existing256KiB ranges/8MiB LRU/two transports/MSE quota/Blob behavior unchanged.
- No CSS, fonts, colors, dimensions, visible controls, backend schema/routes, educational source or publication changes. Only necessary transient security concealment using the existing status pattern.
## Remaining independently executable frontend gates
Review remains PARTIAL. The V25 fresh pre-reveal defect is implemented, not deferred. Supported test01 original actions, long-response/keyboard/transcript/responsive matrix and bounded repeated route/source cleanup are exercised. Whole-catalogue equivalent modal/scroll/focus behavior, mixed recovery/lexical/retake/media stress across source variants, and browser-native timer/observer/media resource accumulation beyond the measured parent counters remain unclosed frontend acceptance/work gates. Six cycles do not prove unbounded leak freedom. These are not excused by missing live access; do not advance Script until closed. No unsupported previous-attempt mapping or API may be invented.
## Visual and integration boundaries
MATCHED-ORIGINAL VISUAL ACCEPTANCE: UNVERIFIED. No equivalent authorized rendered Next/React application reference is available here. Original source HTML/hooks are read-only and exercised under isolated API fixtures; this is not an authorized original product rendering.12 migrated geometry/keyboard/overflow screenshots are labeled migrated-only and are NOT fabricated side-by-side proof. Source/compiled CSS identity proves bytes, not pixel parity. No design change is allowed to mask a discrepancy.
Existing /api/frontend presentation adapters are the previously documented proposed integration boundary, not newly invented endpoints and not certified live APIs. Existing Listening authoritative endpoints/DTOs are unchanged. Direct authored?vocabulary=1 backend exam policy remains independently GPT Work UNVERIFIED. No production probes, auth bypass, backend/Staff/Dictionary/cloud/DB/deploy changes. Safari/hardware/original recordings/live unverified.

Next V26: continue Review catalogue-equivalent modal/scroll/focus and mixed recovery/lexical/retake/media repeated lifecycle instrumentation. Preserve fresh original action authorization and valid route writers, then objective completion assessment before Script; Reading stays gated. See V25_VALIDATION.txt/V25_VERIFICATION.json for final exact source/seal/ZIP/suite/performance proofs.

---
## Preserved prior handoff
# Latest — V24 source/canonical/recovery ownership, Review PARTIAL

## Implemented defects (existing owners, not replacement engines)
- Each authored paint now renews the opaque document token and UI epoch, cancels old document reads, removes detached recovery views, and supersedes the existing ReviewAuthorityBarrier generation. Old successful/failed reads cannot accept/reject or resolve a new round. A new document must hydrate and freshly validate its own Review location; old requested location is reapplied rather than silently showing Hub.
- Source replacement is allowed as a validated existing runtime-file navigation even during an old metadata wait. Old scope cancellation does not reconstruct materials or authorize the destination. Original HTML bytes are unchanged.
- Actual source replacement disposes its old media controller/transports and creates the same existing engine for the new document. Media/image/error callbacks are generation-owned. Native part/question navigation still does NOT replace frames, media engines or route writers.
- UI recovery reads now have a separate AbortController, canceled on UI epoch/source/canonical replacement. This removes detached consumers from the EXISTING shared-GET singleflight: fresh authorization cannot join an old held recovery Check. Valid pending Review POSTs remain route-owned, not UI-aborted.
- Recovery Retry/Retain continuations verify connected panel + exact UI epoch after asynchronous reads. An old Check cannot reject or mutate replacement UI. Aborted API responses cannot dispatch a late global401; active401 still revokes.
- Fresh canonical mismatch before/after progress POST now invalidates the existing authority barrier, synchronously concealing/pausing the stale scope and requiring explicit safe Retry; it cannot leave the old Review visible with merely a save-error button. Pending bytes remain. Two preserved V18 cases now require stale iframe detached + parent Retry visible, while retaining no-confirmation/pending-byte/POST-count assertions (stronger security expectation).
- A completed aggregate Review goal no longer deletes unconfirmed answer bytes. Existing no-replay goal message remains; explicit separate retained-answer Retry performs current reconciliation + exact-context POST acknowledgement. Goal counts are NOT answer receipts.
- The existing authorized lexical dialog now has modal semantics, initial focus, Tab/Shift+Tab containment, Escape, scoped handlers and safe iframe focus restoration. No definition/sense/occurrence fabricated; backend direct vocabulary policy remains independently UNVERIFIED.
## Remaining independently executable frontend gates
Review remains PARTIAL, not promoted by tests. Fresh authorization before original Check/Retry/evidence reveal itself (beyond the accepted native part/question gate and post-owner mismatch teardown) remains unclosed under an otherwise unhinted canonical change. Whole-catalogue source replacement combinations, original source modal/long-response scroll/focus restoration, and instrumented repeated listener/observer/transport lifecycle accumulation are not universally closed. These are frontend work/acceptance gaps, not solely missing live access. Continue implementing these before Script.
No previous-attempt endpoint/identity is invented. No automatic uncertain-write replay, foreign adoption/deletion, exactly-once/CAS/cross-device locks, abort rollback or aggregate question receipt claim. Explicit Check/Adopt/Retry boundaries and eligible own original bytes remain.

Global routes22 COMPLETE/15 PARTIAL/71 NOT STARTED of108; global components62/17/127 of206. Listening routes9/6/1 of16 and components9/10/5 of24. Staff35 reserved unchanged. Full/Retry FRONTEND CODE COMPLETE retained; Review PARTIAL; Script NOT ADVANCED; Reading GATED. Frontend workflows2/9; comprehensive original0/9; authorized live0/9. Product-wide percentages UNDETERMINED. No acceptance promotion.

See final V24_VERIFICATION.json for exact source/seal/report pins and exact-ZIP suite results. Continue Review pre-reveal Check/Retry/evidence and remaining original modal/scroll/repeated-resource closure before Script. Reading gated; no material recreation/deploy.

## Preserved V23 and earlier handoff

# Latest — V23 native in-Review pre-paint, Review PARTIAL

Continue from final V23_VERIFICATION.json source/seal/report pins and CHECKPOINT_V23.md. Native part/question intents are now captured BEFORE source mutation and granted via existing metadata barrier; same-scope intents coalesce. Whole stale view callbacks fenced. Server-ACK canonical changes reset old Review accumulator, retaining journal bytes. Legacy lexical/dialog/network and opaque media/lexical listeners now owned/cancelled; same-part navigation does not destroy trainer controls. Ordinary navigation retains route writers. Full/Retry COMPLETE; Review PARTIAL; Script NOT ADVANCED; Reading GATED. V24 closes broader canonical/uncertain-write/recovery/source-replacement/modal/scroll/repeated lifecycle matrix, not replacement content. Direct vocabulary backend policy remains independent GPT Work UNVERIFIED. No main merge/deploy/backend/staff/content changes.

## Preserved V22 and earlier handoff

# Latest — V22 Review pre-paint increment, PARTIAL

See CHECKPOINT_V22.md and final deliverables/V22_VERIFICATION.json for exact source/archive pins and executed results. Native Hub→Review now requests parent authorization BEFORE rendering; existing V20 barrier/V21 navigation and route-owned writers reused. Queued media pause cleanup and Hub focus restored. Full/Retry complete; Review PARTIAL; Script NOT ADVANCED; Reading GATED. Next V23 closes pending-writer/canonical retake/reentry and held-resource/a11y lifecycle gates, not replacement educational content. Direct vocabulary backend security remains separate GPT Work UNVERIFIED; no deployment.

## Preserved earlier handoff history

# V21 latest handoff — Review PARTIAL, Script NOT ADVANCED

Continue V21 from exact final source/ZIP verification in deliverables/V21_VERIFICATION.json. Real new Review part/question URLs and same-document Back/Forward/hash navigation reuse the existing V20 authority barrier and existing source controls; no material/writer engine replacement. Applied→focus handshake, safe invalid URLs, latest intent coalescing, per-frame load fencing and owned RAF/timer cleanup implemented. No educational content changes/imports. Supported API DTO and lexical holds tested; broad media/pending-writer/retake/lifecycle/accessibility/catalogue and visual/live gates remain OPEN. Next: finish those Review frontend gaps, not Script/Reading. Direct vocabulary endpoint exam-policy and canonical occurrence security remain authorized separate GPT Work; no backend edits. Preserve explicit adoption→separate Retry, exact bytes, no auto replay/foreign deletion, all historical archives and source.

## Preserved V20 handoff/history

# V20 handoff — latest continuation

V20 is an honest resumable PARTIAL checkpoint, not Review completion. See CHECKPOINT_V20.md and matching V20 source/adapter/route/component ledgers. Standing native Review now conceals and pauses on authority hints, performs bounded metadata-only fresh validation, resumes the same frame only for unchanged session/canonical submitted attempt/availability, otherwise disposes stale scope while keeping pending own work. No protected material reconstructed or bundled. Full/Retry remain COMPLETE; Script not advanced; Reading gated. Navigation, broader held lexical/material/media/lifecycle, matched visual/live gates remain open. Direct authored vocabulary exam-policy and Owner registration/publication remain separate authorized backend GPT Work; no backend/cloud edits here. Final exact archive and execution authority: deliverables/V20_VERIFICATION.json. Educational preservation report is mandatory.

## Earlier V19 handoff (preserved)

# Latest handoff — V19 resumable PARTIAL (supersedes V18 status only)

Exact continuation febad852119ea4fbfdffd850f9899df45447b0bf, same Arena branch.
Read CHECKPOINT_V19, SOURCE_STATE_INVENTORY_V19, ADAPTER_CONTRACTS_V19,
ROUTE_LEDGER_V19, COMPONENT_LEDGER_V19, original-activities-v19.json and final
external deliverables/V19_VERIFICATION.json before continuing. Accepted final ZIP/SHA
and final committed local=remote proof are in the final report; archives immutable.

Bounded same-user/test closed-tab discovery and explicit fresh-authorized adoption
are implemented within the existing journal/writer. Adoption does not send; Retry
is separate. Never delete a foreign-context original. Transfer SHA/status is an
untrusted hint, not authorization/completion/partial-unit authority. Source bytes,
existing retained slot and quota-failure copies stay intact. Without browser Web
Locks copy is refused. Storage events only invalidate/rebuild hints. Session schema,
canonical attempt, own revisions and server progress are freshly validated.

Finish remaining ordinary Review direct URL/part/history/exit and held material/
lexical/media/complete focus+lifecycle gates; do NOT begin Script before Review
closure. Then Script→MCQ→Map→Choose TWO→Completion→Vocabulary; Reading gated.
Full/Retry code complete unchanged; Review/frontend original PARTIAL/live UNVERIFIED.
No plan-only handoff should relabel tested subsets as whole closure.

Separate GPT Work owns direct authored?vocabulary=1 server exam-policy acceptance
(current/other-tab exam, held/revoked/direct lookup-save, authorized Review), exact
legacy source/attempt normalization and deferred Owner single-HTML/private-R2/publish.
No backend probes/changes/deployment/Dictionary/staff/data publication in this branch.
Read-only main51dc6e3 is PR53 journal-test extension, not merged/deployed migration.
No exactly-once, universal CAS, abort rollback, cross-device/codec/Safari/live claim.
Three whole-product percentages UNDETERMINED without objective denominator.

---
## Preserved prior handoff (historical; V19 section above is current)

# V18 active continuation — Review PARTIAL, Script NOT advanced

Read CHECKPOINT_V18, V18 source/contracts/ledgers/activity inventory and the final
outside-ZIP V18_VERIFICATION.json/V18_VALIDATION.txt. Resume existing controllers.
Critical next ordinary gate: closed-tab cross-context pending-work discovery/adoption
without auto replay; full held-load/evidence/transcript and real two-tab Review
retake/backforward/focus acceptance. Do not promote from counts. All V17 final code
and three V17 candidates preserved, FINAL_VERIFIED only is accepted V17 baseline.
No Dictionary/backend/staff/Reading work. Owner pipeline remains deferred below.

# V17 current continuation — Review PARTIAL

Read CHECKPOINT_V17, SOURCE_STATE_INVENTORY_V17, ADAPTER_CONTRACTS_V17,
PRODUCTION_RECONCILIATION_V17, V17 ledgers/activity inventory and final
`deliverables/V17_VALIDATION.txt` +machine proof. V16 is preserved unchanged.
Same fixed branch. Original/main/backend/cloud/Dictionary/staff are read-only.
Continue current Review code, not a restart. New lexical bridge reuses existing
server spelling permission +unresolved popup; never fabricate an occurrence/sense.
Durable course journal wraps existing writer, explicit recovery with fresh own
attempt/revision checks; no automatic replay/CAS/rollback/exactly-once claim.
Full+Retry preserved. Review remains PARTIAL; comprehensive ordinary frontend
matrix still required before Script. Reading remains NOT STARTED. Main65/64
divergence and canonical catalogue/new-source gaps documented; no automatic merge.
Historical V16 detailed handoff follows intact.

# V16 continuation — Review remains PARTIAL, do not restart

Baseline V15 final8f498ce914bfa7b30866ce592e00379a701bda88. Current source/package/final
refs and executed evidence: deliverables/V16_VALIDATION.txt. Read CHECKPOINT_V16,
SOURCE_STATE_INVENTORY_V16, ADAPTER_CONTRACTS_V16, V16 ledgers and activity JSON first.

Preserved-regression repairs: transcript navigation is outside original clip controls;
OwnedMediaController waits for queued/native seek settlement before first play, with
cancellation/version/timeout protection and no-seek fast path retaining18 listeners.
First independent124/2 and repaired probes are retained; final report owns acceptance.

Implemented Review source-only transcript/evidence navigation and material guards;
Check preserves active same-part trainer/time/rate; switching/reentry own cleanup.
Parent reuses CheckpointWriter for typed single-flight merged Review /progress work,
manual retry, newest queued-part errors and scoped late-response suppression. No
Review /practice kind; original checking stays self-study, server status completion.

REMAINING ordinary Review gate: authorized lexical selected-word/popup/keyboard/focus
lifecycle; durable pending course-work recovery/reconciliation across reload; complete
Review-specific held authority/SSE/media/foreign feedback/reentry matrix. Session-only
course intent is NOT a durable outbox. Native confirmed revisions/checked reload path
is preserved. Keep Review PARTIAL. Do NOT begin Script until genuine Review closure.
Then Script→MCQ→Map→Choose TWO→Completion→Vocabulary sequentially. Full/Retry complete
retained;2/9 frontend complete,7partial; original/live0/9. Counts unchanged. Reading gated.

Never modify concurrent GPT Work Dictionary Next.js/PostgreSQL/privateR2 architecture,
APIs/migrations/imports/buckets. Never staff35/backend/cloud/main/production changes.
Owner single-HTML upload/extract/privateR2/register/maps/preview/explicitpublish task
and Owner-supervised Reading imports stay deferred. Preserve V1–V16 archives. Same
fixed branch only, no reset/rebase/stash/clean/branch switch/discard/force push.

Prior V15 detailed constraints and historical failures follow, retained for continuity.

# Exact V15 continuation — preserve current work, no restart

ONLY arena/96836bcf-learners-area. DeliveredV14 baseline
78f930c5a147e571ea4e80465c3a1921bb7ec0b4. Read CHECKPOINT_V15,
SOURCE_STATE_INVENTORY_V15, ADAPTER_CONTRACTS_V15, route/component ledgers and
original-activities-v15.json. Final commit/tree/ZIP/independent verification authority
is deliverables/V15_VALIDATION.txt (outside archive to avoid recursive checksums).
Every implementation change stays migration/vanilla-frontend. Original source,
backend/DB/cloud/main/staff35/production are read-only. V1–V14 archives immutable.
Refreshed stale359 files independently preserved OUTSIDE repo before ordinary
same-branch fast-forward; preservation manifest/copies/extraction/moved-originals
remain /home/user/learners-area-v15-preservation. Never reset/stash/clean/rebase/
switch/discard newer files. Stop divergence; verify external byte preservation.

## State and exact next task

Full IELTS supported FRONTEND CODE COMPLETE after actual-source Full gate closure.
Separate original comprehensive PARTIAL/live UNVERIFIED. Backend has no atomic
CAS/revision ordering: real optional browser Web Locks + fresh GET semantic conflict
check are NOT cross-device/noncooperating guarantees. No new endpoint or fake lock.
Cancellation cannot undo a server commit. Snapshot read-confirmation is conditional
and canonical40-row rules remain. Do not rewrite V14 writer/barrier/coalescing/manual
retry/typed ACK/stale suppression/undo/replay/closed freeze/memory/revocation cleanup.
Per-tab three-record recovery prevents one tab clearing another's own draft; legacy
copy failure retains bytes and falls back to memory. Context ID/name never auth.

IMMEDIATELY AFTER Full gate closure Review was started, coherently, same engine.
Review PARTIAL. New original-review-v15.js decorates existing controls:4part tabs,
keyboard focus, labels; own revision answers participate in conflict stamps and
retained409 details. First actual-source all-part/reload/checked/retry/evidence
journey PASS. Existing source self-study check is NOT a new grader and is NOT
server-authoritative course completion. FINISH Review's complete authorized feedback/
transcript/clip/revision/reload/error/pending/retry/authority/responsive/keyboard/
lifecycle sweep and mode-specific contracts before advancing. Never fabricate a
review /practice kind: actual backend kinds are matching/completion/retry/map;
original Review course work uses existing /progress. Preserve server authority;
no browser exam grader/answer release/CSP weakening. Then Script→MCQ→actual Map→
Choose TWO→Completion→Vocabulary, one complete supported activity at a time.
Retry COMPLETE supported leaf retained. Frontend2/9 complete,7partial; comprehensive
original0/9/live0/9. Reading remains gated, staff author NOTSTARTED/staff-only.

## Proof and cautions

V15 inventory405 units/499 Chromium/99 actual-original-source journeys/25assets.
Only external final validation confirms executed extracted-ZIP results. All first
failures retained: native first UUID stamp, responsive nav, fullscreen scroll/lazy
modal reachability, non-Range encoded seek fixture, CSP test poll, foundation30ms
history assumption. Assertions were not weakened; history waits actual DOM commits.
Native Chromium fullscreen now succeeds; hardware/Safari/production unverified.
Numeric highlight offsets memory-only, no protected text cached. Mobile source
fullscreen intentionally hidden, not forcibly exposed. Parent media capability
401 auth invalidation and403/404 teardown; late recover/play cannot revive disposed
scope. Native encoded Range silence is NOT the private recording or alignment.
Generic256KiB/8MiBLRU/two reads retained; Blob NOTprogressive. Universal media PARTIAL.
Sandbox allow-scripts ONLY; no allow-same-origin/privateURL/key/token to child.

Global routes22/15/71 of108; components62/17/127 of206. Listening9/6/1 routes of16,
9/10/5 components of24. Activity leaf completion does not close shared components.
Source/assets/CSS exact is NOT matched rendered parity. Runtime audit0/dev5high0critical.
Weighted/whole-functional-security/rendered-visual-live aggregate UNDETERMINED;
bounded inventory and test ratios reported separately.1–100ms target, not guarantee.

Future GPT Work stays deferred: Owner oneHTML→validate/extract audio→privateR2→
register original activities/transcripts/mappings→preview→explicitpublish; supervised
Reading AI import later. No backend/cloud implementation, no learner CRUD/publishing.
Owner approval before production replacement. Commit/push same branch only; verify
clean/localremote equality, fresh exact ZIP/npmci/build/all suites/assets/CSS/two
identical repacks/real SHA. Never merge or deploy automatically.

Independent first ZIP source run96PASS/1FAIL retained in evidence/v15/independent-first.
The preserved V12 retry matrix installed its response waiter AFTER clicking/re-reading
Q1, so under concurrent load the400ms save could already finish. Its waiter now
starts BEFORE that action and additionally requires the saved currentQ1 + own answer;
all prior input/reload/40-question assertions remain. No production Retry change.
Final external validation, not that first attempt, is delivery acceptance authority.

A new fresh-closed-retake source probe reproduced an integration edge in the UUID
stamp: the preceding closed canonical record must NEVER be relabeled with a new
attempt identity during its metadata write. Normalization now applies only to
in_progress snapshots. Old-build failure and repaired actual-source pass retained;
no V14 writer/barrier replacement. Review save waits are also bound before Check.

The next independent98-source run retained97PASS/1FAIL: an unrelated checkpoint
ACK removed the resource-failure Retry button. The old-build deterministic probe
confirmed disappearance after an explicit own-answer ACK. Resource/checkpoint error
lifetimes are now separate; only actual media play clears a resource failure, while
checkpoint ACKs clear checkpoint errors only. Strengthened source probe passes with
manual Retry, preserved own answer, disposed old transport and a fresh playable
generation. Raw second-run failure and before/after probes are retained.

Terminal resource403/404 authority loss now also disposes the existing checkpoint
writer: a late held response cannot erase the access failure after frame teardown.
A source probe actually commits an own snapshot before holding its response, then
revokes resource access; the old build erased Retry, the repaired build fences the
ACK, retains the error and stops media. The simulated server commit still exists:
client cancellation is NOT rollback. Existing writer engine is unchanged.

## Full exact-candidate staging repair
First independently extracted sealed candidate (source3bbcd148798ddb66934a96d2b67b934b41369290, seal82457613ed85746b97249851983d6c78c6dff067, ZIP9f5cea5915b7fdd6c245d9b104cad17f4da2edfd416a094c5cd133f851c72edb/41,801,747bytes) ran all346 source cases:333PASS13FAIL0SKIP. Twelve preserved V16 journeys immediately asserted question focus, or inspected/filled old-part controls while the new child was inert awaiting authorization; V15 similarly inspected input kind and synchronously asserted End/Home selection. Wait for body:not([inert]) AND existing authority/navigation notices detached after native part/question/End/Home actions. This is event/state-driven staging, no sleep, no production change, no removed or relaxed assertion. V16 entire Review subset and V15 all-parts journey then passed; raw initial full failure and intermediate repair failure retained. Final exact re-extraction/full suites remain required; report authoritative. First candidate ZIP retained outside source and in original seal Git history, not bundled as protected corpus.

## Active-writer Retry closure
An explicit recovery Retry while a valid write is still active now only waits: it does NOT enqueue an action that could silently retry a later uncertain failure. Both success and error settlement re-enable the current recovery button even when the old UI epoch cannot receive confirmation. Exact own bytes remain until a separate explicit Retry/current write ACK. Actual-source held200/503→source replacement→Retry while active→settlement→separate Retry cases pass. New26 source cases PASS0FAIL0SKIP. Earlier25PASS1FAIL exposed the asynchronous Retry queued across settlement; runtime fixed, no assertion removed. A Playwright waitForFunction CSP-eval setup failure was corrected to native locator/element state conditions, never weakening CSP.
First exact candidate c805cc4e2eb2397d29050702739d473e505a4982f52a220aaee886f85402eb7d was independently extracted/Git-verified/installed/built;526 units/assets/preservation passed, full source run was deliberately INTERRUPTED after40 passed cases to implement this discovered defect. It is NOT full-suite PASS evidence. Its source/seal and partial output are retained. Final corrected ZIP must be independently extracted and rerun in full.

## Preserved queued-work regression
Corrected second exact candidate9089d126242f1e81a2a3aa45e6018fadfc2a3ba861f7f590cabbb8a2a8c6544b full original-source run completed371PASS1FAIL: V16 queued part Check did not receive active write failure after same-frame navigation. Overbroad old-epoch error suppression repaired: an error may reach explicitly queued current-part work only in the same source document; source replacement remains fenced, no stale ACK granted. Unchanged protected V16 test now PASS; all26 V24 cases independently PASS. No tests removed or expectations weakened. Failed full report/log retained. Erroneous combined substring-filter focused8 selected zero cases and is NOT execution evidence. Final corrected archive requires a new full pipeline.

## Bounded generic-media cache preservation
Third exact candidate c124e089d1a35d3b1ab762f15442bf1997ae7082546c5409b3db72942db998e6 passed all372 actual-source cases but Chromium V10 completed52PASS1FAIL: replacing generic uploaded source discarded its completed range cache, causing5 fetches instead of1. Repair transfers only completed ranges and their metadata from the existing bounded8MiB LRU when resource identities exactly match; source-owned pending reads abort and callbacks remain fenced. No transport/pending job transfers. Native canonical authored pages deliberately do not inherit this cache. Revocation/disposal clears retained bytes. Existing generic next/previous/play/cleanup V10 assertion unchanged,53PASS; added one actual unit regression for bounded completed-only transfer, foreign URL isolation and disposal. Final expected units527 (521 preserved +6), source372, Chromium499. Historical V10 screenshot scratch output preserved externally and restored byte-for-byte from Git. No original material/codec/media engine replacement. Failed Chromium report/log preserved.

## Verified focused staging
Final focused31PASS0FAIL0SKIP; preserved V16 subset27PASS; preserved V18 canonical before/after2PASS with identical pending-byte/POST/no-confirmation assertions. Three source-bridge unit cases PASS; total530 units PASS. Resource first29PASS1FAIL attempted an external Back link correctly hidden while source Review is active; use original Back-to-Hub first. Next30PASS1FAIL resource baseline was sampled after frame teardown but before ordinary shell commit, so the shell notification storage listener looked like an increase. Wait actual [data-shell] mount before both baseline and terminal snapshots, unchanged listener thresholds; six cycles now PASS. No runtime leak repair falsely attributed to staging. Native original answer-control and feedback assertions retained, only waits added for fresh async action completion. True runtime repairs: scoped Check trainer resume and preserving valid writers on transient metadata failure. Own Check intent staged before validation, not sent, to retain canonical-A bytes when eligibility fails.
All12 migrated geometry/long-answer/keyboard/overflow conditions PASS; not matched original render proof. Browser-native timers/hardware/whole catalogue beyond measured counters still not universally accepted. Final exact-ZIP pipeline authoritative, not focused totals.

## First exact-ZIP staging failure retained
First source c906f78d39b282dd247af57ee15ec5803a126382 / seal77eb4ffafa618842652d0f3f174368138a51128d / ZIP55625a5305f82c75cd450521902acbc6a092a34ef6e5180fe5efa4730077e0a6 (43,931,894bytes) was independently extracted/Git/CRC/hash verified, fresh installed/built,530 units/assets/preservation PASS. Full403 source suite completed398PASS5FAIL: five V20 same-scope hint cases fired the hint while the new transcript-summary action was still being validated, counting two overlapping rounds (4 canonical reads) rather than a single standing-scope hint (2). Helper now waits body inert release, existing authority/navigation notices detached AND actual transcript open BEFORE arming/firing the hint. The exact2-read limit and all concealment/noPOST/no-extra-material/connected-frame/transcript assertions remain unchanged. No runtime or CSS change. First extraction and failure reports preserved; no full-suite PASS claimed for that candidate. Corrected archive requires independent full rerun.

## Same-part trainer continuity across all protected non-clip actions
Second exact candidate30f1874ca47c3c7108af8780dbc1deea54bf9b64e46a84eb59425e965c6fede4 source run deliberately interrupted (partial results retained) when code review found valid transcript/evidence/Retry actions left the trainer paused after fresh validation. Resume now covers all originally-playing non-clip source actions in unchanged document/part/navigation, not Check only. Original clip controls keep their own playback semantics; old clips, replaced sources and denied scopes never resume. One genuine encoded-audio source regression exercises Check, transcript, evidence, save-Retry, Retry-this-Part, same trainer/audio identity and canonical denial disposal. Final expected530 units/404 source (372 preserved +32 new)/499 Chromium/14 timing/4 controls. No assertion removed, media budget/engine/recording/CSS change or stale-play permission. Final independent exact-ZIP run required.

Focused encoded-audio/action suite32PASS0FAIL0SKIP; all530 units PASS. Second run last explicit pre-stop snapshot257PASS/noFAIL; stopping its browser produced143 target/context/browser-closed artifacts in retained partial output, NOT a completed regression result or full PASS. Final revised exact ZIP must execute all404 source cases and other complete suites.


# V26 continuation
Full IELTS and Retry Weak Areas FRONTEND CODE COMPLETE retained. Review PARTIAL; Script NOT ADVANCED; Reading GATED. Frontend workflows2/9; comprehensive original0/9; authorized live0/9. Hardware/Safari/real recordings UNVERIFIED. MATCHED-ORIGINAL VISUAL ACCEPTANCE UNVERIFIED. No product-wide percentage claim.
## Functional changes
- Existing authored vocabulary modal now temporarily isolates background focus using existing DOM inert semantics, including its opaque iframe. Focus confinement and isolation are synchronously removed by the existing lexical AbortSignal. Original dialog markup/classes/geometry and caller-controlled current-source focus restoration are unchanged. No delayed focus callback added.
- Existing Review material validator now accepts empty alternative-answer arrays (no extra accepted answers) used by actual catalogue sources. Arrays containing malformed/empty-string entries are still rejected. Original answers/checker/educational HTML are unchanged.
- Absent optional paraphrase/mistakeType presentation fields no longer prevent otherwise valid original Review controls. No field is filled, transformed or generated; original renderer retains its exact behavior, including original authoring omissions. Required answers/evidence/question identity/part/range validation remains intact.
## Phase2 investigation — OPEN stability gate
V25 first failed290PASS1FAIL208not-run, unchanged rerun499PASS. Both immutable reports retained. V26 first8 controlled repetitions of the same30-switch journey reproduced7PASS1FAIL with unchanged +50nodes/+5listeners assertions. Baseline nodes473–496; run8 immediate495→564 (delta69), then three frame/GC stages settled472. All8 final samples472; documents2/listeners152, connected elements278, no iframe/modal/loading region. This is evidence of transient retention, not an identified retaining owner or proof of no production leak.
Second6 diagnostic repetitions queried CDP detached nodes: bounded shell profile menu/search dialog plus old route loading/status nodes were visible. DOM inspection is intrusive and must not be treated as independent heap-retainer attribution.
A marker-only (no Playwright locator handle) ablation produced larger immediate spikes (up to861), all8 settled468; listeners139 vs152 exposes harness-owned listeners. It ran concurrently with source-variant fixtures, so it is NOT a clean causal isolation of harness vs load. Neither one-frame settlement nor extra GC replaces/weakens the preserved original acceptance assertion. No arbitrary delay/budget increase/test deletion. Exact failure cause remains UNESTABLISHED; stability gate OPEN. Detailed raw JSON under docs/evidence/v26/phase2*, failures retained.
## Remaining independently executable frontend gates
Phase2 exact retaining owner and stability are unresolved. Full15 requested mixed lifecycle combinations, full source-variant12-condition modal/scroll/focus combinations, JS/browser-native timer/RAF and transport/observer ownership attribution beyond CDP/24 modal cycles are not universally closed. Preserve Review PARTIAL; do not use unavailable live access to excuse these implementable gates. Existing404 source cases remain regression coverage, not automatic completion of unexecuted mixed combinations.
## External/source gates
Source10/source25 authoritative time mappings need existing owner-authorized corrections; this frontend does not invent content or timing. Authorized rendered original, live presentation-adapter integration, direct authored?vocabulary=1 backend exam policy (GPT Work), Safari/hardware/real recordings remain UNVERIFIED. No production probing, backend/API/schema/auth/grading/publication/cloud/Staff/Dictionary edits.

Next V27: continue Review, NOT Script. Attribute Phase2 transient detached-node ownership with serial matched-stage heap/callback instrumentation; finish mixed lifecycle and source-variant focus/scroll/resource gates. Obtain owner-authorized time mappings without editing original content. Preserve all accepted gates and original visuals. Reading remains gated.

Source-specific V37 correction: LocalReflectionRecorder and TedStudyPractice mount ONLY in standalone mode, not course mode. Course LessonPage does not supply vocabulary, so its default empty vocabulary list must not be replaced by an invented fetch/tab. Transcript is a real conditional Studio tab, not a dialog dependency. Preserve separate provider-frame restrictions without changing the authored opaque sandbox.
