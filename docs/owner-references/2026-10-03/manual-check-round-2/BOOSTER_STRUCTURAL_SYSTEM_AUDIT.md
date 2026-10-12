# Booster structural system audit — 2026-10-03

This is an evidence and implementation audit, not final product certification. `app.html` and `gate.js` refer to text extracted with macOS textutil from the exact owner RTF archive. Archive hash: `b666a20b004a824cc287ff7af7aa9989d96b62c7d64ba638e0e67c2a3a19010b`. The repo reference ZIP is byte-identical. Reference screenshots execute neither Booster JS nor uploaded package JS. Line anchors are extraction-specific; DOM IDs are stable source locators.

## Auth UX

**SOURCE:** gate.js lines 17–24; app.html API helper at 21170

**WHAT BOOSTER DOES:** Cached bearer state and server revalidation accelerate entry.

**WHY IT HELPS:** Fast presentation while retaining authoritative authorization.

**WHAT IS SAFE TO ADOPT:** Reuse server-authorized shell and scoped destination.

**WHAT MUST NOT BE COPIED:** localStorage bearer tokens or client-only permissions.

**LEARNERS AREA CURRENT STATE:** getCurrentUser reloads role/status; Home sends only authorized destination.

**IMPLEMENTATION DECISION:** Keep current sessions; desktop video routes to login/dashboard/pending.

**TEST REQUIRED:** Guest/active/restricted browser sessions; guest local root verified; real owner Preview dashboard/Writing verified, new Work authenticated root pending.

## Navigation

**SOURCE:** app.html lines 28248–28251

**WHAT BOOSTER DOES:** pushState/popstate stores module navigation.

**WHY IT HELPS:** Back has understandable learning meaning.

**WHAT IS SAFE TO ADOPT:** URL steps and native Next navigation.

**WHAT MUST NOT BE COPIED:** Global page DOM mutation or replacing Next router history.

**LEARNERS AREA CURRENT STATE:** InstantInteractionProvider stall recovery and Practice URL state exist.

**IMPLEMENTATION DECISION:** Preserve provider contracts; no replacement router.

**TEST REQUIRED:** Back/Forward/reload on actual Preview and rapid route switching.

## Request timeout

**SOURCE:** app.html lines 21170–21174, 22569–22573

**WHAT BOOSTER DOES:** AbortController and 120-second request deadline.

**WHY IT HELPS:** Prevents an endless pending request.

**WHAT IS SAFE TO ADOPT:** Bound operation-specific requests and release controls.

**WHAT MUST NOT BE COPIED:** Copying a universal 120-second delay or insecure host/token logic.

**LEARNERS AREA CURRENT STATE:** requestJson bounds headers/body at 25 seconds; legacy JSON controls now share scoped request deadlines; 29 raw component fetch sites remain, mostly existing bounded transfer/stream/lifecycle paths.

**IMPLEMENTATION DECISION:** Scoped cancellation added across Grammar, Speaking, Writing, Management, Vocabulary, Coach, live classes and shell controls.

**TEST REQUIRED:** Timeout/reject/malformed response/unmount; full raw-fetch audit remains open.

## Loading

**SOURCE:** app.html API helper; module stage panels

**WHAT BOOSTER DOES:** Stage-specific work states accompany module actions.

**WHY IT HELPS:** Students see which action is waiting.

**WHAT IS SAFE TO ADOPT:** Local pending state, accessible status and duplicate prevention.

**WHAT MUST NOT BE COPIED:** Permanent global overlays or pretending a pending action succeeded.

**LEARNERS AREA CURRENT STATE:** Existing local skeletons and React control states; raw handlers vary.

**IMPLEMENTATION DECISION:** Maintain shell, bound added actions, show contextual errors.

**TEST REQUIRED:** Slow API, double-click, control release and aria-busy in browser.

## Failure handling

**SOURCE:** gate.js fetch logic; app.html API helpers

**WHAT BOOSTER DOES:** Failure states are visible; reference also contains mock/toast-only flows.

**WHY IT HELPS:** Truthful failures keep user decisions meaningful.

**WHAT IS SAFE TO ADOPT:** Explicit unavailable/retry states.

**WHAT MUST NOT BE COPIED:** Reference mock scores or toast-only completion.

**LEARNERS AREA CURRENT STATE:** RegionFailureNotice and localized API errors exist.

**IMPLEMENTATION DECISION:** Do not suppress NotMigrated or publish incomplete Listening source.

**TEST REQUIRED:** Offline/server failure/JSON parse failure and no fake success.

## Resume

**SOURCE:** app.html learning modules; source resume logic around 2506

**WHAT BOOSTER DOES:** Resume and previous stage concepts are present in reference UI.

**WHY IT HELPS:** Learners can continue unfinished work.

**WHAT IS SAFE TO ADOPT:** Persist actual attempt/position through current server services.

**WHAT MUST NOT BE COPIED:** Use static reference progress as real data.

**LEARNERS AREA CURRENT STATE:** Reading/Listening/Writing/Grammar/TED have server state.

**IMPLEMENTATION DECISION:** Preserve; comprehensive cross-module continuity still needs authenticated QA.

**TEST REQUIRED:** Tab/Back/reload/network interruption for each module.

## Progress

**SOURCE:** app.html TED and grammar stage panels

**WHAT BOOSTER DOES:** Visible stage progression and topic mastery concepts.

**WHY IT HELPS:** A next action is clear.

**WHAT IS SAFE TO ADOPT:** Server-validated attempts and monotonic watched position.

**WHAT MUST NOT BE COPIED:** Hardcoded reference mastery or opened-tab completion.

**LEARNERS AREA CURRENT STATE:** Standalone TED previously discarded authored questions.

**IMPLEMENTATION DECISION:** Load/author actual questions; completion depends on required answers or explicit watch rule.

**TEST REQUIRED:** Database grading/completion and real learner resume.

## Draft saving

**SOURCE:** app.html lines 20048, 21848–21927

**WHAT BOOSTER DOES:** visibilitychange invokes leave/save handling.

**WHY IT HELPS:** Reduces loss when the learner switches away.

**WHAT IS SAFE TO ADOPT:** Current scoped drafts and safe keepalive where already supported.

**WHAT MUST NOT BE COPIED:** Secrets in browser storage or leaking across users.

**LEARNERS AREA CURRENT STATE:** Writing exam/draft services and TED monotonic progress exist.

**IMPLEMENTATION DECISION:** Preserve existing draft paths; do not claim all lifecycle cases verified.

**TEST REQUIRED:** Hide/reload/exit with pending draft, actual server acknowledgement.

## Learning state

**SOURCE:** app.html Grammar correction → translation → activation

**WHAT BOOSTER DOES:** Distinct pedagogical stages rather than generic CRUD.

**WHY IT HELPS:** Supports retrieval and transfer.

**WHAT IS SAFE TO ADOPT:** Independent original activities and persisted attempts.

**WHAT MUST NOT BE COPIED:** Proprietary lesson text or fake scores.

**LEARNERS AREA CURRENT STATE:** Grammar topic/exercise/activity services exist; Preview rows are zero.

**IMPLEMENTATION DECISION:** Add Writing/Speaking grouping plus validated original-content import.

**TEST REQUIRED:** Real Preview content import, activity, history and mastery.

## Responsive UI

**SOURCE:** app.html module CSS and dynamic tab handling

**WHAT BOOSTER DOES:** Responsive panels and dynamic widths adapt visible stages.

**WHY IT HELPS:** Controls remain usable as layouts change.

**WHAT IS SAFE TO ADOPT:** CSS/React state and existing observers where justified.

**WHAT MUST NOT BE COPIED:** Mutation-heavy global legacy UI.

**LEARNERS AREA CURRENT STATE:** Existing responsive shell; new Part cards use responsive grid.

**IMPLEMENTATION DECISION:** Keep shell; expand Practice desktop width without changing route behavior.

**TEST REQUIRED:** Eight required widths × locales/themes; currently incomplete.

## Reading

**SOURCE:** app.html #rd-ac/#rd-achub/#rd-acan/#rd-gen/#rd-qt

**WHAT BOOSTER DOES:** Academic analysis, General missions and question-type practice differ.

**WHY IT HELPS:** Module-specific first actions lower cognitive load.

**WHAT IS SAFE TO ADOPT:** Current canonical Academic/General adapters and deliberate source preview.

**WHAT MUST NOT BE COPIED:** Booster passages/questions wholesale.

**LEARNERS AREA CURRENT STATE:** Management import formerly accepted JSON only.

**IMPLEMENTATION DECISION:** Shared safe ZIP + inert HTML/XML + TXT/MD/DOCX canonical JSON; other sources supplemental.

**TEST REQUIRED:** Canonical import dry-run, source errors, safety and real published learner attempt.

## Listening

**SOURCE:** app.html Listening modules; exact owner Listening ZIP

**WHAT BOOSTER DOES:** Audio, exam, study, review and keyword/vocabulary activities.

**WHY IT HELPS:** Audio and study questions stay together.

**WHAT IS SAFE TO ADOPT:** Author-provided question data, native audio and safe map data.

**WHAT MUST NOT BE COPIED:** Execute packaged JavaScript or invent transcripts/quizzes.

**LEARNERS AREA CURRENT STATE:** Owner source uses modern PAIRS/ALT/DATA/V declarations.

**IMPLEMENTATION DECISION:** Static parser supports source family; whitelist SVG map; keep four transcript blockers.

**TEST REQUIRED:** Exact source automated tests passed; real Preview R2/import/publication still unverified.

## Writing

**SOURCE:** app.html Writing module; existing 19-page Writing PDF

**WHAT BOOSTER DOES:** Eight task-specific workspace tools.

**WHY IT HELPS:** Writing activities have appropriate progression.

**WHAT IS SAFE TO ADOPT:** Existing native eight-tab services and content management.

**WHAT MUST NOT BE COPIED:** Reference copyrighted model texts or sample bands.

**LEARNERS AREA CURRENT STATE:** Preview lacks 0031–0034 tables; NotMigrated is truthful.

**IMPLEMENTATION DECISION:** Prepared migration checkpoint; scoped four vulnerable tools.

**TEST REQUIRED:** Approved migration then open all eight tabs with real content and failures.

## Speaking

**SOURCE:** app.html #sp-struct; exact 2048×471 owner screenshot

**WHAT BOOSTER DOES:** Structures use meaning/examples/exercise/real-use; owner selects three Parts.

**WHY IT HELPS:** Preparation and output are explicit.

**WHAT IS SAFE TO ADOPT:** Original prompts, per-question recording, approved Part selector.

**WHAT MUST NOT BE COPIED:** Copy structure lesson text or replace 880-question bank.

**LEARNERS AREA CURRENT STATE:** Part→Topic→Questions works; screenshot differs visually.

**IMPLEMENTATION DECISION:** Three colored cards, 60/120-second Part2; guard late microphone/upload results.

**TEST REQUIRED:** Real bank checksum, browser cards/timers/deny/release/history.

## Grammar

**SOURCE:** app.html #p-gramw/#p-grams and stage subpanels

**WHAT BOOSTER DOES:** Writing typed activation and Speaking oral activation.

**WHY IT HELPS:** Grammar transfers into production.

**WHAT IS SAFE TO ADOPT:** Separate catalogue groups, original controlled/production tasks.

**WHAT MUST NOT BE COPIED:** Proprietary exercise text or fixed mastery.

**LEARNERS AREA CURRENT STATE:** Database verification found 0 topics and 0 exercises.

**IMPLEMENTATION DECISION:** Admin dry-run/apply import, original AI draft visibly identified.

**TEST REQUIRED:** Owner content review; actual population and typed/oral mastery in Preview.

## TED/Podcast

**SOURCE:** app.html #p-ted and lesson stage panels

**WHAT BOOSTER DOES:** Before, player, transcript, comprehension, gap, vocabulary, opinion, summary.

**WHY IT HELPS:** Moves from comprehension to language use.

**WHAT IS SAFE TO ADOPT:** Authored optional stages and shared lexical/SRS integration.

**WHAT MUST NOT BE COPIED:** Booster course text, artificial tabs or second vocabulary DB.

**LEARNERS AREA CURRENT STATE:** Standalone questions intentionally prohibited before this request.

**IMPLEMENTATION DECISION:** Remove prohibition in authoring/data/UI; existing lexical occurrences accept video source.

**TEST REQUIRED:** Authored answers persisted, canonical vocabulary save, empty tabs absent.

## Focus mode

**SOURCE:** app.html learning panels; existing source focus concepts

**WHAT BOOSTER DOES:** Learning panels concentrate on one exercise.

**WHY IT HELPS:** Reduces distraction.

**WHAT IS SAFE TO ADOPT:** Keep existing opt-in native focus state.

**WHAT MUST NOT BE COPIED:** Hide navigation permanently or inaccessible overlays.

**LEARNERS AREA CURRENT STATE:** Existing FocusEntry/focus tests remain.

**IMPLEMENTATION DECISION:** No focus architecture rewrite; verify after changes.

**TEST REQUIRED:** Escape, Back, route exit, focus-visible and body-lock cleanup.

## Mobile behavior

**SOURCE:** app.html responsive CSS; exact assets

**WHAT BOOSTER DOES:** Responsive module controls and compact arrangements.

**WHY IT HELPS:** Allows practical small-screen learning.

**WHAT IS SAFE TO ADOPT:** Preserve mobile welcome and appropriate adaptive layout.

**WHAT MUST NOT BE COPIED:** Desktop video solely by user-agent or stretching logo/video.

**LEARNERS AREA CURRENT STATE:** Root wrapper uses width + hover + pointer; Night mark exact derivative.

**IMPLEMENTATION DECISION:** Welcome for non-desktop media query; desktop intro only fine/hover ≥1024.

**TEST REQUIRED:** Real 320/375/430/768 and touch1024; touch capability not yet browser-emulated.

## Accessibility

**SOURCE:** app.html controls and semantic structure

**WHAT BOOSTER DOES:** Reference contains buttons alongside inline event and toast patterns.

**WHY IT HELPS:** Meaningful controls can support accessible learning.

**WHAT IS SAFE TO ADOPT:** Real buttons/labels/status, decorative video aria-hidden.

**WHAT MUST NOT BE COPIED:** Inline handlers, color-only feedback, inaccessible inherited controls.

**LEARNERS AREA CURRENT STATE:** Existing shared buttons and dictionaries; new data controls use labels/alerts.

**IMPLEMENTATION DECISION:** Retain existing accessible primitives; complete keyboard/contrast audit pending.

**TEST REQUIRED:** Keyboard/44px/contrast/modals/Escape at Day/Night.

## Performance

**SOURCE:** app.html API helper, state persistence and dynamic panels

**WHAT BOOSTER DOES:** Client panel changes can feel immediate.

**WHY IT HELPS:** Immediate feedback matters more than copied appearance.

**WHAT IS SAFE TO ADOPT:** Native route instrumentation and parallel independent server reads.

**WHAT MUST NOT BE COPIED:** Claim speed from reference or replace strong auth with cached token.

**LEARNERS AREA CURRENT STATE:** Existing PERFORMANCE_DIAGNOSTICS; video questions/progress fetched in parallel.

**IMPLEMENTATION DECISION:** No unsupported speed claim; measure deployed route actions after access.

**TEST REQUIRED:** Actual dashboard/module timing and bundle/route measurement pending.
