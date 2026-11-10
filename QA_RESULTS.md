# RIWI current-main QA — 2026-11-02

Latest completion/training status is in the [2026-11-02 review](docs/riwi-port/completion-20261102/README.md). The capability gate fails; no trained language model is claimed. The full [validation report](docs/riwi-port/current-main-integration-20261101/README.md) and [machine receipt](docs/riwi-port/completion-20261102/VALIDATION.json) govern this candidate.

| Check | Result |
| --- | --- |
| Backend | 3353 passed, 36 subtests passed; 2 real TCP/WebSocket tests failed because the host denies `socket.bind`. Overall exit 1. |
| Frontend | 1270 passed, 0 failed, 11 skipped for the unavailable original Listening fixture. |
| Build | Passed using the project Python venv; 513 assets, 125 browser routes. |
| New contract persistence probe | 14 store checks + 2 HTTP checks passed. |
| Owner policy PostgreSQL | 14 store checks and 5 HTTP checks passed. |
| Canonical domain PostgreSQL | 32 store checks and 7 HTTP assertions passed; 5 requests, zero provider network calls. |
| Current-main Mock / Writing PostgreSQL | 91 Mock and 19 Writing HTTP checks passed. |
| Migration rehearsal | Fresh and populated upgrade passed in PostgreSQL WASM; native server rehearsal remains open. |

Release remains **NO-GO**. No main merge or production deployment was performed. Earlier source-branch QA claims are preserved [for history](docs/riwi-port/source-documents/QA_RESULTS_SOURCE_BRANCH.md); they are not the current candidate's acceptance result.
