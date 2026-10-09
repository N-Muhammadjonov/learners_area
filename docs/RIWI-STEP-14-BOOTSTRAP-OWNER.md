# Step 14: explicit A/C bootstrap owner reconciliation

Base: `423383914d468b6b7c419f9aaa2254d12c4f89f5`. Step 13 is independently remote-verified with 7/7 expected blobs and two native non-build QA rounds. This change continues the preserved checkout without reset or rebuild.

## Problem and resulting behavior

A/full-system and C/learners-area previously rejected every identity map. A fresh destination with a different bootstrap owner UUID could not restore an otherwise valid source. They now optionally accept one explicit source-owner -> initiating destination-owner pair through the existing private `--identity-map-file` input.

The source user row must exist in the verified archive and declare an active owner. Destination authority still comes from the database-backed active owner guard, rechecked and locked within the serialized restore transaction. Missing/unused mappings, student-to-owner mappings, unrecognized targets and conflicting rows reject the import. A/C cannot map arbitrary learners or multiple owners. Mode B retains its independent one-to-one governance mapping and candidate-state rules.

The source bootstrap owner row is skipped, preserving all destination owner identity and login fields. Only schema-declared foreign keys to users, including user-backed primary keys, are rewritten. Other users retain their original IDs, roles and credentials. Embedded JSON, object keys and historical text are not searched or rewritten as identities. Password reset tokens remain excluded by the closed archive classification. The normalized mapping hash is returned for every explicitly mapped mode without disclosing actor IDs.

Dry-run performs no row writes. Apply uses the existing constrained transaction and checksum validation. Failure rolls back and no automatic retry is added. The existing same-UUID path remains supported without a mapping file.

## Operator workflow

Use the existing encrypted import command with explicit A/full-system or C/learners-area expected scope and a private one-entry JSON file of `sourceId` and `targetId`. Keep the session/key/map files private as required by the CLI. Run the default dry-run, inspect the scope, manifest and mapping hashes, then invoke explicit `--apply` only for the reviewed isolated destination. The destination must be fresh except for its initiating active owner.

## Evidence and boundaries

Encrypted A/C source-to-target tests verify owner and learner references, a user-backed profile primary key, source-owner exclusion, destination password preservation, Mode C RIWI exclusion, zero-write dry-run, invalid mapping rejection and rollback. Existing same-UUID A, mapped B, cycle, duplicate, uncertain-commit, encryption, boundary and site-adapter regressions also pass. Exact results and log hashes are in `RIWI-STEP-14-QA-RESULTS.json`.

D03 remains PARTIAL. Native PostgreSQL concurrency/restore acceptance, wider multi-owner identity handling, object reconciliation and app-boot rehearsals remain open. No group closes, no percentage points are earned and no production GO is claimed. The publication script runs two native backend/UI/typecheck/lint rounds without a build before a non-force push.

## Native QA correction

The first native backend round failed two new assertions because random source UUIDs changed which correctly denied identity check appeared first. The original source-owner-only error expectation was too narrow for owner-first ordering. This repair changes tests, not authorization behavior: all four A/C × owner-first/learner-first cases use fixed source UUID ordering and assert the exact corresponding rejection. Invalid apply also verifies zero dependent attempts/profiles and one unchanged destination owner. The failed native log remains recorded in the QA report. Two new full native non-build rounds are required before publication.
