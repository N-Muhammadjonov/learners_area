# Learners Area — Sale-readiness capability matrix

**Snapshot:** branch `arena/c9f21950-learners-area`, base commit `344e538c56a84fb6651e0cc5663a056663d5376a`
**Audit date:** 2026-11-14 · **Auditor method:** live repository inspection + executed test receipts

> **Uzbek xulosasi (qisqa):** Quyidagi jadval har bir biznes imkoniyatni kod manbasi,
> migratsiya, test va status bilan ko'rsatadi. Status so'zlari qat'iy: `VERIFIED_LOCALLY`
> = shu yerda haqiqiy PostgreSQL'da test o'tgan; `IMPLEMENTED_UNVERIFIED` = kod bor, lekin
> men ishlata olmadim; `MISSING` = kodda yo'q; `BLOCKED_EXTERNAL` = tashqi hisob/kreditensial
> talab qiladi. Hech qaysi qator "taxminan bor" deb yozilmagan.

## Status vocabulary (do not soften these words)

| Status | Meaning |
|---|---|
| `VERIFIED_IN_PRODUCTION` | Proven on the live deployment with a dated receipt |
| `VERIFIED_LOCALLY` | Executed here against a real database/browser; command + output recorded |
| `IMPLEMENTED_UNVERIFIED` | Code exists and is wired, but no execution receipt in this pass |
| `PARTIAL` | Some of the capability works; the gap is named in the row |
| `MISSING` | Searched endpoints, templates, bots, models, migrations and tests; not present |
| `BLOCKED_EXTERNAL` | Needs an owner credential, merchant account or legal approval |
| `UNKNOWN` | Could not be established from the repository alone |

## Repository facts established in this pass

| Fact | Value | How established |
|---|---|---|
| Backend API routes | **442** | Enumerated `app.routes` in `services/backend` |
| Backend app modules | 286 | `ls services/backend/app/*.py` |
| Authoritative migration chain | `services/backend/migrations/*.sql` = **113** files (…1114 + new **1115**) | `scripts/apply-test-migrations.mjs` applies this chain |
| Secondary chains | `drizzle/*.sql` = 84, `supabase/migrations` = 5 (+ `tests/platform-migrations.json`) | File listing |
| Backend test files | 183 (`test_*.py`) | File listing |
| Frontend test files | 187 (`*.test.mjs`) | File listing |
| CI workflows | 15 in `.github/workflows/` | File listing |
| Runtime | Python FastAPI modular monolith (`server.py` → `app.asgi.application`), asyncpg pool, native built assets | `server.py`, `services/backend/app/asgi.py` |

**Contradiction register (resolved against code, not prose):**

| # | Claim found | Where | What the code actually shows | Resolution |
|---|---|---|---|---|
| 1 | "Parental control is absent" | Research B appendix | `app/guardian_port.py` (1,200+ lines), migrations `0088_guardian_role`, `0089_guardian_connect`, `0090_guardian_message_replies`; human-approved batches only, replies bound to the originating staff member | **False.** Parent Connect exists; it was preserved, not rebuilt |
| 2 | "Billing exists" | `src/db/schema.ts:2514` | `products/plans/prices/subscriptions/payments` exist but are a dark stub behind `BILLING_ENABLED`, with no charges, allocations or ledger | **Partially true.** No AR subledger existed before migration 1115 |
| 3 | "No CI" | Older prose | 15 workflows; `ci.yml` runs the full backend suite against a Postgres service plus the frontend suite | **False.** CI exists |
| 4 | "Centre attendance exists" | `live_class_attendance` | That table records **online live-class joins** (`app/live_classes_port.py`), not per-lesson centre attendance for a scheduled group | **Distinct concern.** Centre-grade attendance is still `MISSING` |
| 5 | "Migrations live in `drizzle/`" | Repo layout | Production chain is `services/backend/migrations` (goes to 1114/1115); `drizzle/` stops at 0087 | `services/backend/migrations` is authoritative |

## Capability matrix

| CAP-ID | Business capability | User-visible route | Backend route/service | Tables / migration | Role scope | Tests / receipt | Production evidence | Status | Gap | Risk | Priority | Minimal fix | Acceptance proof | Owner action |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAP-01 | Session auth (Telegram/Google/password), role + object authorization | `/`, all `/api/*` | `app/security.py`, `main._load_authority` | `users`, `auth_session_revocations` / 0060 | all | `tests/test_access_*`, `test_cookie_policy` (passing locally) | none in this pass | `IMPLEMENTED_UNVERIFIED` | no live login receipt | high | run staging login E2E | dated staging receipt | staging access |
| CAP-02 | Parent sees linked child's results (read-only) | `/api/guardian/*` | `app/guardian_port.py` | `guardian_*` / 0088–0090 | guardian | `tests/test_guardian_connect.py`, `test_guardian_reply_routing.py` (passing) | none | `VERIFIED_LOCALLY` | live Telegram not exercised | high | owner-run live test | two-parent/two-child test log | Telegram token |
| CAP-03 | Staff→parent manual message, reply returns to the **same** staff member | `/api/staff/guardian-messages/send` | `guardian_port.py`, `telegram_notification_queue_port.py` | `guardian_message_batches/_deliveries`, `guardian_message_replies` / 0089–0090 | owner/admin/teacher | routing + dedupe tests (passing); `UNIQUE(actor_telegram_id, source_message_id)` | none | `VERIFIED_LOCALLY` | delivery needs a real bot | high | live send/reply drill | Telegram log | Telegram token |
| CAP-04 | Automated parent messaging | — | none by design | — | — | negative tests confirm nothing self-sends | n/a | `MISSING (by policy)` | intentional | low | none | — | owner opt-in if ever wanted |
| CAP-05 | IELTS Listening library | `/listening/*` | `app/browser_listening*.py`, `app/listening_*` | 0028, 0059, 0093–0108, 1110–1114 | student/teacher | 33 listening runtime assets present; content-audit migrations | none | `IMPLEMENTED_UNVERIFIED` | 2 shipped-runtime assertions fail locally (tests 08, 10) | med | fix the two runtimes | `test_main_assets` green | — |
| CAP-06 | Reading (Academic/General, articles, lexical layer) | `/reading/*` | `app/browser_reading.py`, `reading_*` | 0017, 0030, 0039, 0062 | student/teacher | suite passes except 1 inline-context assertion | none | `PARTIAL` | `test_general_reading_inline_context` fails on `jar`/`jars` overlap | med | correct the gloss offsets | that test green | — |
| CAP-07 | Writing workspace + feedback | `/writing/*` | `app/lesson_writing_port.py`, `writing_*` | 0031–0033, 0068 | student/teacher | contract tests pass | none | `IMPLEMENTED_UNVERIFIED` | real AI grading not exercised | med | provider key | evaluation receipt | AI provider key |
| CAP-08 | Speaking / Speak-or-Die / Speaking Partner (WebRTC) | `/speaking/*`, partner UI | `app/browser_speaking.py`, `live_partner_signaling.py` | 0001, 0025, 0027, 0036, 0082 | student | signalling unit tests | none | `IMPLEMENTED_UNVERIFIED` | no dual-browser call receipt | high | TURN + 2-browser drill | call log | TURN credentials |
| CAP-09 | Mock exams (lock/unlock, sections, grading) | `/mock/*` | `app/mock_system_port.py`, `mock_scoring_engine.py` | 0042, 0074 | student/teacher/admin | suite passes | none | `IMPLEMENTED_UNVERIFIED` | — | med | — | — | — |
| CAP-10 | RIWI AI abstraction, fallback, provenance | RIWI surfaces | `app/riwi_*` (60+ modules) | 0075–0079 | student/staff | contract tests pass | none | `IMPLEMENTED_UNVERIFIED` | live provider untested | med | provider key | live evaluation receipt | AI provider key |
| CAP-11 | Coin economy / leaderboard / market | `/study-plan/*`, `/api/coins/*` | `app/coin_rewards.py`, `coin_port.py` | 0084, 0091, 0092 | student | **30 DB tests pass on real PostgreSQL** (this pass) | none | `VERIFIED_LOCALLY` | fixture was stale — fixed here | med | — | `tests/test_coin_*` green | — |
| CAP-12 | Study plans (7/30-day, monthly, level) | `/study-plan/*` | `app/study_plan_*` | 0080, 0081, 0086, 0087 | student | suite passes except landing-bank equality | none | `PARTIAL` | in-app bank 150 vs landing 45 | low | reconcile banks | that test green | — |
| CAP-13 | Content CMS, versioning, imports | `/api/admin/content/*` | `app/step38–40_*`, `content_*` | 0040, 0041, 0044, 0047 | owner/admin/teacher | suite passes | none | `IMPLEMENTED_UNVERIFIED` | course hierarchy incomplete per README | med | — | — | — |
| CAP-14 | Private media on R2, signed access | media routes | `app/media_streaming.py`, `step19_storage.py` | 0000, 0064 | scoped | unit tests | none | `BLOCKED_EXTERNAL` | no R2 credentials here | high | owner R2 keys | signed URL receipt | R2 keys |
| CAP-15 | **Tuition contracts + approved discounts** | `/api/staff/finance/contracts*` | `app/tuition_port.py`, `tuition_ledger.py` | **1115** | owner/admin | **18 DB tests pass** incl. "price change never rewrites an obligation" | none | `VERIFIED_LOCALLY` | UI not built yet | high | staff UI | API receipts (recorded) | — |
| CAP-16 | **Charges, posting, reversal documents** | `/api/staff/finance/charges*` | same | **1115** | owner/admin | reversal + immutability tests pass | none | `VERIFIED_LOCALLY` | UI not built | high | staff UI | `UPDATE`/`DELETE` on journal raises | — |
| CAP-17 | **Payments, allocation, receipts, duplicate-callback safety** | `/api/staff/finance/payments*` | same | **1115** | owner/admin | 100× duplicate = 1 effect; 20-way race = 1 payment | none | `VERIFIED_LOCALLY` | UI not built | high | staff UI | race test green | — |
| CAP-18 | **Double-entry journal, balanced + append-only** | `/api/staff/finance/reconciliation` | same | **1115** | owner/admin | deferred trigger rejects unbalanced commit | none | `VERIFIED_LOCALLY` | GL export not built | med | CSV export | trigger receipt | — |
| CAP-19 | **Debtors / advances / overdue position** | `/api/staff/finance/summary`, `/statement` | same | **1115** | owner/admin, teacher read-scoped, student own | reconciliation test ties statement↔summary↔ledger | none | `VERIFIED_LOCALLY` | — | high | — | exact equality assertions | — |
| CAP-20 | **Cash day close with variance + period lock** | `/api/staff/finance/days/close`, `/periods/close` | same | **1115** | owner/admin | day-close blocks later postings | none | `VERIFIED_LOCALLY` | — | med | — | test green | — |
| CAP-21 | **Revenue recognition (separate from collection)** | `/api/staff/finance/revenue/recognize` | same | **1115** | owner/admin | bounded by deferred balance; payment alone recognises nothing | none | `VERIFIED_LOCALLY` | policy per buyer | med | config | test green | accounting basis |
| CAP-22 | Click/Payme provider adapter | — | — | — | — | — | none | `MISSING` | no merchant docs/keys | high | adapter behind flag | sandbox receipts | merchant onboarding |
| CAP-23 | Groups / cohorts, capacity, transfer | — | — | — | — | searched: no operational group table | none | `MISSING` | biggest operational gap | high | groups + enrollment slice | concurrency test | — |
| CAP-24 | Timetable, rooms, sessions | — | — | — | — | searched: none | none | `MISSING` | — | high | recurrence + collision guard | collision test | — |
| CAP-25 | Centre-grade lesson attendance | — | — | `live_class_attendance` is online-join only | — | searched | none | `MISSING` | distinct from CAP-08's online joins | high | attendance journal | correction-trail test | — |
| CAP-26 | Teacher payroll | — | — | — | — | searched | none | `MISSING` | — | P1 | effective-dated rules | period-lock test | contract terms |
| CAP-27 | Lead CRM pipeline | — | — | — | — | searched | none | `MISSING` | — | P1 | pipeline slice | dedupe test | — |
| CAP-28 | Multi-branch isolation | — | — | — | — | searched | none | `MISSING` | only if the buyer has branches | P1 | branch scope | cross-branch 403 test | — |
| CAP-29 | Student data import (Excel/CSV) | — | `src/lib/import/*` is content import, not students | — | — | searched | none | `MISSING` | — | high | mapping + dry-run pipeline | 10k-row receipt | — |
| CAP-30 | Backups / restore drill | — | — | — | — | none | none | `UNKNOWN` | no drill evidence | high | restore to isolated env | restore receipt | DB access |
| CAP-31 | 10,000-student capacity claim | — | — | — | — | **not load-tested in this pass** | none | `MISSING (evidence)` | no execution receipt | high | staged load run | latency/error receipt | infra budget |
| CAP-32 | Passkeys / WebAuthn | — | — | — | — | none | none | `MISSING` | P2 | med | — | — | — |
| CAP-33 | Camera face attendance | — | — | — | — | none | none | `MISSING (deliberately)` | biometric law + consent unresolved | high if attempted | keep off | privacy impact assessment | legal review |

## What this means commercially

* The learning product (CAP-05…CAP-14) is broad and mostly built; its blockers are
  **live-provider and live-infrastructure receipts**, not missing code.
* The money spine (CAP-15…CAP-21) went from a dark stub to a **tested** subledger in this
  branch. It has no staff UI yet — that is the next slice.
* The operational layer (CAP-23…CAP-25, CAP-29) is the largest honest gap between "very good
  IELTS site" and "academy operating system".
* Nothing in this matrix may be quoted to a buyer as production-verified: no row carries
  `VERIFIED_IN_PRODUCTION`.
