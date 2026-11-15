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
| CI real Chromium | 5 roles × 2 themes × 2 widths | PENDING; executable test and screenshot artifact step added |

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

## Gates

| Gate | State | Evidence still required |
|---|---|---|
| A — truth/security | IN_PROGRESS | Persona screenshots; linked/unlinked/revoked guardian negative tests |
| B — payment engine | NOT_STARTED | Durable intents, provider protocols and isolated PostgreSQL settlement proof |
| C — beginner UX | NOT_STARTED | Self-service screen, staff task hierarchy, role tutorials and real browser tasks |
| D — continuity | NOT_STARTED | Full academy lifecycle with preserved parent-thread isolation |
| E — AI/reliability | NOT_STARTED | Read/draft-only typed tools, policy, outages and measured load |
| F — delivery | NOT_STARTED | Reviewed PR and full acceptance evidence; no merge/deploy without approval |

External/owner work remains exclusively in `docs/SALE_READY_MANUAL_ACTIONS.md`.
