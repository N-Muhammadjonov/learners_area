# Controlled integration review — final report

Branch `arena/1052c0fd-learners-area` (Arena session branch, based on
`arena/learners-area-next`). Merge base `31e10bd`. This report covers the controlled
integration of the Content OS line with the learners-area-next line and the post-merge
verification. Numbers are the ones actually observed in this sandbox; nothing here is
extrapolated, and skips are reported as skips.

## 1–5. Sources, branch, final SHA

1. **Content OS source:** `5b6510c03a1a2a371ba21d09164000f90046558e`
   (`arena/1052c0fd-learners-area` before the merge) — declared READY FOR CONTENT-OS /
   INTEGRATION REVIEW at the end of Phase 2.
2. **Learners-area-next source:** `9b3c7186660187d349cccf01ec7b17043229f59d`
   (`arena/learners-area-next`) — untouched by this work and still its tip.
3. **Merge base:** `31e10bd91667c6f8940e16834d7f7bc3e011b1f5`; `main` is
   `bcbf3ebdf54039c3807fcf9479dec5b5c306a0ea` and was never pushed to or merged.
4. **Integration branch:** `arena/1052c0fd-learners-area` (the fixed Arena session
   branch). Both source histories are preserved: the merge commit has two parents, and
   neither source branch was rewritten, reset or rebased.
5. **Final SHA:** `8e0b12d650a1eefa3e7f2e8abd0e2116694ec7ef`, pushed and verified:
   `git ls-remote origin arena/1052c0fd-learners-area` returns exactly that SHA. Commit
   chain: `9f55bc7` (merge, 22 files, +3708/−641) → `1b17f36` (cp1) → `8e0b12d` (cp2).

## 6. Migration collisions and their resolution

* Exactly **one** true collision existed: both lines created an **ordinal 0040** — Content
  OS `0040_content_imports`, learners-area-next `0040_typing_trainer` — and both used the
  same journal `when` (1792000000000).
* Resolution by contract, not by side: `0040_content_imports` keeps its number (it is
  already applied wherever the canonical import contract was exercised, and
  `qa_migration_0040_required` is part of the accepted API contract), and the **newer,
  integration-side** migration was renumbered to `0048_typing_trainer` with a fresh `when`
  (1792200600000). Its SQL text is unchanged, so its hash is unchanged.
* The journal is the union in dependency order: **49 entries**, `idx` == position, no
  duplicate `idx` or `tag`; `drizzle/meta` snapshots untouched, `drizzle-kit generate`
  never run. `tests/content-migration-journal.test.ts` 5/0 pins this.
* **Fresh database:** `npm run -s qa:pg` → `migrations ok: 49 / 49`, fixtures seeded.
* **Upgrade from the accepted existing schema state** (a real database holding the
  Content OS state, `5b6510c`): merged-tree `migrate()` applied **48 → 49**, with the two
  typing tables, four new `typing_runs` columns and 30 corpus texts.
* **Branch-local journal divergence (finding, settled):** a database that had applied the
  *learners-area-next* journal alone records 1792000000000 as its tip, so drizzle's
  last-row-only comparison skips `0040_content_imports` and `0041` then fails on
  `relation "public.content_imports" does not exist` (reproduced: 41 applied, rolled back,
  `content_versions` absent). This state is **not reachable through the accepted deployment
  path** (`vercel.json` pins a region only, the build is `next build`, no deploy step runs
  migrations) and the guarded planner already refuses it with
  `applied migrations after a pending one (gap)` because it compares hash sets. A guarded,
  transaction-scoped reconcile (real DDL first, journal row second, then re-run) was
  executed here and the database ended **MIGRATE OK — 49 distinct hashes**, every canonical
  table present, 30 corpus texts intact. Full procedure and evidence:
  `docs/MIGRATION-APPROVAL-0040-0048.md`.

## 7. Overlapping files

Content OS changed 152 files, learners-area-next 21, and the overlap was 5:
`drizzle/meta/_journal.json`, `src/db/schema.ts`, `src/lib/i18n/en.ts`,
`src/lib/i18n/uz.ts`, `tests/navigation-performance.test.ts`. All four substantive ones are
unions verified to contain both sides' content (schema: `typing_texts` **and**
`content_imports`; both dictionaries: typing strings **and** the content-workspace/bank
strings; navigation test: both route sets). The journal was the only textual conflict.

## 8. Semantic resolutions (never "ours"/"theirs")

1. **`computeTypingMetrics` vs `computeTypingResult`** — the merge had made the legacy
   metric delegate to the prefix-based trainer metric, silently changing a published number
   and turning `listening-and-typing` red. Both contracts are accepted and are kept
   distinct: the legacy metric charges an unfinished run for the untyped rest; the trainer
   metric does not (`completion` carries it). Nothing else uses the legacy function.
2. **Typing writes on both schema states** — `insertTypingRunLegacy` /
   `insertTypingRunTextLegacy` write only pre-0048 columns via raw `sql`, so a verified run
   is saveable before *and* after 0048 (drizzle emits `default` for typed-nullable columns,
   which is why the typed insert could not be used pre-0048). The trainer's extra numbers
   stay in the completion payload.
3. **Writing entry** — the newer typing trainer is kept; the Content OS Suspense/region
   behaviour is kept; the obsolete server-side Band 8–9 model-text read is gone, and
   `tests/section-failure-isolation.test.ts` now asserts the merged contract (12/0).
4. **Typing corpus** — three U+2019 apostrophes removed (English possessives); the
   repository forbids typographic apostrophes in its own sources.
5. **Legacy inventory** — `typing_texts` and `src/lib/services/writing/typing-corpus.ts`
   are classified (COMPATIBILITY ONLY, successor named), inventory is now TOTAL **19**
   (KEEP 11 / COMPATIBILITY ONLY 7 / MANUAL REVIEW 1) and prints "no problems found";
   `typing_texts` is named as the one canonical-content-group member not yet revisioned
   through `content_versions`.
6. **Guarded migration surface** — 0040–0048 registered in `ALLOWED_PENDING` and
   hash-pinned; the single destructive-looking statement (0043's `varchar(16) → varchar(40)`
   widening) has a named, statement-scoped, hash-bound review; a narrowing change is refused.
   The unreviewed-newer-migration test no longer silently returns now that every journal
   entry is registered — it asserts the refusal against a synthetic future migration.

## 9. Contracts preserved — Content OS (21)

Structured import framework, canonical identity, content versions, publication (draft /
scheduled / published / archived; highest version ≠ learner-live), attempt version binding,
question-type registry, canonical Listening/Reading paths, canonical Writing types,
Speaking canonical identity and material mapping, Grammar integration, shared lexical
architecture, typed lessons, media lessons, canonical mocks as orchestration, canonical
assignments (`listAssignableContent` live/openable/authorized only, pinned stays pinned),
source identity/dedup by deterministic hash, native draft preview, cross-content
bank/search/filter, admin authoring workspace, cross-skill attempt timeline as a projection,
legacy inventory, Dictionary QA2 gating. Focused suites: **133 tests across 18 Content OS
files, 133 pass / 0 fail / 0 skipped** (imports 13+3+6+6, versioning 8, attempt binding 3,
authoring/publication 15, identity 6, registry 11, preview 6, bank 3, assignments 12, mocks
13, vocabulary packs 5, lessons/blocks, media lessons, timeline 5, migration journal 5).

## 10. Contracts preserved — Writing Typing and Listening

* **Writing Typing (learners-area-next):** `writing-typing` 17/0, `writing-typing-presets`
  9/0, `listening-and-typing` 13/0, `writing-admin` 10/0, `section-failure-isolation` 12/0.
  The trainer component, the five typing API routes, the rolling three-line stage,
  Full-mode pause/resume, server-authoritative metrics, the corpus and the timer/UI
  refinements all survive the merge.
* **Listening (learners-area-next + Content OS):** `listening-canonical-import` 13/0,
  `listening-import-discovery` 14/0, `listening-focus-layout-contract` 7/0,
  `full-listening-package` 7/0 (1 skip: owner ZIP), `listening-legacy-conversion` 6/0,
  `listening-regression-contract` 6/0, `listening-authored-formats` 4/0,
  `listening-authored-sandbox` 2/0, `listening-write-db` 1/0,
  `full-listening-write-db` 0/0 (1 skip: owner ZIP).
* **Speaking:** canonical identity 4/0, hub rebuild 10/0, practice 10/0, shared bank 2/0,
  study support 4/0, topic management 2/0, bank dry-run 1/0, QA2 bank import 4/0 — the
  smallest additive migration only, no RIWI merge, bank/history/audio retention intact.
* **Publication / mocks / grammar:** publication 9/0, mock summary 3/0, grammar-mastery
  12/0, grammar-privacy-db 1/0, grammar-publication-qa2 **1/0** (this is the suite that
  earlier read "0 pass / 0 fail": it is not empty, it is gated on `QA2_DATABASE_TESTS=1`
  and its single test skips in a default run — with the isolated database it executes and
  passes).
* **Dictionary:** `dictionary-model` 18/0; the two frozen-catalog suites skip with the
  explicit owner-artifact reason (below) — QA2 gating unchanged.

## 11–19. Repository gates (all on the final, pushed tree)

| gate | result |
| --- | --- |
| 11 focused suites | listed above — 0 failures anywhere |
| 12 `npm test` (unit, default env) | **1248 tests, 1152 pass, 0 fail, 96 skipped**, exit 0 |
| 13 `npm run test:ui` | **233 pass, 0 fail, 0 skipped**, exit 0 (jsdom — not browser acceptance) |
| 14 real PostgreSQL | `qa:pg` **49/49** migrations + fixtures; `qa:gate` real-pg **1248 total, 1244 pass, 0 fail, 4 skipped** |
| 15 `npx tsc --noEmit` | **exit 0** |
| 16 `npm run lint` | **exit 0** (`--max-warnings=0`) |
| 17 `npm run build` | **exit 0** — compiled successfully, 120/120 static pages |
| 18 `npm run qa:gate` | **GATE PASS** (unit-pglite, ui, real-pg, typecheck, lint, build, diff-check, diff-check-range), logs `/tmp/qa-gate` |
| 19 `git diff --check` | clean (also clean inside the gate's range check) |

The 96 default-env skips are environment-gated suites, not passes: 88 name
`QA2_DATABASE_TESTS=1`/`DATABASE_URL` (they execute in the gate's real-PG run) and the
remainder are the owner-asset suites below. The gate's real-PG run has **4** skips, each
naming its owner artifact.

**Environmental failure classification (D), proven:** five DB suites briefly reported
failures in per-file runs after the gate finished because the embedded PostgreSQL had been
stopped (`ECONNREFUSED` on localhost:5432); with the server restarted and no code change
they are green (`speaking-shared-bank` 2/0, `speaking-topic-management` 2/0,
`qa2-speaking-bank-import` 4/0, `grammar-privacy-db` 1/0, `grammar-publication-qa2` 1/0),
exactly as they were in the gate's real-PG run.

## 20. Vercel status

**Classified C — deployment/platform block, not a code regression.** Among 24 branch tips,
only `5b6510c` carries `failure: Deployment was blocked`; `785576f`, `9b3c718`, `31e10bd`
and `bcbf3eb` are green, `vercel.json` is unchanged, and every local gate passes on the same
tree. `5b6510c` is the single commit in the repository authored `agent@arena.local`. The
deployments API returns 403 ("Resource not accessible by integration") and the dashboard URL
requires an owner login, so external confirmation is owner-gated. No application code was
changed because of the status message.

## 21. OWNER ACTION REQUIRED

1. **Frozen dictionary catalog** — checksum-pinned owner asset
   (`ae4130d6…`, 62,376 lexemes); without it `dictionary-recent-qa2` and
   `dictionary-release-qa2` skip (they fail closed, never green-by-skip).
2. **Listening source ZIP** — owner asset; `full-listening-package` and
   `full-listening-write-db` skip without it.
3. **Owner approval to convert legacy Listening material**, and the copyright/manual-review
   item for external media (`MANUAL REVIEW REQUIRED` in the inventory).
4. **Applying 0040–0048 to the shared Preview** — still through
   `scripts/preview-qa-migrate.mjs --plan` → fresh `PREVIEW_QA_BACKUP_REF` → `--apply`;
   registration in this branch is not approval (see `docs/MIGRATION-APPROVAL-0040-0048.md`).
5. **Vercel**: unblock/confirm the platform status for the Content OS commit; nothing in the
   repository explains it.

## 22. EXTERNAL REQUIRED

Real browser acceptance (§105) — no real browser was driven here and jsdom output is never
counted as one. Performance profile (§106) — not performed. RIWI staging credentials — not
present, so no live-partner evaluation was exercised.

## 23. Remaining P0/P1 gaps

**P0: none.** **P1:** `typing_texts` is the one canonical content group not yet revisioned
through `content_versions` (named in the inventory and in the shared-table note; the corpus
is otherwise provenance- and publication-aware); the branch-local journal divergence above
(owner note, not reachable through the accepted path); the six matrix rows
L29/L41/L72/L80/L103/L115/L116 from the Content OS coverage matrix were not separately
re-verified in this review.

## 24. Scope

**No `/app` migration happened.** No route moved under `/app`, no global `/app` shell was
introduced, `main` was never touched, no branch was force-pushed, and no shared database was
migrated from this environment. The `/app` master prompt has not started.

## 25. Declaration

Every repository-level gate on the final pushed tree `8e0b12d` is green: typecheck, lint,
build, `git diff --check`, unit tests, UI tests, real-PostgreSQL tests, the migration gate,
and the focused Content OS / Writing Typing / Listening / Speaking / Publication / Mocks /
Assignments / Imports / Dictionary-gating suites. The only non-green items are the owner/
external ones above, which are explicitly not repository-solvable.

**READY FOR FULL /app CONVERSION** — to be started only on the owner's instruction, and only
after the owner actions in §21 are scheduled (the dictionary catalog and Listening ZIP
remain prerequisites for their own acceptance runs, not for the conversion's local
contracts).
