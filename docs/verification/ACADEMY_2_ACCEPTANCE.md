# Academy OS 2.0 — executable acceptance map

Base `f22c06cbbbbbfa9335cba0066413fbcbe34d3db2`; development branch
`feature/academy-payments-ux-20261116`; [draft PR #202](https://github.com/N-Muhammadjonov/learners_area/pull/202).
This is an engineering receipt, not a live merchant or sale-readiness certificate.

## Reproduction

Backend commands below run from `services/backend`, with the existing isolated
PostgreSQL 17 fixture at `127.0.0.1:55439/coin_qa`. `CI=true` makes absence of that
fixture a failure. Each test creates and removes its own disposable database.

```bash
CI=true .venv/bin/python -m pytest -q tests/test_self_service_payments.py tests/test_academy_workbench.py tests/test_academy_assistant.py
CI=true .venv/bin/python -m pytest -q tests/test_academy_learning_journey.py tests/test_guardian_reply_routing.py
CI=true .venv/bin/python -m pytest -q -ra
```

From repository root:

```bash
npm test
npm run typecheck
PATH="$PWD/services/backend/.venv/bin:$PATH" npm run build
```

Real Chromium payment journeys run in `.github/workflows/ci.yml`, not JSDOM.
The task's local Chromium is blocked by the executor's Unix-socket restriction;
that restriction was not bypassed. CI screenshots include five roles, two widths
and both themes. Synthetic sandbox credentials never contact an external vendor.

## Required scenarios

`P` means `services/backend/tests/test_self_service_payments.py`; cases use their
exact `test_` + scenario name unless a different test is specified below.
`F` means `frontend/vanilla/tests/payments.test.mjs`.
The workbench/AI/history batch passed at `04cbadc6` in
[CI run 43800377560](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43800377560):
7,568 backend tests + 287 subtests, 1,826 frontend passes, security/migrations/recovery,
the 20-image matrix and expanded admin/owner/teacher payment journeys. Final scope,
date, account-refresh and assigned-session navigation polish has regression tests
passed at `3792506e` in [run 43802665538](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43802665538):
7,569 backend tests + 287 subtests and 1,829 frontend passes. All 20 role captures,
three payments, admin cash/owner net collection, teacher draft and three mobile
Today views passed. [Reviewed captures](academy-ux/README.md). The final two
guardian role/suspension negative cases bring the targeted suite to 55 passes.

| # | Scenario | Result | Executable evidence | Verification boundary |
|---:|---|---|---|---|
| 1 | guardian_linked_child_can_get_finance_summary | PASS — automated local/CI | P | Isolated PostgreSQL |
| 2 | guardian_unlinked_child_finance_forbidden | PASS — automated local/CI | P | Two families, server denial |
| 3 | guardian_can_pay_only_linked_child | PASS — automated local/CI | P | Exact child and payer |
| 4 | guardian_revoked_link_cannot_start_intent | PASS — automated local/CI | P | Reads and new writes denied |
| 5 | guardian_two_children_payment_uses_exact_beneficiary | PASS — automated local/CI | P + real browser journey | Original beneficiary survives child switching |
| 6 | teacher_cannot_view_student_full_statement_without_finance_scope | PASS — automated local/CI | P | Assigned teacher still has no full finance |
| 7 | student_can_enter_unrestricted_policy_valid_custom_amount | PASS — automated local/CI | P + browser 137531 | Whole UZS, custom amount |
| 8 | amount_zero_negative_float_boolean_overflow_rejected | PASS — automated local/CI | P, six inputs | No coercion |
| 9 | amount_below_provider_minimum_explained | PASS — automated local/CI | P | Backend configured bound |
| 10 | payment_intent_duplicate_submit_returns_one_intent | PASS — automated local/CI | P | Concurrent PostgreSQL requests |
| 11 | browser_redirect_does_not_mark_paid | PASS — automated local/CI | P + browser | No URL-driven settlement |
| 12 | provider_callback_signature_required | PASS — automated local/CI | P + Click signature test | Synthetic protocol authentication |
| 13 | provider_amount_currency_student_order_exact | PASS — automated local/CI | P + Uzum canonical-status test | Mismatched proof refuses posting |
| 14 | callback_replay_one_journal_effect | PASS — automated local/CI | P + 50-request HTTP burst | One independent journal effect |
| 15 | out_of_order_callback_does_not_reopen_cancelled_money | PASS — automated local/CI | P | Terminal state preserved |
| 16 | provider_timeout_status_pending_then_confirmed | PASS — automated local/CI | P | Unknown registration never re-registers or invents a URL |
| 17 | unconfirmed_refund_does_not_reduce_advance | PASS — automated local/CI | P | Approval moves no money |
| 18 | partial_refund_preserves_remaining_advance | PASS — automated local/CI | P | Settled-only effect |
| 19 | credit_note_reduces_payment_allocation_ceiling | PASS — automated local/CI | P | Credits are separate documents |
| 20 | overpayment_is_an_advance | PASS — automated local/CI | P + browser 500000 against 300000 | 200000 remains money on account |
| 21 | reconciliation_equals_independent_journal | PASS — automated local/CI | P | 500000 clearing debit = 300000 receivable + 200000 advance credits |
| 22 | business_date_boundary_tashkent_midnight | PASS — automated local/CI | P | UTC/Tashkent boundary |
| 23 | billing_mode_monthly_does_not_show_fabricated_days | PASS — automated local/CI | P | Frozen monthly policy version |
| 24 | prepaid_day_policy_keeps_exact_remainder | PASS — PostgreSQL and Chromium CI at `40fb974e` | `test_prepaid_services.py`, native payment/staff tests; [run 43839462354](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43839462354) | Arbitrary X UZS / N units; 26,500/1 yields 7 + 14,500; 200,000/7 preserves the exact seven-unit bundle |
| 25 | prepaid_lesson_policy_no_double_spend | PASS — isolated PostgreSQL | `test_held_lesson_deducts_once_attendance_edits_never_charge` | Held-session roster consumes once; replay and attendance edits do not charge again |
| 26 | payment_history_persists_after_refresh | PASS — automated local/CI | P + browser reload | Cash and provider history retained |
| 27 | fiscal_receipt_not_claimed_without_verified_fiscalization | PASS — automated local/CI | P + browser | Internal acknowledgement only |
| 28 | live_providers_disabled_without_credentials | PASS — automated local/CI | P | Sandbox flags cannot activate production |
| 29 | parent_reply_routes_back_to_exact_original_staff | PASS — automated local/CI | `test_guardian_reply_routing.py` + `test_classroom_writing_teacher_feedback_and_guardian_progress` | Includes retry, reply dedup and revoked-link denial |
| 30 | guardian_payment_access_does_not_expand_progress_permissions | PASS — automated local/CI | P + guardian auth suite | No staff, payroll or unrelated child access |
| 31 | finance_help_walkthrough_works_keyboard_mobile | PASS — automated local/CI | F + Chromium Enter-key guide | Actual mobile DOM, not human novice observation |
| 32 | owner_finance_terms_are_explained_without_accounting_jargon | PASS — automated local/CI | `academy-finance.test.mjs`, owner browser total, contextual glossary | Human comprehension not certified by a selector |
| 33 | day_night_theme_and_navigation_no_regression | PASS — automated local/CI | `browser-academy-ux.mjs`, `browser-motion-parity.mjs`, existing route suites | 20 role/theme/width captures |
| 34 | awaiting_external_AI_still_allows_payments_and_lessons | PASS — automated local/CI | `test_academy_assistant.py::test_awaiting_external_AI_still_allows_payments_and_lessons` and outage/kill/quota cases | An intentionally pending provider holds no DB lease and payment/calendar reads finish |
| 35 | 10000_student_read_load_meets_measured_defined_envelope | PASS at 25 short / 10 for two hours; FAIL at 50–2000 | `tests/load_validation/academy_payments_http.py` | Local 25-concurrent short envelope and hosted-CI 10-concurrent two-hour mixed envelope pass; higher levels miss objectives |

No failure was converted to a skip. The unchanged frontend skips belong to external
legacy fixtures. Cases 24–25 now include actual money posting and delivery on
PostgreSQL, beyond math-only tests. The configurable-tariff Chromium journey
passed in run 43839462354. Parent Connect's separate catalog consistency gate
failed at that source because the generated source hashes were stale; the
continuation regenerates the catalog rather than disabling the gate. Existing monthly
contracts remain usable and truthful. See [configurable service contracts](../architecture/PREPAID_SERVICE_CONTRACTS.md).

## Module acceptance

| Module | Implemented behavior | Evidence |
|---|---|---|
| Today / debt queue | Role-scoped actual counts, named accounts, current-branch/overdue filters, paging, source links, retry and refresh time | `test_academy_workbench.py`, `academy-workbench.test.mjs`, expanded browser journey |
| Finance / self-service | Task-first cash entry; immutable custom payment orders, history, acknowledgement, precise debt/advance, advanced accounting disclosure | P, `academy-finance.test.mjs`, browser journey |
| Groups / sessions / attendance | Existing roster, capacity/conflict/revision rules; group and attendance guides | `test_academy_groups.py`, `test_academy_sessions.py`, lifecycle suite |
| Admissions / enrollment | Existing lead → trial → assigned student/group, linked operational detail; native guide | `test_academy_leads.py`, lifecycle suite |
| Directory files | Existing preview/map/apply/export, no silent creation at preview; native guide | Existing directory import/export suites |
| Payroll | Existing source attendance, estimate/accrual/payout separation, maker/checker; three-step guide | Existing payroll suites, lifecycle suite |
| Capacity / learner support | Existing deterministic constraints and explainable evidence; native guides | Existing capacity/rescue suites and real rescue browser |
| Parent links / messaging | Existing exact-sender routing; RIWI draft requires explicit apply, preview and send | Guardian routing suites, AI tests, expanded browser |
| IELTS learning | Existing writing assignment, submit, official teacher feedback and guardian-safe progress retained | Expanded classroom/Writing lifecycle; full reading/listening/speaking/mocks regression |
| RIWI | Scoped typed evidence, local fallback, optional model only ranks IDs; no execute surface | `test_academy_assistant.py`, browser draft |

## 60–90 second guided demo

Use only the isolated CI fixture or an approved test centre. These numbers come
from service/browser assertions, not production sample records.

1. 0–15 s: admin opens Management → Today → Outstanding accounts. Choose QA
   Student, read the current balance, record an actually received 50000 cash amount
   and confirm. Show the refreshed statement and internal acknowledgement.
2. 15–30 s: owner opens Finance. Explain gross funds, settled refunds and net
   collection separately from delivered-service revenue. Advanced opens the journal
   and reconciliation without hiding the ordinary payment action.
3. 30–55 s: guardian chooses QA Student and reviews 150000. Created/redirect is
   pending until the authenticated callback. Switch to QA Younger: 500000 against
   300000 leaves exactly 200000 advance, without invented days.
4. 55–70 s: student enters custom 137531, confirms the beneficiary, refreshes and
   sees persistent status/history. Open the keyboard guide and explain fiscal vs
   internal acknowledgement.
5. 70–90 s: teacher opens an assigned parent, asks RIWI for a draft and explicitly
   applies it. Show that nothing was sent. Existing Preview → confirmed Send remains
   the only message action; replies return to that original staff sender.

Real novice comprehension, merchant acceptance and connected-system verification
are tracked only in [the canonical manual actions](../SALE_READY_MANUAL_ACTIONS.md).
The subsequent closure below adds broader operational facts, mixed exam/attendance writes,
independent worker/restart correctness and a real two-hour mixed soak. High-concurrency
staging capacity and broader AI workflows beyond the read/draft boundary remain unverified.
No sale-ready or production-SLA verdict is inferred from these engineering results.

## 2026-11-16 continuation

The owner/admin operational brief now includes active groups, free seats in those
groups, open admissions and scheduled trials. Teacher evidence includes only
currently assigned active students. PostgreSQL tests cover paused reservations,
pending memberships, closed leads, suspended/promoted accounts and immediate
teacher-link removal. Existing role and financial boundaries are unchanged.

`test_academy_mixed_reliability.py` combines five identical cash submissions,
twenty authenticated provider replays, repeated student/guardian/teacher reads,
unrelated-family denials and an external-model timeout. It verifies exactly two
payments, one provider event, 700000 remaining debt, an unchanged second child
and a balanced journal. This is a concurrent ASGI/real-PostgreSQL correctness
scenario, not a sustained HTTP load or 2-hour soak claim.

Local continuation environment: Python 3.12, disposable PostgreSQL 18.6, no
external provider/model traffic. Targeted payment/prepaid/workbench/AI suite:
74 passes; separate mixed scenario: 1 pass. Frontend full suite: 1833 passes,
11 pre-existing external-fixture skips, zero failures. TypeScript and native
build pass. Full CI for the continuation is recorded in PR #202.

The follow-up account-position change reduces six sequential SQL reads to one
statement snapshot. The real-PostgreSQL money regression command passed 159
tests, including the new snapshot/round-trip budget, credits, reversals, refunds,
provider concurrency, prepaid delivery and separate-child balances:

```bash
CI=true .venv/bin/python -m pytest -q tests/test_tuition_ledger.py tests/test_self_service_payments.py tests/test_prepaid_services.py tests/test_academy_workbench.py tests/test_academy_mixed_reliability.py tests/test_tuition_provider_http.py tests/test_tuition_refund_http.py
```

The initial local full run recorded 7587 passes, 287 subtests, one failure because
the minified build had not been generated yet, and three release-fixture setup
errors because `/usr/lib/postgresql/17/bin/pg_dump` was absent. The minified-build
case passed after building; no test was suppressed or changed to a skip. Native
PostgreSQL 17 recovery remains covered by the required full CI job.

## Merge verification — 2026-11-16

[PR #202](https://github.com/N-Muhammadjonov/learners_area/pull/202) was merged
as `763d7a02a18522d48a8ce48f7acd574ab9470ea7`. Verified source
`fada41c91be4f8c42633adbbe16a95c55d7e2733` passed
[full CI 43877008848](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43877008848):
7596 backend tests, 287 subtests, 1833 frontend passes and 11 unchanged external-fixture skips;
security, TypeScript, migrations, PostgreSQL 17 recovery, Rescue/Academy Chromium and motion parity.
Parent Connect and leaderboard checks also passed.

| Added scenario | Executable proof | Result |
|---|---|---|
| Forty concurrent examinees plus attendance and cash retries | `test_academy_mixed_reliability.py::test_mass_attendance_and_acknowledged_exam_drafts_survive_payment_retries` | Forty newest acknowledged drafts remain at revision 8 after stale writes; forty attendance rows; one cash effect; unrelated draft denied |
| Two independent HTTP workers and process restart | `test_academy_worker_isolation.py::test_two_worker_callback_cash_retry_and_immediate_link_revocation` | Twenty callbacks and six cash submissions create two payments; revocation applies on both workers and survives restart |
| Bounded measurements | `test_load_measurements.py` | Every rejection retained; conservative 1 ms histogram; overflow cannot pass a percentile objective |
| Two-hour mixed HTTP | `.github/workflows/academy-soak.yml` | 7200.11 s, 1034705 successful reads, no read errors, p95 115 ms, p99 133 ms; all defined read/write and money invariants pass |

[Soak run 43877008801](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43877008801)
used 10000 synthetic registered students, ten concurrent readers, one application
process, pool five, PostgreSQL 17.12 and Python 3.14.10. Its 238 pulses include
1190 cash retries, 2381 protocol callback requests, 238 model-outage fallbacks
and 238 cross-family denials. Periodic cash/provider effects are one each; the
second child's remaining debt is exactly 461469 and the journal balances. The
final separate 50-callback burst adds one effect for a second intent, hence two
provider journal entries in the final global total.

[Raw receipt](academy-ux/soak-two-hours.json) retains source hashes, clean-tree
identity, environment and endpoint distributions. It proves this hosted-CI
envelope only. Production throughput, vendor sandbox/live acceptance and human
novice usability remain separate. New payment/prepaid production migrations and
activation were not performed by this merge. Rollback remains feature disablement
and additive repair, preserving paid history. Owner-dependent actions remain
only in [the canonical manual actions](../SALE_READY_MANUAL_ACTIONS.md).
