# 01 — Current State & Branch Audit (`CURRENT_SITE` vs `LEGACY_RIWI`)

## 1. Verified Source Provenance

| Source Tree | Git Branch | Verified Commit SHA | Exported File Count | Integrity Status |
|---|---|---|---|---|
| `LEGACY_RIWI` (reference only) | `arena/01a10bac-learners-area` | `b28408abdf0006a0855b02ca8828b69b9231e434` | 452 | `TESTED_LOCALLY` (SHA-256 verified against `MANIFEST.json`) |
| `CURRENT_SITE` (target runtime) | `arena/learners-area-next` | `7db87af1911657f4fde16cea353d2e5f89a9d3ce` | 984 | `TESTED_LOCALLY` (SHA-256 verified against `MANIFEST.json`) |
| `MAIN_REFERENCE` | `main` | `7e916a02ef7be3192f42bfd054fcf432318fbb47` | Reference SHA | Documented in `MANIFEST.json` |

### Skipped Source Files in `MANIFEST.json`
The offline handoff exporter skipped exactly 4 files from `LEGACY_RIWI`:
1. `docs/RIWI-BATCH-15-SCHEMA-INVENTORY.json` (1,789,675 bytes — exceeds max source size)
2. `docs/RIWI-FINAL-REQUIREMENT-LEDGER.jsonl` (11,263,730 bytes — exceeds max source size)
3. `scripts/verify-migration-tooling.mjs` (9,607 bytes — excluded by secret scanner heuristic)
4. `tests/riwi-security.test.ts` (54,307 bytes — excluded by secret scanner heuristic; all security requirements are reconstructed and tested in Python under `services/backend/tests/`)

## 2. Target Architecture (`CURRENT_SITE`)

- **Backend Runtime**: Python 3 + FastAPI (`services/backend/app/main.py`, ASGI entry `services/backend/app/asgi.py`).
- **Frontend Runtime**: Native HTML5 + CSS3 + Vanilla JavaScript ES modules (`frontend/vanilla/`), compiled and fingerprinted into `services/backend/app/static/` via `scripts/build_native_assets.py`.
- **Database Layer**: PostgreSQL via `asyncpg` connection pool (`services/backend/app/db.py`), with forward-only SQL migrations in both `drizzle/` and `services/backend/migrations/`.
- **Storage & Media**: Cloudflare R2 presigned upload/download intents (`services/backend/app/storage_port.py`, `r2_sigv4.py`, `upload_validation.py`).
- **Authentication & CSRF**: Server-verified `la_session` JWT cookie with live database role/status re-verification (`services/backend/app/auth_session.py`, `step11_auth_source_port.py`) and strict Origin/Referer CSRF middleware (`services/backend/app/security.py`).

## 3. Existing RIWI / Coach Capabilities Already in `CURRENT_SITE`

1. **Deterministic Evaluators (`services/backend/app/step31_riwi_evaluators.py`, `step31_riwi_text.py`)**:
   - Deterministic IELTS Writing (Task 1 & Task 2), Speaking (Parts 1/2/3/general/mock with pronunciation strictly limited/null), Grammar (`correct_it`, `translate_it`, `activate_it`), Vocabulary, and Assignment evaluators.
2. **Coach Orchestration & Persistence (`services/backend/app/step31_coach.py`, `step31_learning_production.py`, `step32_writing_riwi.py`, `step33_assignment.py`)**:
   - Persists rows into `evaluations` and `coach_weaknesses`, enforces provider timeouts, and falls back deterministically to internal `riwi`.
3. **Owner AI Control (`services/backend/app/owner_ai_control_port.py`, `frontend/vanilla/modules/staff-final30/owner-integrations.js`)**:
   - Exposes `GET/POST /api/owner/ai-control` and persists `ai.control.set` settings in `audit_log`.
4. **Canonical Domain Engines**:
   - **Dictionary**: `step17_dictionary_read_port.py`, `dictionary_context.py`, `step21_meaning_access.py`, `step21_dictionary_entry_save.py`.
   - **Reporter**: `step37_reports.py`, `step37_report_exports.py`, `report_metric_specs.json`.
   - **Retention**: `step27_retention_policy.py`, `step35_retention_attempts.py`, `step35_retention_scoring.py`.

## 4. Missing RIWI Capabilities in `CURRENT_SITE` (Ported in This Package)

1. **Database Schema & Migrations**:
   - 11 RIWI governance, chat, policy, experiment, usage, and security tables plus 2 speaking AI session tables and 10 RIWI enums (`0036`–`0050` in `LEGACY_RIWI`, which collide with `0036`–`0069` in `CURRENT_SITE` and are ported forward-only as `0070`–`0072`).
2. **All 20 `/api/riwi/*` Endpoints**:
   - Chat gateway (`POST /api/riwi/chat`), conversations (`GET/DELETE /api/riwi/conversations/{id}`), targets (`GET /api/riwi/targets`), presence (`POST /api/riwi/presence`), student feedback (`POST /api/riwi/feedback`), objective explanations (`POST /api/riwi/objective-explanation`), learning signals (`GET/POST /api/riwi/learning-signals`, detail, review, materialization), and owner governance endpoints (`audit`, `diagnostics`, `knowledge`, `provider-lab`, `security-signals`, `assessment-policies`).
3. **RIWI Core Services**:
   - Default-deny capability matrix (`riwi_capabilities.py`), server-owned intent/request/response contracts (`riwi_contracts.py`), rollout flags (`riwi_rollout.py`), outbound PII/secret guard (`riwi_outbound_guard.py`), HMAC-bound owner history cursors (`riwi_cursor.py`), tool broker (`riwi_tool_broker.py`), provider router (`riwi_provider_router.py`), 105 assessment contracts + owner overlay policies (`riwi_assessment_contracts.py`), knowledge ingestion/conflict/approval/promotion (`riwi_knowledge.py`), learning signals (`riwi_learning_signals.py`), security signals (`riwi_security_signals.py`), provider lab (`riwi_provider_lab.py`), educational domain tools (`riwi_tools_domain.py`), gateway (`riwi_gateway.py`), and portability Modes A/B/C (`riwi_portability.py`).
4. **Vanilla Frontend Modules**:
   - `/app/riwi` (`frontend/vanilla/modules/riwi/index.js`), `/app/owner/riwi` (`frontend/vanilla/modules/staff-final30/owner-riwi.js`), objective explanation widget (`frontend/vanilla/modules/riwi/objective-explanation.js`), client adapter (`frontend/vanilla/js/adapters/riwi.js`), route registrations, and EN/UZ i18n copy.
