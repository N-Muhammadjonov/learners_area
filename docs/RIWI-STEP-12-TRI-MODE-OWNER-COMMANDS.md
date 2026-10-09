# Step 12: explicit tri-mode owner commands

Base: `e11872b24932908f936d9849565e405df0580cfa`. This continues the verified Step 11 tree without resetting, rebuilding, changing branches or touching the parallel website branch.

## Behavior

The owner CLI now accepts explicit A/full-system, B/riwi and C/learners-area scope. A preserves allowed site and RIWI data. C excludes RIWI intelligence and conversations. B exports only global/role RIWI knowledge, its eligible descendants and governance tables. User-scoped sources, units, conflicts and private ancestor references are excluded; users, chats, learner submissions and site records never enter B.

Mode B object references must belong to a matching global/role knowledge source in the same database snapshot. A supplied inventory cannot relabel a private or missing source as public. This database proof does not establish real R2 access; object policy remains O1/keep-r2. O2 copy/read-back and lifecycle acceptance remain in D04.

Mode B import requires an explicit private identity-map file. Its JSON format is:

```json
[
  {"sourceId": "SOURCE_GOVERNANCE_UUID", "targetId": "DESTINATION_OWNER_UUID"}
]
```

Replace placeholders with reviewed UUIDs. The map is one-to-one, has at most 1000 entries and accepts no supplied role field. Every target must already be an active owner in the destination database. Missing, duplicate, many-to-one, unused and invalid-target mappings fail and roll back. An empty array is valid only when the archive contains no governance actor references. The map is never read from the archive and never changes a user's identity, credentials or role. A/C reject identity-map arguments; their bootstrap owner identity must already match the allowed source owner.

Imports use a transaction-level relation lock to serialize restores, then lock/revalidate owner rows before freshness checks. The destination must have empty tables for the chosen scope; B may use an existing site's users. Duplicate primary keys are detected during dry-run as well as apply. Missing primary keys fail rather than generating unrelated identities. Checksums, scope, counts, file paths and object metadata are checked; even a rehashed manifest cannot authorize private B objects or unknown modes.

B imports never activate source approvals. Active/approved knowledge becomes candidate. Policy activeVersion clears and approved versions become candidate. Approved security signals become candidate. Conflict resolutions reopen. Prior approval/regression fields clear. The reviewed identity map only preserves allowed authored provenance; it does not prove destination review. Destination regression and explicit owner review are still required before activation. A intentionally retains allowed restore state; target app boot/cutover remains an operational acceptance step.

## Commands and recovery

Use an identified authorized source/destination environment with `DATABASE_URL` supplied privately. Session, 32-byte raw encryption key, inventory and mapping files must be private regular files with mode `0600`. Do not place credentials in commands, logs or reports.

Mode B export dry-run:

```sh
node --conditions=react-server --import tsx scripts/riwi-portable-export.ts --scope riwi --dry-run --source-fingerprint reviewed-source --session-file /private/session.jwt --inventory-file /private/inventory.json
```

To publish an encrypted artifact, remove `--dry-run` and add `--destination /private/riwi.lap --key-file /private/key.bin`. Existing files cannot be overwritten.

Mode B import dry-run (the default):

```sh
node --conditions=react-server --import tsx scripts/riwi-portable-import.ts --source /private/riwi.lap --expected-scope riwi --dry-run --destination-fingerprint reviewed-destination --session-file /private/session.jwt --key-file /private/key.bin --identity-map-file /private/identity-map.json
```

Review the plan and identities before replacing `--dry-run` with explicit `--apply`. A/C use the matching expected scope without an identity-map file. The receipt prints the manifest hash and, for B, the normalized mapping hash without actor IDs. Keep the reviewed map privately with the encrypted archive and recovery checkpoint. Source/destination fingerprints must differ.

On pre-commit failure, the transaction rolls back. On an uncertain COMMIT, stop and reconcile exact destination state before any retry; do not overwrite or automatically retry. Objects and deployment data must be reconciled separately. Do not restore over production as a rehearsal.

## Acceptance

Local command rehearsals use isolated PGlite databases and synthetic rows. They are not native PostgreSQL, canonical source-bank, real R2 or production restore proof. Focused tests and logs are recorded in `RIWI-STEP-12-QA-RESULTS.json`. No new schema, dependency or migration is introduced.

The publication script checks the exact base, clean native checkout, patch checksum and staged blob manifest, then runs two native backend/UI/typecheck/lint rounds. It does not reset or rebuild. D02 remains pending native gates and remote verification until that publication is independently checked. D03's broader cycles/identity reconciliation, D04 real object lifecycle, D05 clean-destination/app-boot rehearsals and D09 last-source build acceptance remain open. This packet does not claim an 11-point increase or production GO.
