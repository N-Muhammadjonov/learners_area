# Backend regression follow-up — 2026-11-09

Current follow-up: Reading integrity fixes, 67 real PostgreSQL checks, complete asset restoration and scoped measurements are in [07-reading-integrity-followup.md](07-reading-integrity-followup.md). Earlier results below remain historical evidence. Manual stability is deferred by the user; overall Phase 2 remains PARTIAL.

Automated regression: PASS. Overall Phase 2 acceptance: PARTIAL.

Repository: `N-Muhammadjonov/learners_area`  
Working branch: `arena/learners-area-next`  
Tested remote parent: `20d91288bb4f8ffc7d1ba0d089c501ff4ab08f08`  
Tested edits: exact SHA-256 per file in `06-backend-validation.json`. The push receipt identifies the resulting commit.

## Result

All 17 inherited backend failures are resolved. They were stale verification data: ten inventory assertions expected 340 methods instead of the 345 already registered, five SEO assertions expected obsolete homepage copy or imagery, and two Listening database fixtures omitted `audio_url`.

No production runtime code was changed. No API routes were removed, tests disabled, database migrations applied, main updates made, or production deployments performed.

| Check | Passed | Failed | Skipped | Time | Receipt |
|---|---:|---:|---:|---:|---|
| Full backend pytest | 5,923 + 282 subtests | 0 | 0 | 127.67 s | `backend-final.log`, `backend-final.xml` |
| Five-endpoint guard and inventory tests, separately | 11 | 0 | 0 | 3.294 s | `access-checks.log`, `access-checks.xml` |
| Full frontend Node suite | 1,385 of 1,396 | 0 | 11 | 93.000 s | `frontend-complete.log` |
| Restored Listening source contracts, separately | 22 | 0 | 0 | 1.256 s | `frontend-source-restored.log` |
| Python runtime readiness | PASS | 0 | — | — | `runtime-check.log` |
| Local static build | PASS, incomplete asset checkout | 0 | — | — | `build-complete.log` |

Targeted runs overlap the full suites. Do not add the totals. Pytest JUnit records 6,205 cases including the 282 subtests, while the terminal summary reports 5,923 tests plus 282 subtests. Frontend skips retain the existing `LEGACY_LISTENING_FIXTURE` requirement.

Commands:

```sh
cd services/backend
python3 -m pytest -q --tb=short --junitxml=backend-final.xml
python3 -m pytest -q tests/test_phase2_backend_inventory_access.py --junitxml=access-checks.xml
# From repository root:
npm test
python3 scripts/serve.py --check
python3 scripts/build_native_assets.py
```

Environment: Python 3.12.14, pytest 9.1.1, FastAPI 0.121.3, Node v24.22.1. Backend and frontend suites ran on the same shared host, concurrently for part of their execution. These timings are test receipts, not performance comparisons.

## Endpoint access evidence

| Method | Endpoint | Missing credentials | Invalid credentials | Database reached |
|---|---|---:|---:|---|
| GET | `/api/internal/telegram/directory/{userId}/results` | 401 | 401 | No |
| POST | `/api/internal/telegram/contacts/{telegramUserId}/remove` | 401 | 401 | No |
| GET | `/api/riwi/materials` | 401 | 401 | No |
| POST | `/api/riwi/conversations/{conversation_id}/archive` | 401 | 401 | No |
| POST | `/api/riwi/documents/export` | 401 | 401 | No |

Each request uses a real FastAPI TestClient route, checks the exact error body and `nosniff` response header, and installs a database tripwire that fails the test if called. Missing and invalid bearer/session cases are parametrized separately. A further test preserves historical inventory counts and classifies the five additions as `ported_code_no_db_integration_test`.

The manifest now exactly matches all 345 runtime method/path pairs. Historical 272/304/340-method records are retained. The extra entries describe existing endpoints; they add no runtime routes and claim no successful authenticated database integration.

## Listening and SEO assertions

Listening fixtures now contain realistic audio URLs. Assertions verify that accessible days expose their own URL, locked learner days expose none, and teacher catalogue access retains audio. Existing order, sequence-lock, and pagination checks remain active.

SEO tests follow the current Phase 1 welcome page and SVG brand image. Canonical origin, hostile-host rejection, JSON-LD, preview noindex, CSP, and unauthenticated rendering checks remain active. The UI was not changed to satisfy old tests.

## Restoration and limits

The local source materialization lacked several test inputs. Required SQL/source/editorial fixtures were restored from the exact remote parent and checked against Git blob hashes. These restored files are already present in the remote tree and are excluded from the push.

Six legacy runtime assets remain unavailable locally: four PNG files and two OCR language archives exceed the source-transfer limit. Their remote bytes are preserved because the commit is built on the existing remote tree and changes only explicitly listed files. The local build is therefore a packaging smoke check, not a complete-asset release artifact. The source-verification receipt lists the six paths.

This follow-up closes the backend regression and five anonymous-access checks. It does not close original protected audio playback, Safari/device coverage, continuous 60-minute four-journey soak, adverse-network browser lifecycle checks, production health/capacity, or authenticated PostgreSQL integration for the five newly inventoried endpoints. Those dimensions remain unverified. Overall Phase 2 stays PARTIAL.
