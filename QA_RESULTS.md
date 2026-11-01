# RIWI current-main QA — 2026-11-01

The exact local code checkpoint is `dd7bd2b01f61912b5a61ff28e01766a25a6a6311`. The full [validation report](docs/riwi-port/current-main-integration-20261101/README.md) and [machine receipt](docs/riwi-port/current-main-integration-20261101/VALIDATION.json) govern this candidate.

| Check | Result |
| --- | --- |
| Backend | 3306 passed, 36 subtests passed; 2 real TCP/WebSocket tests failed because the host denies `socket.bind`. Overall exit 1. |
| Frontend | 1262 passed, 0 failed, 11 skipped for the unavailable original Listening fixture. |
| Build | Passed using the project Python venv; 512 assets, 125 browser routes. |
| Owner policy PostgreSQL | 14 store checks and 5 HTTP checks passed. |
| Canonical domain PostgreSQL | 32 store checks and 7 HTTP assertions passed; 5 requests, zero provider network calls. |
| Migration rehearsal | Fresh and populated upgrade passed in PostgreSQL WASM; native server rehearsal remains open. |

Release remains **NO-GO**. No main merge or production deployment was performed. Earlier source-branch QA claims are preserved [for history](docs/riwi-port/source-documents/QA_RESULTS_SOURCE_BRANCH.md); they are not the current candidate's acceptance result.
