# Step 11 candidate, 2026-10-09

Base: `c133f97cabc086fdd14b9acb7f60c46a1cc92419`; publication target: `arena/01a10bac-learners-area`. This candidate does not change the parallel website branch or apply migrations.

## Changes

- Reading and Listening analysis have an explicit post-submission explanation button. The server loads the owned completed attempt, official result and authored source, verifies the submission fingerprint and canonical contract, and denies active exams, stale sources and missing historical evidence. Explanation provenance identifies `authored-source`; there is no claim of a live provider call. Scores and answer keys are never rewritten by this endpoint.
- Attempt starts serialize on the persisted active account; retries resume the owned attempt. Inactive accounts cannot start new attempts.
- The security review workflow executes registered regression fixtures on the server and requires same-owner, current-signal preview evidence. Replay, stale proof and invented fixture IDs cannot approve a signal. Transactional audits retain metadata only.
- Portable core authority comes through a versioned site adapter. Revocation during tool execution or audit suppresses returned data; authority lookups have bounded deadlines. A fake destination regression and transitive import audit check capability denial and the feature-table boundary.
- Owner commands require explicit scope and signed-session files. Export supports zero-write dry-run and private authenticated encryption. Import authenticates the archive before parsing, validates scope and freshness, preserves the destination bootstrap owner, and defaults to dry-run. Existing destination files are never overwritten. Imports never activate RIWI automatically.
- The learner-facing shadowing section is removed according to the visible owner instruction. Old bookmarks redirect to Speaking lessons. Historical data and compatibility contracts are retained.

## Operational commands

Run against an identified authorized environment only. `DATABASE_URL` comes from that environment; never put credentials in a report or command history. Session and key files must be private regular files, with permissions `0600`. The encryption key file contains exactly 32 raw bytes. Object inventory must come from the authorized source; a supplied list alone is not proof of R2 permissions or retention.

Dry-run examples (replace the placeholder paths and environment fingerprints with reviewed values):

```sh
node --conditions=react-server --import tsx scripts/riwi-portable-export.ts --scope learners-area --dry-run --source-fingerprint source-qa --session-file /private/session.jwt --inventory-file /private/inventory.json
node --conditions=react-server --import tsx scripts/riwi-portable-import.ts --source /private/archive.enc --expected-scope learners-area --dry-run --destination-fingerprint destination-qa --session-file /private/session.jwt --key-file /private/key.bin
```

Use an explicit `full-system` or `learners-area` scope. Export requires `--scope`, `--source-fingerprint`, `--session-file` and `--inventory-file`; artifact publication also requires a destination path and key file. Import requires `--source`, `--expected-scope`, `--destination-fingerprint`, `--session-file` and `--key-file`. Keep import in dry-run until the destination identity and plan are reviewed; `--apply` is the explicit apply action.

Scope `riwi` is intentionally rejected until identity reconciliation is implemented. Object policy is O1/keep-r2; O2 copying is not accepted by this operational workflow. Source and destination fingerprints must differ. The destination must be fresh except for one active bootstrap owner with the same UUID; a different identity fails rather than silently remapping authority. FK cycles and unsupported mappings fail with rollback. Following an uncertain commit, reconcile destination state before any retry. Preserve the encrypted artifact and safety point; never restore over production as a rehearsal.

## Verification and remaining boundaries

The previous native gate passed 1183 backend tests with 91 skips and 250 UI tests before later edits. It does not certify the current tree. Current focused evidence: 8 explanation tests, 15 portability tests, 56 security tests, 252 UI tests, TypeScript and lint passed; one additional Listening regression passed and its real-source companion skipped. Detailed logs and scope are in `RIWI-STEP-11-WORKING-QA-RESULTS.json`.

The owner instructed no restart, reset or rebuild. The final publication script runs two native non-build test/type/lint rounds and checks exact staged blobs and unchanged candidate state. It contains no build, reset, clean, rebase, merge or force push. Earlier build results are retained as historical evidence; last-source build acceptance is not claimed. If any gate fails, the script stops and leaves changes in place for correction. Do not rerun an apply script on an already patched checkout; continue from the stopped stage after reconciling the exact tree.

Progress remains 7/34 = 20.59% accepted groups. This batch's 14.71% scope is not earned progress. D02 remains partial, D09 remains open under the no-rebuild instruction, and no production GO or 100% is claimed. Native PostgreSQL clean-destination rehearsals, canonical original bank inputs, real R2/object lifecycle, live provider/browser acceptance and deployed backup/PITR remain separate outstanding evidence.

## Native round correction

The first final native backend round had 1288 tests: 1194 passed, 3 failed, 91 skipped. It did not commit or push. The correction uses the shared active-user guard and returns 401 for anonymous callers; the access audit now verifies the delegated handler's guard, denial and authenticated dispatch, matching the existing delegated chat/targets architecture. It preserves origin/IP limits before authentication, inactive-account denial and the service's transactional authority check. Two Uzbek strings now use ASCII apostrophes. The focused 32 tests, TypeScript and lint passed after correction.

Use `RIWI_STEP_11_RESUME_VERIFY_AND_PUSH.sh` for the already staged native candidate. It verifies all original staged blobs before applying only the correction, verifies the full resulting manifest, then runs two final non-build QA rounds. Do not reapply the original Step 11 patch. No reset, restart or rebuild is required.
