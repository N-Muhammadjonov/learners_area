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

`ACADEMY_LOAD_SECONDS` defaults to 5; for a later isolated 2-hour read soak use 7200 with a deliberately bounded concurrency. No 2–24-hour result is claimed here. Mixed mass-attendance/exam submissions, Friday reminder queues, R2 degradation, independent load generators and multi-replica staging remain unmeasured engineering gates. Existing isolated backup/restore and Telegram retry tests continue in full CI. External-resource decisions are tracked only in [the canonical actions](../SALE_READY_MANUAL_ACTIONS.md).
