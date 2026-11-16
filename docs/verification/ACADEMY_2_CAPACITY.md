# Academy 2.0 — local HTTP capacity receipt

10,000 registered students, one FastAPI process, PostgreSQL 17.11, pool 5, request budget 64. The client, application and database share the same local machine. The initial fixture also has 100 groups, 1,000 guardian links, 30,000 attendance records, 10,000 reading attempts and 10,000 posted charges. Ten cash receipts and ten portal orders are added through the real services to exercise a full payment-history page.

The receipt records the base commit, modified-tree flag and SHA-256 of measured source files. No production database, merchant network, real credentials or deployment is involved. Raw results: [load-receipt.json](academy-ux/load-receipt.json).

| Parallel requests | 200 | 503 | p95 ms | p99 ms | Pool wait p95 ms | Read objectives |
|---:|---:|---:|---:|---:|---:|---|
| 10 | 1312 | 0 | 63.54 | 79.94 | 14.25 | met locally |
| 25 | 1266 | 0 | 173.44 | 217.98 | 74.52 | met locally |
| 50 | 1201 | 0 | 365.13 | 476.75 | 174.04 | MISSED |
| 100 | 142 | 726 | 3109.74 | 5152.63 | 2088.29 | MISSED |
| 250 | 127 | 777 | 4607.31 | 5831.41 | 2720.92 | MISSED |
| 500 | 140 | 959 | 6393.43 | 7021.98 | 2696.93 | MISSED |
| 1000 | 170 | 1242 | 9064.08 | 9470.27 | 3382.95 | MISSED |
| 2000 | 262 | 1935 | 11078.85 | 12105.97 | 2485.42 | MISSED |

Each level admits work for five seconds, then waits for completion. Latencies include all HTTP replies, including rejected requests. Per-endpoint distributions and successful-only p95 are retained in the JSON. An objective passes only if every request succeeds, mixed and every individual endpoint p95 are at most 300 ms, and mixed p99 is at most 1.5 s. This short synthetic run is not a soak or a production SLA.

At 25 parallel requests the measured endpoint p95 values were:
- `debtor_queue`: 174.71 ms (125 successful reads).
- `guardian_payments`: 203.67 ms (212 successful reads).
- `owner_summary`: 211.79 ms (99 successful reads).
- `student_journey`: 134.95 ms (147 successful reads).
- `student_payments`: 146.75 ms (533 successful reads).
- `teacher_today`: 127.22 ms (150 successful reads).

At the same pool/budget, replacing repeated per-student debt subqueries with aggregate-before-join reduced the observed 25-concurrent mixed p95 from 235.78 to 173.44 ms and debtor p95 from 306.35 to 174.71 ms. These are two local executions, not a controlled production benchmark or a guarantee. Payment-history enrichment is bounded to at most two queries for any allowed page size, protected by a PostgreSQL regression test.

50 concurrency misses the latency objective; 100–2,000 also return admission `busy` and some pool-acquire timeouts. Current generic database failure handling labels those timeout replies `unreachable`; pool-wait instrumentation identifies the observed saturation. No unsupported hardware, pool or replica capacity is inferred from these results. Raising request budgets alone would not prove useful capacity.

At every level an unrelated guardian-child request returned 403 and `/readyz` recovered to 200. The separate real HTTP burst issued 50 authenticated duplicate Payme PerformTransaction requests: 50 acknowledged, one journal effect, one provider event, balanced journal, 0.923 s. Synthetic protocol credentials do not establish vendor sandbox/live verification.

Reproduction requires a new empty localhost `coin_qa` database on port 55442. The runner refuses a different target, non-test environment, an existing schema or inherited live merchant keys. From repository root:

```bash
APP_ENV=test LOAD_TEST_ONLY=1 RATE_LIMIT_BACKEND=memory DATABASE_POOL_MAX=5 \
  REQUEST_BUDGET_ORDINARY=64 AUTH_SECRET=isolated-academy-load-test-secret \
  DATABASE_URL=postgresql://coin_qa:coin_qa_local@127.0.0.1:55442/coin_qa \
  ACADEMY_LOAD_LEVELS=10,25,50,100,250,500,1000,2000 \
  PYTHONPATH=services/backend services/backend/.venv/bin/python \
  services/backend/tests/load_validation/academy_payments_http.py
```

`ACADEMY_LOAD_SECONDS` defaults to 5; for a later isolated 2-hour read soak use 7200 with a deliberately bounded concurrency. The initial short run did not establish a soak; the subsequent two-hour result is below. Mixed mass-attendance/exam submissions, Friday reminder queues, R2 degradation, independent load generators and multi-replica staging remain unmeasured engineering gates. Existing isolated backup/restore and Telegram retry tests continue in full CI. External-resource decisions are tracked only in [the canonical actions](../SALE_READY_MANUAL_ACTIONS.md).

## Confirmation after pagination correction

All seven measured source hashes in [load-confirmation.json](academy-ux/load-confirmation.json)
match published `3792506e`. Empty debtor pages now retain the correct total rather
than displaying a false zero. A separate targeted PostgreSQL suite was completed
before this 30-second-per-level repeat.

| Parallel requests | Successful reads | 5xx / transport errors | Mixed p95 | Worst endpoint p95 | p99 |
|---:|---:|---:|---:|---:|---:|
| 10 | 7137 | 0 | 73.05 ms | 94.17 ms | 107.69 ms |
| 25 | 7054 | 0 | 184.72 ms | 220.12 ms | 242.54 ms |

The independent 50-request callback burst again produced one journal effect, one
provider event and a balanced journal (0.585 s). An unrelated child was denied at
each level and readiness remained 200. These are still short local measurements.

The preceding five-second execution overlapped other targeted PostgreSQL QA.
It recorded 1078 successful requests with mixed p95 210.40 ms, but guardian payment
p95 314.45 ms, missing the per-endpoint objective. That observation is retained in
[load-concurrent-qa.json](academy-ux/load-concurrent-qa.json). No failed observation
was deleted or turned into a passing performance assertion. The defined quiet
local profile is narrower than a shared host or production-capacity guarantee.

## Continuation: statement-consistent account positions

Two additional runs use Python 3.12 / PostgreSQL 18.6, 10,000 synthetic
students, one worker, pool 5 and admission budget 64. The first uses the six-read
account position; the second uses the one-statement position. Both source hashes
and dirty-tree markers are retained in the raw receipts. Each level admits work
for only five seconds, so these are short observations, not soak or SLA evidence.

| Parallel clients | Before p95 ms | After p95 ms | Read objective after |
|---:|---:|---:|---|
| 25 | 242.63 | 236.31 | PASS: 893 responses, all 200 |
| 100 | 2248.44 | 2325.91 | FAIL |
| 250 | 4067.28 | 3554.13 | FAIL |
| 500 | 6228.76 | 5897.25 | FAIL |
| 1000 | 9673.86 | 9701.30 | FAIL |
| 2000 | 10204.62 | 10677.86 | FAIL |

The statement change proves one consistent account snapshot and removes five
round trips; these noisy runs do not establish an overall throughput improvement
or expand the verified concurrency envelope. Every level denies an unrelated
guardian and recovers readiness. Each run acknowledges 50 duplicate callbacks
with exactly one journal effect and a balanced journal (0.925 s before, 1.150 s
after). No genuine provider verification is implied.

[Before receipt](academy-ux/continuation-load-before.json) ·
[After receipt](academy-ux/continuation-load-after.json).

The following two-hour run closes the bounded mixed-soak gate. Independent-worker
settlement/restart correctness is also tested. Higher-concurrency and production
horizontal-capacity gates remain open; no failed target is relabelled as passed.

## Two-hour hosted-CI mixed soak

[Workflow run 43877008801](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43877008801)
passed on clean source `fada41c91be4f8c42633adbbe16a95c55d7e2733`.
[Raw receipt](academy-ux/soak-two-hours.json).

| Measurement | Observed value |
|---|---:|
| Registered synthetic students / concurrent readers | 10000 / 10 |
| Duration | 7200.11 seconds |
| Successful reads / read failures | 1034705 / 0 |
| Read p50 / p95 / p99 | 66 / 115 / 133 ms |
| Worst endpoint p95 (owner summary) | 138 ms |
| Periodic cash write p95 | 245 ms |
| Mixed-operation requests / failures | 4048 / 0 |
| AI outage fallback / unrelated-family denial | 238 / 238 |
| Periodic cash / provider effects | 1 / 1 |
| App plus client peak RSS | 233636 KiB |
| Last thirty-minute heartbeat RSS range | 229788–230300 KiB |

The generator, app and PostgreSQL share a four-CPU hosted runner; this is not an
independent load generator or production measurement. One application process
uses pool five and admission budget 64. All-request percentiles use conservative
one-millisecond upper-bound histograms, not a rolling sample. SQL/acquire/loop
instrumentation retains bounded samples. The memory observations do not promise
leak-free operation at every duration or workload.

The 238 pulses replay the same cash document and provider transaction while
serving reads and simulating model unavailability. Every pulse denies an
unrelated family. A final 50-request burst targets another intent: one additional
provider effect; the final global provider-entry count is two, with a balanced
journal. No real vendor or paid model is contacted.

The workflow is repeatable via manual dispatch and relevant PR changes. It builds
the native frontend for the real readiness contract, retains pipeline failures,
requires at least two elapsed hours and verifies all stated objectives before
passing. Earlier configuration/readiness failures remain in Actions history.
No failure was converted to a skip.

The earlier 50–2000 single-worker misses remain valid observations. This result
qualifies the stated ten-reader sustained profile and does not establish a
production SLA or 10000 simultaneous users. Staging scale/resources remain MA-10.
