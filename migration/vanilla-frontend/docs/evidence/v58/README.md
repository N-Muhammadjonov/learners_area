# V58 status (hand-written summary; generated run outputs are not committed)

Branch `arena/96836bcf-learners-area`. Synthetic fixtures only; no live backend was contacted.

| Task | Status | Basis |
|---|---|---|
| My Progress course `Open` → `/app` | PASS (fixture) | `browser-progress-v54` 29/0 |
| Grammar V36 behaviour (parity, `/app/grammar`, `?tab=`) | PASS (fixture) | V36 behaviour 33/0 |
| Grammar V36 strict visual, 12 grammar cases | FAIL (not closed) | DOM and geometry identical; residual paint noise on the 81% progress-bar corner (max delta 50). Re-injecting the native element's own markup in place already gives 107 px diff (max 10). Harness method limitation, not a product defect. Gate kept strict. |
| Grammar V36 strict visual, course 1440 night | PASS | 1-level rounding tolerance (`maxChannelDelta <= 1`), documented in the test |
| Management V57 (routes, statistics, owner delete) | PASS (fixture) | `browser-staff-v58` 18/0; Staff unit 205 (194 pass, 11 env-gated skipped) |
| Management live `/api/frontend/staff/*` reads | BLOCKED | Read endpoints are PROPOSED, not implemented or live-verified. Consumers fail closed (502). |
| Mock Tests runner | DEFERRED | User decision. List-only page remains; `browser-mocks-v55` 28/0. |
| Speaking V53 / Writing V50 regressions | PASS (fixture) | Speaking smoke PASS; Writing V52 smoke 6/6; Speaking/Writing unit tests pass |

## Known gaps (not changed in V58)

- `kit.js`: a 404 from a staff read shows the generic "not found" page, not an integration-required notice. Acceptable for detail routes; for absent read endpoints it is misleading.
- Owner retention (`/app/owner/retention`) runs cleanup from its own button without a confirmation step. Preserved from the source (ledger finding F-1).
- Permanent deletion (`/app/admin/reading/retention`) is owner-only, two-step (native confirm, then exact label), and treats 409 as "still in use" without retry. Verified in fixtures.
