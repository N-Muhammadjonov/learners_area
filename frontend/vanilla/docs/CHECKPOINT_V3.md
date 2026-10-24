# Vanilla frontend V3 — CHECKPOINT, status PARTIAL

2026-10-18. Continue V2; do not restart, merge, deploy or replace production.

## 1. Git and scope

- Required branch: `arena/96836bcf-learners-area` only.
- Original/main baseline: `9a7d9fc5a93608078644d61cd9f9850c05c4ddc8`.
- V1 checkpoint: `22560b7a17c9074e5ca18b1526537b239aa59716`.
- V2 checkpoint: `b22a0f4c56d3099d5e02739521c5c66d12f78196`.
- V3 implementation checkpoints: `6259ff18f5eb71186c41b7e209352c5b0f6f2343`, then `a4f72f8e558398e83d2ad268b1485d343eb0cb1e`.
- Delivery commit/ZIP checksum: see final response and `deliverables/*V3*` sidecar/validation. A document cannot contain its own final commit hash without recursion.
- All changes are inside `migration/vanilla-frontend/`. Original source, services, educational content, backend and production remain unchanged.

**FRONTEND CODE COMPLETE: NO.** Finishing all ordinary states of the existing 27 candidates was not achieved. This is an engineering checkpoint, not an externally blocked otherwise-complete migration.

## 2. Reconciliation / stable inventory

Reviewed the existing README, V2 checkpoint/ledger/contracts, handoff, limitations, functional/visual/security/performance reports; inspected native runtime/build/generators/tests/assets and targeted original account, dashboard, MCQ, shell, navigation, notification and report implementations. This does **not** claim an exhaustive source-state audit of all 115 pages or 206 components.

| Source-file population | Current stage |
|---|---|
| 115 page records | 107 canonical candidates + 1 conditional canonical/legacy + 6 redirect-only + 1 retired |
| Existing page implementations | 27 IN PROGRESS; 81 NOT STARTED; 6 redirect-only CODE COMPLETE; 1 RETIRED-N/A |
| Product pages accepted complete / full parity verified | 0 / 0 |
| 206 component source files | 50 IN PROGRESS, 156 NOT STARTED, 0 accepted complete |
| Other indexed files | 214 original API route files; 13 supplemental layout/loading/error boundaries |
| New V3 product-page implementations | 0 — priority remained the existing 27 |

Nine newly recorded component candidates are section navigation/heading, entry frame/outlet, code prewarm and retry/confirmation primitives; touching these does not complete them. Route records, conditional/query/dynamic classification and specific remaining work for each of the 27 candidates are in [ROUTE_LEDGER_V3.md](ROUTE_LEDGER_V3.md) and [route-ledger-v3.json](route-ledger-v3.json). V2 artifacts are retained unchanged as history. Explicit Grammar tabs remain real unfinished destinations, not default redirects; Shadowing stays retired.

## 3. Implemented V3 improvements

- Native source-derived login/register/reset/recovery forms: honest malformed/429/503/network failures, retained drafts, bootstrap retry, generic reset acknowledgement, query errors and safe return paths. Recovery now reuses the source LoginForm(recovery), independently of public provider bootstrap.
- Onboarding constraints/defaults and pending status-specific request/logout states; successful mutations invalidate session presentation before navigation/refresh. Fresh role/status changes clear prior private resources; locale updates document language.
- Confirmations: source presentation, modal focus/return, pending/double-submit protection, failures/retry, abort cleanup and stale close-event guard. Profile mouse focus handoff fixed using synchronous relatedTarget containment; actual two-tab pointer logout verified.
- Dashboard summary, open lessons and mocks read/render/retry independently. Safe nullable/unavailable semantics; no invented results. This is not full live streaming/performance acceptance.
- MCQ source Day/query semantics, empty UI, validated stage protocol, true A–E string multiselect with no artificial cap, server reveals/outcomes, cancellation and audio element retention across renders.
- Notification observer/serialized updates and DTO validation; source report/dialog lifecycle and error redaction. Removed an added duplicate sidebar reporter that overlapped original navigation; original floating utility retained. The Support product route is not thereby converted.
- Source pending entry frames keep the shell but hide/inert outgoing private content. Abort/stale chunk protection prevents delayed imports replacing later navigation. Frames are NOT ready content or completed routes.
- Code-only bounded intent/idle prewarm follows original source policy; no DTO/API/media/attempt/retention prefetch. SaveData/offline/2g/hidden/pre-aborted constraints, dedup and lifetime cleanup. Native imports cannot be physically canceled, but aborted work cannot trigger optional follow-up or commit.
- Per-history-entry main scroll capture/restoration, including repeated identical URLs; shell/sidebar remain separate scrolling lifetimes.
- Restored source Listening/Reading/Grammar catalogue layout wrappers, Listening section headings and real section navigation. Original links/labels/query preservation and arrow/Home/End focus-only keyboard semantics retained. No new linked destination is claimed complete.
- Legacy Telegram widget script/CSP errors show original unavailable UI; CSP was not weakened. Real Telegram integration remains unverified.

Runtime remains HTML/CSS/DOM/History/Fetch/ES modules only, with reviewed build-time extraction of pure source presentation/utilities. No React/Next/virtual DOM/hydration/hooks shim is shipped.

## 4. Module status and ordinary work still missing

| Module | Current reality / unfinished work |
|---|---|
| Entry/auth/accounts | Improved candidates; full source-state keyboard/focus/validation and live cookies/providers/recovery/approval still required. |
| Shell/navigation/shared UI | Persistent native candidate with tested transitions/scroll/dialogs; full component/all-interaction/layout parity audit unfinished. |
| Dashboard/mocks | Region behavior improved; full roadmap, all source states, source screenshots, owned summaries and real server projection acceptance missing. No invented mock runner. |
| Listening | Catalogue/hub/authored-host/MCQ subset. **Nine activities, all authored states, timers/notes/flags/autosave/resume/outbox, progressive streaming and every media transition are not code-complete.** |
| Reading | Catalogue/history/academic presentation subsets and section navigation. Lesson/test/attempt engines, five product workflows, filtering and retention incomplete. |
| Writing | Product/workflow/feedback/editor/submission interfaces not started. |
| Speaking | Hub/microphone UI subset only. Lesson/recording/upload/feedback/staff workflows incomplete; no real mic acceptance. |
| Vocabulary | Word popover subset retained. Product tabs, dictionaries/games/revision/retention workflows unfinished. |
| Grammar | Lessons candidate and source section navigation; real writing/speaking conditional tabs and lesson workflows unfinished. |
| Retention | Reading/listening/vocabulary and management engines unfinished; no time-sensitive data prewarm. |
| Owner/Admin/Teacher | Management/audit/content/material presentation subsets only. Complete forms/tables/filters/permissions/confirmations/transfer/support/content actions not implemented. |
| Profile/courses/video/progress/live classes/assignments/support | Mostly NOT STARTED; links or floating utilities do not complete these routes. |
| Notifications | Observer/mutation/retry subset improved; full source-state/focus/scroll and live delivery acceptance outstanding. |

These are missing frontend engineering, not merely missing backend adapters. A rendered source fragment, fixed skeleton or touched component is not completion. Full per-route dependency/state/handler/API audits must still precede expansion.

## 5. Verification

Source build PASS; **142/142 unit PASS**. The preserved 58 V2 units remain intact. Chromium 133 source validation: **27/27 original + 14/14 V2 + 49/49 V3 = 90/90 probes PASS**. Original/V2 test files are unchanged. Raw counts, TAP, outputs, fixtures and screenshots: `docs/evidence/v3/`.

V3 includes real pointer two-tab logout, auth failures and draft retry, pending transitions/fresh session, onboarding locale refresh, MCQ reveal/choose/empty/media identity, notification/report abort/serialization/privacy, localized error recovery, delayed source chunks, code-only idle warming, repeated-entry Back/Forward scroll, source catalogue nav and keyboard. Account and catalogue probes cover **390×844, 768×1024, 1440×900 × EN/UZ × day/night**. This is selected surface coverage, not every page/state at every configuration.

Screenshot inspection: the three UZ/night catalogue sizes were opened and inspected for layout, section title/navigation and containment. These are fixture screenshots, NOT comparisons against the original application. **Original baseline comparisons: 0. Live integration accepted: 0.** No full accessibility audit, Safari/WebKit, hardware microphone, real recording/upload/audio expiry or real role/backend acceptance.

Independent archive extraction/install/build/unit/browser validation is recorded **alongside** the ZIP in `deliverables/V3_VALIDATION.txt` and its logs, not fabricated inside an archive that must be finalized before those tests run. Do not treat the source counts above as independent archive proof without that external validation.

## 6. Adapters and security

See [ADAPTER_CONTRACTS_V3.md](ADAPTER_CONTRACTS_V3.md). `/api/frontend/public`, `/api/frontend/session` and `/api/frontend/view` remain **PROPOSED, NOT existing endpoints**. V3 extends the view interface with independently read dashboard regions. Original auth/state/events/Telegram/onboarding/admission/search/notifications/support/MCQ/authored/media APIs are reused by native consumers; their implementations were not changed. Original server source functions, ownership gates, safe projection requirements and remaining DTO/schema work are documented.

All API successes in browser tests are isolated synthetic fixtures. Real preview `/api/**` returns 503 `{error:"backend_not_connected"}`. No fake identity or production-capable fixture backend is shipped. Server remains authoritative for HttpOnly identity/status/role/permissions, ownership, revocation, grades/reveals and media. No credentials migrated to browser storage; private settled DTOs are not persisted. Existing authored recovery storage is a distinct source-derived checkpoint mechanism and still needs live privacy/lifecycle review.

Opaque authored iframe remains `sandbox="allow-scripts"`, never allow-same-origin. No private authored content, protected media, answer keys or public/private storage substitution is bundled. Source UI validation is not server authorization; nested schemas for many catalogue/staff projections are still incomplete.

## 7. Performance and development advisories

`evidence/v3/navigation-performance.json`: local Chromium, 1440×900 EN/day, warm modules, 30 synthetic catalogue rows, 15 switches at each controlled fixture latency; no original baseline or production benchmark.

| Added fixture latency | Pending-frame DOM median | Content DOM median | Content after frame opportunity median |
|---|---:|---:|---:|
| 0 ms | 1.0 ms | 42.8 ms | 456.7 ms |
| 50 ms | 0.8 ms | 82.1 ms | 478.3 ms |

rAF opportunities are not certified pixel/hardware paint; a pending-frame update is not content readiness. The perceived 1–100 ms target is **not demonstrated**. Real backend/media latency unmeasured. 0 observed long tasks in this sample; post-GC documents 1→1, nodes 697→668, listeners 71→71; used heap 2,544,024→2,707,656 bytes. Finite observations do not prove leak freedom. Rendering/frame scheduling, real devices and original baseline investigation remain necessary; no design/CSS-token changes were made to manufacture a speed claim.

Audit improved from 7 dev findings to **5 high, 0 moderate, 0 critical** by pinning selector-parser 7.1.6. Runtime-only npm audit is zero (no production npm dependencies). Old selector-parser 6.1.4 vs overridden build produced byte-identical current CSS, SHA256 `52e0badddc331ec6dac3fb45a7cca0208323d054a83bb80332439fdd608a7ff5`. Remaining dev-only glob/braces/Tailwind chain requires separate safe dependency work; npm's proposed major Tailwind upgrade was not forced. This is not a claim that the repository is vulnerability-free.

## 8. Package, handoff and metrics

Default package: `deliverables/LEARNERS_AREA_VANILLA_FRONTEND_CHECKPOINT_V3.zip` (never CODE_COMPLETE). Ordered/fixed-date/fixed-permission ZIP, file manifest and SHA256SUMS; excludes dependencies, builds, Git, environments and deliverables. Includes generated modules, original public assets/fonts, native source, tests and evidence. Historical PARTIAL and V2 archives are immutable and internally verified by `--legacy --verify` / `--v2 --verify`.

[GPT_WORK_HANDOFF.md](GPT_WORK_HANDOFF.md) starts with the V3 ready-to-paste inspection/repair/integration prompt and preserves previous history. Owner approval is mandatory before production replacement or backend/adapter integration.

| Checkpoint metric | Evidence-based result |
|---|---|
| Implementation percentage | **UNDETERMINED** — active canonical/product denominator and full state audits unconfirmed; 27 partial/115 indexed pages, 0 accepted; 50 partial/206 components, 0 accepted. |
| Functional/security percentage | **UNDETERMINED** — 142 unit and 90 browser subset probes pass, not all source interactions/roles/security acceptance. |
| Visual/integration percentage | **UNDETERMINED** — 0 genuine original comparisons and 0 live accepted routes. |

Production changes: **main NO; original site NO; backend/DB/Supabase NO; Railway NO; Cloudflare/Worker/R2/DNS NO; Telegram configuration NO; deployment/replacement NO.**
