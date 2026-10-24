# V6 Phase2 contracts — no backend changes

V5 remains authoritative for auth/session/shell and proposed public/session/view envelopes. These frontend projection paths **are not existing production endpoints**. Static preview `/api/*` remains503, not fake identity/data. New consumers are native; all original server services below remain read-only. No staff-specific adapters/contracts are replaced.

## Dashboard/MOCK proposed reads

`GET /api/frontend/view?route=<encoded pathname+search>&region=<dashboard|openLessons|mock>` → `{version:1,route:exactRequestedRoute,region?:exactRequestedRegion,data:{dashboard|openLessonsResult|mock:<DTO>}}`. Require current active authenticated identity; derive userId from HttpOnly session, never query/body; no-store private. Dashboard starts all3reads together; Mocks requests only mock. Do not implement a single sequential endpoint that blocks independent regions. Server may reuse original services but must redact private raw rows/snapshots/answers before serialization.

- `dashboard`: narrow projection of `src/lib/data/dashboard.ts:getDashboardData(currentUser.id)`: `profile:null|{targetBand:null|finite0..9}`, `streak`, `writingAttempts`, `vocabDueCount` each null or nonnegative integer; `skillCounts:{reading,listening,writing,speaking}` each null or nonnegative integer; `unavailable` booleans for profile/latestEvaluation/vocabDue/streak/writingAttempts/readingAttempts/listeningAttempts/speakingAttempts/assignments/nextLiveClass/lastActivity. Null means unavailable, NEVER invented zero.
- `lastActivity:null|{module:reading|listening|writing|speaking|vocabulary,at:ISODate,href:safeLocalAppPath}`: newest OWN activity per original `getAttemptTimeline`/vocabulary reads. Keep deep query/fragment. No foreign attempts, credentials or protected content.
- `openAssignments:null|[{id,title,dueAt:ISODate|null}]`, `nextLiveClass:null|{id,title,scheduledAt:ISODate}`, `latestEvaluation:null|{overallEstimate:null|finite0..9,weaknesses:string[],checkedByName:publicAttribution}`. Use original `PUBLIC_CHECKED_BY`, never provider/model identity or raw evaluation payload. Fields the UI does not consume must be redacted, not whole DB objects.
- `openLessonsResult:{ok:false}|{ok:true,lessons:[{id:safePathSegment,title,moduleTitle,unitTitle,state:available|assigned|in_progress}]}`: original `getDashboardOpenLessons(currentUser.id)` / `getCourseRoadmap('ielts',currentUser.id)`, original slice4 and server release/assignment policy. Do not show locked/scheduled/completed as newly open; lesson detail is a later module, links remain exact source URLs.
- `mock:{tests:[{id,title,skill:full|reading|listening|writing|speaking}],attempts:[{id,mockTestId:string|null,title:string|null,skill:validSkill|null,startedAt:ISODate|null,finishedAt:ISODate|null,estimatedBand:finite0..9|null,rawScore:finiteNumber|null}],finishedCount:nonnegativeInteger,catalogueUnavailable:boolean,attemptsUnavailable:boolean,attemptTitlesUnavailable:boolean}`. Original `src/lib/data/mocks.ts:getMockOverview(currentUser.id,'ielts')`; catalogue and own attempts/title lookups independent. Historical removed mock title/skill are resolved server-side from own attempt snapshot, but NEVER return the snapshot/questions/answers. Unfinished outcomes redacted server-side as original. Source finishedCount counts all finished own attempts, not only full mocks. Existing V2 compatibility derives missing finishedCount only from supplied finishedAt facts; no invented attempts or grades.

`js/adapters/dashboard.js` validates fields, dates, paths, enum/count/band validity and duplicate mock IDs. Generated source mock summary calculates presentation-only average/best/change/unique completed catalogue mocks from server-earned completed full bands; it is not a grader. Source removed mock history is retained without inflating current catalogue completion. No mock runner exists or is introduced. Source catalogue, finished/unfinished own rows, null-score dash and independent failure notices are rendered unchanged.

Dashboard open lessons has its own DOM boundary while summary is loading/failed. Summary retry reuses that boundary, not refetching/replacing lessons or siblings. This repairs a V5 dependency rather than claiming a skeleton equals usable content. HTTP/parse/network/malformed DTO errors keep safe localized retry; scope signal cancels latest-only reads and prevents stale paint. Existing api-client401 reconciliation remains unchanged.

## Reporting proposed presentation read

`GET /api/frontend/view?route=%2Fapp%2Freports[encoded query]` → `{version:1,route:exactRequestedRoute,data:{reporter:{query:trimmedQMax60,scopes:orderedScopeArray,students:[{id:UUID,name:nonemptyStringMax200}]}}}`.

Original source: `src/app/app/(shell)/reports/page.tsx`; source policies `src/lib/reporter/access.ts`, `roster.ts`, `validation/like.ts`. Adapter must use current own server role, NOT caller-supplied actor/role:

| Actor | Ordered scopes | Student selector / search |
|---|---|---|
| owner | owner,teacher,student | Original all-student id/name query; optional escaped name LIKE search, stable name/id ordering, cap1000; source capped message |
| admin | teacher,student | Same all-student/search scope; NO owner centre scope (`ADMIN_REPORT_POLICY.ownerScope:false`) |
| teacher | teacher,student | ONLY `listRoster(currentUser.id)` from explicit teacher_student_links; stable order, source cap500; query does not broaden roster; no name-search UI |
| student | student | Empty students array, self only; no selector/subject ID/search |

Projection errors/unavailable roster must fail closed, not fall back to all students. No emails/roles/DB rows/roster administration permissions exposed. No student identity/role trusted from URL. Native `reporterDTO` checks ordered policy scopes, query, UUID/name rows, duplicates and source caps; loading/malformed/error/retry separate from genuine empty lists. Empty teacher roster uses original noRoster text. This is Reporting UI for staff roles, not implementation of any of the35reserved staff product routes.

## Existing report API — reused, NOT invented

`GET /api/reports?scope=...&subject=...&period=...&from=...&to=...&format=...&lang=...` is **existing** `src/app/api/reports/route.ts` → `src/lib/reporter/service.ts:generateReport`.

- Source scope policy as above, all authorization repeated by backend on every download. Teacher student subject must be on explicit roster. Student self only; native emits no subject. Unrelated/missing student →same404, no probing. Owner centre scope never inherited by admin.
- `period:on_demand|weekly|monthly|yearly|custom`, `format:json|csv|xlsx|docx|pdf|zip`, `lang:uz|en`. Custom `from/to` YYYY-MM-DD inclusive calendar dates, valid/nonreversed/at most366days/not after current centre date in Asia/Tashkent. Existing periodic windows are last completed periods. Native reuses reviewed pure source period logic for validation, NOT database/report generation; server repeats it with authoritative time.
- Native form retains source `ui=1` plain-GET fallback markup, but Fetch deliberately omits ui to receive machine JSON errors rather than303navigation. Only whitelisted seven parameters; irrelevant dates/subjects omitted. Client contains no actor ID, SQL or grading.
- Success200 binary with original `CONTENT_TYPES`, `Content-Disposition:attachment; filename="riwi-report-<scope>-<from>_<to>.<format>"`, private/no-store, nosniff, X-Report-Id. Native verifies MIME/attachment/nonempty bytes, uses safe filename fallback for unsafe headers, downloads the ACTUAL response blob, revokes object URL on timer/new download/route abort. No in-browser fake PDF/Office/CSV/JSON/ZIP generator. Request credentials same-origin, redirect:error, no-store, 120s bound, explicit cancel/no mutation replay. Browser download event tested; no claim to verify server file encoders through synthetic bytes.
- Errors `{error:{code}}`:401unauthorized,400invalid_input/invalid_date/range_reversed/range_too_long/range_in_future,403forbidden,404not_found,503generation_failed. Unknown/private driver strings are never rendered; localized fallback. 401 uses existing authority invalidation event; stale/cancelled responses cannot save a file. Cancelling a client request does NOT promise server audit/generation never occurred.
- Own form draft survives same-route preference refresh only; actual navigation/identity change clears route state. Selection must still belong to newly fetched authorized roster. No blob/credential/report data in persistent browser storage.

Backend still authorizes, builds recorded metrics/provenance, applies private student/roster/owner scopes, generates all six real formats and audits before delivery. No browser SQL, policy bypass, student list synthesis, server rewrite, provider/DB/configuration/production change.

## Parallel integration

See PARALLEL_INTEGRATION_V6.md:35staff routes remain exclusively owned by the other AI, whose V4 snapshot predates V5/V6. Review only its staff-owned delta against latest Arena; no automatic merge or wholesale shared-file replacement. Existing V5 auth/session DTOs and V6 native clients must not be rolled back. No deployment without explicit owner approval.
