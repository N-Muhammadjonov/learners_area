# RIWI implementation ledger

Statuses: `PASS`, `FAIL`, `BLOCKED`, `EXTERNALLY UNVERIFIED`, `OWNER ACTION REQUIRED`, `NOT APPLICABLE WITH REASON`.
This is the phase checkpoint ledger; the final requirement-by-requirement acceptance ledger will be `docs/RIWI-FINAL-ACCEPTANCE-LEDGER.md`.

## Start checkpoint

- Starting session branch: `arena/01a10332-learners-area`
- Starting SHA: `a83351a3d2fcc2e81fc024e5e1a308f3410864b9`
- Required `origin/feature/riwi-full-build`: same SHA.
- Remote `origin/arena/learners-area-next` observed at the same SHA.
- Worktree: clean before implementation.
- Production touched: NO.
- Shared Preview touched: NO.
- Provider live call: NO; existing provider-matrix evidence says no key is configured in the QA environment.

## Checkpoint 0 — forensic baseline

| Requirement | Status | Evidence / notes |
|---|---|---|
| BASE-001 — baseline relation | PASS | Starting Arena HEAD equals the requested RIWI feature baseline and the observed current integration SHA. |
| BASE-002 — preserve work | PASS | Worktree was clean; no unknown files/process residue was removed. |
| FOUND-001 — current-state truth table | PASS | `docs/RIWI-CURRENT-STATE-TRUTH-TABLE.md`; source/tests/migrations mapped. |
| FOUND-002 — distinguish evaluator from system | PASS | `docs/RIWI-ARCHITECTURE.md`; current Coach provider is preserved as a component, not claimed as the whole system. |
| Prompt review | PASS | Two-pass review completed from the authoritative full-scope prompt/context carried in this task: pass 1 captured the functional Phase 0–20 build; pass 2 captured security boundaries, migration approvals, external evidence, and non-claims. The prompt remains controlling; each detailed requirement is to be linked to code/tests/evidence in the final ledger. |
| Baseline unit suite | PASS with skips | `npm test`: 947 passed, 0 failed, 90 skipped (including external source/provider gates; skips are not PASS). |
| Baseline UI suite | PASS | `npm run test:ui`: 205 passed, 0 failed. |
| Baseline typecheck | PASS | `npm run typecheck`. |
| Baseline lint | PASS | `npm run lint`. |
| Baseline runtime | PARTIAL | Installed lockfile dependencies; Node 22.22.3 is below declared Node 24.x engine. |
| Migration generator baseline | PASS for forward generation; historical metadata PARTIAL | Added generator-produced `drizzle/meta/0035_snapshot.json` as a current-schema anchor linked to 0027; the journal is byte-for-byte unchanged. `drizzle-kit check` passed; official generation against the repaired baseline reported no changes; a temporary one-table probe generated only its one table with a linked snapshot. Historical 0028–0034 snapshots remain absent and are explicitly not claimed restored. No migration was applied. |
| Shared Preview migration apply | OWNER ACTION REQUIRED | Not requested or attempted. |
| Provider live verification | EXTERNALLY UNVERIFIED | No live call made; credential presence is checked by name only before any possible live test. |
| Listening source package | OWNER ACTION REQUIRED | `LISTENING_SOURCE_ZIP` not supplied/proven by this phase; source tests remain skipped. |
| W13 author content | OWNER ACTION REQUIRED | Existing content contract remains authoritative; no content invented. |
| Live Partner / R2 acceptance | EXTERNALLY UNVERIFIED | Not re-run in Phase 0; preserve existing evidence and re-test only if RIWI code changes affect these paths. |

## Phase status

| Phase | Purpose | Status | Checkpoint |
|---|---|---|---|
| 0 | Forensic baseline | PASS | Docs and baseline tests recorded. |
| 1–20 | Full RIWI build / acceptance | NOT STARTED | Will be updated with each logical code checkpoint; external and shared-DB gates remain independent. |
