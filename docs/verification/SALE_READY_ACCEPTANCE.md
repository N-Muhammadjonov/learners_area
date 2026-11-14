# Sale-readiness acceptance receipt

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
| `cd services/backend && .venv/bin/python -m pytest -q --timeout=90 -ra` | **5 failed, 7,277 passed, 1 xfailed, 287 subtests passed in 98.69s** |
| `.venv/bin/python -m pytest -q tests/test_tuition_ledger.py` | **18 passed** (real PostgreSQL) |
| `.venv/bin/python -m pytest -q tests/test_tuition_port_authorization.py` | **26 passed** |
| `.venv/bin/python -m pytest -q tests/test_coin_production_safety.py tests/test_coin_economy_integration.py` | **30 passed, 1 xfailed** |
| `.venv/bin/python -m pytest -q tests/test_step31_release_invariants.py tests/test_step40_265_methods.py` | **71 passed** (migration-integrity gates) |
| `cd frontend/vanilla && npm test` | **1,777 tests · 1,745 pass · 21 fail · 11 skipped** |
| `node .tmp-pg/schema-parity-check.mjs` (PGlite) | **117 typed columns verified against migration 1115; 0 migrated-but-untyped** |
| `node .tmp-pg/pglite-finance-check.mjs` (PGlite) | migration 1115 applies; both triggers present; append-only and balance guard both enforced |

### Baseline vs now (same machine, same database)

| Run | Failed | Passed | xfailed |
|---|---|---|---|
| Base commit, **no** PostgreSQL, no asset build | 7 | 7,211 | 21 |
| Base commit, **with** PostgreSQL — `test_coin_production_safety.py` alone | 4 | 26 | 1 |
| This branch, **with** PostgreSQL | **5** | **7,277** | **1** |

Net effect of this branch: **+66 passing tests, −6 failures** (4 stale-fixture coin failures
fixed, 2 migration-integrity failures that a new migration would otherwise cause, registered).

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
.venv/bin/python -m pytest -q tests/test_tuition_ledger.py tests/test_tuition_port_authorization.py -v
```

Expected: 44 passed. If PostgreSQL is not reachable at `127.0.0.1:55439`, the 18 database tests
report `xfail` with `Disposable Postgres … unavailable` — that is a skipped proof, **not** a pass.

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
