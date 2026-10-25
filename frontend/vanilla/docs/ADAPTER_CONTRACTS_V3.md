# V3 frontend integration contracts — NOT implemented backend endpoints

Extends [ADAPTER_CONTRACTS_V2.md](ADAPTER_CONTRACTS_V2.md); historical V2 document is unchanged. No backend/API/database change was authorized or made. Fixture successes are not live integration. All three `/api/frontend/*` interfaces remain proposals; the real static preview responds 503.

## Public and session projection

Public shape remains V2. Original source: `src/app/login/page.tsx`, registration page, `src/lib/auth/public-auth-policy.ts`, `src/lib/auth/telegram-intent-config.ts` and providers. Derive password/Telegram/Google policy server-side; never return environment objects, provider secrets, bot tokens or credentials. Nonce/CSP integration must use an owner-reviewed existing policy, not wildcard/unsafe-eval permissions. Invalid flags fail closed. Missing bootstrap shows correct localized source auth title and deliberate retry. Legacy widget script failure shows original unavailable UI; self-only preview policy is not weakened to make it appear live.

Session shape remains V2, derived from `getCurrentUser()` / `getCurrentSessionAuthority()` in `src/lib/auth/current-user.ts`, account-status/role gates and source `/app/layout.tsx`. Identity, role, status and absolute expiry must be database/session authoritative, not cookie-role guesses or client-submitted scope. HttpOnly cookies stay HttpOnly. `accessEventsEnabled` derives from the existing server's supported event configuration. Every protected read/mutation independently enforces authorization.

Native consumer: `js/workspace.js`, `js/authority.js`, `js/adapters/frontend.js`. Mutations that rotate onboarding/admission presentation invalidate cached session before navigation/refresh. Fresh identity/role/status changes clear private resources. Expiry/SSE/reconciliation/401/logout teardown remains independently enforced. Browser presentation does not grant access.

## Independent dashboard regions — new PROPOSED view interface

Request: `GET /api/frontend/view?route=%2Fapp&region=dashboard|openLessons|mock`.
`/app/mocks` requests only `region=mock`. Other region names are rejected by the native adapter.

Response: `{version:1,route:<exact path+query>,region:<requested region>,data:{<field>:<safe DTO>}}`.

| Region | Required field | Original server source |
|---|---|---|
| dashboard | `dashboard` | `DashboardContent` in `src/app/app/(shell)/page.tsx`; `getDashboardData(user.id)` from `src/lib/data/dashboard.ts` |
| openLessons | `openLessonsResult` | Same page's independently started roadmap; `getDashboardOpenLessons` from the same original data module |
| mock | `mock` | Original MockProgressOverview / mock data services recorded by `scripts/convert-dashboard.mjs` and generated mocks/dashboard presentation |

Native consumer: `modules/dashboard.js`; validation: `js/adapters/dashboard.js`; source skeletons/renderers: generated dashboard/mocks. Start all permitted regions concurrently. Summary failure must not serialize/block siblings; an early roadmap result is retained until its source slot exists. Retry only the failed region, never replay a mutation or invent a zero-result success. Abort stops later rendering. V2 aggregate responses may contain the requested field, but native callers now make separate region requests. The region echo is optional for legacy fixture compatibility, validated if present; exact route/version/data are mandatory. This compatibility is not a production schema acceptance claim.

Dashboard required source fields: `profile` (nullable targetBand), nullable `streak`, `writingAttempts`, `vocabDueCount`, `skillCounts` (four named skills), `unavailable` boolean region map, nullable `lastActivity`, `openAssignments`, `nextLiveClass`, `latestEvaluation`. Preserve source null/unavailable meaning; no fake counts, strengths, marks or grading. Owned links must be safe local `/app` paths. Projection must exclude raw DB rows, answers, hidden evaluations, staff-only fields and unrelated users.

Roadmap: `{ok:false}` or `{ok:true,lessons:[{id,title,moduleTitle,unitTitle,state:'available'|'assigned'|'in_progress'}]}`. Gate assignment/enrolment and published content on the server; a client state string never authorizes opening a lesson.

Mocks: `{tests:[safe id/title/skill],attempts:[safe owned id/title/skill/startedAt/finishedAt/estimatedBand/rawScore],finishedCount, catalogUnavailable flags}`. Exact keys are `catalogueUnavailable`, `attemptsUnavailable`, `attemptTitlesUnavailable`; dates are ISO strings. Preserve source finished-full-mock summary rules, not synthetic scoring. Compatibility derives missing finishedCount only from supplied finishedAt facts. It does not invent attempts. Do not return raw responses/private grading material.

## Existing per-route interfaces — still incomplete server integration

15 presentation recipes remain in `js/generated/view-registry.js`; each records the exact original page path and required fields. No new V3 page recipe was added. Session is required even for safe static management/speaking hub presentation.

- Listening/Reading lessons: original `listLessonLibrary` in `src/lib/content/lesson-library.ts`, called by original lesson pages. Reading page bound 1..10000, size24, server offset/published/staff policy; Listening area is a server semantic filter, not guessed from audio. Safe summary projection only: id/title/summary plus original estimatedMinutes/hasTeacherNotes/hasMedia as needed. `hasMore` is server supplied. Source section navigation is local UI, not a DTO/API or a completed linked product.
- Other catalogues/histories/audit/admin/materials: retain V2 required fields and exact source functions identified in the registry/inventory. **Nested schemas, pagination/filter/role/ownership redaction for several recipes are NOT fully specified/accepted yet.** Completing them and their native ordinary states remains engineering work, not an external-only blocker.
- Pending: original `findOpenRequestForUser` in `src/lib/data/admission.ts`, original pending page and database-backed account status. Return only the learner's safe open request (or null); do not infer a request from registration.
- Listening test hub: original `listeningSequenceAccess`, `fullListeningDetail`, `listeningLearnerFacts`, `listeningPracticeProgress`, `packageActivities`/`activityPath`, MCQ data services and original page. Return original registry-derived safe hub metadata/status/paths, not arbitrary activities or answer-bearing payloads. All nine activities/native engines are not complete. Authored runtime/media stay behind original authorized APIs and capability protocol.
- MCQ: original day page and `src/lib/listening/mcq-program.ts` determine Day/active position. Server returns safe question/stage metadata only before reveal. Native day validation and `js/adapters/mcq.js` enforce declared stage/next/options shapes, real multi-select strings and matching ids; no local reveal/grading/role inference.
- Notifications: existing `/api/notifications` returns safe owned notification rows. `js/adapters/notifications.js` rejects duplicate ids, invalid dates and unsafe destinations before rendering/observation. Read controls use existing serialized mutation API; live server counts/delivery remain unverified.

## Existing APIs reused, not created

Original source handlers are indexed under `api` in `docs/source-inventory.json` (214 files). Examples actually consumed by native modules:

- `/api/auth/login`, `/register`, `/reset/request`, `/reset/confirm`, `/recovery/login`, `/state`, `/changes`, `/logout` and original Google/Telegram intent/status/cancel/exchange endpoints (under `/api/auth/...`).
- `/api/theme`, `/api/locale`, `/api/onboarding`, `/api/admission/request`.
- `/api/search`, `/api/notifications`, `/api/support/reports`.
- `/api/listening/mcq`, `/api/listening/mcq/:sessionId`; original authored state/progress/resource/sandbox/media APIs; vocabulary lookup/folder/save APIs.

Read exact native module and original handler before integration: this list is not an authorization contract or declaration that every action has been ported. Support product routes, most staff actions and educational engines remain unfinished. No generic SQL/DB/table-name endpoint, browser credentials or new production service was added.

All proposed reads must be same-origin credentialed/no-store, route-allowlisted and server-gated. Mutations retain original CSRF/origin/rate-limit/idempotency policies. No user identity/role in mutation bodies; return safe typed errors rather than driver/stack messages. Source private-media expiry/revocation/publication/ownership rules remain mandatory; no public URL substitution.

## Acceptance gate

Complete each source-state consumer and nested DTO schema first. With explicit owner approval, adapt to existing authoritative server functions/APIs in an isolated review environment. Verify real HttpOnly rotation, CSRF, role/status downgrade, cross-user denial, reconnect/revocation, ownership, media/answer redaction and 401/403/error/timeout states. Fixtures, safe rendering, and basic field checks are not live permission or integration acceptance. No approval to replace production is implied.
