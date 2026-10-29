# RIWI AI — Remaining External Infrastructure Verification Requirements

Because the execution sandbox operates without outbound internet access or live production credentials, the following checks must be run in the staging environment before enabling production rollout flags:

1. **GitHub Remote Push**:
   - Outbound DNS/HTTPS to `github.com` is disabled inside the sandbox VM (`fatal: unable to access 'https://github.com/N-Muhammadjonov/learners_area.git/': Could not resolve host: github.com`).
   - Run `git pull /path/to/riwi-fastapi-integration-20261029.bundle feature/riwi-fastapi-integration-20261029` and `git push origin feature/riwi-fastapi-integration-20261029` from a network-connected workstation.
2. **Staging PostgreSQL / Supabase Migration Application (`0072`–`0074`)**:
   - Apply `0072_riwi_core_and_governance.sql`, `0073_riwi_assessments_and_security_signals.sql`, and `0074_riwi_speaking_sessions_and_activity_indexes.sql` against a staging PostgreSQL database (`TEST_DATABASE_URL`) and run live database integration tests.
3. **Cryptographic Signing Secrets in Environment**:
   - Ensure `AUTH_SECRET` (and optionally dedicated `RIWI_CURSOR_SECRET` and `RIWI_PORTABLE_SIGNING_SECRET`, each `>= 32` random bytes) are configured in staging/production environment variables. RIWI now fails closed if signing secrets are missing or `< 16` characters.
4. **Live External AI Provider Smoke Check**:
   - With `RIWI_EXTERNAL_AI_ENABLED=true`, `AI_EXTERNAL_ENABLED=true`, and provider keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY`) configured in staging, run a fixed-fixture Provider Lab experiment from `/app/owner/riwi` (`POST /api/riwi/owner/provider-lab`).
5. **Browser DOM (`jsdom`) Suite in CI**:
   - Run `npm ci && node --test frontend/vanilla/tests/*.test.mjs frontend/vanilla/tests/staff-final30/*.test.mjs` in GitHub Actions where `jsdom` and `postcss` are installed from npm.
6. **149 MB Media Corpus Verification**:
   - Run `pytest services/backend/tests/test_main_assets.py` in a checkout with the full `public/` and `services/backend/assets/` media corpus present.
