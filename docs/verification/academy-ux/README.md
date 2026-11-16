# Real browser evidence

These are actual Chromium captures of the native website and FastAPI, backed by
disposable PostgreSQL 17 and synthetic identities. No production records, merchant
network, paid AI completion or real Telegram recipient was used.

Before: source `cd02246a`, CI run 43758406742. After and journey: source
`3792506e405446d72953ff537603091d2f58ff06`,
[green CI run 43802665538](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43802665538).
The later active-student check strengthens guardian AI denial without changing
these positive-flow UI sources.

| Role | Before, day/mobile | After, day/mobile | After, night/desktop |
|---|---|---|---|
| Owner | [Before](before/owner-day-390.png) | [After](after/owner-day-390.png) | [After](after/owner-night-1440.png) |
| Admin | [Before](before/admin-day-390.png) | [After](after/admin-day-390.png) | [After](after/admin-night-1440.png) |
| Teacher | [Before](before/teacher-day-390.png) | [After](after/teacher-day-390.png) | [After](after/teacher-night-1440.png) |
| Student | [Before](before/student-day-390.png) | [After](after/student-day-390.png) | [After](after/student-night-1440.png) |
| Guardian | [Before failure](before/guardian-day-390.png) | [After](after/guardian-day-390.png) | [After](after/guardian-night-1440.png) |

[Before receipt](before/receipt.json) · [After receipt](after/receipt.json) ·
[Journey receipt](journey/receipt.json) · [File hashes](artifact-manifest.json).
All 20 after captures returned 200 at the exact permitted route, with zero page
exceptions, horizontal document overflow or unlabelled form fields. This automated
check does not certify real novice comprehension or every WCAG criterion.

## Operational walkthroughs

| Evidence | Actual result |
|---|---|
| [Admin Today](journey/admin-today.png), [confirmed cash](journey/admin-cash-from-debt-queue.png) | Today → named debtor → 50000 cash confirmation. Statement and refreshed queue both show 462469 due |
| [Owner net collection](journey/owner-net-collection.png) | 937531 collected after refunds, 0 recognized service revenue; report scope and update time visible |
| [Guardian payment](journey/guardian-first-paid.png) | 150000 accepted only after authenticated callback; first child moves from 800000 to 650000 due |
| [Second child](journey/uz-500000-created.png), [keyboard guide](journey/guardian-help-keyboard.png) | 500000 against 300000 leaves 200000 advance; Enter moves the three-step guide |
| [Student custom payment](journey/student-custom-paid.png) | 137531 custom amount, persistent status/history, no fiscal receipt claim |
| [Teacher reviewed draft](journey/teacher-reviewed-draft.png) | Assigned parent only; explicit draft application fills the composer; no Send request occurred |
| [Owner mobile Today](journey/owner-today-mobile.png), [Admin](journey/admin-today-mobile.png), [Teacher](journey/teacher-today-mobile.png) | Current role-scoped counts and source links; no horizontal document overflow |

The callback is a synthetic protocol request to the actual server. Created orders
are labelled sandbox and never marked paid by the browser redirect. Duplicate
callbacks have one ledger effect. Two children remain isolated, and the actual
student revocation API immediately denies the former guardian's reads/writes.

The journey records conservative control budgets of 4 activations for the student
and 5 for the guardian, excluding text entry and counting provider/child selection
even if the default was already selected. Admin's ordinary Today/debtor/cash path
uses 4 activations, excluding amount entry. These are scripted control sequences,
not instrumented click telemetry or timed human studies.
Owner understanding and real novice acceptance are not inferred from selectors.

Native browser title normalization intentionally moves the first module heading
into the shared header. An intermediate test at `8506bfac` incorrectly waited for
the now-hidden source heading; it was fixed to await visible, successfully loaded
Today status. No failed check was skipped. The final complete journey passed.
