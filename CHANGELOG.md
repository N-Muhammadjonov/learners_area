# RIWI AI — FastAPI + Vanilla JS Integration Changelog

## Latest Hardening & Full-Suite Acceptance (`feature/riwi-fastapi-integration-20261029`)
- ** Baseline**: Integrated onto `main` (`1415ceee45a3fc18583a3b780fffd5cd6c519ae4`) and reconciled with PR #86 (`feat: bound AI provider concurrency and deduplicate paid requests`).
- **Cryptographic Signing Secret Hardening**:
  - Removed hardcoded fallback secrets (`"riwi-offline-deterministic-cursor-secret-v1"` and `"riwi-portable-manifest-secret-v1"`) from `services/backend/app/riwi_cursor.py`, `services/backend/app/riwi_role_surface.py`, and `services/backend/app/riwi_portability.py`.
  - Enforced minimum 16-character secret requirement from `RIWI_CURSOR_SECRET`, `RIWI_PORTABLE_SIGNING_SECRET`, `AUTH_SECRET`, or `JWT_SECRET` with domain-separated HMAC-SHA256 subkeys (`b"riwi:owner-history-cursor:v1"`, `b"riwi:target-cursor:v1"`, and `b"riwi:portable-manifest:v1"`), failing closed (`cursor_secret_not_configured` / `signing_secret_required`) when unset or `< 16` characters.
- **Bounded AI Provider Concurrency & Paid Request Deduplication**:
  - Added per-event-loop bounded concurrency semaphores (`RIWI_MAX_CONCURRENT_EXTERNAL_REQUESTS`, default `4`) and in-flight paid request deduplication (coalescing concurrent identical external requests via `asyncio.shield`) in both `services/backend/app/riwi_provider_router.py` (`dispatch_external_riwi_provider`) and `services/backend/app/step23_writing_provider.py` (`evaluate`).
  - Fixed `RegisteredProviderSpec` for `"anthropic"` (`model_env_var="ANTHROPIC_MODEL"`) and wired `_resolve_provider_model` into `dispatch_external_riwi_provider`.
- **End-to-End FastAPI HTTP Route Wiring & Fixes**:
  - Wired all 31 `/api/riwi/*` routes in `services/backend/app/riwi_port.py` (total `/api/` routes on `core.app`: `304` = `273` canonical `main` + `31` RIWI routes).
  - Fixed `UUID_RE` import in `services/backend/app/riwi_port.py`, aligned `review_security_signal` `state=` parameter, and unified `submit_riwi_student_feedback` in `services/backend/app/riwi_learning_signals.py` to support both `{correlationId, rating}` and `{conversationId, helpful, reason}` payloads.
  - Added `"provider_agreement"` to `LEARNING_SIGNAL_TYPES` and `PRODUCER_REQUIRED` in `services/backend/app/riwi_learning_signals.py`.
  - Added HTTP `Range: bytes=start-end` (`206 Partial Content`) handling in `services/backend/app/frontend_static.py`.
- **Vanilla JavaScript Frontend & Native Asset Build**:
  - Completed `RiwiClientAdapter` (`frontend/vanilla/js/adapters/riwi.js`), `createRiwiWorkspaceController` & `mount` (`frontend/vanilla/modules/riwi/index.js`), `renderObjectiveExplanationWidget` & `loadObjectiveExplanation` (`frontend/vanilla/modules/riwi/objective-explanation.js`), and `createOwnerRiwiControlRoom` & `mount` (`frontend/vanilla/modules/staff-final30/owner-riwi.js`).
  - Rebuilt versioned native static assets (`scripts/build_native_assets.py`): `448` files, `124` routes, revision `d7bfdb5bf1d18d74a197`.
- **Database Migrations (`0072`–`0074`)**:
  - Preserved all 71 existing SQL migrations (`0000`–`0069` and `0071_shared_abuse_limits.sql`) byte-for-byte.
  - Added forward-only additive migrations `0072_riwi_core_and_governance.sql`, `0073_riwi_assessments_and_security_signals.sql`, and `0074_riwi_speaking_sessions_and_activity_indexes.sql` in both `drizzle/` and `services/backend/migrations/`, with contiguous journal entries `0`–`73` in `drizzle/meta/_journal.json`.
