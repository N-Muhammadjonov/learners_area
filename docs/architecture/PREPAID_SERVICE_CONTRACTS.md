# Configurable service tariffs

Every service contract stores its chosen `price_amount_minor` (X whole UZS) and
`price_units` (N eligible days or lessons) independently. There is no fixed
200,000/7 default and no monthly-price/30 conversion. The form starts with both
fields empty. The user may enter any supported positive whole UZS amount and
unit count, subject to the explicit cash and 3,660-unit bounds. Each unit must
cost at least one UZS. These bounds are validated by the API and database.

An administrator drafts terms for a selected student and course. A different
owner approves them using the existing contract approval, then staff activates
the contract. Approved amounts, unit ratios, eligibility and dates are immutable.
New pricing uses a new dated contract; active contracts for the same student and
course cannot overlap. Existing monthly contracts retain their behavior.

## Exact conversion

For total consumed units `k`, cumulative cost is `ceil(k * X / N)`. The next
unit costs the difference between consecutive cumulative costs. Integer arithmetic
is used throughout; the browser uses BigInt for its estimate. Therefore any N
consecutive units sum to exactly X, including a non-divisible tariff. Examples
exist only in tests:

| Configured tariff | Confirmed payment | Result before consumption |
|---|---:|---|
| 26,500 UZS / 1 unit | 200,000 UZS | 7 units and 14,500 UZS residual |
| 200,000 UZS / 7 units | 200,000 UZS | 7 units, no residual |
| 350,000 UZS / 12 units | 350,000 UZS | 12 units, no residual |
| 137,531 UZS / 19 units | 137,531 UZS | 19 units, no residual |

Residual money is retained without expiry. Weekdays, excluded dates, approved
pauses, start/end dates and already consumed dates determine calendar coverage;
month length is never approximated. Cash that cannot cover eligible future dates
remains money. The screen separates service cash, residual, service debt and
remaining units, and labels its pre-confirmation calculation as an estimate.

## Money and delivery

The existing student/linked-child intent accepts an optional immutable
`servicePolicyId`. Its quote version binds to that exact policy. Verified provider
settlement and staff-recorded cash fund only the selected service contract's
posted obligations; funds cannot silently pay unrelated monthly debt. A pending
intent grants no units. Provider replay posts one journal effect and one immutable
service event. The generic monthly account remains a separate explicit choice.

A calendar day is consumed only after completion, through an authorized command
or the bounded calendar runner. A lesson is consumed only by the existing
held-session transition, against its frozen eligible student roster. Attendance
edits cannot consume again. Each delivered service reference has one derived
invoice, consumption record and balanced advance application. Unfunded delivery
remains an explicit receivable. Corrections to delivered charges use credit notes;
they do not rewrite delivered-unit history.

Refund request/approval reserves cash against spending but does not remove paid
money or units. Only settlement reduces the wallet and journal. Reserved money
cannot simultaneously fund a delivered unit. Student-scoped transaction locks
serialize funding, delivery and refund settlement; immutable reference constraints
provide additional duplicate protection.

## Isolated migration and calendar runner

`20261116081748_academy_prepaid_service_policies.sql` was created with the migration
CLI and is owned by the native migration chain. It adds four private RLS tables,
nullable bindings to existing tables and triggers. It changes no historical money
or historical migration bytes. Direct public/API-role access is revoked.
`migrate_prepaid_services.py` has its own private checksum journal and an atomic,
idempotent upgrade. Tests cover failed-upgrade rollback and preservation of
existing money. The exact-target application mechanism matches the prior runner.

`PREPAID_BILLING_ENABLED=1` permits new terms/purchases; default is disabled. Reads
and completion/refund processing of existing bound funds continue when disabled.
The schema and module were activated in the
[2026-11-17 guarded production release](../verification/PAYMENTS_PRODUCTION_RELEASE_20261117.md).
No calendar scheduler or production sample policy was provisioned.

The calendar command `prepaid_calendar.py` inspects one policy and at most 31
completed dates per invocation. It defaults to read-only. Its actor must be an
active owner/admin; application requires the exact inspected target. Repeated
dates return existing consumption and do not create more invoices. The cash and
accounting period remain today's open period while the original service date is
retained separately. Scheduling is deliberately separate from importing the app.

Rollback disables new purchases and scheduling while retaining money and service
history. Repair is additive; paid history must never be dropped. External release,
commercial-policy and merchant decisions remain in the
[canonical actions](../SALE_READY_MANUAL_ACTIONS.md).

## Verification

`services/backend/tests/test_prepaid_services.py` runs configurable ratios, actual
provider settlement/replay, monthly isolation, day delivery, held-session duplicate
and attendance edits, refund reservation/settlement, pauses, permissions, immutable
terms, calendar boundaries, bounded worker and atomic migration on PostgreSQL 17.
The frontend payment and staff package tests exercise the real native modules.
`browser-prepaid-journey.mjs` is wired into the isolated real Chromium CI journey;
its receipt is separate from external provider acceptance. Current verification
status is recorded in [the acceptance map](../verification/ACADEMY_2_ACCEPTANCE.md).
