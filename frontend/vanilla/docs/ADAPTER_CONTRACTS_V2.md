# V2 frontend integration contracts — NOT existing backend endpoints

No backend endpoint was added. The local static preview deliberately responds 503 to `/api/**`.
The following names are frontend adapter interfaces only, not a new backend/database proxy.
Implement/integrate only with owner approval and existing server authority; this task did not authorize production integration.

## Public presentation

Proposed `GET /api/frontend/public`, `{version:1, public:{auth:{passwordEnabled:boolean,telegramOnly:boolean,telegramIntentEnabled:boolean,telegramConfigured:boolean,googleConfigured:boolean,botUsername?:string,nonce?:string}}}`.
The server must derive policy/configuration. Never expose environment variables/tokens/provider secrets. Contradictory Telegram-only/password-enabled flags are rejected. Legacy widget script requires independently reviewed origin/nonce/CSP integration, not `unsafe-eval`/broad script allowances.

## Session presentation

Proposed `GET /api/frontend/session`, private no-store same-origin credentials:
`{version:1,session:{user:{id:string,name:string,email?:string,role:'student'|'teacher'|'admin'|'owner',accountStatus:'active'|'pending'|'suspended'|'rejected',photoPresent:boolean},expiresAt:integerUnixSeconds,accessEventsEnabled:boolean}}`.
Only the database-backed server can supply identity/status/permissions. Client data is presentation, not authorization. Current validation enforces basic shape, declared roles/statuses and absolute expiry; nested DTO contracts need production validation. Existing `/api/auth/state` exposes no identity and is **not** a substitute. Maintain existing SSE/session revocation, cookie/CSRF/origin protections and authoritative resource gates.

## Per-route view

Proposed `GET /api/frontend/view?route=<encoded path+query>`:
`{version:1,route:<exact requested path+query>,data:<route-specific object>}`.
No arbitrary query execution, table names, raw SQL, browser DB access or client-provided user scope. Server allowlist each route and run its original page's role/status/ownership gates. Gate each underlying existing API independently. Fragment is UI-only and not transmitted.

`js/generated/view-registry.js` documents 15 explicitly reviewed presentation recipes, required top-level DTO fields, date hydration and roles. The source function/filename is recorded with each recipe; consult original functions for the complete nested schema. Basic field-presence checks are **not** full DTO/schema acceptance. No success/empty fallback if adapter missing or malformed.

- Lesson catalogues: `{library:{rows:[original safe lesson summaries],hasMore:boolean}}`; preserve published/staff policy and paging on server.
- Academic Listening: `{cards:[safe original summaries + learner progress/lock facts],total:number}`. Do not send raw test payloads, answer keys or protected media.
- General Listening: `{cards:[published standalone section summaries],total:number,hasMore:boolean}`; page/query preserved.
- MCQ catalogue: `{days:[original published Day summary/status/lock facts]}`; no fixed day limit or unearned completion.
- MCQ Day: `{day:{day,title,draft,audioUrl,status,questions:[{id,questionText,stage}]}}`; derive Day/active position from actual programme. No options/keys before stage. Every drill transition calls the existing server APIs.
- Histories/audit/notifications: `{rows:[original safe, owned rows]}`; source Date fields revived locally only for formatting. Notifications use existing GET `/api/notifications`, mapping `notifications` to presentation rows.
- Management/Speaking hub need no page DTO, but require authoritative session presentation. Presentation links do not grant access.
- Admin content/materials: `{inventory,writingOther}` / `{counts}`; counts and authorization must come from original services. No invented defaults when reads fail.
- Dashboard: `{dashboard:<getDashboardData safe DTO>,openLessonsResult:{ok:true,lessons:[safe summaries]}|{ok:false},mock:<safe getMockOverview DTO>}`. Preserve original unavailable flags. Current native aggregate loader does not yet preserve all independently streaming regions.
- Mocks: `{mock:<safe catalogue/owned attempts + unavailable flags>}`. Date hydration is explicit; original summary rules apply only to actually completed full mocks. No runner/grading invented.
- Listening focus hub: `{kind:'locked'}` or `{kind:'authored'}` or `{kind:'hub',test:{title,publicationState},meta:{parts,questions,min},cards:[{path,activity,name,tag,complete,latest}]}`. The server must derive activities from original registry/learner facts, not an invented fixed grid. `kind` must not be client-selectable without server gates.
- Pending: `{openRequest:<original safe request or null>}`. Never infer that registration created a request.

## Existing APIs reused, not rewritten

Auth login/register/reset/recovery, Telegram intent/status/cancel/exchange, theme/locale, onboarding/admission, auth state/changes/logout, search, notifications, support reports, vocabulary/folders and Listening authored/state/progress/resource/sandbox APIs remain the original backend's responsibility. Their discovered source handlers are in `source-inventory.json`. Browser fixtures are NOT implementation of those APIs.

Authored runtime HTML/media/vocabulary arrive only after original server authorization. Opaque iframe remains `sandbox="allow-scripts"` with original authored CSP/parent-token protocols. No allow-same-origin, public/private R2 URLs or original content is bundled. The original identity-keyed authored pending checkpoint storage is retained for recovery; general private view caches remain memory-only. Continue reviewing outbox/exit-flush/multi-tab behavior with the real backend before acceptance.
