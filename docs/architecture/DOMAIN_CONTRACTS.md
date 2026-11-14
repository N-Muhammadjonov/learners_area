# Domain contracts — tuition finance

**Migration:** `services/backend/migrations/1115_tuition_finance.sql`
**Commands:** `services/backend/app/tuition_ledger.py` · **HTTP:** `services/backend/app/tuition_port.py`

> **Uzbek qisqacha:** Bu hujjat pul hisobining qat'iy qoidalarini yozadi: pul `bigint` da
> (UZS uchun 1 so'm = 1 birlik), jurnal faqat qo'shiladi (o'chirib bo'lmaydi), har bir
> tranzaksiya balanslashgan bo'lishi shart, va bitta provider tasdiqlashi faqat bitta
> to'lov yaratadi. Quyidagi A–D misollar test faylida haqiqiy PostgreSQL'da bajariladi.

## 1. Money representation

* Every total is `bigint` in the currency's **smallest unit** (`amount_minor`), `currency_code='UZS'`.
* For UZS the smallest unit in circulation is 1 som, so `800000` = **800,000 UZS**.
* Floats are rejected at the boundary: `_minor()` raises `amount_must_be_integer_minor_units`
  (proven by `test_floats_are_rejected_for_money`).
* If a provider ever uses a different smallest unit, the conversion belongs in that provider's
  versioned adapter — never in the ledger.

## 2. State machines

| Document | States | Rule |
|---|---|---|
| Tuition contract | `draft → approved → active → completed \| cancelled` | approval is an explicit command; a new price is a NEW contract version (`supersedes_contract_id`), never an edit of a signed obligation |
| Discount | one approved document per `(contract, period)` | `UNIQUE (contract_id, period_key)`; a second attempt raises `discount_already_approved_for_period` |
| Charge | `draft → approved → posted → reversed \| credited` | posting writes the journal; reversal is a NEW negative document, the original keeps its amounts and is marked `reversed` |
| Payment | `initiated → pending_provider → confirmed \| rejected \| expired \| cancelled`; `confirmed → partially_refunded \| refunded` | a pending provider intent allocates nothing and posts nothing |
| Refund | one document per provider refund id | `UNIQUE (provider_refund_id)`; internal request state is stored separately from provider state |

## 3. Chart of accounts (illustrative, configurable)

`cash_on_hand`, `bank_clearing`, `accounts_receivable`, `customer_advance`,
`deferred_tuition_revenue`, `tuition_revenue`, `scholarship_discounts`, `refund_payable`,
`salary_expense`, `salary_payable`, `payment_fees_expense`.

`finance_accounts.statutory_code` is **NULL** by design: the buyer maps these to their own
approved chart of accounts. No Uzbek statutory account number or tax code is asserted here.

## 4. Worked examples (each one is an executed test)

### Example A — one student, one month (fee 800,000; discount 200,000; 250,000 paid first)

| Step | Subledger effect | Journal |
|---|---|---|
| Contract 800,000 approved + activated | obligation recorded | — |
| Discount document 200,000 approved | one document, `UNIQUE(contract, period)` | — |
| Charge posted | `gross 800,000 − discount 200,000 = net 600,000` | DR `accounts_receivable` 600,000 · CR `deferred_tuition_revenue` 600,000 |
| Cash receipt 250,000 | allocation 250,000 to the open charge; receipt `RC-202611-000001` | DR `cash_on_hand` 250,000 · CR `accounts_receivable` 250,000 |
| Position check | receivable 600,000 − allocated 250,000 = **350,000 due** | `tuition_revenue` = 0 — collection recognised nothing |
| Half the service delivered | explicit recognition of 300,000 | DR `deferred_tuition_revenue` 300,000 · CR `tuition_revenue` 300,000 |
| Second receipt 350,000 | allocation 350,000 | DR `cash_on_hand` 350,000 · CR `accounts_receivable` 350,000 |
| Final | balance due **0**, collected 600,000, A/R 0 | every transaction balanced |

### Example B — overpayment of 100,000

Payment 700,000 against a 600,000 receivable → allocation 600,000, surplus 100,000 to
`customer_advance` (DR cash 700,000 · CR A/R 600,000 · CR `customer_advance` 100,000).
`balance_due = max(receivable, 0) = 0`; the surplus stays **visible** as an advance and is
never turned into revenue.

### Example C — refund

An authorized refund document debits `customer_advance` and credits the cash/bank account used.
The original payment row is untouched, the receipt stays in history, and a repeated provider
refund callback resolves to the same document. Refunding money that is already allocated is
refused (`refund_exceeds_available_funds`) — reversing that charge first is a documented
correction, not an automatic side effect.

### Example D — charge correction

Reversal creates a **new** charge row (`is_reversal = true`, `net = −600,000`,
`original_charge_id` → the original) and a new journal transaction
(DR `deferred_tuition_revenue` · CR `accounts_receivable`). The original row keeps
`net = 600,000` and is marked `reversed`. `UPDATE`/`DELETE` on any journal row raises
`finance_journal_is_append_only`. Reversal is refused while any payment is allocated
(`charge_has_allocations`).

## 5. Invariants and where each one is enforced

| Invariant | Enforced by | Test |
|---|---|---|
| `SUM(debits) = SUM(credits)` per transaction | deferred constraint trigger `finance_journal_balance_deferred` | `test_unbalanced_journal_transaction_cannot_commit` |
| Posted history is append-only | triggers `finance_journal_lines_append_only`, `finance_journal_entries_append_only` | `test_charge_correction_uses_reversing_documents_and_history_is_immutable` |
| One provider confirmation ⇒ at most one payment | `UNIQUE (provider, provider_transaction_id)`, `UNIQUE (idempotency_key)` + savepoint recovery | `test_duplicate_provider_callback_has_exactly_one_effect` (100×), `test_parallel_duplicate_callbacks_create_one_payment` (20-way race) |
| `receivable = posted charges (net, reversals included) − applied allocations` | `student_position()` | `test_statement_and_owner_summary_reconcile_to_the_ledger` |
| `balance_due = max(receivable, 0)`; surplus is an advance | `student_position()` | `test_overpayment_becomes_a_visible_customer_advance` |
| `confirmed = allocated + refunded + unallocated`; never allocate more than collected | `_allocate()` + refund availability check | `test_refund_is_an_authorized_reversal_that_never_erases_the_receipt` |
| No cross-student allocation | scope filter + object-level guard `cross_student_allocation` | `test_allocation_never_crosses_students` |
| Recognition ≤ deferred balance | `recognize_revenue()` | `test_revenue_recognition_is_bounded_by_the_deferred_balance` |
| Closed period/day accepts no new postings | `_assert_period_open`, `_assert_day_open` | `test_closed_period_rejects_new_postings`, `test_day_close_records_variance_and_locks_the_day` |
| Receipt numbers unique per period | `cash_receipt_sequences` with `ON CONFLICT … RETURNING` | `test_receipt_numbers_are_unique_and_sequential` |
| A redirect is not a payment | `confirm=False` writes no allocation and no journal | `test_pending_provider_intent_moves_no_money` |
| Catalogue price change never rewrites a signed obligation | contract versioning | `test_contract_price_change_never_rewrites_an_existing_obligation` |

## 6. Owner reporting: five different numbers that must never be conflated

`finance_summary(start, end)` returns, each from its own source query, plus `asOf`:

| Field | Meaning | Source |
|---|---|---|
| `collectedCashMinor` | money settled in the range | `tuition_payments` (settled states, `occurred_at`) |
| `invoicedTuitionMinor` | charges posted with `due_date` in range | `tuition_charges` |
| `recognizedRevenueMinor` | revenue earned under the configured policy | journal lines on `tuition_revenue` |
| `outstandingReceivableMinor` | positive per-student balances | charges − allocations |
| `overdueReceivableMinor` | the overdue subset (`due_date < CURRENT_DATE`) | charges − allocations |
| `customerAdvanceMinor` | unallocated money held | payments − allocations − refunds |
| `refundsMinor` | refunds issued in the range | `tuition_refunds` |

`GET /api/staff/finance/reconciliation` returns `{transactions, unbalanced, balanced}` over the
whole journal — the receipt an accountant can ask for.

## 7. HTTP contract

| Method | Route | Roles |
|---|---|---|
| POST | `/api/staff/finance/contracts` | owner, admin |
| POST | `/api/staff/finance/contracts/{id}/approve` · `/activate` | owner, admin |
| POST | `/api/staff/finance/contracts/{id}/discounts` | owner, admin |
| POST | `/api/staff/finance/charges` · `/charges/{id}/post` · `/charges/{id}/reverse` | owner, admin |
| POST | `/api/staff/finance/payments` · `/payments/{id}/refund` | owner, admin |
| POST | `/api/staff/finance/revenue/recognize` | owner, admin |
| POST | `/api/staff/finance/days/close` · `/periods/close` | owner, admin |
| GET | `/api/staff/finance/summary` · `/reconciliation` | owner, admin (teacher refused) |
| GET | `/api/staff/finance/students/{id}/statement` | owner, admin; teacher only for `teacher_student_links` |
| GET | `/api/finance/me` | student, own position only |
| — | every finance route | **guardian refused centrally** |

All error bodies are `{ "error": "<stable_code>", ...details }` with `Cache-Control: private, no-store`.

## 8. Provider adapter contract (not yet implemented — deliberately)

Any Click/Payme adapter must implement exactly this surface, and must not go live until the
merchant account, keys and callback secret exist:

```
create_intent(amount, currency, order_ref) -> provider_reference
validate_notification(raw_request) -> bool          # signature/secret/TLS, never client-trusted
normalize_event(provider_event) -> internal_event    # amount/currency/order binding
query_status(provider_reference) -> provider_state
cancel_or_refund_if_supported(...) -> provider_state
reconciliation_report(range) -> rows                 # provider totals vs internal totals
provider_health() -> ok | degraded | unavailable
```

Rules the adapter must honour: persist the raw event in sanitized form, enforce replay
handling and idempotency keys, treat an unknown state as unknown (never as paid), keep merchant
keys out of JavaScript, and prove in sandbox: success, duplicate callback, delayed callback,
callback before browser return, bad signature, amount mismatch, refund, cancellation, lost
network. See `docs/SALE_READY_MANUAL_ACTIONS.md` for the owner steps that gate this.
