# Drizzle forward-baseline repair

**Purpose:** prevent `drizzle-kit generate` from treating the unchanged 0035 application schema as a new migration after the repository's snapshot history stops at 0027.

## Finding

`drizzle/meta/_journal.json` and SQL migrations are present through `0035_teacher_student_links`, but committed snapshots stop at `0027_snapshot.json`. Drizzle Kit's `generate` command needs a snapshot corresponding to the latest journal entry. Without it, the unchanged application schema is emitted as a spurious new migration. `drizzle-kit check` alone does not repair that missing snapshot.

## Repair performed

1. Created the isolated local QA database `learners_qa2` using `bash scripts/qa2-local-postgres.sh`; the repository's full journal applied as **36/36** migrations. This was the repository's designated local QA database only; Preview and Production were not contacted.
2. In a temporary, untracked output folder, copied the committed snapshots through 0027 and used the installed official Drizzle Kit generator with `src/db/schema.ts` to generate a current-schema snapshot. This generated state contains 97 tables and 37 enums and links its `prevId` to the actual 0027 snapshot id.
3. Installed that generator-produced snapshot as `drizzle/meta/0035_snapshot.json`. No hand-authored snapshot fields, ids, journal records or migration SQL were created. The journal remains exactly as committed through idx 35.
4. Ran `npx drizzle-kit check --dialect=postgresql --out=drizzle`; it returned **Everything's fine**.
5. Ran official generation against the repaired repository baseline; it reported **No schema changes, nothing to migrate** and did not modify the journal or produce a migration.
6. In a separate temporary output folder, added one probe table to a temporary schema and invoked the official generator. The output contained exactly one `CREATE TABLE "riwi_snapshot_probe"` statement; the generated next snapshot's `prevId` matched the new 0035 baseline snapshot id. Temporary probe outputs were removed.

## Honest limitation

This is a **forward-generation anchor**, not a reconstruction of each historical schema state. Snapshots 0028–0034 remain absent; the new 0035 snapshot represents the current source schema after migrations 0028–0035 and links to the last available committed snapshot 0027. It lets future official generator output start from the actual current application-schema state without inventing journal entries. Existing historical SQL and journal entries were not altered.

## RIWI additive migrations and ordering

After the repaired snapshot baseline was available, Drizzle Kit generated the additive RIWI migrations from `src/db/schema.ts`:

- `0036_riwi_core.sql` creates the RIWI conversation, knowledge, learning, provider-experiment, usage, and confirmation tables.
- `0037_riwi_governance_hardening.sql` adds scope consistency, rights/regression evidence, and integrity constraints.
- `0038_riwi_provider_experiment_idempotency.sql` was generated after the schema gained a per-actor experiment idempotency key and unique index. The generated `NOT NULL` column-add was hardened for upgrades: add nullable, backfill existing rows with a UUID-derived legacy key, then set `NOT NULL` and create the unique index. Fresh and populated-upgrade behavior still require the isolated PostgreSQL gate.

The accepted 0035 journal entry has `when: 1791500000000`, which is later than the current sandbox clock. That accepted entry was not edited. Drizzle Kit writes the current wall-clock time for new entries, which would make the migrator skip them; the locally added 0036–0038 journal times were therefore normalized to strictly increasing logical timestamps immediately after the accepted 0035 value. `drizzle-kit check` and a subsequent no-schema-change official generation both pass without timestamp warnings or extra SQL.

## Safety result

- The accepted journal history through idx 35 is unchanged; local additive entries now end at idx 38.
- New migration SQL is generated from the application schema by Drizzle Kit; 0038's add/backfill/not-null sequence is an explicit upgrade-safety hardening.
- Fresh isolated PostgreSQL application passed: `npm run qa:pg` reported migrations **39/39** plus fixtures.
- The populated 0037→0038 upgrade was exercised only on local `learners_qa2`: a legacy experiment row was inserted without the new column, the 0038 migration was replayed, and `legacy-<UUID>` backfill plus the unique index passed. The probe row was then removed.
- Preview 0029–0038: not applied; explicit owner approval is still required.
- Production: untouched.
