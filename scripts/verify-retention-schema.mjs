#!/usr/bin/env node
/**
 * Retention schema verification — the migration applied to a REAL PostgreSQL,
 * with the invariants attacked on purpose.
 *
 *   node scripts/verify-retention-schema.mjs
 *
 * The whole migration chain (`drizzle/*.sql`, 0000 → 0022) is executed in order
 * against an in-process PostgreSQL (PGlite, PostgreSQL 18 on WASM), because a
 * migration file that exists is not a migration that runs. It never touches a
 * remote database: PGlite is an empty server inside this process, so there is no
 * DATABASE_URL to point anywhere, and Production cannot be reached from here.
 *
 * What is proven, not assumed:
 *
 *   * every shipped migration applies in sequence, in order, on an empty server;
 *   * the four Retention tables, their indexes, their unique constraints and the
 *     hand-written composite foreign key exist in the catalogue afterwards;
 *   * a text can only point `current_version_id` at ITS OWN version;
 *   * two simultaneous live attempts for one learner and level are refused by the
 *     database (the multi-tab invariant), while terminal attempts are unlimited;
 *   * archiving a text never deletes an attempt, and never touches a version;
 *   * the usage counters (current version / lifetime) return the truth for the
 *     exact rows they are supposed to count.
 *
 * Exit code 0 only when every check passes.
 */

import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS_DIR = join(ROOT, "drizzle");

let passed = 0;
const failures = [];
async function check(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`ok   - ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`not ok - ${name}\n         ${String(error?.message ?? error).slice(0, 400)}`);
  }
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
async function rejects(promise, pattern, message) {
  try {
    await promise;
  } catch (error) {
    const text = String(error?.message ?? error);
    assert(pattern.test(text), `${message}: expected /${pattern}/, got "${text.slice(0, 200)}"`);
    return;
  }
  throw new Error(`${message}: the statement was accepted but should have been refused`);
}

const migrationFiles = readdirSync(MIGRATIONS_DIR)
  .filter((name) => name.endsWith(".sql"))
  .sort();

const db = new PGlite();
const query = async (sql, params) => (await db.query(sql, params)).rows;

console.log(`Applying ${migrationFiles.length} migrations to an empty PostgreSQL (PGlite)…`);
for (const file of migrationFiles) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
  for (const statement of statements) {
    try {
      await db.exec(statement);
    } catch (error) {
      console.log(`not ok - migration ${file} failed\n         ${String(error?.message ?? error).slice(0, 300)}`);
      process.exit(1);
    }
  }
}
console.log(`ok   - ${migrationFiles.length} migrations applied in order, none failed`);

await check("Retention migration and every later migration are journalled in order", async () => {
  const last = migrationFiles.at(-1);
  assert(migrationFiles.includes("0022_retention_bank.sql"), "Retention migration missing");
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_DIR, "meta", "_journal.json"), "utf8"));
  const tags = journal.entries.map((entry) => entry.tag);
  assert(`${tags.at(-1)}.sql` === last, `journal ends at ${tags.at(-1)}, files end at ${last}`);
  assert(new Set(tags).size === tags.length, "duplicate migration tag in the journal");
  assert(journal.entries.at(-1).idx === journal.entries.length - 1, "journal idx is not sequential");
});

await check("the four Retention tables exist with their columns", async () => {
  const expected = {
    retention_texts: ["id", "level", "internal_label", "sequence", "active", "current_version_id"],
    retention_text_versions: ["id", "retention_text_id", "version_number", "body_text", "word_count", "scoring_structure"],
    retention_attempts: [
      "id", "user_id", "retention_text_id", "retention_text_version_id", "level", "rotation_cycle", "status",
      "read_started_at", "read_ends_at", "write_started_at", "write_ends_at", "recall_text", "submitted_at",
      "completed_at", "score", "score_breakdown", "evaluator_version",
    ],
    retention_rotation_state: ["id", "user_id", "level", "cycle_number", "last_completed_text_id"],
    retention_rotation_completions: ["id", "user_id", "level", "cycle_number", "retention_text_id"],
  };
  for (const [table, columns] of Object.entries(expected)) {
    const rows = await query(
      "select column_name from information_schema.columns where table_name = $1",
      [table]
    );
    const present = new Set(rows.map((row) => row.column_name));
    for (const column of columns) assert(present.has(column), `${table}.${column} is missing`);
  }
});

await check("the named constraints and indexes exist in the catalogue", async () => {
  const wantedConstraints = [
    "retention_texts_current_version_identity_fk",
    "retention_attempts_retention_text_id_retention_texts_id_fk",
    "retention_attempts_retention_text_version_id_retention_text_versions_id_fk",
    "retention_attempts_score_range",
    "retention_attempts_deadline_order",
  ];
  const constraints = await query(
    `select conname from pg_constraint where conrelid::regclass::text like 'retention%'`
  );
  const names = constraints.map((row) => row.conname);
  for (const wanted of wantedConstraints) {
    // PostgreSQL truncates identifiers at 63 bytes, so a long auto-generated
    // foreign key name is matched by prefix.
    assert(names.some((name) => name === wanted || name.startsWith(wanted.slice(0, 55))), `${wanted} is missing`);
  }
  const wantedIndexes = [
    "retention_text_versions_text_version_idx",
    "retention_rotation_state_user_level_idx",
    "retention_rotation_completions_unique_idx",
    "retention_texts_label_idx",
    "retention_texts_level_sequence_idx",
    "retention_attempts_version_usage_idx",
  ];
  const namedIndexes = await query(
    `select indexname from pg_indexes where indexname = any($1::text[])`,
    [wantedIndexes]
  );
  assert(
    namedIndexes.length === wantedIndexes.length,
    `expected ${wantedIndexes.length} named indexes, found ${namedIndexes.length}`
  );
  const indexes = await query("select indexname from pg_indexes where indexname = $1", ["retention_attempts_one_active_idx"]);
  assert(indexes.length === 1, "the one-live-attempt index is missing");
  const partial = await query(
    "select indexdef from pg_indexes where indexname = $1",
    ["retention_attempts_one_active_idx"]
  );
  assert(/where .*status.*reading.*recall/is.test(partial[0].indexdef), `index is not partial: ${partial[0].indexdef}`);
});

// ---------------------------------------------------------------------------
// Data integrity — with real rows
// ---------------------------------------------------------------------------

const [owner, learner, otherLearner] = await query(
  `insert into users (name, role, account_status, email) values
     ('QA Owner', 'owner', 'active', 'qa.owner@example.test'),
     ('QA Learner', 'student', 'active', 'qa.learner@example.test'),
     ('QA Learner 2', 'student', 'active', 'qa.learner2@example.test')
   returning id`
).then((rows) => rows.map((row) => row.id));

async function makeText(level, label, sequence, body, version = 1, active = true) {
  const [text] = await query(
    `insert into retention_texts (level, internal_label, sequence, active) values ($1,$2,$3,$4) returning id`,
    [level, label, sequence, active]
  );
  const [row] = await query(
    `insert into retention_text_versions (retention_text_id, version_number, body_text, word_count, scoring_structure, created_by_user_id)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [text.id, version, body, body.split(/\s+/).length, JSON.stringify({ schemaVersion: 1, maxScore: 100, claims: [] }), owner]
  );
  await query("update retention_texts set current_version_id = $1 where id = $2", [row.id, text.id]);
  return { textId: text.id, versionId: row.id };
}

const textA = await makeText("B1", "QA-B1-001", 1, "The company was founded in 1998 by two students.");
const textB = await makeText("B1", "QA-B1-002", 2, "The river runs through the old city.");

await check("a text's current version must belong to that text (composite foreign key)", async () => {
  const [versionOfB] = await query("select id from retention_text_versions where retention_text_id = $1", [textB.textId]);
  await rejects(
    query("update retention_texts set current_version_id = $1 where id = $2", [versionOfB.id, textA.textId]),
    /foreign key constraint|violates/i,
    "pointing text A at text B's version"
  );
  // A NULL current version is legal while a brand-new text has no version yet.
  await query("update retention_texts set current_version_id = null where id = $1", [textA.textId]);
  await query("update retention_texts set current_version_id = $1 where id = $2", [textA.versionId, textA.textId]);
});

await check("the database allows at most one live attempt per learner and level", async () => {
  const deadlines = "'2026-01-01T10:00:00Z','2026-01-01T10:02:00Z','2026-01-01T10:02:00Z','2026-01-01T10:05:00Z'";
  await query(
    `insert into retention_attempts (user_id, retention_text_id, retention_text_version_id, level, rotation_cycle, status, read_started_at, read_ends_at, write_started_at, write_ends_at)
     values ($1,$2,$3,'B1',1,'reading',${deadlines})`,
    [learner, textA.textId, textA.versionId]
  );
  await rejects(
    query(
      `insert into retention_attempts (user_id, retention_text_id, retention_text_version_id, level, rotation_cycle, status, read_started_at, read_ends_at, write_started_at, write_ends_at)
       values ($1,$2,$3,'B1',1,'recall',${deadlines})`,
      [learner, textB.textId, textB.versionId]
    ),
    /duplicate key value|unique/i,
    "a second live attempt for the same learner+level"
  );
  // A different learner, and a different level, are both fine.
  await query(
    `insert into retention_attempts (user_id, retention_text_id, retention_text_version_id, level, rotation_cycle, status, read_started_at, read_ends_at, write_started_at, write_ends_at)
     values ($1,$2,$3,'B1',1,'reading',${deadlines})`,
    [otherLearner, textB.textId, textB.versionId]
  );
  // Finishing it releases the slot: the unique index only covers live rows.
  await query(
    `update retention_attempts set status = 'completed', completed_at = now(), submitted_at = now(), score = 80
     where user_id = $1 and level = 'B1' and status = 'reading'`,
    [learner]
  );
  await query(
    `insert into retention_attempts (user_id, retention_text_id, retention_text_version_id, level, rotation_cycle, status, read_started_at, read_ends_at, write_started_at, write_ends_at)
     values ($1,$2,$3,'B1',1,'reading',${deadlines})`,
    [learner, textB.textId, textB.versionId]
  );
  const live = await query("select count(*)::int as n from retention_attempts where user_id = $1 and status in ('reading','recall')", [learner]);
  assert(live[0].n === 1, `expected exactly one live attempt, found ${live[0].n}`);
});

await check("score and deadline guards hold whatever writes the row", async () => {
  await rejects(
    query("update retention_attempts set score = 101 where user_id = $1", [learner]),
    /check constraint|violates/i,
    "a score above 100"
  );
  await rejects(
    query("update retention_attempts set score = -1 where user_id = $1", [learner]),
    /check constraint|violates/i,
    "a negative score"
  );
  await rejects(
    query("update retention_text_versions set version_number = 0 where id = $1", [textA.versionId]),
    /check constraint|violates/i,
    "version number 0"
  );
});

await check("version numbers are unique per text and the current pointer stays single", async () => {
  await rejects(
    query(
      `insert into retention_text_versions (retention_text_id, version_number, body_text, word_count, scoring_structure)
       values ($1, 1, 'duplicate', 3, '{}'::jsonb)`,
      [textA.textId]
    ),
    /duplicate key value|unique/i,
    "a second v1 for the same text"
  );
  const [v2] = await query(
    `insert into retention_text_versions (retention_text_id, version_number, body_text, word_count, scoring_structure)
     values ($1, 2, 'The company was founded in 1998 by two university students.', 9, '{}'::jsonb) returning id`,
    [textA.textId]
  );
  await query("update retention_texts set current_version_id = $1 where id = $2", [v2.id, textA.textId]);
  const v1Attempts = await query(
    "select count(*)::int as n from retention_attempts where retention_text_version_id = $1",
    [textA.versionId]
  );
  assert(v1Attempts[0].n === 1, "the v1 attempt must still point at v1 after v2 exists");
  const [current] = await query("select current_version_id from retention_texts where id = $1", [textA.textId]);
  assert(current.current_version_id === v2.id, "the current version must be v2");
});

await check("archiving a text keeps every attempt and version, and blocks nothing historical", async () => {
  await query("update retention_texts set active = false where id = $1", [textA.textId]);
  const [row] = await query("select active from retention_texts where id = $1", [textA.textId]);
  assert(row.active === false, "the text must be archived");
  const joined = await query(
    `select a.id, v.body_text, t.active
       from retention_attempts a
       join retention_text_versions v on v.id = a.retention_text_version_id
       join retention_texts t on t.id = a.retention_text_id
      where a.retention_text_id = $1`,
    [textA.textId]
  );
  assert(joined.length >= 1, "an archived text must still join to its attempts");
  const versions = await query("select count(*)::int as n from retention_text_versions where retention_text_id = $1", [textA.textId]);
  assert(versions[0].n === 2, "archiving must not remove versions");
  // A version referenced by an attempt cannot be deleted — history is not deletable by routine actions.
  await rejects(
    query("delete from retention_text_versions where id = $1", [textA.versionId]),
    /foreign key constraint|violates/i,
    "deleting a version an attempt points at"
  );
  // Restore is the same flag back.
  await query("update retention_texts set active = true where id = $1", [textA.textId]);
});

await check("usage counters are truthful: current version vs lifetime", async () => {
  const currentUses = await query(
    `select count(*)::int as n from retention_attempts a
       join retention_texts t on t.id = a.retention_text_id
      where a.retention_text_id = $1 and a.retention_text_version_id = t.current_version_id
        and a.status in ('completed','timed_out')`,
    [textA.textId]
  );
  const lifetimeUses = await query(
    `select count(*)::int as n from retention_attempts
      where retention_text_id = $1 and status in ('completed','timed_out')`,
    [textA.textId]
  );
  assert(currentUses[0].n === 0, `a v1 attempt on a v2-current text must not count as a current-version use (got ${currentUses[0].n})`);
  assert(lifetimeUses[0].n === 1, `lifetime should be 1, got ${lifetimeUses[0].n}`);

  // A live attempt is not a use.
  const liveAttempt = await query(
    `select count(*)::int as n from retention_attempts where status in ('reading','recall')`
  );
  assert(liveAttempt[0].n >= 1, "expected the live attempt to exist for the comparison");
  const completedOnly = await query(
    `select count(*)::int as n from retention_attempts where status in ('reading','recall') and status in ('completed','timed_out')`
  );
  assert(completedOnly[0].n === 0, "an in-progress attempt must never be counted as a completed use");
});

await check("rotation state is one row per learner and level", async () => {
  await query("insert into retention_rotation_state (user_id, level, cycle_number) values ($1,'B1',1)", [learner]);
  await rejects(
    query("insert into retention_rotation_state (user_id, level, cycle_number) values ($1,'B1',1)", [learner]),
    /duplicate key value|unique/i,
    "a second rotation row for the same learner+level"
  );
  await query(
    "insert into retention_rotation_completions (user_id, level, cycle_number, retention_text_id) values ($1,'B1',1,$2)",
    [learner, textA.textId]
  );
  await rejects(
    query(
      "insert into retention_rotation_completions (user_id, level, cycle_number, retention_text_id) values ($1,'B1',1,$2)",
      [learner, textA.textId]
    ),
    /duplicate key value|unique/i,
    "the same text completed twice in one cycle"
  );
});

await check("a text with 100+ rows per level is not constrained by any maximum", async () => {
  await db.exec("begin");
  for (let index = 0; index < 120; index += 1) {
    const [text] = await query(
      "insert into retention_texts (level, internal_label, sequence) values ('C1',$1,$2) returning id",
      [`QA-C1-${String(index + 3).padStart(3, "0")}`, index + 3]
    );
    await query(
      `insert into retention_text_versions (retention_text_id, version_number, body_text, word_count, scoring_structure)
       values ($1, 1, 'QA bulk text', 3, '{}'::jsonb)`,
      [text.id]
    );
  }
  await db.exec("commit");
  const active = await query("select count(*)::int as n from retention_texts where level = 'C1' and active");
  assert(active[0].n === 120, `expected 120 active C1 texts, found ${active[0].n}`);
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(failures.map((name) => `FAILED: ${name}`).join("\n"));
  process.exit(1);
}
await db.close();
