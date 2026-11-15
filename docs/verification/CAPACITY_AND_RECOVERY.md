# Capacity, database evidence and recovery

**Branch:** `arena/c9f21950-learners-area` · **Date:** 2026-11-14

Lokal 10 000 o‘quvchili HTTP sinovi va sintetik PostgreSQL/S3 tiklash mashqi o‘tkazildi. 50 parallel so‘rov darajasi p95 maqsadiga yetdi. Yuqori darajalarda xato chegarasi oshdi. Quyida ish muhiti, so‘rovlar va tiklash natijalari keltirilgan.

## Katalog importi o‘lchovi (2026-11-15)

| Fayl | Qator | Preview va fayl tayyorlash | Apply | Jarayon peak RSS |
|---|---:|---:|---:|---:|
| CSV | 500 | 20 ms | 21 ms | 112 136 KiB |
| CSV | 5 000 | 94 ms | 160 ms | 122 032 KiB |
| XLSX | 10 000 | 1 485 ms | 1 350 ms | 130 640 KiB |

Linux x86_64, Python 3.12.14, PostgreSQL 18.6. Har fayl sintetik. Preview vaqtiga faylni tayyorlash ham kiradi. RSS butun sinov jarayonining eng yuqori xotira sarfi. Katalog importi o‘lchovi [qabul dalillarida](SALE_READY_ACCEPTANCE.md) takrorlanadi. Parallel HTTP yuk va to‘liq zaxiradan tiklash uchun alohida dalil kutilmoqda.

Xuddi shu PostgreSQL 18.6 konfiguratsiyasidagi takroriy XLSX o‘lchovi 10 000 qatorda 1 518 ms preview, 1 287 ms apply va 125 944 KiB process peak RSS berdi. 500, 5 000 va 10 000 qatorning uchta sinovi o‘tdi. Katalog importi alohida o‘lchov. Parallel HTTP va tiklash natijalari quyida.

## HTTP yuk sinovi va PostgreSQL indekslari (2026-11-15)

PostgreSQL 18.6, bitta FastAPI jarayoni, pool 5, oddiy parallel so‘rovlar budjeti 64. Lokal sintetik baza 10 000 o‘quvchi, 100 guruh, 1 000 guardian bog‘lanishi, 30 000 davomat, 10 000 Reading urinishlari va 10 000 posted charge bilan to‘ldirildi. Haqiqiy loopback HTTP’da student Journey, session, guardian davomat, teacher Rescue va owner finance summary o‘qildi. Har daraja besh soniya qabul qildi, qolgan so‘rovlar yakunigacha kutilgan. Natijalar bitta lokal bajarilishdan olingan.

| Parallel so‘rov | 200 | 503 | p50 (ms) | p95 (ms) | p99 (ms) |
|---:|---:|---:|---:|---:|---:|
| 50 | 1 621 | 0 | 142.97 | 295.36 | 397.23 |
| 100 | 225 | 713 | 216.54 | 2 246.86 | 3 190.80 |
| 250 | 223 | 936 | 870.98 | 3 231.22 | 4 422.74 |
| 500 | 219 | 1 008 | 2 224.17 | 6 107.23 | 6 833.13 |
| 1 000 | 258 | 1 291 | 4 608.09 | 9 114.83 | 9 590.87 |

p95 va p99 barcha HTTP javoblarini qamrab oladi. 100–1 000 darajalari 0,5% xato chegarasidan oshdi. `busy` javoblari va pool kutishlari qayd etildi. Indekssiz birinchi sinovda 50 parallel darajada p95 458,84 ms va 198,43 so‘rov/s, indekslardan keyin 295,36 ms va 317,99 so‘rov/s bo‘ldi. Indekssiz pool 10 bilan yana o‘lchaganda 50 darajada p95 343,43 ms chiqdi, yuqori darajalarda 503 davom etdi. Yuklamadan so‘ng `/readyz` 200 qaytardi.

`EXPLAIN (ANALYZE, BUFFERS)` joriy SQL’da Reading urinishlari har bir Rescue nomzodi uchun to‘liq qayta o‘qilganini ko‘rsatdi. `1131` yakunlangan Reading va Listening urinishlari hamda ishga tushgan guruh a’zoliklariga qisman indekslar qo‘shadi. O‘lchangan SQL vaqti Journey uchun 3,117 → 0,394 ms, o‘qituvchi Rescue ro‘yxati uchun 112,114 → 5,074 ms, butun akademiya Rescue ro‘yxati uchun 10 914,631 → 198,876 ms. 50 parallel darajasidan yuqorisida maqsadlar hali ochiq. Navbat, yozuvlarning aralash yuklamasi, bir soatlik sinov, ko‘p replika va staging infratuzilmasi bu o‘lchovdan tashqarida.

Qayta ishlatish uchun faqat yangi, bo‘sh lokal `coin_qa` bazasini 55442 portda ishga tushiring. Sinov production manzillarini qabul qilmaydi.

```bash
APP_ENV=test LOAD_TEST_ONLY=1 RATE_LIMIT_BACKEND=memory DATABASE_POOL_MAX=5 \
  REQUEST_BUDGET_ORDINARY=64 AUTH_SECRET=synthetic-local-academy-test-secret \
  DATABASE_URL=postgresql://coin_qa:coin_qa_local@127.0.0.1:55442/coin_qa \
  PYTHONPATH=services/backend services/backend/.venv/bin/python \
  services/backend/tests/load_validation/academy_http.py
```

`ACADEMY_LOAD_EXPLAIN=1` bilan yangi bo‘sh fixture’da SQL rejalarini qayta tekshirish mumkin.

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
| Normal API read p95 | ≤ 300 ms | 295,36 ms at 50 local concurrent requests. Higher levels missed the target. |
| API write p95 (attendance/attempt/finance) | ≤ 500 ms | not measured |
| Server-side error rate | < 0.5% | 0% at 50 local concurrent requests. 100–1,000 missed the target. |
| LCP / INP / CLS | ≤ 2.5 s / ≤ 200 ms / ≤ 0.1 | not measured |
| Availability | ≥ 99.9% monthly | no monitoring yet |
| Duplicate charges / lost saves / cross-role leaks | **0** | **enforced by tests**: 100 duplicate callbacks ⇒ 1 payment; 20-way race ⇒ 1 payment; 26 authorization tests |
| RPO / RTO | ≤ 1 h / ≤ 4 h | staging target, local restore measured separately |

## 6. Correctness under concurrency — what *is* proven

| Scenario | Proof |
|---|---|
| 100 identical provider callbacks | exactly 1 payment, 1 allocation, 2 journal entries (`test_duplicate_provider_callback_has_exactly_one_effect`) |
| 20 simultaneous connections, same idempotency key | exactly 1 payment, 19 duplicates, 0 raised errors (`test_parallel_duplicate_callbacks_create_one_payment`) |
| Two operators issuing receipts in the same period | unique sequential receipt numbers (`test_receipt_numbers_are_unique_receipt…`) |
| Unbalanced journal | rejected at COMMIT by a deferred constraint trigger |
| Rewrite of posted history | blocked by `BEFORE UPDATE OR DELETE` triggers |

## 7. Lokal zaxira va tiklash

PostgreSQL 18.6 va `pg_dump` / `pg_restore` 18.6. Sintetik akademiya bazasi `tools/recovery_backup.py` orqali shifrlanib zaxiralandi. Manba baza o‘chirildi, ajratilgan PostgreSQL jarayoni qayta boshlandi va arxiv yangi `learners_recovery_arena` bazasiga tiklandi.

| Tekshiruv | Natija |
|---|---|
| Shifrlangan PostgreSQL arxivi | 6 370 120 bayt, 0,63 s |
| PostgreSQL’ni tiklash va tekshirish | 1,59 s |
| Tiklangan satr sonlari | 240 jadval bo‘yicha teng |
| Himoya | 112 RLS jadvali, 12 trigger, guardian bog‘langan bola 200 va boshqa bola 403 |
| Moliya | 20 000 jurnal qatori, 0 balans buzilishi |
| Lokal S3 media | 3 obyekt, 56 364 bayt, 3 tiklangan DB manzili, MIME va SHA-256 teng |
| Lokal media zaxira / tiklash | 0,12 s / 0,09 s |

Lokal S3 emulyatorida manba bucket o‘chirilib, fayllar alohida bucketga yozildi. Ishlab turgan Cloudflare R2, ruxsatlar, staging, production RPO/RTO va real foydalanuvchi yuklamasi uchun alohida o‘lchov kerak.

## 8. Failure domains and expected behaviour (design, untested here)

| Dependency | Expected behaviour on failure | Verified? |
|---|---|---|
| PostgreSQL down | money writes fail closed (503 via `db_failure`); no fake success | by code reading only |
| Telegram down | academic routes unaffected; guardian queue retries with backoff | unit tests only |
| R2 down | media reads degrade; no financial impact | not tested |
| Provider callback lost | payment stays `pending_provider`; nothing posts | `test_pending_provider_intent_moves_no_money` |
| Duplicate/delayed callback | resolves to the existing payment | proven (§6) |
| Instance restart mid-request | transaction rolls back; no partial posting (`@transactional`) | proven by design + tests |
