// J1–J5: the migration journal after the Content OS ⇄ learners-area-next integration.
//
// Two accepted lines diverged from the same base and BOTH created a migration whose
// ordinal was 0040: the Content OS line added `0040_content_imports` (already applied
// wherever the canonical import contract was exercised, and named by the API's own
// readiness error `qa_migration_0040_required`), and learners-area-next added
// `0040_typing_trainer`. Two different migrations cannot share an ordinal in one journal,
// so the newer, integration-side migration was renumbered to the next free ordinal
// (`0048_typing_trainer`) and the journal became the union in dependency order.
//
// These tests pin the rules that make that resolution safe, because the danger in a
// renumbering is not the ordinal — it is the *timestamps*. drizzle's PostgreSQL migrator
// decides what to apply with ONE comparison against the LAST applied row:
//
//     if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
//
// (drizzle-orm/pg-core/dialect.js). It does not consult the hash, so an entry whose
// `when` is not strictly greater than an already-recorded `when` is silently SKIPPED, and
// an entry whose `when` is greater is applied even if it is already there. A journal is
// therefore only safe if its `when` values are strictly increasing, and a renumbered
// migration must take a fresh, larger `when`.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as {
  entries: { idx: number; version: string; when: number; tag: string; breakpoints: boolean }[];
};

/** The rule the drizzle PG migrator actually implements, in one function. */
function planned(appliedCount: number): { apply: string[]; skip: string[] } {
  const last = appliedCount > 0 ? journal.entries[appliedCount - 1]!.when : null;
  const apply: string[] = [];
  const skip: string[] = [];
  for (const entry of journal.entries) {
    if (last === null || last < entry.when) apply.push(entry.tag);
    else skip.push(entry.tag);
  }
  return { apply, skip };
}

test("J1 the journal is well-formed: 52 entries, idx equals position, unique tags, strictly increasing when", () => {
  assert.equal(journal.entries.length, 52, "0000…0051 — the 48 Content OS migrations, the typing trainer, private lesson notes, the lesson learning area + Teacher Notes, and the Listening question revision set");
  journal.entries.forEach((entry, index) => {
    assert.equal(entry.idx, index, `${entry.tag}: idx must equal its position in the journal`);
    assert.equal(entry.version, "7");
    assert.equal(entry.breakpoints, true);
  });
  const tags = journal.entries.map((e) => e.tag);
  assert.equal(new Set(tags).size, tags.length, "no migration tag appears twice");
  const whens = journal.entries.map((e) => e.when);
  assert.equal(new Set(whens).size, whens.length, "no two migrations share a `when`: the migrator would skip one");
  for (let i = 1; i < whens.length; i++) assert.ok(whens[i]! > whens[i - 1]!, `${tags[i]} must be strictly newer than ${tags[i - 1]}`);
});

test("J2 the collision is resolved exactly once, and the migration that keeps 0040 is the one already applied", () => {
  assert.equal(existsSync("drizzle/0040_typing_trainer.sql"), false, "the typing migration no longer claims ordinal 0040");
  assert.equal(existsSync("drizzle/0048_typing_trainer.sql"), true, "it moved to the next free ordinal");
  assert.equal(existsSync("drizzle/0040_content_imports.sql"), true, "the content-imports migration keeps its ordinal");

  assert.equal(journal.entries[40]!.tag, "0040_content_imports");
  assert.equal(journal.entries[48]!.tag, "0048_typing_trainer");
  assert.equal(journal.entries.filter((e) => e.breakpoints).length, 52);

  // The kept entry keeps its ORIGINAL `when` — that value is recorded in every database
  // that applied it, so changing it would make the migrator re-apply (or skip) it.
  assert.equal(journal.entries[40]!.when, 1792000000000, "0040_content_imports keeps the timestamp it was applied with");
  // The renumbered entry takes a FRESH, strictly larger timestamp: it must not reuse the
  // value its old ordinal carried (1792000000000), which a database may have recorded.
  assert.ok(journal.entries[48]!.when > journal.entries[47]!.when, "the typing trainer is the newest step");
  assert.notEqual(journal.entries[48]!.when, 1792000000000);

  const typingSql = readFileSync("drizzle/0048_typing_trainer.sql", "utf8");
  assert.match(typingSql, /CREATE TABLE IF NOT EXISTS "typing_texts"/, "the file IS the typing trainer");
  assert.match(typingSql, /typing_runs_run_token_uq/);
  // A database that applied the typing migration under its old ordinal will have it
  // applied a second time under the new one (the migrator compares timestamps only), so the
  // file has to survive that. Every statement is IF NOT EXISTS, or is preceded by a drop.
  assert.match(typingSql, /DROP CONSTRAINT IF EXISTS "typing_run_texts_one_target_chk"/);
  assert.match(typingSql, /SELECT conname FROM pg_constraint/, "the preset check is dropped before it is re-added");
  assert.match(typingSql, /ON CONFLICT \("external_id"\) DO NOTHING/, "re-seeding the owner corpus is a no-op");
});

test("J3 every reachable prefix of the merged journal applies exactly its missing migrations", () => {
  // This is the invariant that matters: whatever a database has applied, running the
  // migrator must add the rest and touch nothing else — for EVERY prefix, not just the two
  // ends. A silent skip and a double apply are both failures here.
  for (let applied = 0; applied <= journal.entries.length; applied++) {
    const { apply, skip } = planned(applied);
    const expectedApply = journal.entries.slice(applied).map((e) => e.tag);
    assert.deepEqual(apply, expectedApply, `after ${applied} applied migrations the migrator must apply exactly the rest`);
    assert.deepEqual(skip, journal.entries.slice(0, applied).map((e) => e.tag), `and must never re-apply an applied migration (${applied})`);
  }
});

test("J4 the two source lines' own states stay safe under the merged journal", () => {
  // The Content OS line is the accepted line: its prefixes are the states a real database
  // can be in (the QA database is one of them). Its entries are unchanged in the merged
  // journal, so every prefix must behave exactly as J3 already proves — asserted here for
  // the two states that matter by name: 0039 (the last owner-approved migration) and 0047
  // (the full accepted Content OS schema).
  const contentOs = journal.entries.filter((e) => e.idx <= 47);
  assert.equal(contentOs.length, 48, "the accepted Content OS journal is untouched: 48 entries");

  const after0039 = planned(40);
  assert.equal(after0039.apply[0], "0040_content_imports", "the next step after 0039 is the import ledger");
  assert.equal(after0039.apply.length, 12, "0040…0051 are pending");

  const after0047 = planned(48);
  assert.deepEqual(after0047.apply, ["0048_typing_trainer", "0049_lesson_notes", "0050_lesson_learning_area", "0051_listening_question_revision"], "the accepted schema needs the typing trainer, the private notes table, the lesson learning area, then the Listening question-set revision column");

  // 0049 is hand-written too (the snapshot chain stops at 0027) and it is additive in
  // BOTH directions: it creates a table, and its backfill COPIES text into it before
  // clearing the legacy column only where the copy is provably present. Every statement
  // carries IF NOT EXISTS / ON CONFLICT so a re-apply cannot fail or lose data.
  const notesSql = readFileSync("drizzle/0049_lesson_notes.sql", "utf8");
  assert.match(notesSql, /CREATE TABLE IF NOT EXISTS "lesson_notes"/);
  assert.match(notesSql, /lesson_notes_user_lesson_uq/, "the unique index is the upsert contract");
  assert.match(notesSql, /ON CONFLICT \("user_id", "lesson_id"\) DO NOTHING/, "the backfill never overwrites a newer note");
  assert.match(notesSql, /AND n\."body" = p\."notes"/, "the legacy column is cleared only where the copy exists");

  // 0050 is hand-written in the same style and is ADDITIVE ONLY: it adds two nullable
  // columns, swaps two CHECK constraints and adds an index — it rewrites no lesson row,
  // so historical lesson data keeps its meaning and its content.
  const areaSql = readFileSync("drizzle/0050_lesson_learning_area.sql", "utf8");
  assert.match(areaSql, /ADD COLUMN IF NOT EXISTS "learning_area" varchar\(20\)/);
  assert.match(areaSql, /ADD COLUMN IF NOT EXISTS "teacher_notes" text/);
  assert.match(areaSql, /lessons_learning_area_chk/);
  assert.match(areaSql, /lessons_teacher_notes_len_chk/);
  assert.match(areaSql, /CREATE INDEX IF NOT EXISTS "lessons_learning_area_idx"/);
  assert.match(areaSql, /ALTER TYPE "upload_block_kind" ADD VALUE IF NOT EXISTS 'video'/);
  assert.doesNotMatch(areaSql, /\bUPDATE\s+("?lessons"?)\s+SET\b/i, "0050 must not rewrite historical lesson rows");
  assert.doesNotMatch(areaSql, /\bDELETE\s+FROM\b/i, "0050 must not delete anything");
  assert.doesNotMatch(areaSql, /DROP\s+COLUMN/i, "0050 must not drop a column");

  // 0051 is hand-written in the same style and is ADDITIVE ONLY: it adds one NULLABLE column,
  // its index and its foreign key, then backfills NOTHING. Every historical question row keeps
  // its identity and stays unversioned, which is what lets a historical attempt keep reading the
  // rows its answers were recorded against (§9, §10, §41).
  const revisionSql = readFileSync("drizzle/0051_listening_question_revision.sql", "utf8");
  assert.match(revisionSql, /ADD COLUMN IF NOT EXISTS "content_version_id" uuid/);
  assert.match(revisionSql, /CREATE INDEX IF NOT EXISTS "listening_questions_version_set_idx"/);
  assert.match(revisionSql, /ON DELETE set null/i, "deleting a revision must never delete a question");
  assert.doesNotMatch(revisionSql, /\bUPDATE\s+"?listening_questions"?\s+SET\b/i, "0051 must not rewrite an existing question row");
  assert.doesNotMatch(revisionSql, /\bDELETE\s+FROM\b/i, "0051 must not delete anything");

  // The learners-area-next line's accepted states are its prefixes up to 0039 (0040 is not
  // in ANY approved apply list, which is why the typing trainer ships with a bundled
  // fallback). A database at 0039 gets the same nine migrations as above — asserted
  // through the merged journal's own first 40 entries, which are byte-identical to both
  // lines' first 40.
  const sharedPrefix = journal.entries.slice(0, 40).map((e) => e.tag);
  assert.equal(sharedPrefix[39], "0039_academic_reading_sets");
  assert.equal(sharedPrefix.length, 40);
  assert.deepEqual(sharedPrefix, [...new Set(sharedPrefix)]);
});

test("J5 the journal never depends on a snapshot: the drizzle meta chain is untouched", () => {
  // Migrations 0028+ are hand-written because the snapshot chain stops at 0027. A
  // renumbering must not have silently regenerated or deleted a snapshot.
  for (const index of [0, 27]) {
    const name = `drizzle/meta/${String(index).padStart(4, "0")}_snapshot.json`;
    assert.equal(existsSync(name), true, `${name} must still exist`);
    JSON.parse(readFileSync(name, "utf8"));
  }
  assert.equal(existsSync("drizzle/meta/0028_snapshot.json"), false, "the snapshot chain still ends at 0027; the journal is hand-maintained (never drizzle-kit generate)");
});
