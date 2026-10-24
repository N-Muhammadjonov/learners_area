# V7 Listening contracts — PARTIAL FRONTEND, no backend edits

V6/V5 public/session/view envelopes remain backward compatible and PROPOSED, not existing production endpoints. Existing real Listening APIs are reused. No staff-specific APIs/components are implemented. No frontend projection grants access/ownership; every server read/write reauthorizes the active own HttpOnly session and sequence/publication/attempt ownership.

## Proposed source-authorized view reads

GET `/api/frontend/view?route=<exact pathname+query>` → existing `{version:1,route:exact,data:...}`. Never use client userId/role to select protected records. Private/no-store;401invalidates existing authority;403sequence/access;404missing/unowned indistinguishable;503temporary; malformed→localized client retry. No browser DB or answer-key synthesis.

`/app/listening/tests/:id/:activity`, `id` UUID, original activity1–5 or matching/completion/map/retry only. Source `src/app/app/(focus)/listening/tests/[id]/[activity]/page.tsx`: sequence gate, role-aware fullListeningDetail and server runtime/registry checks BEFORE choosing kind:

- `{kind:'locked'}` → source sequence notice.
- `{kind:'authored'}` → replace to SAME authorized `/app/listening/tests/:id` hub, no guessed runtime classification or eager audio request.
- activity1 `{kind:'exam-start',title:string}` → source FullExamStart; actual POST starts/resumes server-owned attempt.
- practice path `{kind:'practice',practice:{id:matchingUUID,title,kind:matchingPath,audioUrl:null|privateResourcePath,mapDiagram?:canonicalMap,initial:record<numberString,string>,questions:[{number:positiveInteger,text,instruction,options:string[],at:nonnegativeSeconds,end?:secondsAtLeastAt}]}}`. Source studyPack authored membership, examInProgress gate; retry includes only own missed questions. Return NO keys/evidence/alternatives before server check. Practice only after source authorizes the mode.
- `{kind:'exam-locked'}` → original examLocked status.
- Other original activity2–5 branches remain UNIMPLEMENTED native ordinary frontend work. Do not invent a fake projection to call them complete.

`/app/listening/attempts/:id`: source attempt page getAttemptDetail(id,currentUser.id) determines section/package/legacy/result; do not guess from URL:

- `{kind:'exam',exam:{attemptId:matchingUUID,testId:UUID,title,audioUrl:privateResourcePath,imageUrl:null|privateResourcePath,mapDiagram?:canonicalMap,mapSections?:number[],questions:[{id:UUID,number,section:1..4,text,instruction,options:string[],input?:text|select|multi}],initial:record<OWNquestionUUID,stringMax500>,audioPosition:seconds0..7200,audioStartedAt:null|ISODate,duration?:positiveSeconds,sectionMode?:boolean}}`.
- Original full-exam question projection explicitly excludes key/alternatives/pair/evidence/correctAnswer. Native rejects duplicate IDs, foreign initial keys, unsafe media/maps and unsupported controls. `input` must be resolved server-side by canonical question-control registry when appropriate; options-based fallback only original package behavior. All A–E multiselect choices retained, no artificial choice cap or local grading.
- Completed package full exam `{kind:'redirect',href:'/app/listening/tests/<ownedTestUUID>/2'}`; finished section may redirect to its own `/app/listening/general/<ownedTestUUID>`. Server chooses own target; client only accepts narrow Listening destinations.
- Legacy ListeningExam, finished analysis/transcript/owner-material blocks, General lexical/highlight wrapper and revision/study consumers are not completed by this checkpoint. Standalone generated analysis is unit-verified, not a live route or authorized answer release mechanism.

## Existing APIs reused (unchanged handlers)

POST `/api/listening/full/:id/start` (no body) → `{id:ownedAttemptUUID}`. Single flight, source12s bound, same-origin/no-store/redirect:error, no automatic mutation replay. Sound check source oscillator disposed on completion/new check/navigation.

PUT `/api/listening/attempts/:id/draft` `{answers:record<OWNquestionUUID,stringMax500>,audioPosition:seconds,startAudio:boolean}`. Original5s cadence, crash draft and local notes scoped to attempt; snapshot tracking doesn't clear newer dirty answers. No provider/student identity persisted. Server retains authoritative timing/release/ownership and rejects finished attempts. Source draft schema enforces bounds and allowed IDs independently.

POST `/api/listening/attempts/:id/submit` `{answers:[{questionId:OWNquestionUUID,answer:string}]}`. Native confirmation, source12s bound, one flight;409refresh; failure retains own draft/notes; success alone removes THIS attempt's source local key family then navigates to original section-own or full-exam review destination. No browser verdict. API/session abort prevents stale navigate. Initial source13/108 code closures are not increased by this candidate flow.

POST `/api/listening/full/:id/practice` `{kind:matching|completion|map|retry,answers:record<authoredNumber,string>,complete:boolean}`. Server alone returns `{results:[{number,correct:boolean,key:string,evidence:string}]}` AFTER ownership/exam/registry validation. Native validates returned numbers/verdict/text before displaying. Full completion sends all source questions (empty string if unanswered); interim check only nonempty authored numbers. Results merge by question; no local scoring. Evidence clip stop uses source at/end (fallback25s); source audio element survives draws and is paused/unset on abort. Prediction and original previous/next/reset behavior retained. Text selection lookup support remains PARTIAL versus complete canonical ClickableText; do not count lexical/highlight closure.

## Existing authored APIs and retry generation

GET `/api/listening/full/:id/authored` is original handler; server sequence/role/runtime authorization returns source HTML runtime only at request time. Source protected HTML/answer keys/audio are NEVER bundled into native assets. Validate `runtime:{entryPath,files:record<relativePath,string>}` with own HTML entry/≤5MiB, private audio/image paths, source nativePersistence flag and vocabulary array before creating a frame. GET `/authored?vocabulary=1` remains optional enrichment.

GET/PUT `/api/listening/full/:id/authored-state` → `{values:record<stringMax100,stringMax100000>,course:serverCourseStatus|null}`; total serialized≤100000. Parent validates checkpoint/outbox values; legacy local states retained as original. Hub paints BEFORE checkpoint/full media. Native persistence storage blocked until server hydration acknowledgement; outbox replay must succeed before clearing pending own key. Source errors retain outbox. Native typed validation does not authorize a write.

POST `/api/listening/full/:id/progress` source `{activity:review|script|mcq|matching|map|multi|completion|vocab|retry,answers:record<key1..160,string1..4000>}` max80keys. These are source COURSE-WORK enum names, NOT proof that nine UI activities are implemented/tested. Backend recordOriginalCourseWork alone validates/grants progress. Existing serialized bounded-retry queue preserved, not generalized mutation retries.

`authoredFrame` retry aborts/disposes/releases prior owned session, rotates token/frame and revokes old URLs; no stacked audio/frame/listeners or stale success. Runtime/state malformed messages ignored before mutation; source-window+token message verification unchanged. sandbox="allow-scripts" ONLY, opaque authored CSP unchanged. Parent owns resource URLs/capability renewal; iframe receives inert blobs/media IDs only. Valid authored source HTML still owns its original interactions; all nine genuine activities need full behavior verification, not synthetic replacement cards. Native generated media controller remains original reviewed source.

No backend/DB/session/provider/staff/DNS/production changes. Separate AI's V4staff snapshot must be manually reconciled against latest V7 and cannot overwrite V5/V6/V7 shared consumers (including backwards-compatible strokeDasharray SVG attribute mapping). No automatic integration/merge/deploy; owner approval before production.
