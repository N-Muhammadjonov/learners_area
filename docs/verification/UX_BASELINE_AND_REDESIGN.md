# Academy OS 2.0 — UX baseline and implementation receipt

## Source of truth

- Base: `f22c06cbbbbbfa9335cba0066413fbcbe34d3db2`, fetched 2026-11-16.
- Task branch: `feature/academy-payments-ux-20261116`.
- Open PR search returned no open PRs at task start. PR #189 is already merged.
- Academy 1115–1131 and the private-function hardening are installed in production;
  the preceding release receipt remains authoritative for that installation.
- This task changes the development branch only. Production migration/activation,
  financial transactions, merges, secrets and deployments require a new approval.
- Only the master specification was attached. Referenced research DOCX and the
  original screenshot are not present in the task inputs. The design will use the
  described functional requirements and original Learners Area components.

## Baseline evidence

| Scope | Environment | Result |
|---|---|---|
| Backend | Python 3.12, native isolated PostgreSQL 17 | 7,516 passed + 287 subtests; 0 fail/skip/xfail; 177.43 s |
| Frontend | Node 24, existing native/JSDOM suite | 1,816 passed; 0 fail; 11 existing external legacy-fixture skips |
| Local real Chromium | Existing Playwright and `/usr/bin/chromium` | BLOCKED: process singleton cannot create Unix socket under executor policy |
| CI real Chromium | 5 roles × 2 themes × 2 widths | 20 baseline PNGs + receipt saved; run 43758406742, source cd02246a |

The Chromium failure is retained as an environment limitation. No passing screenshot
result or usability metric is inferred from unit tests. CI uses the same real
FastAPI server, native database migrations and synthetic fixtures, with external
network requests blocked in the browser. No production data or auth cookie is
written to the screenshot receipt.

## Current screen and service map

| Surface | Source | Observed issue / preserved control |
|---|---|---|
| Staff finance | `frontend/vanilla/modules/staff-final30/academy-finance.js` | Summary, reconciliation, aging, journal export, cash close, lookup and payroll share one long screen; everyday action has no clear priority |
| Financial documents | `frontend/vanilla/modules/staff-final30/finance-documents.js` | Existing approvals and immutable documents must remain available behind progressive disclosure |
| Guardian navigation | `frontend/vanilla/modules/shell/dock.js` | Only Progress and Leaderboard; no payment entry |
| Guardian authority | `services/backend/app/guardian_port.py` | Every child is resolved through a current linked guardian record; preserve this server-side boundary |
| Tuition HTTP | `services/backend/app/tuition_port.py` | Student has amount summary only; guardian deliberately excluded from full staff finance |
| Money truth | `services/backend/app/tuition_ledger.py` | Integer UZS, posted credits deducted before allocation, settled-only refunds, partial-refund state, Tashkent dates and append-only journal already present |
| Provider callback | `services/backend/app/payments_sandbox.py` | Existing HMAC sandbox is not Click, Payme or Uzum verification |
| Native routing | `frontend/vanilla/js/routes.js` | Staff finance exists; self-service payment routes do not yet exist |
| Operational modules | `frontend/vanilla/modules/staff-final30/academy-*.js` | Preserve groups, sessions, attendance, leads, directory, payroll, rescue and capacity services while adding contextual guidance |

## Beginner tasks and measures

| Task | Source-level baseline | Acceptance target |
|---|---|---|
| Admin takes cash | Search input → search button → student choice → open → payment form → confirmation → save | Student context and one primary cash action; measured 3–5 deliberate clicks |
| Admin finds debtor | Aggregate debt without a direct debtor list | A linked filtered debt queue with balance and next action |
| Owner reads collection | Multiple accounting totals without an initial task hierarchy | Gross collection, settled refunds and net collection explained separately |
| Teacher contacts parent | Existing guardian screen and exact-staff reply routing | Preserve routing and make the selected child/thread clear |
| Student/guardian pays | No self-service payment screen or linked-child intent flow | Custom amount, beneficiary review, available-provider truth and durable pending status |

Click counts above describe controls found in source, not timed novice observations.
Actual browser paths and before/after screenshots will be recorded with their tested
commit. The screenshot matrix uses 1440×900 and 390×844, day and night.

## Permission and migration contract

- Student: own summary, paged history, create intent and own intent status.
- Guardian: the same four operations only for a currently linked, active child.
  Revocation removes reads and new writes immediately. An already accepted provider
  settlement remains bound to its original immutable beneficiary and is audited.
- Teacher: existing amount-free student tuition status and assigned academic work;
  no full statements, arbitrary payments, refunds or payroll authority.
- Owner/admin: retain current finance roles and maker-checker rules. Browser redirects
  never settle money. Callback authentication is provider-specific.
- Additive schema only; no inferred entitlement backfill and no production sample data.
  Existing integer `amountMinor` values mean whole UZS in this application. Provider
  tiyin conversion must multiply/divide exactly at the adapter boundary, never float.
- Existing monthly tuition remains the default. Days/lessons are shown only with an
  explicitly versioned configured policy; unavailable methods stay disabled.

## Observed baseline browser failures

The baseline is an observation, not acceptance of broken behavior. All 20 captures
are under [academy-ux/before](academy-ux/before/receipt.json), generated by real
Chromium against isolated PostgreSQL/FastAPI. Owner/admin/student returned 200.
Teachers were redirected from the authorized guardian page to Management in all four
combinations. Guardian hard reload returned 503 in all four combinations. No horizontal
overflow, unlabelled fields or page exceptions were observed in the captured states.

Both permission/navigation causes are addressed by the implementation. CI now captures
the same matrix with the new payments route and requires successful document responses.
The initial after matrix passed at 1e0bfa7d (run 43761482136). Visual review found raw
module naming and root-ICU Uzbek date formatting; both were corrected. Published
`072a647d` passed the complete matrix and three real payment journeys in
[run 43795214244](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43795214244).
All 20 document responses and exact routes passed, without page errors, horizontal
overflow or unlabelled fields. The Today/admin/teacher-draft extension also passed
at `04cbadc6` in [run 43800377560](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43800377560).
Review of its cash screenshot exposed a refresh timing gap; final polish now refreshes
the statement, centre summary and open debt queue after a financial command.

[Owner mobile before](academy-ux/before/owner-day-390.png) ·
[Guardian failure before](academy-ux/before/guardian-day-390.png) ·
[Before/after and 13 journey captures](academy-ux/README.md).

## Implemented development slice

- Durable immutable student/guardian orders, live-link locking, vendor proof validation,
  append-only events and existing ledger/outbox settlement.
- Exact custom whole-UZS amounts, older cash history, paging/filtering, pending recovery,
  separate internal/fiscal acknowledgements and fail-closed provider capabilities.
- Native bilingual payments page, child picker, review before checkout, bounded polling,
  server-authoritative status, FAQ and an accessible three-step guide.
- Staff finance now prioritizes received-payment entry and debt lookup. Journal, cash
  close and payroll are grouped under Advanced. Contextual guides also cover groups,
  leads, directory, capacity, learner support and guardian messages.
- Source contract checks still preserve every historic route and migration hash. New
  routes and the additive migration have explicit reviewed inventory entries.

The current extension adds actual Today priorities, a named server-paged debt queue,
net-collection presentation and optional RIWI typed facts/parent drafts. It also adds
attendance/payroll guides, bounded history enrichment and child-specific AI panel
rebinding. See [the control-plane boundary](../architecture/ACADEMY_WORKBENCH_AND_RIWI.md).

Latest isolated targeted evidence: 55 backend payment/workbench/AI tests passed.
The complete backend passed 7,568 tests + 287 subtests, with no failures/skips/xfails
(local 150.00 s, then CI green at `04cbadc6`). Frontend CI passed 1,826 tests with 11
unchanged legacy fixture skips. TypeScript and the native Python/venv build passed
(1,037 assets, 145 routes). Final polish adds explicit report scope/refresh time,
uniform academy dates, stale-response protection and a session-only teacher entry
that does not request an unauthorized full group roster. All of that passed at
`3792506e` in [CI run 43802665538](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43802665538):
7,569 backend tests + 287 subtests, 1,829 frontend passes, 20 role captures and the
expanded three payments/admin/owner/teacher journey plus three mobile Today views.
The final guardian role/suspension parity adds two targeted negative tests.

The final 10,000-student actual HTTP confirmation passes the quiet local read envelope
at 25 concurrent requests over 30 seconds: mixed p95 184.72 ms, 7,054 successes,
no errors; every endpoint p95 below 300 ms. Higher levels miss objectives, and a
separate run overlapping other QA missed the guardian endpoint objective. All
observations are retained. Fifty duplicate authenticated
callbacks produced exactly one journal effect and a balanced journal. This is not a
production SLA. [Final confirmation](academy-ux/load-confirmation.json) and
[measurement limits](ACADEMY_2_CAPACITY.md).

## Gates

| Gate | State | Evidence still required |
|---|---|---|
| A — truth/security | LOCALLY_TESTED | Current source, role screenshots, immutable migration and current-link negative tests are recorded |
| B — payment engine | LOCALLY_TESTED / PARTIAL | Monthly invoice math and all three protocols tested; configurable prepaid modes now have real PostgreSQL posting/refund/delivery evidence; new browser CI pending; vendor acceptance remains external |
| C — beginner UX | LOCALLY_TESTED / PARTIAL | Five-role screenshot matrix and payment/admin/teacher browser flows pass; real novice acceptance is separate |
| D — continuity | LOCALLY_TESTED | The lead→class→Writing→parent→payroll journey also exercises parent portal payment and exact Today teacher scope |
| E — AI/reliability | PARTIAL | Typed read/draft tools, injection/outage/kill/quota tests and measured load; high concurrency, mixed write/outage scenarios and long soak remain engineering gates |
| F — delivery | DRAFT | PR #202, reviewed screenshots, full green code CI, migration/forward-fix documents and explicit acceptance gaps; no merge/deploy performed |

The [35-scenario acceptance map](ACADEMY_2_ACCEPTANCE.md) distinguishes implemented
proofs from missing work. No all-gates-complete or sale-ready claim is made.

External/owner work remains exclusively in `docs/SALE_READY_MANUAL_ACTIONS.md`.
