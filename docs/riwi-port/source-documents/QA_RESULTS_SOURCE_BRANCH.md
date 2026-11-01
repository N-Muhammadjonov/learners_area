# RIWI AI — Comprehensive QA & Regression Results

## 1. FastAPI Backend Regression Suite (`services/backend/tests/test_*.py`)
- **Test Files Executed**: 78 test files
- **Passed**: **2,751 tests** (including all **30 RIWI phase & E2E HTTP integration tests** across `test_riwi_phase1_schema_migrations.py` through `test_riwi_phase9_e2e_integration.py`, plus `test_main_function_parity.py` [1,529 passed], `test_writing_stealing_collection.py` [113 passed], `test_step40_265_methods.py` [68 passed], `test_source_differential_round2.py` [66 passed], `test_step20_190_methods.py` [57 passed], `test_writing_source_materials.py` [57 passed], `test_parity_qa_fixes.py` [43 passed], etc.)
- **Failed**: **0**
- **Skipped / Blocked by Omitted Media Corpus**: **300** (288 binary media asset checks in `test_main_assets.py` plus 12 asset-file checks referencing the 149 MB audio/image/dictionary shard corpus omitted from the source archive).

## 2. Vanilla JavaScript Frontend Regression Suite (`frontend/vanilla/tests/**/*.test.mjs`)
- **Node-Runnable Test Suites Executed**: 22 test files (**219 subtests passed, 0 failed**), including:
  - `riwi-integration.test.mjs` (5 subtests: EN/UZ key shape parity, `/app/riwi` & `/app/owner/riwi` protected routes and breadcrumbs, XSS escaping and post-submission objective explanation gate, Teacher/Owner target learner pagination & Owner Control Room tabs, and strict `node --input-type=module --check` ESM parsing across all RIWI JS files)
  - `staff-final30/routes.test.mjs` (3 subtests: all staff routes export `mount()`, patterns match V4 route table, zero staff modules touch `localStorage`, `sessionStorage`, `indexedDB`, `innerHTML`, `insertAdjacentHTML`, `eval`, or `new Function`)
  - `staff-v56.test.mjs` (15 subtests), `staff-v57.test.mjs` (19 subtests), `listening-v16.test.mjs` (23 subtests), `assignments-v59.test.mjs` (15 subtests), `listening-v14.test.mjs` (15 subtests), `listening-v17.test.mjs` (15 subtests), `video-v47.test.mjs` (15 subtests), `coach-v60.test.mjs` (14 subtests), `listening-v20.test.mjs` (14 subtests), `listening-v18.test.mjs` (13 subtests), `progress-v54.test.mjs` (11 subtests), `mocks-v55.test.mjs` (9 subtests), `grammar-v48.test.mjs` (8 subtests), `v61-v62.test.mjs` (8 subtests), `listening-v24.test.mjs` (6 subtests), `v63-four.test.mjs` (4 subtests), `speaking-v53.test.mjs` (3 subtests), `listening-body-v28.test.mjs` (2 subtests), `python-build-v69.test.mjs` (1 subtest), `writing-v51.test.mjs` (1 subtest).
- **Blocked by Offline Sandbox npm Packages (`jsdom` / `postcss`)**: 58 test files that import `jsdom` or `postcss` (not pre-installed in the offline VM sandbox).

## 3. Native Asset Build Verification (`scripts/build_native_assets.py`)
- **Status**: Passed (`staticBuild: true`, `nodeRequired: false`)
- **Compiled Files**: 448 files (`177` minified JS/CSS files), `124` routes, build revision `d7bfdb5bf1d18d74a197`.
