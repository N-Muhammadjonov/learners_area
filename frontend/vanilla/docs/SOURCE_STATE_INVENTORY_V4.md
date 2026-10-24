# V4 source-state and dependency closure

## Completed bounded module: password recovery/reset frontend

This is a **three-route functional module**, not completion of public account/provider onboarding, the shell, Phase 1, or the application. No new canonical route was started. CODE COMPLETE here closes ordinary frontend engineering in these three source workflows; server mail delivery, real cookie/token enforcement and original-rendered visual acceptance are separate unaccepted gates. A disconnected adapter does not excuse a missing consumer: the public projection consumer/loading/retry exists.

| Route | Original page / frontend dependencies read | Native implementation |
|---|---|---|
| `/auth/recovery` | `src/app/auth/recovery/page.tsx`; `auth/LoginForm.tsx` recovery branch; `auth/AuthShell.tsx`; Input, Button, brand, theme/locale controls; safe-redirect and client-request helpers | `modules/auth/recovery.js`, stable password-form, reviewed LoginForm renderer, native AuthShell/controls |
| `/reset-password` | `src/app/reset-password/page.tsx`; `auth/ResetRequestForm.tsx`; same shell/controls/request helpers; public-auth-policy | public policy consumer, stable ResetRequestForm + source done expression |
| `/reset-password/confirm` | `src/app/reset-password/confirm/page.tsx`; `auth/ResetConfirmForm.tsx`; same shared dependencies; token query and router | public policy consumer; stable token/password form; exact local navigation |

Component paths in this table abbreviate `src/components/`. Server dependencies inspected read-only: `src/app/api/auth/{recovery/login,reset/request,reset/confirm}/route.ts`, `src/lib/auth/password-sign-in.ts`, public-auth-policy, account-status and safe-redirect. Existing APIs are NOT replaced. Authoritative role/status, reset eligibility, mail, single-use token expiry/consumption, sessions and cookies remain server responsibilities.

### All ordinary source-state consumers for this bounded module

| ID | Source state/interaction | Native closure / executable evidence |
|---|---|---|
| P01 | Recovery always available independently of public password/provider policy | Recovery source LoginForm only; no public-policy fetch, Google/Telegram or forgot/register links. V3 recovery query test; V4 12 administrator recovery matrix journeys |
| P02 | Email/password required; reset confirmation password minlength 8; missing token disables submit | Native browser constraint validation before POST; original labels/autocomplete/geometry; original foundation + V3 deep/reload and 12 V4 reset journeys test invalid email/short password and missing-token state |
| P03 | Reset pages disabled by server public password flag | Native acknowledged public-policy projection; both routes redirect with replace to `/login`; V4 policy test |
| P04 | Initial policy loading, transport error, retry, late response after navigation | Localized AuthShell stays mounted with controls; source title; bounded loading and retry region. V4 bootstrap loading/retry/navigation-abort test; source auth runtime and unit abort probes |
| P05 | Recovery/confirm query strings, OAuth query error where source has it, fragments, deep link and reload | Original source mappings and safe next; router preserves URL semantics. Historical account matrix + recovery direct/reload + V4 recovery matrix |
| P06 | Pending submission, duplicate prevention, acknowledgement, malformed success | Stable field/provider nodes; pending button and aria-busy; acknowledgement checked before success. account-v4 tests; V4 delayed acknowledgement and malformed login probes; confirmation adversarial browser journey |
| P07 | Field value/focus/selection after failure and retry | Errors inserted beside existing inputs, not whole-form remount. Unit identity/caret probes; browser invalid-token then malformed-confirmation acknowledgement retains focused input/caret and retries to login |
| P08 | Known invalid credentials/token, unavailable reset; network/parse/429/5xx | Localized safe semantic errors, no raw driver/body/error echo. Source request-error and account-v4 unit suites; foundation unavailable; V4 recovery first401→retry, reset first503→retry, confirmation first400→malformed200→ack |
| P09 | Reset request generic done only after `{ok:true}`; optional development link | Source done renderer; no fake mail-delivery assertion. Only same-origin `/reset-password/confirm` with nonempty token is linked; arbitrary API/internal/external/JavaScript URLs ignored. V3 unsafe-link and V4 full reset journeys; resetDevUrl unit validation |
| P10 | Confirm acknowledgement → login → authoritative session destination; recovery safe deep target | Exact existing endpoints/bodies; cache invalidated; safeNext preserved. V4 12 reset→login→dashboard and 12 recovery→safe deep-target journeys |
| P11 | Theme/locale persistence and keyboard; refresh while request pending | Existing persistence reverts on failure; locale waits for mutation settlement or abort, never replays it. Ephemeral drafts survive only preference refresh; errors re-localize. Historical controls matrix; V4 acknowledgement/race and draft tests |
| P12 | Real navigation/logout/abort cleanup and stale reply | Route lifetime abort; outgoing credential fields wiped on real navigation; no storage/history/URL insertion of input passwords; stale response cannot navigate. Source/router/account unit and V4 route/deferred-response probes |
| P13 | Responsive/browser source UI variants | Source fields/classes/brand/fonts retained. Real Chromium 1440×900, 768×1024, 390×844 × EN/UZ × day/night recovery and reset journeys. These are native fixture renderings, NOT comparisons against original rendered source |

Functional gates: 181 unit and 162 total Chromium fixture probes for the whole candidate (not 343 independent product states). The scoped evidence above does not imply every source branch has a separate test or that browser fixtures enforce backend authorization. Live mail/provider/cookie/security, Safari, actual hardware and original-rendered visual acceptance remain NOT VERIFIED.

## Additional account work — intentionally NOT whole-module closure

Original Login/Register/TelegramIntentLogin/TelegramButton, onboarding and pending sources and endpoints were read and their native consumers repaired: stable password/name/gender draft, localized gender validation, acknowledgement-only onboarding/admission, all four account statuses, nonce-bound intent cancellation/deadline/exchange, source link retention after expiry, pending-create cancellation, route teardown and safe diagnostics. Registration→pending/admission→logout has a 12-case matrix; Telegram outcome tests cover login/register/link destinations and aborted creation. These changes do not promote `/login`, `/register`, `/onboarding`, `/pending`, or the entire Phase 1. Remaining exhaustive source-state/shared-control/visual/live audit is recorded rather than counted complete.

Telegram database enum was explicitly read in `src/db/schema.ts`: `pending`, `confirmed`, `consumed`, `expired`, `cancelled`. The native poller does not invent approval: only `confirmed` triggers exchange; `consumed`/other unresolved states never grant a session and remain bounded by the five-minute source deadline. Status endpoint errors retry within that bound. Cancellation is client teardown first, then best-effort server cancel with safe failure feedback; it never claims server revocation on transport failure. Expired source deep links remain visible, without continuing polling.

## Six completed source-file components

- LoginForm (both ordinary/recovery rendering and native state handlers), ResetRequestForm, ResetConfirmForm: original source expressions, stable field state, exact validation/navigation/acknowledgement/error lifetimes above. The surrounding ordinary login/provider module still needs its exhaustive integration audit.
- Breadcrumbs and ModuleContextHeading: original pure `breadcrumbsFor`/`parentFor`, source heading/module matching, Management parent links, source top-level no-parent/null behavior and nonmodule crumbs. Build-time reviewed transpilation only; no hooks/framework/virtual DOM at runtime. `shell-v4.test.mjs` verifies Management and nonmodule behavior.
- GlobalSearch: original shortcut, hint, three skeleton rows, empty/no-results hint, safe result label/context/target, error, debounce, clear/close/outside click, Ctrl/Cmd-K/Escape/arrows/Enter, mouse active option, stable result nodes, stale request suppression, abort/resize cleanup. Six shell unit probes and twelve full responsive/localized/themed browser journeys. Malformed DTO is an error, not fake empty success. Modal Ctrl-K cannot open a behind-modal search.

Measured source-derived native mobile search bug: input x = −57.5px, width331.5 at390 viewport. Fixed by clamping the existing 85vw/420px floating field/panel to viewport bounds (8px existing gap token), retaining source size/classes/colors. Browser matrix asserts actual bounds. Focus restoration is guarded against immediately reopening the popup. Source header/brand/avatar/drawer improvements remain scoped changes, not full Topbar/MobileNav/ProfileMenu acceptance. An obsolete photo's error cannot replace a newer avatar; drawer crossing768px closes and releases locks.

## Phase order / ordinary work still open

1. Finish comprehensive landing/account/provider/onboarding/pending + all shell/utility/notification/profile/diagnostic/focus/scroll transitions before claiming Phase1 complete. Landing now has server-derived anchor destinations, correct CTA push versus intro replace, one-shot ended and teardown; nine fixture destination/history journeys cover guest/active/pending on three viewports. Original rendered intro/device comparison is absent.
2. Then finish Dashboard/reporting/mocks and complete navigation/history/reload source audits.
3. Then Listening nine Test1 engines, authored content/media/timers/notes/flags/autosave/resume/review/authoring/import; Reading; Writing; Speaking without retired Shadowing; actual Vocabulary/Grammar tabs; Retention/MCQ; ALL Owner/Admin/Teacher actions; remaining routes/components.

No later module was started to inflate progress. The 81 untouched candidates and 154 not-started components are ordinary frontend work, not externally blocked completed work.
