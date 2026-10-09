# RIWI step 05 — migration order repair

Baseline: `62a22ae53c451190c2f7f425f845c59ef2d9cb3f`, branch `arena/01a10bac-learners-area`.

## Defect and resulting behavior

The immutable journal places 0046–0048 after 0045 while their timestamps are lower. The Drizzle migrator selects pending SQL using the latest applied timestamp. On a populated database already at 0045, it skips 0046–0048 and can still execute 0049. A fresh database test that runs files in filename order does not detect that upgrade defect.

`npm run db:migrate` now runs the canonical chain by immutable SQL SHA-256 identity and journal index. Every recorded hash must exist in this chain with its original timestamp. Unknown or duplicate hashes, altered timestamps and unrelated gaps are rejected. Only the explicitly identified skip layout (0000–0045 plus 0049 recorded, 0046–0048 absent) can be repaired automatically. The runner executes those three SQL files and never replays 0049.

Pending SQL and its history records commit in one transaction under a PostgreSQL advisory transaction lock. SQL failure rolls back the pending schema and new history. Populated schemas without migration history are refused before creating history. A second successful run is a no-op. No original migration SQL, journal metadata or applied history rows are rewritten.

The production inspection script validates hashes and timestamps rather than timestamp-sorting the history; its approval flow is preserved. Native isolated QA bootstrap uses the canonical command. Preview-specific allowlists, identities and existing approval boundaries remain unchanged. CLI errors do not expose the database connection string.

## Current validation

- 27 tests passed, 0 failed, 0 skipped. Includes actual Drizzle upgrade reproduction on PGlite, recovery of the skipped layout, populated 0045 prefix upgrade, all 50 migrations on a fresh database, idempotence, rollback and divergent-history refusal.
- Existing Coach, RIWI security, chat retention and Preview migration guard tests passed in that same run.
- Typecheck and lint passed. JavaScript syntax, shell syntax and diff checks passed.
- `drizzle/` has no changes in this patch.

The database integration tests run PostgreSQL compiled to WebAssembly through PGlite, not a native PostgreSQL server. Native concurrency/upgrade proof and applying to any shared Preview or Production target remain open. No shared database was accessed or migrated. Direct `npx drizzle-kit migrate` bypasses this repair and is not the canonical command for this chain.

The step-04 migration timestamp blocker is addressed in source by this runner. Deployment acceptance still requires identifying the target, inspecting its exact history, and running the authorized native upgrade checks. This is not Production GO or overall RIWI completion.
