# Academy Today and RIWI evidence boundary

This extends the existing native Management hub. It creates no replacement auth,
ledger, model gateway, Telegram sender or financial command surface.

## Operational reads

| Route | Authority | Source and interpretation |
|---|---|---|
| GET `/api/staff/academy/today` | owner/admin/teacher | Tashkent-day sessions, due admissions follow-ups and current debt count; teachers receive assigned classes and scoped parent-link counts only |
| GET `/api/staff/finance/debtors` | owner/admin | Current positive receivable, with posted reversals, allocations and credits; no forecast or historical-balance claim |

Today lists have ten-row pages and explicit totals. `classesOffset` and
`followupsOffset` are independently bounded. Counts open their actual list, and
individual rows link to the existing group/admissions detail. Debt search, current
membership branch filter, overdue filter and pagination execute on the server.
Withdrawn memberships cannot match a current-branch filter. An API failure never
creates a zero count. Refresh time and Tashkent business date are visible.

Teacher class links open the existing session API in a session-only native view.
Substitute teachers need not request a full group roster; existing server services
still check exact session and attendance authority. Attendance opens only for a held
class. Financial commands refresh the student statement, centre totals and any open
debtor queue. An older in-flight report cannot replace the confirmed collection.

The debtor query aggregates each financial table before joining. It avoids both
join multiplication and repeated per-student subqueries over 10,000 accounts.
Payment history similarly enriches an entire page with at most two queries.
`student_position` and the append-only journal remain the monetary authority.
The account position is now one SQL statement rather than six sequential reads.
Charges, credits, allocations, settled collections/refunds and overdue debt use
one PostgreSQL statement snapshot, so a concurrent settlement cannot split the
components across different READ COMMITTED snapshots. Charge-local allocation
and relief aggregates preserve the existing no-multiplication rule.

## Read/draft-only AI

| Route | Permitted action |
|---|---|
| POST `/api/staff/academy/assistant/proposals` | Owner/admin evidence brief; teacher assigned-class facts; assigned/authorized parent-message draft |
| POST `/api/finance/me/assistant` | Student's own deterministic payment facts |
| POST `/api/guardian/children/{child_id}/assistant` | Currently linked, active child's deterministic payment facts |

Typed tools are registered in the existing RIWI tool broker. Its live actor check,
capabilities, allowed roles, strict input/output validation and tool audit apply.
Guardian tools recheck and lock the actual link; neither a prompt nor a body role
can select another family. A promoted staff account or suspended learner cannot
remain eligible through an old student link. Teacher briefs omit monetary evidence. Parent drafts
require an assigned learner and a linked parent.

The optional model may only prioritize known evidence and role-permitted workflow IDs. Values, units, sources,
links, approval flags and draft text come from deterministic server services.
Unknown/duplicate evidence IDs, extra properties, timeouts and vendor errors fall
back to the complete local facts and guidance. Prioritization never drops the remaining
financial facts. Free-form questions, names, identity IDs,
source URLs and message text are not sent to this optional ranking provider.
No connection or guardian row lock is held while the model is awaited.

## Shared process context and deterministic automation

`riwi_workflows.py` supplies nine reviewed procedures to local RIWI, Academy
guidance and optional external providers. It records triggers, required inputs,
deterministic steps, review boundaries and outputs. The server selects roles and
live module/payment-method availability. Free-form Academy questions select a
known topic locally; an explicit `workflowId` remains pinned. Unknown topics are
shown as general guidance, not falsely answered questions. Guardian payment links
retain the currently authorized child.

The ordinary external tutor also receives a compact current process description
through the existing guarded instruction payload. This is runtime context, not
parameter training. The process version includes reviewed definitions and the
generated source catalogue. The catalogue now fingerprints the ledger, payment,
prepaid, workbench and workflow implementation as well as the frontend; the same
build generates and packages it. No credential or private record enters that
static description. Existing external rollout/verification gates remain unchanged.

Today additionally finds unmarked frozen rosters for held sessions within the
last seven Tashkent calendar days. It checks the current session-teacher link,
pages ten sessions at a time and distinguishes an expired correction window.
Unmarked never means absent. These reads work independently of RIWI/model flags.

GET `/api/staff/finance/balance-packets.zip` is an owner/admin-only private export
for at most twenty explicit student IDs, limited to six requests per identity per
minute. One repeatable-read, read-only snapshot supplies all account positions.
The pure renderer creates readable, safe per-student CSV filenames, combined CSV
and a SHA-256 manifest in deterministic ZIP metadata. It reports whole UZS,
current-position scope and no historical opening balance/fiscal claim. Unknown,
duplicate, oversized or non-student selections fail without a partial packet.
No model, financial posting, external send, scheduler or extra database table is
needed. The UI downloads only the accounts on the displayed debtor page and
removes the previous download link while refreshing or after an error.

The [video comparison](../verification/VIDEO_RIWI_AUTOMATION_20261117.md) records
timestamped lessons, preserved safeguards, implemented changes and remaining
integration/acceptance boundaries.

Owner/admin briefs also expose current active-group and available-seat counts,
open admissions and scheduled-trial counts. Available seats use the existing
capacity rule: active/paused memberships reserve a seat, pending memberships do
not; paused/closed groups contribute no available seats. These are current
operational counts, not conversion rates, future income or promises of enrollment.
Teacher briefs count only currently active student accounts assigned through the
live teacher/student link. All new evidence retains a source API and an existing
review page, with Uzbek and English labels. No learner names reach the ranker.

Every response retains the RIWI brand and `canExecute=false`. Applying a draft
only fills the existing composer and selects the reviewed parent. Its separate
recipient preview and explicit Send remain mandatory. There is no AI SQL,
payment, refund, payroll, contract or message-send executor.

`ACADEMY_ASSISTANT_ENABLED=1` enables this surface in a managed environment;
Academy and the existing global/per-role RIWI switches also apply. The guardian
kill switch is `RIWI_GUARDIAN_ENABLED`. Hourly identity limits are owner 120,
admin 100, teacher 60, student 30 and guardian 20. Disabling or exhausting AI
does not disable payments, calendar or classes.

Local deterministic operation has no model cost. External ranking additionally
requires the existing external-AI switches, configured gateway credentials/model,
`ACADEMY_AI_EXTERNAL_ENABLED=1` and `ACADEMY_AI_PROVIDER_VERIFIED=1`. It is off by
default. No external completion was purchased or provider selected in this task.
Internal usage records include configured provider/model, state, duration and
returned token counts. External cost stays unknown rather than an invented zero.

## Verification boundary

Security and deterministic facts are exercised on disposable PostgreSQL. Browser
evidence is generated by CI against the actual native app, with external browser
requests blocked. Synthetic Payme protocol credentials prove local behavior only.
See [the acceptance receipt](../verification/UX_BASELINE_AND_REDESIGN.md) and
[the canonical external actions](../SALE_READY_MANUAL_ACTIONS.md).
