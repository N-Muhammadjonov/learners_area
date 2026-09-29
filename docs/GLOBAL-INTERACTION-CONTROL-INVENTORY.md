# Global interaction control inventory and audit

**Method:** static source inventory and bounded inspection, not a browser audit. Counts below are occurrences in `src/**/*.tsx` from this branch after the current implementation. They include generic/raw elements and do not prove that every runtime-rendered control is reachable or accessible.

## Control families

| Family | Current surface / source signals | Interaction/performance observations | Architecture decision / follow-up |
|---|---|---|---|
| Primary internal navigation | 103 `<Link>`/`<a>` occurrences; persistent `SidebarNav`, `Topbar`, dashboard cards, module cards, search result selection, item/detail links | Shell is already persistent. `LinkPending` delayed status alone was too late to be the first response. Several primary programmatic transitions used `router.push` after successful create/start. | Route intent is now acknowledged in the private workspace outlet; `InstantLink` retains Next routing/history. Primary programmatic routes use `navigate()`. No raw History API. Dynamic deep links and query strings are preserved. |
| Local view state | 126 button elements; tab-like selectors, menu open/close, disclosure/accordion, filters, paging, theme, game/answer controls | Existing React state changes are generally local; source counts do not prove every click gives feedback. New global active/touch CSS gives a frame-local cue. The new outlet does not replace local tabs/filters with server navigation. | Keep local state for view-only choices. Future tabs should expose `aria-selected`/`aria-pressed`; filter drafts must not be confused with server-applied results. |
| Forms and mutations | 20 `<form>` occurrences plus inline `fetch` action handlers in Reading, Listening, Speaking, Writing, Grammar, Video lessons, notifications, teacher/admin, etc. | Most inspected mutation paths already set local `pending`/`busy` before awaiting and preserve server responses; implementation varies and not all paths share one completion id/error component. | `useAsyncAction` and `AsyncActionButton` define the preferred contract. Adopt them incrementally; never set a success state before an authoritative response. Existing handlers remain unchanged unless needed for navigation response. |
| Destructive/security-sensitive actions | Admin role/status/publication, admissions, live-class status, material delete, account transfer, sign out | Server-side role/rank/ownership checks are authoritative. Role changes and account reactivation now require the shared confirmation dialog; suspension has a staged reason and explicit second action; admissions approve/reject require confirmation. Ownership transfer still requires the owner's password again. Destructive material deletion and exam submissions retain their existing native `confirm()` step. | `ConfirmAction` is available for future high-risk changes; logout now confirms and checks the server response. Do not infer authorization from a dialog or client role list. Full current-control confirmation audit remains externally/manual review. |
| Data-view/search | Global search dialog; notifications, reading filters, vocabulary search and paging, dashboard summaries | Search is debounced and aborts stale requests; it renders only API-authorized hits. `router.replace` query filters stay native URL state. Static scan shows dependent fetch chains in a few panels; they were not rewritten because they include multi-step mutation/read-model semantics. | Keep result state scoped to the component and discard stale requests. Use URL query for shareable filters. No cross-user/local-storage cache was added. |
| Timed/media workflows | Reading and Listening exams, timer/audio playback, Speaking recorder/uploads, Writing autosave/editor | Timers and in-progress answers are client view state; scoring/submission remains server-authoritative. Start-attempt controls acknowledge pending and navigate only after create response. | Do not optimistic-score, invent completion, or alter timer semantics in a performance-only pass. Measure response, usable result, and request completion separately in a real browser. |
| Public/auth controls | Login, register, reset, pending/admission, theme/locale, logout | Root Preview telemetry now captures public control response frames without values. Locale shows pending/error before awaiting persistence; logout uses confirmation, checks HTTP success, then routes. Existing server auth remains authoritative. | Keep diagnostics out of production. `useAsyncAction` can run outside the private provider; completion correlation is available where adopted. |

## Static counts and route/navigation audit

- `<button>`: 124 occurrences.
- `<Link>` or `<a>`: 103 occurrences.
- `router.push` / `router.replace`: 11 occurrences after this pass's targeted primary-navigation conversions.
- `onClick=`: 207 occurrences.
- `<form>`: 20 occurrences.
- `router.refresh()` call sites: 35 occurrences across 31 files. This is a source count, not a runtime waterfall count.
- Static search found no `next/dynamic` or runtime import-based component split (one type-only `import()` result). Next's route-segment chunks remain the active code-splitting mechanism. Heavy editor/audio code is route-local by import graph; no production bundle trace was available to assert actual transferred bytes.
- 27 source files include `Promise.all`; AppLayout already parallelizes locale and current-user reads. Independent page reads often run in parallel. Upload→create, attempt→navigate, mutation→server read-model refresh, and submit→result stages are dependent and remain serial.
- App segment now has one data-free loading boundary shared by its private route children. Error boundaries exist at the root and private segment. Individual nested routes do not each define a custom loading UI.

## `router.refresh()` inventory and decision

`router.refresh()` is not the first user response in these flows: local pending/error state or a confirmed server response occurs first. Removing refresh without a complete server-authoritative replacement could leave role, account, score, list, or aggregate projections stale. No blanket replacement was made. The notable calls are:

| Area | Call sites | Reason retained / optimization constraint |
|---|---|---|
| Auth/session/admission | `auth/LoginForm.tsx` (2), `RegisterForm.tsx`, `OnboardingForm.tsx`, `admission/AccessRequestForm.tsx`, `shell/ProfileMenu.tsx`, `shell/LogoutButton.tsx` | Session, accountStatus, admission decision, shell identity, or access state must be re-read. Logout now checks a successful server response first. |
| Language preference | `shell/LocaleSwitcher.tsx` | Rebuilds server-rendered dictionary after cookie persistence; a local language toggle without a matching dictionary would misrepresent state. |
| Administration | `admin/AdmissionQueue.tsx`, `NewExerciseForm.tsx`, `NewListeningQuestionForm.tsx`, `NewPromptForm.tsx`, `NewQuestionForm.tsx`, `PeopleTable.tsx` (2), `PublicationControl.tsx`, `RoleSelect.tsx` | Authoritative queue, permissions, roles/status, publication state, counts, or parent read models. Candidate for narrow cache/tag invalidation only after measuring and replacing all visible projections. |
| Assignments / teacher / coach | `coach/AssignmentBoard.tsx`, `coach/ManualTranscriptForm.tsx`, `teacher/NewAssignmentForm.tsx`, `teacher/TeacherFeedbackForm.tsx` | Feedback/evaluation/assignment rows and aggregates are server-derived. |
| Exams / attempts | `listening/ListeningExam.tsx`, `reading/ReadingExam.tsx` | Server submission/scoring result must not be synthesized optimistically. |
| Live classes / support | `live-classes/ClassStatusControls.tsx`, `NewLiveClassForm.tsx`, `support/ResolveReportButton.tsx` | Status, capacity, list, or resolved-report projection is server-owned. |
| Speaking | `speaking/EditMaterialForm.tsx`, `ManagedMaterialCard.tsx` (2), `NewMaterialForm.tsx`, `PracticeStudio.tsx` | Server material/attempt/history projections are refreshed after success. |
| Vocabulary and Writing | `vocabulary/VocabStudio.tsx` (2), `writing/Editor.tsx` | Server-derived counts/queues/grade/history projections; preserve existing attempt/content behavior in this scoped pass. |
| Ownership | `owner/OwnershipTransferForm.tsx` | High-risk authority transfer requires server re-read; never replace with client cache. |

The shell's route acknowledgement is independent of these read-model refreshes. A future reduction should be per-flow: measure the RSC cost, define the complete returned projection, preserve retries/errors, and test account/role isolation before removing a refresh.

## Accessibility, touch, and failure review

- Internal routes use native anchors through Next Link; keyboard/modifier/new-tab behavior is not reimplemented.
- Workspace navigation announces the destination and loading status politely, marks only the outlet busy, and has an explicit retry on prolonged unresolved navigation. Existing root/private error boundaries remain responsible for actual route errors.
- Shared `ConfirmAction` uses native `<dialog>.showModal()`, names title/description, moves focus to confirmation, disables action while pending, reports failure, handles Escape, and returns focus to its trigger.
- Global controls have active/touch-action feedback and reduced-motion handling. Root layout retains mobile viewport resizing, safe-area layout, and no pinch-zoom restriction; private shell retains mobile drawer and independently scrolling surfaces.
- Source inspection is not a substitute for keyboard-only, screen-reader, 320–390 px, coarse-pointer, contrast, zoom, or reduced-motion Preview checks.

## Explicitly unverified

No browser automation or authenticated Preview session was available. The required 15+ warmed primary-navigation chain, representative local-view/mutation/destructive action timings, p50/p95, mobile/touch pass, and account-switch/revocation exercise were **not run**. Do not use `node:test`, JSDOM, `performance.now()` inside tests, or CSS active-state timing as substitutes.
