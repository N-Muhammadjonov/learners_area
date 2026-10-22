#!/usr/bin/env python3
"""Targeted owner/contract packet from existing V32 evidence, not a new search or approval."""
import pathlib,json,hashlib,re
b=pathlib.Path(__file__).resolve().parents[1];repo=b.parents[1];out=b/'docs/evidence/v33';out.mkdir(parents=True,exist_ok=True)
sha=lambda x:hashlib.sha256(x).hexdigest()
def read(n):return (repo/n).read_text()
selected=[
 ('owner-role','docs/OWNER-DOSSIER.md','Prepared for the owner.'),
 ('owner-external-decision','docs/OWNER-DOSSIER.md','OWNER_DECISION_REQUIRED'),
 ('deployment-not-approval','docs/OWNER-DOSSIER.md','Vercel `success` does not authorise cutover'),
 ('manual-owner-process','docs/MANUAL-QA-OWNER-PACK.md','Visual decisions reserved for you'),
 ('manual-not-go','docs/MANUAL-QA-OWNER-PACK.md','This is not Production GO.'),
 ('explicit-scoped-precedent','docs/PREVIEW-MIGRATION-APPROVAL-2026-10-03.md','Approval received directly from the owner:'),
 ('latest-owner-instruction','docs/arena-package/2026-10-01/Arena_implementation_and_acceptance_2026-10-01_v2.txt','This current owner request'),
 ('original-one-identity','src/lib/listening/original-test-one.ts','export const ORIGINAL_TEST_ONE_ID'),
 ('original-batch-definition','src/lib/listening/original-listening.ts','export function originalListeningDefinition'),
 ('publication-contract','src/lib/data/full-listening.ts','isStaff(role) || isLive(row.test)'),
 ('source-mapping-contract','src/app/api/listening/full/[id]/authored/route.ts','originalListeningDefinition(id,detail.pkg.sourceId)'),
 ('sequence-contract','src/app/api/listening/full/[id]/authored-state/route.ts','listeningSequenceAccess(user,id)'),
 ('own-current-checkpoint','src/lib/data/listening-original-state.ts','const row = await database.query.listeningAuthoredCheckpoints.findFirst'),
 ('current-fallback-not-history-selector','src/lib/data/listening-original-state.ts','orderBy:desc(listeningAttempts.startedAt)'),
 ('get-may-normalize-state','src/lib/data/listening-original-state.ts','await database.insert(listeningAuthoredCheckpoints)'),
 ('prior-comprehensive-open','migration/vanilla-frontend/docs/ADAPTER_CONTRACTS_V21.md','Previous-attempt selector'),
 ('strict-case','migration/vanilla-frontend/tests/browser-v6.mjs',"await check('Phase2 repeated"),
 ('app-disposal-criterion','migration/vanilla-frontend/tests/original-review-v27-journeys.mjs','V27 six Review source route cycles'),
]
refs=[]
for key,p,needle in selected:
 data=(repo/p).read_bytes();ls=data.decode().splitlines();hits=[(i+1,s) for i,s in enumerate(ls) if needle in s];assert hits,(key,p,needle);ln,text=hits[0];refs.append({'id':key,'path':p,'line':ln,'sha256':sha(data),'quote':text})
refmd='\n'.join(f"- **{r['id']}** `{r['path']}:{r['line']}` SHA256 `{r['sha256']}` — {r['quote'][:800]}" for r in refs)
authority={'roleIdentified':'Human project owner / project acceptance decision role, evidenced by owner dossier/manual QA pack; not automatically an application Owner-role account.','namedPersonOrDelegation':None,'verifiedSigningAuthority':None,'existingPhase2Approval':None,'accessibleAuthorizedSubmissionMechanism':None,'existingProcessEvidence':'Direct explicit, scoped owner response is recorded for Preview migrations0029–0035. It is a precedent ONLY for that fingerprinted DB task, not authorization or a binding approval protocol for vanilla Phase2. Owner QA pack provides human review/failure feedback, not delegated migration release authority.','delivery':'Prepare owner-ready packet in this branch and return it to task requester for routing to the real project owner. Do not open/assign an issue, PR, send messages, impersonate anyone, or infer that repository handle/author/task requester/demoOwner is the signer. Request actual identity/delegation and authoritative recorded decision.','decision':'EXTERNAL RELEASE ACCEPTANCE BLOCKED','preparedDate':'2026-10-22','approvalDate':None,'approvedRule':None,'policyFields':{k:None for k in ['acceptancePopulation','requiredEnvironment','reliabilityThreshold','historicalFailureTreatment','transientNativeRetention','inspectorOwnership','nativeOpaqueConditions','signingAuthority','decisionDateVersion','authorizedOutcome']},'additionalDiagnosticRuns':0,'references':refs}
(out/'release-authority.json').write_text(json.dumps(authority,indent=2)+'\n')
old=json.loads((b/'deliverables/V32_VERIFICATION.json').read_text())
packet='''# V33 Phase2 owner decision request — NOT AN APPROVAL

Prepared2026-10-22. **Current acceptance outcome: BLOCKED — EXTERNAL RELEASE ACCEPTANCE BLOCKED.** No owner decision received, no policy proposed, no signature supplied. Review remains PARTIAL. This is a decision packet, not new runtime implementation progress or a production-release request.

## 1. Feature and decision boundary

Feature: supported Listening **Review & Revision** in the HTML5/CSS3/VanillaJS migration. Full IELTS and Retry Weak Areas frontend code remain COMPLETE. Supported Review behavior is fixture/source verified, but aggregate Review acceptance is PARTIAL; Script NOT ADVANCED/Reading GATED. Frontend workflows2/9, comprehensive original0/9, live0/9. The requested decision is the **Phase2 release/stability gate only**, not permission to redesign, alter source content, release production, merge main or certify every other external scope.

Sealed evidence target: V32 implementation bc28d715772ec145963da59cadb36467d0f1b64d; source c9a0d6277c79b1f91082dde5cc2dd041ae167eab; seal853d435b88c04d232843e8d2ae1f7fcd2a29b92a; report b09c0e73c15b3adaf6fc9d8ab4f40cf9cbd42325. V32 ZIP100238862bytes/2109members/SHA256138fb550e9d28e4ec4ed266a6c53c8ea51f82dbf190646d88ac341cfaec69835. V33 is an evidence/tooling-only checkpoint; its final source/seal/report identities and current regression outcome are recorded in deliverables/V33_VERIFICATION.json after packaging. An approval must state which frozen version and evidence population it covers, not float to future commits.

## 2. What is already executable and measured

Original `tests/browser-v6.mjs:53`: enter reports, preserve the shell, original three-switch warmup, original diagnostic GC/before counters,30 measured app/mocks/reports route switches, original GC/after counters. Require same shell, `after.nodes <= before.nodes + 50`, `after.jsEventListeners <= before.jsEventListeners + 5`. Existing timeouts, animations, stages and values unchanged. One invocation has one strict PASS/FAIL. The30 switches are not30 independent release trials.

Observed environment, NOT an owner-selected required environment: pinned Chromium133.0.6943.0 / Playwright1.51.1, Linux sandbox,1440×900,English/day, warm local synthetic authorized fixtures. Hardware acceptance not established. CDP counts allocated Blink nodes/listeners, not connected DOM or all native/GPU/OOPIF resources. Additional release population, OS/hardware equivalence, reliability threshold and history treatment are unspecified.

## 3. V26–V32 chronology (never pool unlike instrumentation)

| Record | Actual evidence | Treatment in this request |
|---|---|---|
| V26 `CHECKPOINT_V26.md`, `V26_VERIFICATION.json.phase2Investigation` | Original8 diagnostic repetitions7PASS1FAIL; run8 immediate495→564(+69), later settled472. Further marker/detached-node variants and serial ablations include failures; serial original3/1, marker2/2 with different instrumentation. | Every original failure remains failed. Later GC/settling and intrusive diagnostics are NOT replacement original assertion results. No pooled denominator. |
| V27 `evidence/v27/phase2-heap-baseline-marker/browser-v6-results.json` | Fixed four3PASS1FAIL. Captured heap path established, below. | Failed series preserved. |
| V27 `evidence/v27/phase2-heap-rejected-cancel-marker/browser-v6-results.json` | Fixed four3PASS1FAIL in rejected cancellation mode. | Failed trial retained; cancellation withdrawn, not shipped. |
| V28 `evidence/v28/phase2-heap-v28-original/browser-v6-results.json` | Fixed four4PASS0FAIL. | Separate bounded passing population, no retroactive waiver. |
| V29 `V29_VERIFICATION.json.phase2.currentOriginalCase` | Original strict PASS; inspector-handle causal attribution accepted separately. | Scope differs from release reliability. Historical actual-source417/1 remains historical. |
| V30 `V30_VERIFICATION.json.phase2.currentOriginalCase` | Original strict PASS; exact mandatory source418PASS after bounded ACK/observation repairs. | Not retroactive reconstruction of V29 event chronology. |
| V31 `evidence/v31/phase2/browser-v6-results.json` | Predefined12PASS/0FAIL/0SKIP;360switch samples,36warmups. Deltas−2,−19,−22,−22,+4,+13,+23,+23,−22,+35,0,+12;listeners152/docs2/connected278/shellstable. | The number12 was a finite evidence plan, not an approved reliability policy. Separate preseal/exact original passes not added to the series. |
| V32 `V32_VERIFICATION.json.phase2` | Single original strict PASS in exact499 suite:496→473nodes(−23),listeners152→152,docs2→2. Zero added diagnostics. | Per-run PASS; aggregate release OPEN — EXTERNAL CRITERION REQUIRED. |

V32 audit already inspected835 documentation/tests+249 config/scripts,29+5citations,paired63pagePDF and qualified GitHub index searches. No applicable aggregate rule found. V33 reuses that audit and inspects only targeted owner/contract evidence; no new repository-wide sweep.

## 4. Settled ownership evidence — not reopened

Historical path: detached loading skeleton → CSSAnimation → DocumentTimeline → HTMLDocument.219/232 captured detached targets had shortest strong paths through CSSAnimation. This is not an exclusive-dominator proof for all allocations. The original raw heap is absent; remaining13 targets cannot be identified from new objects. Browser-only reproduction established transient animation-related retention in that scope. Ineffective cancellation was withdrawn; no animation or loading UI changed.

A separate allocated-node slope was attributed to Playwright pointer-hit-test inspector handles. Scoped release:444→348allocated,291→291connected,184→184listeners. This is test-process ownership, not an application cleanup patch. No repetition or broad native exception is inferred. Owner must specify the treatment of native transients/confirmed inspector owners without changing historical numeric FAIL outcomes.

## 5. Completed frontend repairs and current known verification

V26: actual-source optional-field/empty-alternative compatibility and existing lexical-modal isolation, without educational content changes. V27: existing modal owner releases removed background branches and disposes externally removed dialog observers/listeners/abort continuations. V30: existing parent/opaque-child acknowledged-snapshot fence prevents older ACK hydration from overwriting newer local learner bytes or cancelling a legitimate debounce. Existing CheckpointWriter/ReviewJournal/barrier/media owners reused. Both V14 native Exam-readiness observations retain8000ms/score/value/draft/twoPUT requirements; these are accepted harness observations, not weakened assertions.

V32 sealed exact verification:544unit/499Chromium/418actual-source/14timing/4controls PASS,0fail0skip;25assets/CSS identity/determinism;2104originals preserved.15/15supported mixed journeys and30/30valid-source proofs preserved. Scoped app-owned frames/requests/RAF/URLs are disposed, audio paused/unsourced, observers/timers do not grow at equivalent disposed stages. Legitimate shell/harness owners remain. This does not prove universal native-memory release. V33 fresh exact packaged results must be read in V33_VERIFICATION.json, not inferred from V32.

## 6. Remaining independent external scopes

Comprehensive source/catalogue/previous-attempt/publication mapping, authorized live integration, backend direct authored?vocabulary=1 policy (GPT Work), matched original12-condition rendered visuals, Safari/hardware/original recordings remain unverified. Tests10/25 need authoritative timing correction only. See V33_CATALOGUE_ACCEPTANCE_HANDOFF.md. Approval of Phase2 alone cannot silently certify these scopes or promote aggregate Review if required conditions remain unmet.

## 7. A–J decision form — REQUIRED OWNER INPUT, no agent defaults

| Field | Existing fact / exact missing decision | Explicit owner entry |
|---|---|---|
| A ACCEPTANCE POPULATION | Which named V26–V32 runs/scenarios/instrumentation are in scope? Twelve passes are evidence, not a rule. | [NOT PROVIDED] |
| B REQUIRED ENVIRONMENT | Authoritative browser/version,OS,hardware,viewport,language/theme,fixture/live conditions; equivalence of recorded environments? | [NOT PROVIDED] |
| C RELIABILITY THRESHOLD | Actual pass/fail threshold and any required statistical/reliability rule, if one exists. No N/rate/confidence invented here. | [NOT PROVIDED] |
| D HISTORICAL FAILURE TREATMENT | Both3/1 and all other failures remain failed. Can subsequent observations supersede their release effect? Under which explicit scoped rule? | [NOT PROVIDED] |
| E TRANSIENT NATIVE RETENTION | Does attributed transient CSSAnimation retention affect acceptance when scoped app cleanup passes? What evidence/exception, if any, is authorized? | [NOT PROVIDED] |
| F INSPECTOR OWNERSHIP | How are confirmed Playwright-owned handles treated? Any exclusion must retain raw measurements and identify exact scope. | [NOT PROVIDED] |
| G NATIVE / OPAQUE RESOURCES | Which measurable terminal/lifecycle/native conditions are mandatory? Define observable,tool,threshold,stage; do not require or certify unmeasured universality by implication. | [NOT PROVIDED] |
| H SIGNING AUTHORITY | Identify real person/team/role, source of delegation and what authenticated recorded approval constitutes. GitHub handle/appOwner/agent is not inferred authority. | [NOT PROVIDED] |
| I DECISION DATE / VERSION | Actual decision date, packet revision/source/seal/report/ZIP/evidence population and exclusions. Prepared date is not approval date. | [NOT PROVIDED] |
| J ACCEPTANCE OUTCOME | Explicit PASS / FAIL / BLOCKED, reasons and precise scope. Current agent disposition is BLOCKED pending authority/rule, not an owner rejection. | [NO OWNER DECISION] |

If an existing rule is supplied, cite its exact origin, applicable version, and authenticated owner/delegation reference. Do not populate missing fields from silence or engineering convenience.

## 8. Consequences (conditional, not a proposed release policy)

- **Authorized PASS:** verify origin/scope and apply every specified condition to the preserved evidence; record which specific gate closes. Preserve every historical FAIL. Review may be promoted ONLY if explicit authorized acceptance covers its required scope and all remaining required gates are satisfied; no implied comprehensive/live/device/visual acceptance, Script/Reading/main/deploy authorization.
- **Authorized FAIL:** retain exact reasons and evidence. A policy failure alone is not proof of an app bug. Only a demonstrated application owner may be repaired under a bounded causal plan; otherwise record the specified unmet external condition.
- **BLOCKED/no response/unclear authority:** EXTERNAL RELEASE ACCEPTANCE BLOCKED; Review PARTIAL, Script NOT ADVANCED, Reading GATED. Silence is not approval.
- **Additional observations explicitly required:** before any run record exact scenario/environment/count/instrumentation/threshold/history treatment/evidence/closure condition and source of authority. Execute only that finite set, retain failures, never retry-until-green or rerun settled studies by default.

## 9. Explicit response / authorization block (unfilled)

Signer identity and project role: [NOT PROVIDED]
Authority/delegation source: [NOT PROVIDED]
Authenticated decision reference/channel: [NOT PROVIDED]
Decision date/time: [NOT PROVIDED]
Packet revision and frozen source/seal/report/ZIP: [NOT PROVIDED]
Fields A–I completed or incorporated existing rule reference: [NOT PROVIDED]
Decision PASS / FAIL / BLOCKED and reasons: [NO OWNER DECISION]
Specific accepted scope / excluded or unmet gates: [NOT PROVIDED]
Additional finite observations authorized, if any: [NONE RECEIVED]
Signature or explicit owner statement: [UNSIGNED — DO NOT FILL ON BEHALF OF OWNER]

Do not paste credentials/private attempt records into chat. Provide only an authorized decision/reference and privacy-safe evidence through an existing authorized process. This branch packet is delivered to the task requester for routing; it has not been submitted to an invented approver or external service.

## 10. Targeted authority provenance

The human project-owner role is documented. No named Phase2 signer/delegate, current approval, or accessible established migration signoff mechanism was found in these existing records. Direct “Tasdiqlayman” in the Preview DB approval is scoped to0029–0035 and a DB fingerprint; it must NOT be reused here. Demo Owner accounts and repository ownership are not authority delegation. Older docs reference other branches; they establish the owner-review pattern, not present release acceptance.

'''+refmd+'\n'
(b/'docs/V33_PHASE2_OWNER_DECISION_REQUEST.md').write_text(packet)
# Catalogue metadata only: never copy educational questions/keys/transcripts/media.
catalogue=json.loads((repo/'src/lib/listening/original-listening-catalogue.json').read_text());sources=[]
for n in range(1,33):
 prefix=f'content/listening/academic/test-{n:02d}';m=json.loads(read(prefix+'/manifest.json'));sourceid=m['id'];assert sourceid==f'listening-test-{n}';definition=catalogue.get(sourceid);canonical=repo/(prefix+'/canonical.json');c=json.loads(canonical.read_text()) if canonical.exists() else None
 assert not c or (c['sourceRef']==sourceid and c['publication']['state']=='draft')
 storage='la_listening_test_1_v2' if n==1 else definition['storageKey']
 row={'number':n,'sourceIdentity':sourceid,'knownCodeTestUUID':'e44e3d4b-3af6-41a9-b465-7d4bc21e1019' if n==1 else None,'requiredCanonicalBinding':'Authorized existing server test UUID ↔ package.sourceId ↔ storageKey ↔ canonical own attempt; not title/ordinal/browser-key inference. Test1 frozen code identity is not proof of live publication.','storageKey':storage,'manifestStorageKey':m.get('storageKey'),'staticStorageKeyAgreement':n==1 or storage==m.get('storageKey'),'storageKeyGap':'Versioned runtime/manifest strings differ; authoritative runtime/source normalization contract must be confirmed, not auto-corrected.' if n!=1 and storage!=m.get('storageKey') else None,'originalPresentationPath':prefix+'/source.html','originalPresentationSHA256':sha((repo/(prefix+'/source.html')).read_bytes()),'manifestPath':prefix+'/manifest.json','manifestSHA256':sha((repo/(prefix+'/manifest.json')).read_bytes()),'versionedPublicationDeclaration':m.get('deployment') if n==1 else c.get('publication'),'declarationIsNotLivePublicationEvidence':True,'canonicalMetadataPath':prefix+'/canonical.json' if c else None,'canonicalMetadataSHA256':sha(canonical.read_bytes()) if c else None,'authorizedPreviousAttemptContext':None,'livePublicationAvailability':'BLOCKED: current authorized server publication/sequence/user eligibility evidence not supplied; no live probe performed.','expectedPresentation':'Exact existing authored HTML and original interactions/EN-UZ/day-night/responsive states; no reconstruction. Matched authorized original rendering UNVERIFIED.','existingBackendContract':'Existing /api/listening/full/:id/authored and /authored-state GET/PUT; existing /progress GET/POST and /practice POST; canonical user/test/attempt, sequence/publication and exact own-byte ACK guards. No arbitrary historical-attempt selector endpoint inferred.','acceptanceOwner':'Human project acceptance owner + authorized catalogue/content/publication custodian; named delegation not supplied; backend normalization/policy belongs GPT Work.','requiredEvidence':'Authorized canonical test/source/storage binding; current allowed/denied publication+sequence+session states; own submitted/in-progress/exited/retake context with canonical results; source SHA and matched original views; exact existing contract responses in approved isolated QA. No credentials/private answers in packet.','fixtureSourceProof':'UNAVAILABLE/INVALID timing mapping' if n in [10,25] else 'Preserved V27 valid-source proof (isolated synthetic server/media, NOT live identity/publication/comprehensive closure).','comprehensiveOriginal':'BLOCKED','authorizedLive':'BLOCKED','timingLimitation':'40 invalid/unavailable entries; authoritative correction only' if n==10 else 'Q30end1236>1235.879;Q40end1525>1524.01;authoritative correction only' if n==25 else None};sources.append(row)
(out/'catalogue-handoff.json').write_text(json.dumps({'scope':'Read-only existing source identity/publication metadata;32 explicit source rows, no content copy/production read/write. Current live binding and own previous attempts not established.','sources':sources,'references':refs},indent=2)+'\n')
workflows=['Full IELTS Test','Review & Revision','Script Completion','MCQ Mastery','Map Mastery','Choose TWO Mastery','Completion Mastery','Vocabulary Builder','Retry Weak Areas']
rows='\n'.join('| '+str(x['number'])+' | `'+x['sourceIdentity']+'` | '+('`'+x['knownCodeTestUUID']+'` (code only)' if x['knownCodeTestUUID'] else 'Existing server UUID required; not inferred')+' | `'+x['storageKey']+'` | '+('versioned waiting-for-upload/activation note; live BLOCKED' if x['number']==1 else 'versioned canonical draft; live BLOCKED')+' | '+('UNAVAILABLE/INVALID; external timing correction' if x['number'] in [10,25] else 'Valid-source fixture proof preserved')+' | Own attempt / composite original / live BLOCKED |' for x in sources)
workflowrows='\n'.join(f'| {name} | '+('FRONTEND CODE COMPLETE' if name in ['Full IELTS Test','Retry Weak Areas'] else 'PARTIAL; NOT ADVANCED' if name=='Script Completion' else 'PARTIAL; supported subset only')+' | Preserved named fixtures/source evidence; not comprehensive | BLOCKED: authoritative per-source/user/attempt/publication set and original expected states | Human project owner + catalogue/content authority; backend policy GPT Work |' for name in workflows)
(b/'docs/V33_CATALOGUE_ACCEPTANCE_HANDOFF.md').write_text('''# V33 catalogue / previous-attempt / publication handoff

**COMPREHENSIVE ORIGINAL ACCEPTANCE: BLOCKED0/9. AUTHORIZED LIVE: BLOCKED0/9.** No production read/write, import, new endpoint or change to original metadata. Each row is a request for the existing authoritative state, not a fabricated attempt/publication grant. Evidence/tooling only; code/fixtures/original/live are separate gates.

## Contract and identity rules

Existing `src/lib/listening/original-test-one.ts` names Test1 codeUUID e44e3d4b-3af6-41a9-b465-7d4bc21e1019 and sourceId listening-test-1. Other existing definitions bind a server UUID and `detail.pkg.sourceId` to the versioned catalogue storageKey; never infer a live DB UUID from title, ordinal or fixture UUID. `original-listening-catalogue.json` contains2–32, not proof of their current DB publication.

Existing authored GET requires active user, UUID, sequence access and role/live eligible detail. `fullListeningDetail` uses staff or isLive, not a frontend permission hint. Authored-state reads the current own checkpoint, otherwise latest-started own attempt; it does NOT establish an arbitrary historical-attempt picker. Its GET fallback may INSERT a normalized checkpoint: **GET is not assumed side-effect-free and no live GET was executed here.** Existing server normalization/historical access contracts must be identified by their owner before a previous-attempt composite journey is judged. No fake endpoint or invented selector.

Current own Review requires server-owned submitted canonical attempt, exact source/document and40unique q1–40 `{q,user,ok}` results under the correct storageKey, fresh session/progress/own-state fences. Source-local answer material/browser storage never grants access. Active/foreign/replaced/unknown context conceals/fences current UI while retaining valid pending learner bytes. Existing legacy normalization responsibility remains external; no production records altered.

## Per-source identity and current gap

The SHA/path, repository declaration, full required evidence/owner/contract/previous-attempt gap for EACH row are in `evidence/v33/catalogue-handoff.json`. Runtime catalogue storageKey is reported separately from manifestStorageKey in the JSON. Any static disagreement is a normalization/identity clarification for the owner, not a proven frontend failure or permission to rewrite metadata. Versioned declarations below are reported exactly as repository artifacts, NOT current live facts. Test1 manifest says waiting for R2 upload/safe activation;2–32 canonical manifests declare draft. Neither proves current production state. No private media bytes/questions/answers/transcripts copied.

| Test | Existing source identity | Canonical test binding | Existing storageKey | Publication evidence distinction | Supported fixture scope | Remaining acceptance |
|---|---|---|---|---|---|---|
'''+rows+'''

## Existing runtime/manifest identity discrepancies (not new frontend defects)

Test11 runtime catalogue storageKey `la_listening_test_11_v2` versus manifest `la_listening_test_10_v2`;Test22 runtime catalogue `la_listening_test_22_v2` versus manifest `la_listening_test_21_v2`. Both are versioned strings, not live state. The existing runtime catalogue/adapter contract and preserved valid-source fixtures remain the frontend reference; do not substitute the manifest string, infer another canonical test or rewrite originals. The catalogue/content custodian must confirm the existing normalization when supplying authorized source/attempt bindings. This is a handoff clarification, not a demonstrated app defect or new failing frontend criterion.

## Per-workflow acceptance mapping

All nine rows require the actual authorized catalogue set, own attempt/source/publication eligibility and original expected presentation identified above for every applicable source. Preserve source-specific supported controls; do not assume every test offers every mastery activity because the Test1 hub has nine. Source HTML/manifest is the original presentation authority, matched current original renders remain unavailable.

| Workflow | Frontend implementation | Supported fixture acceptance | Comprehensive original / previous-attempt / publication / live | Responsible owner |
|---|---|---|---|---|
'''+workflowrows+'''

## Concrete external evidence requests and next action

1. Project owner confirms the acceptance set: applicable source/workflow pairs and whether/how an existing previous-attempt selector is part of original behavior. ADAPTER_CONTRACTS_V21 leaves selector/catalogue/sequence/publication comprehensive verification OPEN; absence of an established historical selection contract cannot be solved by inventing one.
2. Authorized catalogue/publication custodian provides privacy-safe existing server testUUID→sourceId→storageKey binding and published/unpublished/deleted/sequence-locked/unlocked states for an already authorized isolated QA environment. No guessed IDs, credentials, production edits, bulk material download or new permission.
3. Authorized attempt custodian supplies existing own submitted/current/exited/retake states and any actually supported previous-attempt reference/contract, canonical question/result membership and expected deny cases. Never copy another learner's data or fabricate attempt history. Fixture pending/outbox states remain fixture proof only.
4. Original UI acceptance owner supplies matched original states for1440×900/768×1024/390×844 × EN/UZ × day/night. Byte-identical CSS is not pixel parity.
5. Only after contract/access and expected outcomes are supplied: prewrite a finite scenario mapping existing endpoints and original behavior, permitted mutations (if any) and exact pass/deny assertions; execute only within those permissions. This task grants no production probe or original record mutation. New demonstrated frontend defects remain repairable through existing owners, not excused by external limits.

## Tests10/25 — unchanged authoritative correction handoff

Read `V27_EXTERNAL_TIMING_HANDOFF.md` and `evidence/v27/timing-handoff.json` (all42 correction entries preserved). Test10 forty invalid/unavailable timing entries. Test25Q30end1236 exceeds1235.879;Q40end1525 exceeds1524.01. Authoritative content/media owner must reconcile against original authorized recordings under their existing publication workflow. No timestamp guesses, clips clamped, recordings regenerated, HTML/keys/identifiers/publication changed. No32/32 original acceptance.

## Separate external gates

Direct authored?vocabulary=1 backend exam-policy is GPT Work responsibility, UNVERIFIED by frontend fixtures. Authorized live/provider/private recording/Safari/hardware acceptance is BLOCKED pending access/authority, not proof of a frontend bug. Staff35reserved/Dictionary/backend untouched. No approval or publication update is implied by this handoff.

## Targeted exact provenance

'''+refmd+'\n')
# Thirteen independent acceptance decisions, each with requirement/authority/evidence/state/missing/owner/action.
statuses=[
 ('A','Full IELTS frontend implementation','Preserve accepted exact own-context input/checkpoint/grading handoff','V32 checkpoint/contracts','FRONTEND CODE COMPLETE','No new demonstrated defect; comprehensive/live separate','Frontend verifier','Preserve existing regressions, no rebuild'),
 ('B','Retry Weak Areas frontend implementation','Preserve original source and server-only feedback','V32 checkpoint/contracts','FRONTEND CODE COMPLETE','Comprehensive/live separate','Frontend verifier','Preserve existing regressions'),
 ('C','Review frontend implementation','Supported original behavior and required aggregate acceptance','V32 matrix/ADAPTER_CONTRACTS_V21 + current V33 task','PARTIAL; supported features implemented/scoped verified','Release decision and specified comprehensive external states','Project acceptance owner','Owner packet; do not promote'),
 ('D','Mandatory fixture verification','544unit/499Chromium/418source/14timing/4controls exact packaged source','Current task§18–20; V32 baseline case identities','V32 PASS; V33 PENDING UNTIL FINAL REPORT','Fresh V33 exact-ZIP execution','Frontend verifier','One independent mandatory run; stop expansion on failure'),
 ('E','Original Phase2 strict test','Original+50nodes/+5listeners/stable shell stage','tests/browser-v6.mjs:53','V32 PASS496→473/152→152/docs2→2','V33 original case once inside499','Frontend verifier','No new diagnostic population'),
 ('F','Phase2 release/stability','Owner-authorized population/environment/threshold/history/native scope','Owner role provenance; V32 negative audit scope','EXTERNAL RELEASE ACCEPTANCE BLOCKED; OPEN','All missing A–J owner fields; authority binding and explicit rule','Human project owner; signer/delegation unverified','Return unsigned decision request; apply only actual authenticated rule'),
 ('G','Application-owned resource cleanup','Disposed-stage frames/requests/RAF/URLs0,audio paused/unsourced,observers/timers not grow; legitimate owners retained','original-review-v27-journeys.mjs:9/V27_RESOURCE_OWNERSHIP','IMPLEMENTED AND VERIFIED in supported scoped observables','No newly demonstrated app defect; no universal leak-freedom claim','Frontend verifier','Preserve mandatory lifecycle regression; no speculative cleanup'),
 ('H','Browser-native/opaque observations','Normal frame/context terminals and scoped native/inspector attribution','V27–V32 resource evidence','SCOPED VERIFIED; universal native NOT MEASURABLE WITH AVAILABLE TOOLS','Owner-defined measurable native requirement and any original13-target evidence','Project acceptance owner / original evidence custodian','No settled animation/inspector study replay; no native counter manipulation'),
 ('I','Comprehensive original sources','Authorized per-source/workflow set and exact original presentation','ADAPTER_CONTRACTS_V21/source manifest contracts','BLOCKED0/9','Genuine bindings/states/scenarios and authorized original reference','Catalogue/content + project owner','32-row catalogue handoff; no synthetic→live inference'),
 ('J','Previous-attempt/publication','Actual own canonical historical context and original authorized selection/publication/sequence contract','original-listening-state.ts/full-listening.ts/listening-sequence.ts','BLOCKED','Current checkpoint/latest fallback is not arbitrary historical selector; live eligibility not established','Attempt/catalogue/publication custodian + project owner','Provide existing contract/states, no invented history or production writes'),
 ('K','Matched-original visual','Three viewports×two languages×two themes matched authorized original','Current task§14/V32 visual scope','UNVERIFIED','Equivalent authorized original rendered states','Original visual acceptance owner','Compare only when references/access supplied; CSSidentity≠pixels'),
 ('L','Authorized live integration','Existing real auth/API/source/media and direct vocabulary backend policy','Existing contracts/current task§15','BLOCKED0/9; backend policy UNVERIFIED','Authorized environment/account/permission; backend scope GPT Work','Authorization/integration owner + GPT Work','No production probe/new endpoint/backend change'),
 ('M','Safari/hardware/original recordings','Actual authorized device/media behavior, not Chromium/synthetic silence','V32 external limits/current task§17','UNVERIFIED/BLOCKED','Authorized original recording/device/Safari access and owner scenarios','Device/media QA/content owner','No private audio packaging/capture or fabricated certification'),
]
items=[dict(zip(['id','workstream','requirement','authority','state','missingCondition','responsibleOwner','nextExecutableAction'],s)) for s in statuses]
for r in items:r['evidence']='Preserved V32_VERIFICATION.json plus exact targeted source receipts in release-authority.json/catalogue-handoff.json; V33 current executions only in final verification report.'
(out/'acceptance-status.json').write_text(json.dumps({'overall':'BLOCKED acceptance checkpoint; no new runtime progress','decisions':items,'authority':authority,'additionalDiagnosticRuns':0,'newDemonstratedFrontendDefects':[]},indent=2)+'\n')
(b/'docs/V33_ACCEPTANCE_STATUS_MATRIX.md').write_text('# V33 independent acceptance status matrix\n\n**BLOCKED acceptance checkpoint. Review PARTIAL. No approval received or fabricated; no runtime implementation change.** V32 evidence is baseline evidence, not fresh V33 proof. Final V33 exact-artifact outcomes override PENDING entries below via deliverables/V33_VERIFICATION.json.\n\n| ID | Scope / exact requirement | Authority | Evidence | State | Missing condition | Responsible owner | Next executable action |\n|---|---|---|---|---|---|---|---|\n'+'\n'.join('| '+' | '.join((r[k]+' — '+r['requirement'] if k=='workstream' else str(r[k])) for k in ['id','workstream','authority','evidence','state','missingCondition','responsibleOwner','nextExecutableAction'])+' |' for r in items)+'\n\nExact requirement text for each row is in evidence/v33/acceptance-status.json. V32 categories A–F remain scoped; no new C/application defect; absent policy remains external, universal native remains measurement-limited, not silently declared not-required. Full/Retrycomplete,ReviewPARTIAL,ScriptNOTADVANCED,ReadingGATED; inventories unchanged. No count alone promotes Review.\n')
(b/'docs/V33_REMAINING_EXTERNAL_DECISIONS.md').write_text('''# V33 remaining external decisions / executable work

**EXTERNAL RELEASE ACCEPTANCE BLOCKED.** Project-owner role identified in existing dossier/manual QA process; specific signer/delegation and migration approval mechanism not established. The unsigned `V33_PHASE2_OWNER_DECISION_REQUEST.md` is ready for the task requester to route to the actual owner. No approval obtained, no new release policy, no GitHub identity/Owner app account presumed authority. Old Preview DB “Tasdiqlayman” is not this permission. Prepared2026-10-22 is not an approval date.

## Missing owner decisions

Complete A–J: population,required environment,reliability threshold,historical failures/supersession,native transient classification,confirmed inspector handling,mandatory measurable native/opaque conditions,signing authority/record,decision date+version+evidence scope,explicit PASS/FAIL/BLOCKED. Source and authority must be verifiable. No N/default threshold proposed. Conditional consequences and unsigned response block are in the owner packet.

Catalogue/content/attempt/publication custodian must identify existing authoritative per-source/workflow set, canonical bindings and already authorized own attempt/sequence/live states. Versioned Test1 waiting-deployment and2–32 draft declarations are not current live publication proof. Current-state/latest-attempt fallback is not an arbitrary historical selector. No historical attempts fabricated. Existing GET may normalize a checkpoint; do not probe production as if GET were side-effect-free. All32 source and9 workflow rows are in the handoff/JSON with hashes/contracts/owners/gaps.

Matched original12-condition rendered states, authorized live integration, GPT Work direct authored?vocabulary=1 policy, Safari/hardware/original recordings and original13-target evidence remain external/measurement limitations. Do not treat hypothetical native objects as app defects. Tests10/25 authoritative correction handoff unchanged.

## Independently executable frontend obligations

No newly demonstrated frontend defect. Preserve and execute the exact packaged baseline544unit/499Chromium/418source/14timing/4equivalent controls with original assertions/names/timeouts and one original Phase2 case inside499. Zero added native/Phase2 diagnostics. Existing15mixed/30source matrices are preserved, not expanded/rerun as additional matrices. Fresh25assets/CSS/2104originals/history/two deterministic repacks remain executable. No material runtime change means no performance improvement claim.

If a mandatory failure occurs: preserve full/partial output first; write bounded causal plan distinguishing app/harness/fixture/native/external/unknown; repair only demonstrated owner, focused verification then mandatory regressions. No unchanged retries, budget/timeouts/security weakening or speculative runtime cleanup. External blocks never excuse an actual demonstrated app defect.

## Exact V34 continuation task

Verify sealed V33 implementation/source/seal/report/ZIP identities, clean local=remote branch and immutable V32/history first. Read the V33 owner decision packet, catalogue handoff and final exact-artifact results; do not repeat the V32 repository-wide audit or settled animation/inspector studies. Prioritize any actual mandatory failed case with preserved evidence and a written bounded causal plan; repair only its demonstrated owner through existing controllers and preserve assertion strength. Otherwise route the unsigned A–J packet to the verified real project owner through an actually authorized channel; obtain the existing applicable rule, signer/delegation, dated version/evidence scope and explicit decision. No approval from silence, repository ownership, demo Owner role or unrelated DB approval. Apply an obtained rule to preserved V26–V33 evidence without rewriting failures; before any required additional observation write its exact scenario/environment/count/instrumentation/threshold/history treatment/evidence/closure condition and execute only that finite authorized set. Obtain existing canonical catalogue/source/publication/sequence and authorized own previous-attempt acceptance states before bounded composite original QA; do not invent IDs, history, selector, endpoint, publication or permissions. If unavailable, retain EXTERNAL RELEASE ACCEPTANCE BLOCKED, Review PARTIAL, Script NOT ADVANCED, Reading GATED. Tests10/25 corrections remain authoritative content/media-owner work only. No redesign/original content/backend/Staff/Dictionary/main/deploy/retention changes; package and report actual evidence, never portray a new ZIP as runtime progress.
''')
print('Created owner-ready unsigned A–J packet;',len(refs),'targeted citations;32source rows;9workflow rows;13independent decisions. No approval/rule or diagnostic run.')
