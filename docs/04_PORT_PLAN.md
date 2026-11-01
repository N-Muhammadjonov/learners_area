# 04 — Sequential RIWI Port Plan (FastAPI + Vanilla JS)

## Execution Order & Dependency Graph

1. **Phase 1 — Additive Database Schema & Migrations (`0070`–`0072`)**:
   - Create `0070_riwi_core_and_governance.sql`, `0071_riwi_assessments_and_security_signals.sql`, `0072_riwi_speaking_sessions_and_activity_indexes.sql` in both `drizzle/` and `services/backend/migrations/`.
   - Update `drizzle/meta/_journal.json` and `src/db/schema.ts`.
   - Verify with `services/backend/tests/test_riwi_phase1_schema_migrations.py`.

2. **Phase 2 — Server-Side Identity, Authorization & Conversation Retention**:
   - Port `riwi_capabilities.py`, `riwi_contracts.py`, `riwi_rollout.py`, `riwi_errors.py`, `riwi_cursor.py`, `riwi_outbound_guard.py`, `riwi_audit.py`, `riwi_retention.py`, `riwi_conversations.py`, `riwi_role_surface.py`.
   - Verify with `services/backend/tests/test_riwi_phase2_auth_conversations.py`.

3. **Phase 3 — Default-Deny Tool Broker & Provider Router**:
   - Port `riwi_tool_broker.py` and `riwi_provider_router.py` (audit-before-execute, SSRF/DNS/redirect guards, PII/secret redaction, task-profile routing, timeouts, usage metrics).
   - Verify with `services/backend/tests/test_riwi_phase3_broker_router.py`.

4. **Phase 4 — Knowledge Engine, Owner Governance, Audit, 105 Assessment Contracts & Policy**:
   - Port `riwi_assessment_contracts.py`, `riwi_knowledge.py`, `riwi_learning_signals.py`, `riwi_security_signals.py`, `riwi_provider_lab.py`.
   - Verify with `services/backend/tests/test_riwi_phase4_governance_contracts.py`.

5. **Phase 5 — Cross-Module Educational Tools & RIWI Gateway**:
   - Port `riwi_tools_domain.py`, `riwi_gateway.py`, `riwi_port.py`, and wire into `services/backend/app/main.py`, `browser_reads.py`, and `browser_staff.py`.
   - Verify with `services/backend/tests/test_riwi_phase5_educational_gateway.py`.

6. **Phase 6 — Vanilla JS Frontend Integration**:
   - Create `frontend/vanilla/js/adapters/riwi.js`, `frontend/vanilla/modules/riwi/index.js`, `frontend/vanilla/modules/riwi/objective-explanation.js`, `frontend/vanilla/modules/staff-final30/owner-riwi.js`.
   - Register `/app/riwi` and `/app/owner/riwi`, add i18n keys to `en.js` and `uz.js`, rebuild static assets via `scripts/build_native_assets.py`.
   - Verify with `services/backend/tests/test_riwi_phase6_frontend_build.py`.

7. **Phase 7 — Portability (Modes A/B/C) & Scheduled Retention Worker**:
   - Port `riwi_portability.py` (closed table classification across all 108 tables, Mode A/B/C filtering, AES-256-GCM `LAP1` streaming envelope, manifest signing/verification, dry-run/apply import) and CLI scripts `scripts/riwi_chat_retention_worker.py` + `scripts/riwi_portable_archive.py`.
   - Verify with `services/backend/tests/test_riwi_phase7_portability_retention.py`.

8. **Phase 8 & 9 — Full Security/No-Regression Gate & Deliverable Packaging**:
   - Run complete test suite (`services/backend/tests/test_*.py`), generate `CHANGELOG.md`, `QA_RESULTS.md`, `REMAINING_EXTERNAL_CHECKS.md`, `INTEGRATION_INSTRUCTIONS.md`, and package `/tmp/RIWI_FASTAPI_VANILLA_COMPLETED.zip`.
