# Migration registration 0040–0048 (Content OS → integration review)

Status: **REVIEW PACKAGE — NOT AN APPROVAL TO APPLY ANYWHERE.**
Written on the session branch `arena/1052c0fd-learners-area` after the controlled merge of
`5b6510c` (Content OS) and `9b3c718` (`arena/learners-area-next`); merge base `31e10bd`.

## What this document registers

`scripts/preview-qa-migrate.mjs` refuses to run unless every pending migration is both
allowlisted and, where a hash is pinned, byte-identical to the reviewed SQL. The integration
branch registers the nine migrations the merged journal now carries after the frozen tip
(0039) and pins their hashes:

| ordinal | tag | sha256 (first 12) | review note |
| --- | --- | --- | --- |
| 0040 | `0040_content_imports` | `07061c332c84` | accepted Content OS ingest ledger; keeps its number because it is already applied on real targets and is named by the readiness error code `qa_migration_0040_required` |
| 0041 | `0041_content_versions` | `594b74d0e36b` | canonical revisions + attempt binding; FK to `content_imports` |
| 0042 | `0042_mock_composition` | `7323615d9a62` | mocks as orchestration over canonical content |
| 0043 | `0043_authoring_identity` | `e517578ebdf5` | authoring identity, revision snapshots, **widening** of `reading_questions.type_code` (see below) |
| 0044 | `0044_lesson_blocks` | `85b33a5fdecf` | typed native lesson blocks |
| 0045 | `0045_media_lessons` | `c9d728b966b5` | media lessons (references only, never bytes in the database) |
| 0046 | `0046_vocabulary_topic_packs` | `d0251d7d0f4f` | vocabulary packs through lexeme → sense → occurrence |
| 0047 | `0047_assignments_canonical` | `210927a617c2` | assignments/`assignment_targets` over canonical content + grammar integration |
| 0048 | `0048_typing_trainer` | `813f3c8566af` | the learners-area-next typing trainer, **renumbered** from its colliding 0040 |

Membership in `ALLOWED_PENDING` means "this script knows the migration and refuses an
unreviewed one". It is **not** owner approval of a Preview rollout: `--apply` still requires
the owner-approved URL fingerprint, the server identity match and a fresh
`PREVIEW_QA_BACKUP_REF`, and the owner must still approve applying them.

## The one reviewed "destructive-looking" statement

`DESTRUCTIVE` in the guard flags any `ALTER TABLE … ALTER COLUMN … TYPE`. `0043` contains
exactly one such statement:

```sql
ALTER TABLE "reading_questions" ALTER COLUMN "type_code" TYPE varchar(40);
```

It is a **widening** of `varchar(16)` → `varchar(40)` (the column could not hold canonical
Reading type ids such as `true_false_not_given`, 20 characters). Widening a `varchar` cannot
truncate existing values. The review is bound to exactly that statement in
`REVIEWED_SAFE_STATEMENTS` and to the pinned file hash, so it can never cover different SQL:
`tests/preview-qa-migrate.test.ts` asserts that replacing the widening with a narrowing is
refused.

## Migration journal integrity

* Only one true collision existed: **both lines created an ordinal 0040** (Content OS
  `0040_content_imports`, learners-area-next `0040_typing_trainer`) — and with the same
  `when` (1792000000000).
* Resolution: the already-applied, contract-named Content OS migration kept `0040`; the
  newer integration-side migration was renumbered to `0048_typing_trainer` with a fresh
  `when` (1792200600000). Its SQL text is unchanged, so its hash is unchanged.
* The journal is the union in dependency order — **49 entries**, `idx` == position, no
  duplicate `idx`/`tag`. `tests/content-migration-journal.test.ts` pins this.
* `drizzle/meta` snapshots were not edited and `drizzle-kit generate` was never run.

## Verified migration paths (this sandbox, real PostgreSQL)

| path | command | result |
| --- | --- | --- |
| fresh database | `npm run -s qa:pg` | **`migrations ok: 49 / 49`**, fixtures seeded |
| accepted Content OS state (48 applied, `5b6510c`) | merged-tree `migrate()` | **48 → 49 applied**, 2 typing tables, 4 new `typing_runs` columns, 30 corpus texts |
| a database that had applied **the learners-area-next journal alone** | merged-tree `migrate()` | **refused** — see below |
| the same database after the documented reconcile | merged-tree `migrate()` | **`MIGRATE OK`** — 49 distinct hashes, all canonical tables present, 30 corpus texts |

### The branch-local journal divergence (finding, not a defect in the merge)

Drizzle's migrator decides what to apply with
`select id, hash, created_at from drizzle.__drizzle_migrations order by created_at desc limit 1`
and applies a migration only when `Number(last.created_at) < migration.folderMillis`
(`node_modules/drizzle-orm/pg-core/dialect.js`). It is **not** journal-diff aware.

Because learners-area-next's `0040_typing_trainer` used the same `when` (1792000000000) as
`0040_content_imports`, a database that had applied the next-branch journal records that
value as its tip. Against the merged journal, `0040_content_imports` is then *not* applied
(its `folderMillis` is not greater than the tip) and `0041` runs onto missing objects:

```
MIGRATE FAILED: Failed query: ALTER TABLE "content_versions" ADD CONSTRAINT
"content_versions_content_import_id_content_imports_id_fk" FOREIGN KEY ("content_import_id")
REFERENCES "public"."content_imports"("id") ON DELETE set null ON UPDATE no action;
CAUSE: relation "public.content_imports" does not exist
```

Reproduced in this sandbox on a database built with
`git archive 9b3c718 | tar -x -C /tmp/next3` + `npx drizzle-kit migrate`
(`learners_nextbranch`: 41 applied, `typing_texts` present, `content_versions` absent; the
failure rolled back, leaving 41 applied).

**Reachability:** not through the accepted deployment path. `vercel.json` only pins a region,
the build is `next build`, and no deploy step runs migrations — migrations are applied by the
guard (`scripts/preview-qa-migrate.mjs`) or by an explicit `npm run db:migrate`. The guard
already **refuses** this state with `applied migrations after a pending one (gap)`, because it
compares hash sets, not timestamps. The divergence can therefore only exist in a stray
branch-local or developer database.

**Documented reconcile (owner action, stray databases only — never shared Production):**

1. Confirm the state before touching it: `41` applied rows, newest row hash
   `813f3c8566afa4c1c6df10584e7041f58576d9558f384cb81cfe623c8c415ef0` (created_at
   1792000000000), `public.content_imports` absent, `public.typing_texts` present.
2. In **one transaction**: execute `drizzle/0040_content_imports.sql` verbatim (its DDL is
   `IF NOT EXISTS`-guarded except the enum, which does not exist in this state), then insert
   the journal row with the journal's own values —
   hash `07061c332c848f89d17fd0510884a097eaabd01a429bf2d1f846e56d02a0a397`,
   `created_at` 1792000000000 — then commit. The row is written **only after its SQL ran**, so
   no journal history is faked.
3. Re-run `migrate()`. It applies 0041–0048; 0048 is re-applied because its `when` is the new
   tip and its SQL is idempotent (verified: `typing_texts 30 -> 30`, 20 statements). The
   database ends with 50 rows and **49 distinct hashes** — the branch's pre-applied typing
   migration shares the byte-identical file hash with 0048 — which is exactly what both the
   raw migrator and the guard's set-based planner read as "everything applied".

The 0048 idempotence matters for a second reason: any database at the *typing* tip can be
recovered by this procedure with no data loss, and no learner history is touched.

## Not claimed here

* This is not a Preview or Production migration receipt. No shared database was contacted
  from this environment and none was migrated.
* Applying 0040–0048 to the shared Preview remains **OWNER ACTION REQUIRED** through
  `scripts/preview-qa-migrate.mjs --plan` → backup → `--apply`.
* The frozen dictionary catalog and the Listening source ZIP remain owner assets and are
  unchanged by this document.
