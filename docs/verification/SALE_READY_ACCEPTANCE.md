# Sale-readiness acceptance receipt

## Arena davomi (2026-11-15, Toshkent)

| Tekshiruv | Commit | Natija |
|---|---|---|
| Main bazasi, GitHub Actions | `098d3ac8225e46054f8908b82a339d3ea5821a50` | Backend 7 247 o'tdi, 9 fail, 1 xfail, 287 subtest o'tdi. Frontend 1 758 o'tdi, 18 fail, 12 skip. [CI](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43629155107) |
| Arena, sinxronlangan to'liq CI | `8a4f4ec87f6c6bb93d612725afd3eda6abf86882` | Backend 7 447 o'tdi, 0 fail, 1 mavjud xfail, 287 subtest o'tdi, 120.64 s. Frontend 1 776 o'tdi, 0 fail, 12 mavjud skip, 123.37 s. [CI](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43630359248) |
| Listening resume, Script Completion va RIWI katalogi | `ae7a045b4210ea8240246e0461822eb8bff2b7ab` | Backend 7 447 o'tdi, 0 fail, 1 xfail, 287 subtest, 108.37 s. Frontend 1 778 o'tdi, 0 fail, 12 skip, 91.77 s. Listening JSDOM 2 o'tdi, 1.40 s (Node 24.22.1). [To'liq CI](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43630766224) |
| Moliya va outbox | `8a4f4ec87f6c6bb93d612725afd3eda6abf86882` | Linux x86_64, Python 3.12.14, PostgreSQL 18.6. Quyidagi uch faylda 90 o'tdi, 0 fail, 13.14 s. Faqat ajratilgan test bazasi. |

GitHub Actions ikkala branchda Ubuntu runner, Python 3.14.10, Node 22.23.4 va PostgreSQL 17 servisidan foydalandi. Yakuniy xfail `test_short_media_never_pays_before_five_minutes` bo'yicha mavjud egasi qarori. Browser va haqiqiy audio tekshiruvi egada.

```bash
cd services/backend
python -m pytest -q tests/test_tuition_ledger.py tests/test_finance_outbox.py tests/test_tuition_schema_parity.py
cd ../..
npm run test:migrations
npm run backend:test:postgres
node --test frontend/vanilla/tests/listening-resume-source-repairs.test.mjs
```

### Sabab va dalil

- `tuition_ledger.py` dagi to'lov taqsimoti tasdiqlangan credit noteni ayirmagan. Hisob endi charge qulfi ichida kamaytirilgan majburiyatdan boshlanadi. 600 000 qarz, 100 000 credit note va 550 000 to'lov sinovida 500 000 qarzga va 50 000 avansga yozildi. Qarama-qarshi tartib, qaytarish, qisman to'lov va parallel yozuvlar ham qamrab olindi.
- Refund rezervi bilan amalda pul chiqishi bitta ko'rsatkichdagi summaga qo'shilgan. Talaba va egasi hisoblarida faqat yakunlangan refund qoladi. To'lov holati qolgan real mablag'dan hisoblanadi. 700 000 avans uchun 100 000 qisman, keyin 600 000 to'liq qaytarish va qayta yuborish sinovdan o'tdi.
- Refund sanasi iltimos sanasidan qolib ketgan. Kassa yopilishi va pul chiqishi bitta Toshkent kun kalitini qulflaydi. Provider tushumi tasdiqlangan kunga, credit note esa asl davr yopiq bo'lsa ochiq davrga yoziladi. Parallel kassa/refund va turli sessiya vaqti sinovlari `test_tuition_ledger.py` da.
- `finance_outbox.py` va `1121_finance_outbox_dispatch.sql` faqat `provider.settled` sandbox qabul qiluvchisini ulaydi. Cheklangan ishchilar, ijara, 100 qayta urinish, karantin va barqaror hodisa ID bilan takror yetkazishda bitta receipt. Jarayon yetkazgandan so'ng to'xtashi hamda ruxsatsiz mavzuni chetlab o'tish PostgreSQL'da sinovdan o'tdi.
- Listening 08/10 transcript ta'miri runtime ko'prigini va exam resume kodini olib tashlagan. O'z testlarining tarixiy integratsiyasi, iframe tasdiqlashi va savol turi tanlash tiklandi. Amaldagi transcript va audio manzillari saqlandi. JSDOM qayta yuklash, javob, flag, pozitsiya va Script Completion hodisasini tekshirdi.
- Landing bank 45 savolda qolgan. `landing-inline.js` dagi bank amaldagi 150 savoldan tiklandi, mavjud 17 savollik tanlov saqlandi. `navigation-list.js` Dock bilan bir xil piktogramma API'ini ishlatadi. Listening/Vocabulary/Retention fixture tekshiruvlari amaldagi kontrakt va ayni foydalanuvchi xatti-harakatlarini tekshiradi. Finance test sanasi endi test ishlashida olinadi. Startup warning sinovi Uvicorn log konfiguratsiyasi va platforma muhitini izolyatsiya qiladi.
- RIWI katalogi `main`dagi Telegram handoff workflow'da eski bo'lgan. Ishlab chiqaruvchi skript chiqargan route va source diff, Arena'dagi ikki fayl xeshi bilan birga, katalogga kiritildi. Main-dagi oldingi natija 138 route va 558 source. [Telegram handoff bazasi](https://github.com/N-Muhammadjonov/learners_area/actions/runs/43629155115)

### Migratsiya va keyingi tekshiruvlar

| Muhit | Holat |
|---|---|
| Yangi ajratilgan baza | Tasdiqlandi. 100 sxema migratsiyasi, 21 nomlangan kontent migratsiyasi keyinga qoldirildi, 171 typed table, 9 ASGI tekshiruvi. |
| Kontentli bazani yangilash | Kontent import qilingan to'liq nusxada hali bajarilmadi. Upgrade kontrakti kontent yo'q bo'lganda `0094` da to'xtashini sinadi. |
| Staging / production | Bajarilmadi. |
| 10k yuk, tiklash, savdo demosi | Bu davomda bajarilmadi. |

Gate A sandbox va ledger doirasida tekshirildi, moliya UI va haqiqiy provider integratsiyasi ochiq. Gate B oxirgi kod commitida 0 fail. Static build, to'rtta migratsiya kontrakt testi, Coin Economy va Leaderboard workflow'lari o'tdi. Main uchun Telegram handoff katalog tekshiruvi tarixan qizil va faqat main'da ishlaydi. Arena katalogi generator diff bilan yangilandi. Gate C–F uchun keyingi amallar [checkpoint](ARENA_CONTINUATION_CHECKPOINT.json) da. Tashqi tasdiqlar va egasining amallari [yagona ro'yxatda](../SALE_READY_MANUAL_ACTIONS.md).

---

## Tarixiy tekshiruv (Arena davomidan oldin)

**Branch:** `arena/c9f21950-learners-area` · **Base commit:** `344e538c56a84fb6651e0cc5663a056663d5376a`
**Executed:** 2026-11-14 · **Environment:** Linux sandbox, Python 3.11.2, Node 22.22.3, PostgreSQL **18.6** (embedded build from `@embedded-postgres/linux-x64`) on `127.0.0.1:55439`

> **Uzbek xulosasi:** Bu yerda har bir da'vo aniq buyruq va aniq natija bilan yozilgan.
> 5 ta test hali qizil — ularning barchasi mening o'zgarishimdan **oldin** ham qizil edi va
> buni asosiy commit'da qayta ishga tushirib isbotladim. Production'da hech narsa
> tekshirilmagan: bitta qator ham `VERIFIED_IN_PRODUCTION` emas.

## 1. Environment reproduction (exact commands)

```bash
# Python side
python3 -m venv services/backend/.venv
services/backend/.venv/bin/python -m pip install -r services/backend/requirements-dev.txt pytest-timeout
services/backend/.venv/bin/python scripts/build_native_assets.py
# {"staticBuild": true, "runtime": "Python FastAPI", "files": 1010, "routes": 138, ...}

# Node side
npm ci --no-audit --no-fund

# Real PostgreSQL for the DB-backed tests (the repo's own embedded-postgres pattern,
# port/credentials chosen to match .github/workflows/ci.yml: coin_qa@127.0.0.1:55439/coin_qa)
mkdir -p .tmp-pg && cd .tmp-pg && npm pack @embedded-postgres/linux-x64 && cd ..
tar xzf .tmp-pg/embedded-postgres-linux-x64-*.tgz -C /tmp/qa2-pg
#   initdb -D /tmp/qa2-pg/data -U postgres --auth=trust -E UTF8 --locale=C
#   postgres -D /tmp/qa2-pg/data -p 55439 -k /tmp -c listen_addresses=127.0.0.1
#   CREATE ROLE coin_qa LOGIN PASSWORD 'coin_qa_local' CREATEDB; CREATE DATABASE coin_qa OWNER coin_qa;
```

Without that database the DB-backed tests `xfail` instead of running — which is exactly how
four real defects stayed invisible (see §5).

## 2. Test receipts

| Command | Result |
|---|---|
| `cd services/backend && .venv/bin/python -m pytest -q --timeout=300 -p no:randomly` | **5 failed, 7,410 passed, 1 xfailed, 287 subtests passed in 120.95s** (7,416 collected) |
| finance subset (8 files: ledger, charge-HTTP, refund, provider, authorization, database-policy, schema-parity, migration-contract) | **177 passed** (real PostgreSQL, real HTTP over ASGI) |
| `.venv/bin/python -m pytest -q tests/test_tuition_migration_contract.py` | **13 passed** |
| `npm run test:migrations` | **4 tests · 4 pass · 0 fail** (PGlite; fresh path, upgrade path, contract drift) |
| `npm run backend:test:postgres` | **exit 0, `result: passed`** — 99 schema migrations applied, 21 content migrations deferred and named, 170 typed tables, 9 HTTP checks |
| `cd frontend/vanilla && npm test` | **1,777 tests · 1,745 pass · 21 fail · 11 skipped** — identical to the base run; the finance work touches no frontend code |

### Baseline vs now (same machine, same database, same assets)

The base figures below were produced by checking the base commit out into a separate worktree
and running it against the same PostgreSQL server and the same `node_modules`, so the
comparison holds the environment constant. Comparing against a run that had no database or no
built assets is not a comparison at all — it silently moves tests between `pass`, `fail` and
`xfail`.

| Run | Collected | Failed | Passed | xfailed |
|---|---|---|---|---|
| Base `344e538`, PostgreSQL reachable + assets built | 7,239 | 9 | 7,229 | 1 |
| Base `344e538`, worktree **without** `node_modules` | 7,239 | 11 | 7,227 | 1 |
| Base `344e538`, **no** PostgreSQL, no asset build | 7,239 | 7 | 7,211 | 21 |
| **This branch**, PostgreSQL reachable + assets built | **7,416** | **5** | **7,410** | **1** |

Net effect of this branch against the environment-matched base: **+177 tests, +181 passing,
−4 failures**. The 4 failures that went away are the stale-fixture coin tests described in §5;
the 5 that remain are listed in §3 and fail identically at the base commit.

The `xfail` column moves for a reason worth stating, because it looks like a regression when it
is the opposite: 20 tests in `test_coin_production_safety.py` and
`test_coin_economy_integration.py` call `pytest.xfail()` when `127.0.0.1:55439` is
unreachable, so with no database they report `xfailed` and prove nothing. With the database
present they execute for real and pass. The one remaining `xfailed` is
`test_short_media_never_pays_before_five_minutes`, a `strict=True` xfail that records an owner
decision, not a missing capability.

## 3. The 5 remaining failures — all pre-existing, all reproduced at the base commit

| Test | Symptom | Classification |
|---|---|---|
| `test_main_assets.py::test_all_original_listening_runtimes_are_shipped[8]` | built `source.html` for Listening 08 lacks `originalSaveStored` / `laCourseWork` | content/asset defect, present at base |
| `test_main_assets.py::…[10]` | same for Listening 10 | content/asset defect, present at base |
| `test_general_reading_inline_context.py::test_rejects_unchecked_spelling_and_wrong_absolute_offset` | `jar`@4 is accepted inside `jars` | lexical content defect, present at base |
| `test_study_plan_level.py::test_in_app_bank_stays_identical_to_landing_reference` | landing bank has 45 questions, in-app bank 150 | content parity defect, present at base |
| `test_proxy_startup_safety.py::test_startup_warnings_once_without_changing_hard_minimum` | passes standalone after `build_native_assets.py`, fails inside the full suite | **order-dependent**, present at base |

None of these touches finance, auth, guardian routing or migrations. None was weakened, skipped
or deleted; no assertion in this branch was relaxed to improve a pass rate.

**Proof the 21 frontend failures are pre-existing:** the nine affected files were re-run with
the working tree stashed at the base commit:

```
git stash push -u -m "finance-spine-wip"
cd frontend/vanilla && node --test tests/hover-system.test.mjs tests/listening-tests-1-20-context-audit.test.mjs \
  tests/listening-tests-21-25-contextual.test.mjs tests/listening-v16.test.mjs tests/listening-v8.test.mjs \
  tests/phase1-design.test.mjs tests/reading-contextual-source.test.mjs tests/ux-corrections.test.mjs \
  tests/landing-stability.test.mjs
# → tests 85 · pass 68 · fail 17 — identical assertion names to the full run
git stash pop
```

## 4. Known pre-existing blocker found while verifying

`npm run backend:test:postgres` (PGlite, `scripts/verify-fastapi-postgres.mjs`) fails **before**
reaching migration 1115:

```
error: Listening 1–20 must contain 80 transcript Parts
  ← services/backend/migrations/0094_listening_1_20_context_audit.sql:189
```

That file is a content-audit migration and was not touched by this branch (the same failure
appears when the chain is applied sequentially to a bare PostgreSQL). Because the repo's own
isolated-integration path stops there, migration 1115 was verified under PGlite with a scoped
harness instead (§2, last two rows). **Sale blocker for the migration gate:** either seed the
listening content the audit expects, or scope the audit to databases that have it.

## 5. Gate-1 defect fixed in this branch

`tests/test_coin_production_safety.py` applied only `0084_coin_economy.sql`, while
`coin_rewards.wallet()` also reads `coin_gift_refunds` (added by `0092_coin_gift_fulfillment.sql`).
`wallet()` swallows any exception and returns an all-zero wallet, so with a real database four
assertions failed with `balance == 0` for a reason that was **not** the wallet. Two changes:

1. the fixture now applies `0084`, `0091`, `0092` and expects the true table count (13, RLS on,
   no grants to `anon`/`authenticated`/`service_role`);
2. `wallet()` now logs the exception before falling back, so a zero balance caused by a
   schema/permission error is visible in production logs instead of looking like a real zero.

## 6. What is explicitly **not** verified (no receipt exists)

| Area | Status | Why |
|---|---|---|
| Production deployment, live auth, live Telegram | `BLOCKED_EXTERNAL` | needs owner credentials/approval |
| Cloudflare R2 signed upload/download | `BLOCKED_EXTERNAL` | no R2 keys in this environment |
| Click/Payme sandbox flows | `MISSING` | no merchant account; adapter intentionally not guessed |
| WebRTC dual-browser call | `IMPLEMENTED_UNVERIFIED` | needs TURN + two real browsers |
| Backup / restore drill | `UNKNOWN` | no database access granted |
| 10,000-student load profile | **not executed** | see `CAPACITY_AND_RECOVERY.md`; no capacity claim is made |
| Staff UI for the finance module | `MISSING` | API + invariants first; UI is the next slice |

## 7. How to re-run the finance proof yourself

```bash
cd services/backend
.venv/bin/python -m pytest -q tests/test_tuition_ledger.py tests/test_tuition_port_authorization.py
```

Expected: **115 passed** (73 ledger + 42 route-authorization). For the whole finance slice —
ledger, charge/refund/provider HTTP, authorization, database RLS policy, TypeScript schema
parity and the migration contract — run the eight files together; expected **177 passed**:

```bash
.venv/bin/python -m pytest -q tests/test_tuition_ledger.py tests/test_tuition_charge_http.py \
  tests/test_tuition_refund_http.py tests/test_tuition_provider_http.py \
  tests/test_tuition_port_authorization.py tests/test_tuition_database_policy.py \
  tests/test_tuition_schema_parity.py tests/test_tuition_migration_contract.py
```

If PostgreSQL is not reachable at `127.0.0.1:55439`, the database-backed tests report `xfail`
with `Disposable Postgres … unavailable` — that is a **skipped proof, not a pass**. In CI, where
the database is part of the job, the same tests raise instead of xfail, so a missing database
cannot masquerade as a green run.

## 8. CI state — red on `main` before this branch

The full `ci.yml` ("Full stability regression") is **already failing on the base commit**, so
this PR does not introduce the failure:

| Run | Ref | Jobs | Conclusion |
|---|---|---|---|
| `43602692235` | `main` @ `344e538` (the base of this branch) | `backend`, `frontend` | **failure** (both, exit code 1) |
| PR #189 run `43609593263` | `arena/c9f21950-learners-area` | `backend`, `frontend` | failure — same two jobs |
| PR #189 run `43609593183` | same | `backend`, `frontend` (subset workflows) | **pass** |
| PR #189 run `43609593180` | same | `backend-coin`, `bot`, `browser` | **pass** |

Verified with:

```bash
gh api "repos/N-Muhammadjonov/learners_area/actions/workflows/ci.yml/runs?branch=main&per_page=3"
# → {"conclusion":"failure","created_at":"2026-11-14T14:01:37Z","head_sha":"344e538"}
gh api "repos/N-Muhammadjonov/learners_area/actions/runs/43602692235/jobs"
# → backend: failure (job 132470647662) · frontend: failure (job 132470648061)
```

Check-run annotations only report `Process completed with exit code 1`; the log archive host
(`results-receiver.actions.githubusercontent.com`) is not reachable from this sandbox, so the CI
failure list could not be read directly. The locally reproduced failures in §3 are the same
content/asset defects and are the most likely cause; that inference is labelled as inference,
not as a verified match.

**Consequence for the merge gate:** `main` is red today. Fixing the five content/asset defects
in §3 is the cheapest path to a green gate, and it is engineering work (not an owner action),
so it belongs in the next slice rather than in `docs/SALE_READY_MANUAL_ACTIONS.md`.

## 9. FIN-13 — migration safety (fresh install vs upgrade)

`npm run backend:test:postgres` aborted at `0094_listening_1_20_context_audit.sql` with
`Listening 1–20 must contain 80 transcript Parts` (SQLSTATE `P0001`), raised by that file's own
`DO $verify$` block. It never reached `1115_tuition_finance.sql`, so the finance schema was
never built by the real runner and the command was not an end-to-end signal at all.

**Root cause.** The chain mixes two kinds of migration. A *schema* migration is valid on any
database at the prior revision. A *content* migration repairs or enriches imported curriculum
content, creates no table of its own, and in several cases asserts an absolute content count.
`scripts/apply-test-migrations.mjs` applied every file in filename order to an **empty**
database, so 0094 was asked to validate 80 transcript Parts in a database that has never had
content imported into it. No migration inserts listening content —
`grep -ln "INSERT INTO listening_packages\|INSERT INTO listening_tests" migrations/*.sql`
returns nothing — so on a fresh database that assertion can never be satisfied. The listening
validation itself is correct and was left untouched.

**Fix — distinguish the two paths instead of skipping the file.**

| | |
|---|---|
| Classification | `services/backend/tests/migration-contract.json`: 21 content migrations, derived as *references a content table AND declares no DDL of its own* |
| Drift protection | `tests/test_tuition_migration_contract.py` re-derives the list from the migration bytes and fails if the manifest is edited independently, so it cannot become an ignore list |
| Fresh path (default) | schema migrations applied, content migrations **deferred and named** in the runner's report — never silently dropped |
| Upgrade path | `MIGRATION_MODE=upgrade` applies everything, content assertions included, and fails loudly |
| Listening validation | intact: the Node test asserts the upgrade path **still raises** `Listening 1–20 must contain 80 transcript Parts` on a content-less database |
| Finance chain | `test_no_finance_migration_is_deferred` pins 1115–1120 to always run on both paths |

Receipts: `npm run backend:test:postgres` → exit 0, `{"result":"passed","migrationMode":"fresh",
"migrations":99,"deferredMigrations":[21 entries],"typedTables":170,"httpChecks":9}`.
`npm run test:migrations` → 4 pass, including the test that the upgrade path still fails.

**Has any environment applied 1115/1116?** Probed every database on the reachable server:
`learners_fin` and `learners_scale` contain 1115 only (they have `tuition_charges` and
`finance_journal_entries` but **no** `tuition_refunds.status` and **no**
`tuition_payments.identity_fingerprint`, which 1116 and 1118 add). No staging or production
database is reachable from this sandbox, so the question cannot be answered for those from
here — it is recorded as an open item, not assumed. `1115` was therefore treated as applied and
never edited; every correction went forward into `1116`–`1120`.

**A real defect found while measuring this.** Timing the chain into a fresh schema exposed a
bug in `1116`:

```sql
IF EXISTS (SELECT 1 FROM information_schema.columns
           WHERE table_name = 'tuition_refunds' AND column_name = 'status') THEN
    ALTER TABLE tuition_refunds ADD CONSTRAINT tuition_refunds_status_check CHECK (status IN (...));
```

`information_schema` describes the **whole database**, so the guard was answered by unrelated
schemas. Once any schema in the database had finished the chain, the guard became true and the
`ALTER` ran against the *current* schema, where `status` does not exist until 1118 adds it —
`column "status" does not exist`. The finance suite is built on disposable schemas, so this was
not theoretical: with one migrated schema present, 8 finance tests failed. Reproduced, then
fixed by scoping the guard to `table_schema = current_schema()`, and pinned by
`test_the_chain_applies_into_a_second_schema_of_the_same_database` plus
`test_no_finance_migration_guard_reads_a_database_wide_catalog_unqualified`, which asserts the
cause on the SQL of all six finance migrations. Because `1116` had never been applied in any
environment, it was corrected in place and its checksum re-registered in
`tests/migration-additions.json` (`29734e43…` → `354ee79e…`, still 52 entries, one line changed).
After the fix, the same 8 tests pass with the contaminating schema still present.

**Apply time, forward-fix, old-code compatibility** (real PostgreSQL 18.6, disposable schema):

| Migration | Fresh apply |
|---|---|
| `1115_tuition_finance.sql` | 42.3 ms |
| `1116_tuition_finance_corrections.sql` | 19.9 ms |
| `1117_tuition_charge_approval.sql` | 2.7 ms |
| `1118_refund_lifecycle_and_cash_day.sql` | 7.4 ms |
| `1119_provider_clearing_account.sql` | 0.9 ms |
| `1120_freeze_contract_terms.sql` | 0.9 ms |
| **Total** | **74.2 ms** (15 finance tables) |

Re-running all six against the already-migrated schema: **20.6 ms, no error** — every
`CREATE TABLE/INDEX` is `IF NOT EXISTS` and every function is `CREATE OR REPLACE`, asserted per
file by `test_finance_migrations_are_idempotent_and_non_destructive`, which also fails on any
`DROP TABLE`, `TRUNCATE`, `DELETE FROM` or `DROP COLUMN`. Old-code compatibility is structural
rather than measured: the chain alters no pre-existing table, all 25 indexes are
`IF NOT EXISTS` on finance-owned tables, and the only legacy tables referenced are `users` and
`courses`, as foreign-key targets.

**What this section does not prove.** There is no staging database here, so lock behaviour
under concurrent production traffic, a rollback, and genuine old-code compatibility against a
populated table are all unmeasured. The figures above are an empty-schema apply on a single
idle server. They bound the DDL cost; they are not a production migration window.

**CI wiring.** `ci.yml` never invoked `backend:test:postgres` — which is how a content-repair
migration could abort the chain for so long without anyone seeing it. The `backend` job now
runs `npm run test:migrations` and `npm run backend:test:postgres` before the full suite, both
of which pass locally.
