# Capacity, database evidence and recovery

**Branch:** `arena/c9f21950-learners-area` · **Date:** 2026-11-14

> **Uzbek xulosasi:** Bu hujjatda **haqiqiy o'lchovlar** bor: 10,000 talabalik sintetik
> baza yaratildi va yangi moliya o'qish yo'llari `EXPLAIN (ANALYZE, BUFFERS)` bilan
> o'lchandi. Lekin bu **HTTP konkurentlik testi emas**. Shuning uchun "10,000 foydalanuvchi
> bir vaqtda ishlay oladi" degan da'vo **qilinmayapti** — bunday da'vo uchun load-test
> retsepti kerak va u hali bajarilmagan.

## 1. The claim this document does **not** make

* ❌ "Supports 10,000 concurrent users." No HTTP load test was executed in this pass.
* ❌ Any p95 latency for the web application. Only database query times were measured.
* ❌ 99.9% availability. There is no monitoring receipt.

What **is** claimed, with receipts below: the new finance read paths were profiled on a
10,000-student synthetic dataset, one inefficiency was found and fixed, and the resulting
plans are recorded.

## 2. Target workload (for the next test run, not a result)

| Dimension | Planning figure |
|---|---|
| Enrolled students | 10,000 (registered ≠ concurrently connected) |
| Staff | 500 |
| Charges / year | ~120,000 (10,000 × 12 months) |
| Payments / year | ~120,000 |
| Journal lines / year | ~600,000 (2–3 lines per money event) |
| Interactive concurrency levels to prove | 100 → 250 → 500 → 1,000 → 2,000 |
| Exam-burst scenario | 2,000 submissions in a 60–120 s window |

## 3. Measured: finance read paths at 10,000 students

**Environment:** PostgreSQL 18.6 (embedded build), single instance, local disk, sandbox CPU.
**Dataset (seeded in 2.5 s):** 10,001 users · 30,000 charges · 10,000 payments · 10,000 allocations.
**Method:** the production functions `tuition_ledger.student_position()` and
`tuition_ledger.finance_summary()` were called through a logging connection proxy, so the SQL
under `EXPLAIN (ANALYZE, BUFFERS)` is the shipped SQL, not a copy.

### `student_position(student)` — the hot per-student read

| Query | Execution time |
|---|---|
| posted charges for the student | **0.037 ms** |
| applied allocations (LATERAL) | **0.049 ms** |
| collected payments | **0.022 ms** |
| refunds | **0.011 ms** |
| overdue (LATERAL) | **0.059 ms** |
| **end-to-end wall time** | **9.2 ms** (5 sequential round trips + Python) |

**Inefficiency found and fixed by this measurement.** Before the fix, the overdue query used a
grouped sub-select over the *entire* `tuition_payment_allocations` table:

```
Hash Right Join … Execution Time: 7.468 ms   Buffers: shared hit=127   (10,000 allocation rows)
```

That cost grows with total centre history, not with one student's records. Rewritten as a
`LATERAL` subquery against `tuition_payment_allocations(charge_id)`, it is now **0.059 ms** —
a ~127× reduction at this dataset size, and O(this student) instead of O(table). The same
treatment was applied to the per-student allocation total and to the allocation candidate set
in `_allocate()`. All 18 ledger invariant tests still pass after the rewrite.

**Honest follow-up:** the 9.2 ms wall time is round-trip dominated. Collapsing the five
statements into one aggregate query would cut it further; that is an optimization, not a
correctness issue, and it is not claimed as done.

### `finance_summary(start, end)` — owner-wide dashboard read

| Metric | Execution time |
|---|---|
| collected cash (date range) | 4.384 ms |
| invoiced tuition (date range) | 8.835 ms |
| recognized revenue | 0.022 ms |
| refunds | 0.014 ms |
| **outstanding receivables (all 10,000 students)** | **42.104 ms** |
| **customer advances (all 10,000 students)** | **24.669 ms** |
| **overdue receivables (all 10,000 students)** | **19.106 ms** |
| **end-to-end wall time** | **81.8 ms** |

These three are genuine full-history aggregates. At 10,000 students they cost tens of
milliseconds; at 10× the history they will cost roughly 10×. **Recommended next step (not
done):** a materialized per-student balance read model refreshed on commit, so the dashboard
never aggregates the whole ledger. Until then the dashboard must show its `asOf` timestamp,
which it already returns.

## 4. Configuration facts relevant to scale (read from code)

| Setting | Default | Source |
|---|---|---|
| `DATABASE_POOL_MAX` | 5 (capped at 20) | `app/db.py:91` |
| `DATABASE_POOL_ACQUIRE_TIMEOUT` | 5 s | `app/db.py:92` |
| `REQUEST_BUDGET_ORDINARY` | 64 (1..1024) | `docs/CAPACITY-BOUNDARIES.md` |
| `AUTH_HASH_CONCURRENCY` | `max(2, CPUs)` capped at 8 | same |
| New finance write rate limit | 120 writes / 60 s per identity | `app/tuition_port.py` |

Prior controlled-load receipts for the application as a whole (levels 20 and 200, Docker image,
synthetic database per case) are in `docs/PLATFORM-LOAD-VALIDATION-20261101.md` and are
reproducible with `scripts/controlled_load.py`. They predate this branch and do **not** cover
the finance routes.

## 5. SLOs — targets, not achievements

| Metric | Target | Status |
|---|---|---|
| Normal API read p95 | ≤ 300 ms | not measured |
| API write p95 (attendance/attempt/finance) | ≤ 500 ms | not measured |
| Server-side error rate | < 0.5% | not measured |
| LCP / INP / CLS | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 | not measured |
| Availability | ≥ 99.9% monthly | no monitoring yet |
| Duplicate charges / lost saves / cross-role leaks | **0** | **enforced by tests**: 100 duplicate callbacks ⇒ 1 payment; 20-way race ⇒ 1 payment; 26 authorization tests |
| RPO / RTO | ≤ 1 h / ≤ 4 h | **aspiration only** — no restore drill performed |

## 6. Correctness under concurrency — what *is* proven

| Scenario | Proof |
|---|---|
| 100 identical provider callbacks | exactly 1 payment, 1 allocation, 2 journal entries (`test_duplicate_provider_callback_has_exactly_one_effect`) |
| 20 simultaneous connections, same idempotency key | exactly 1 payment, 19 duplicates, 0 raised errors (`test_parallel_duplicate_callbacks_create_one_payment`) |
| Two operators issuing receipts in the same period | unique sequential receipt numbers (`test_receipt_numbers_are_unique_receipt…`) |
| Unbalanced journal | rejected at COMMIT by a deferred constraint trigger |
| Rewrite of posted history | blocked by `BEFORE UPDATE OR DELETE` triggers |

## 7. Recovery — status is UNKNOWN, deliberately

No backup or restore drill was performed: no production or staging database credentials were
available in this environment, and none was requested. What exists:

* `docs/PLATFORM-RECOVERY-20261029.md` and `scripts/qa2-local-postgres.sh` document the
  isolated-restore pattern used previously.
* The new finance tables are ordinary PostgreSQL tables with no external state, so a
  schema+data restore fully restores the ledger — but that has **not** been demonstrated.

**Required before any sale claim:** restore a masked copy into an isolated environment and
record schema counts, ledger balance (`GET /api/staff/finance/reconciliation` must return
`balanced: true`) and R2 pointer validity, with timestamps.

## 8. Failure domains and expected behaviour (design, untested here)

| Dependency | Expected behaviour on failure | Verified? |
|---|---|---|
| PostgreSQL down | money writes fail closed (503 via `db_failure`); no fake success | by code reading only |
| Telegram down | academic routes unaffected; guardian queue retries with backoff | unit tests only |
| R2 down | media reads degrade; no financial impact | not tested |
| Provider callback lost | payment stays `pending_provider`; nothing posts | `test_pending_provider_intent_moves_no_money` |
| Duplicate/delayed callback | resolves to the existing payment | proven (§6) |
| Instance restart mid-request | transaction rolls back; no partial posting (`@transactional`) | proven by design + tests |
