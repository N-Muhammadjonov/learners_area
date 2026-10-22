# V36 implementation handoff — course lesson/workspace/private notes

## Authority, baseline and scope

Current human project owner authorizes independent whole-site frontend migration. Baseline local/remoteV35 e8beca18e3bf9dd51a86691aaff4601d8f1e6bab restored by same-branch fetch/fast-forward after hash/copy-preserving359unexpected older migration files outside repository. No destructive reset/clean/forcepush. All implementation edits inside migration/vanilla-frontend. No new sealedZIP; this is a verified fixture-specific implementation increment,not whole-product completion.

## Implemented original source behavior

- LessonPage `/app/courses/ielts/lessons/:lessonId`: source JSX extracted to native DOM; back control,title/unit/summary/badge,recording card,closed notice,original workspace placement,source assets/classes/EN-UZ/day-night. CanonicalUUID rejects before view lookup; null/404 notfound; other failures local retry. Details from minimized own-authorized proposed view boundary only; no substitute data.
- LessonWorkspace: original Start/Complete buttons,busy/disabled/error labels,server-only success and original completion label/date. Singleflight25s state API; no visit progress,no optimistic completion,no second timestamp. Action repaint NEVER detaches the notes textarea,retaining focus/current edits.
- LessonNotesPanel: existing generated source presentation and ONE existing shared serialized writer reused,not rebuilt.900ms/4000/blur/pagehide/hidden/routeexit/exactACK/manualretry/keepalive/privacy retained. Two actual reproduced writer defects repaired: (1) inflightB→queuedC→revertACKA erroneously postedC instead ofA; (2) duplicateflush of inflightB queued identicalB and automatically replayed it after failedB. Pre-fix failures saved; current snapshot field deduplicates transport without aborting older legitimate writes.
- OwnerMaterialBlocks course consumer: original visible gate and ResourceBlocks renderer reused,original five block types and order,empty means no invented heading. Existing ClickableText lexical owner reused unmodified. Resource access server-authoritative; native audio/video teardown owned by route.

Source detail nuance: original isOpen excludes completed as well as locked/scheduled. Reloaded completed detail therefore shows original closed card; a just-completed mounted workspace shows its ACK label. This is intentional source parity,not a new transition policy.

## Video / Grammar boundaries

Full619line VideoLessonStudio and its imports/provider/progress dependencies read and recorded in evidence/v36/source-receipts.json. Not implementable accurately as a generic iframe. Availability=true produces explicit incomplete-video region,not silent omission or fake controls. Remaining: course-mode tabs,provider YouTube messaging/origin validation,direct-media controls,captions,watched progress,authored answers/opinion/summary,vocabulary props when supplied,transcript behavior and stream/frame/listener cleanup. Preserve strict migration CSP/sandbox; do not copy provider iframe settings into opaque authored sandbox. Recording card implementation is separate from Studio; original external recording origins remain an integration gap. No separate VideoTranscriptDialog source file exists here.

Grammar parallel work not started: safe independent agent ownership unavailable,lesson priority honored. V35 roadmap and Grammar native implementations preserved; no unrelated redesign.

## Verification / remaining failures

Fresh unit suite595PASS including20new tests,0FAIL/SKIP. Actual final Chromium course matrix/lifecycle92PASS/0FAIL/0SKIP (including real touch controls), see evidence/v36/browser-course.json and verification.json (initial89PASS preserved separately before final dedup/touch additions). A–T lifecycle coverage includes controlled response ordering,exact-current ACK,revert-to-oldACK,duplicateflush failure,900msdebounce,blur/routeexit/syntheticpagehide/hidden events,overlong/empty/whitespace,source-switch fencing,401revocation,403failure,foreign-owner projection refusal,Back/Forward/reload and real controls. Browser fixtures are authorized synthetic metadata only; synthetic visibility/pagehide events do not certify real-device document shutdown delivery.

Relevant original shell/shared notes regressions run v3/v5/v10 (49/52/53),with historical evidence restored byte-for-byte. Final note change rerun separately under regressions-final-notes. V35 entry33functional cases rerun into V36only:33PASS,0FAIL; fresh strict visual17PASS/7FAIL,not a replacement for historicalV35 18PASS/6FAIL. New lesson initial available-state React source fixture:9/12exactPASS,3FAIL; key UI geometry/styles12/12equal,maxchannel1. No threshold relaxed; visual commands deliberately nonzero. Other lesson states are functional/screenshot evidence,not matched original-pixel certification. Reference uses original React19.3.0 components in candidate shell/sourceCSS,NOT running originalNext/live.

Bounded V35followup: one predefined desktopENnightroadmapcase,two captures of unchanged native DOM matched bytes; reference replacement differed33pixels,maxchannel1 with equal geometry/fonts/colors. RawA/B and computed styles/theme retained in visual-control/. This does NOT prove the discrepancy comes from reference or harmless nondeterminism; cause remains unresolved. No fonts/palette/geometry/motion changed to mask it; no additional until-green sampling. Historical6FAILs remainFAIL.

## True inventory and next work

Routes22COMPLETE/18PARTIAL/68NOTSTARTED (108);new lesson NOTSTARTED→PARTIAL. Components62COMPLETE/19PARTIAL/125NOTSTARTED (206);LessonWorkspace and course OwnerMaterialBlocks NOTSTARTED→PARTIAL. Existing Notes/ResourceBlocks remainPARTIAL with course expansion; no completed count promotions,no page-renderer inflation. Staff35reserved;remainingnonStaff51;remainingcomponentfiles144. Machine ledgers and V36 dependency inventory updated.

V37: implement actual original VideoLessonStudio course-mode dependencies in order (provider/direct media→owned player lifecycle→watched progress→authored answer/response tabs→transcript and applicable vocabulary; reflection is standalone-only),then extend course lesson verification. Grammar topic/activity consumers remain independent. Do not wait for Review approval to implement these.

Authorized live view/resource/server-policy integration remains UNVERIFIED. Proposed view endpoint is not newly deployed. All tests synthetic; no production requests,writes,content/auth/backend/DB/Staff/Dictionary changes. Review Phase2 still BLOCKED—OWNER DECISION REQUIRED,its A–J packet/historicalFAILs untouched. No new Phase2/native/inspector diagnostic series. No comprehensive fresh499/418/timing/control suite or sealedZIP claimed; focused shared-note/caller tests run instead.

Source-specific V37 correction: LocalReflectionRecorder and TedStudyPractice mount ONLY in standalone mode, not course mode. Course LessonPage does not supply vocabulary, so its default empty vocabulary list must not be replaced by an invented fetch/tab. Transcript is a real conditional Studio tab, not a dialog dependency. Preserve separate provider-frame restrictions without changing the authored opaque sandbox.
