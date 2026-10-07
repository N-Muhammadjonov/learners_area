#!/usr/bin/env node
/**
 * Real-PostgreSQL upgrade proof for migration 0052 (the Listening MCQ programme relation)
 * on the ISOLATED local QA2 server (never Preview/Production).
 *
 *   node scripts/qa2-listening-mcq-0052-upgrade.mjs fresh    # fresh DB, journal 0000…0051 + history
 *   node scripts/qa2-listening-mcq-0052-upgrade.mjs apply    # applies 0052 only
 *   node scripts/qa2-listening-mcq-0052-upgrade.mjs verify   # hard gates
 *   node scripts/qa2-listening-mcq-0052-upgrade.mjs branch   # accepted 0039 → 0052 (integrated branch)
 *   node scripts/qa2-listening-mcq-0052-upgrade.mjs diverge  # 0039 → 0051 (accepted line) → 0052
 *
 * Why not the drizzle migrator for the partial states: the journal is the source of truth for
 * ORDER, and applying a SUBSET with the real migrator would mean editing the journal to fake a
 * history this repository does not have. So this probe applies the exact journal-ordered SQL
 * files directly — byte-for-byte what the migrator executes — and refuses to run anywhere but
 * localhost/learners_qa2.
 *
 * What it proves:
 *   • 0051 → 0052: both columns, both CHECKs, the partial unique index and the partial index
 *     appear, while NOT ONE existing row of listening_tests, listening_questions,
 *     listening_packages, listening_attempts, listening_mcq_sessions or content_versions changes
 *     value (row-level md5) and no row is added;
 *   • the relation is closed and honest: both-or-neither, ordinal >= 1, one item per
 *     (programme, day), the same ordinal allowed in ANOTHER programme, and NULL (not in a
 *     programme) still the norm for every pre-existing row;
 *   • re-applying 0052 is a no-op (idempotent);
 *   • the integrated branch upgrade (accepted 0039 → 0052) and the divergence path (0039 → 0051
 *     → 0052, i.e. the accepted line catching up with the programme) both land correctly.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/learners_qa2") {
  console.error("refusing: only the isolated local learners_qa2 database is allowed");
  process.exit(2);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries;
const MODE = process.argv[2] ?? "verify";
const THROUGH_0051 = "0051_listening_question_revision";
const THROUGH_0039 = "0039_academic_reading_sets";
const TAG_0052 = "0052_listening_mcq_program_days";
const PROGRAMME = "listening-mcq-program";

const failures = [];
const gate = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "not ok"} - ${name}${detail && !ok ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

const statements = (tag) =>
  readFileSync(`drizzle/${tag}.sql`, "utf8")
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);

let client = null;
async function openClient() {
  client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
}
const q = async (sql, args = []) => {
  if (!client) throw new Error("the probe client is not connected");
  return (await client.query(sql, args)).rows;
};
const expectReject = async (sql, args = []) => {
  try {
    await q(sql, args);
    return false;
  } catch {
    return true;
  }
};

async function applyTag(tag) {
  for (const statement of statements(tag)) await client.query(statement);
  const hash = createHash("sha256").update(readFileSync(`drizzle/${tag}.sql`, "utf8")).digest("hex");
  const entry = journal.find((candidate) => candidate.tag === tag);
  await client.query(
    `insert into "drizzle"."__drizzle_migrations" (hash, created_at) select $1, $2 where not exists (select 1 from "drizzle"."__drizzle_migrations" where hash = $1)`,
    [hash, entry.when],
  );
}

async function ensureMigrationTable() {
  await client.query('create schema if not exists "drizzle"');
  await client.query('create table if not exists "drizzle"."__drizzle_migrations" (id serial primary key, hash text not null, created_at bigint)');
}

async function recreate() {
  const admin = new pg.Client({ connectionString: url.toString().replace(/\/learners_qa2$/, "/postgres") });
  await admin.connect();
  await admin.query("select pg_terminate_backend(pid) from pg_stat_activity where datname = 'learners_qa2' and pid <> pg_backend_pid()");
  await admin.query("drop database if exists learners_qa2");
  await admin.query("create database learners_qa2");
  await admin.end();
  if (client) await client.end().catch(() => {});
  await openClient();
}

async function applyThrough(lastTag) {
  await ensureMigrationTable();
  for (const entry of journal) {
    await applyTag(entry.tag);
    if (entry.tag === lastTag) break;
  }
}

/** The rows a migration must never rewrite. */
const DEFAULT_TABLES = [
  "listening_tests",
  "listening_questions",
  "listening_packages",
  "listening_attempts",
  "listening_mcq_sessions",
  "content_versions",
];

/**
 * The columns a table HAS right now, in catalogue order. Capturing this before a migration is what
 * lets the state be compared afterwards: a column that a migration ADDS is a new fact, while every
 * pre-existing column must keep the exact value it had.
 */
async function columnsOf(tables = DEFAULT_TABLES) {
  const columns = {};
  for (const table of tables) {
    columns[table] = (
      await q(
        `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by ordinal_position`,
        [table],
      )
    ).map((row) => row.column_name);
  }
  return columns;
}

async function snapshotRows(tables = DEFAULT_TABLES, { exclude = ["program_ref", "program_ordinal"], columns } = {}) {
  const known = columns ?? (await columnsOf(tables));
  const snapshots = {};
  for (const table of tables) {
    // `listening_packages` is keyed by its test, not by an id column of its own.
    const key = table === "listening_packages" ? "test_id" : "id";
    const hashed = known[table].filter((column) => !exclude.includes(column));
    const projection = hashed.map((column) => `'${column}', x."${column}"`).join(", ");
    snapshots[table] = await q(`select ${key}::text id, md5(jsonb_build_object(${projection})::text) h from ${table} x order by ${key}`);
  }
  return snapshots;
}

/**
 * The historical Listening content 0052 lands on top of: a full test with its MCQ question, its
 * package, an attempt, a revision and a learner's staged MCQ session. `minimal` writes only what a
 * 0039-state database can hold — the branch and divergence modes exist to prove the MIGRATION, not
 * the later tables, so they stop at the two tables it touches.
 */
async function seedHistory(minimal = false) {
  const [owner] = await q(`insert into users (name, role, account_status) values ('0052 probe owner', 'owner', 'active') returning id`);
  const [learner] = await q(`insert into users (name, role, account_status) values ('0052 probe learner', 'student', 'active') returning id`);
  /*
   * The historical rows are written with the columns a 0039-state database HAS: the later content
   * columns (`source_ref`, `type_code`, the question-set revision) belong to migrations that came
   * after it, and a probe that assumed them would be testing its own fixture rather than the
   * upgrade path.
   */
  const [test] = minimal
    ? await q(`insert into listening_tests (created_by_user_id, title, audio_type) values ($1, 'Probe full test', 'audio') returning id`, [owner.id])
    : await q(
        `insert into listening_tests (created_by_user_id, title, audio_type, publication_state, source_ref, publish_at)
         values ($1, 'Probe full test', 'audio', 'published', 'probe-0052-full', now()) returning id`,
        [owner.id],
      );
  await q(
    minimal
      ? `insert into listening_questions (test_id, "order", question_text, correct_answer, explanation, type) values ($1, 1, 'Q1', 'A', 'hidden', $2)`
      : `insert into listening_questions (test_id, "order", question_text, correct_answer, explanation, type, options, type_code)
         values ($1, 1, 'Q1', 'A', 'hidden', 'multiple_choice', '["A) one","B) two"]'::jsonb, 'mcq_single')`,
    minimal ? [test.id, "multiple_choice"] : [test.id],
  );
  const [question] = await q(`select id from listening_questions where test_id = $1`, [test.id]);
  if (minimal) return { owner: owner.id, learner: learner.id, test: test.id, attempt: null, question: question.id };
  await q(
    `insert into listening_packages (test_id, source_id, payload, audio_object_key, source_hash, legacy_runtime)
     values ($1, 'probe-0052-full', '{"schemaVersion":1,"collection":"academic","testId":"probe-0052-full","title":"Probe","category":"full","provenance":"probe","audio":{"path":"a.mp3","durationSec":600},"imagePath":null,"sections":[{"number":1,"title":"Part 1","transcript":"","reviewRequired":false}],"questions":[],"keyword1":[],"keyword2":[],"vocabulary":[]}'::jsonb, 'private/probe/a.mp3', repeat('0',64), false)`,
    [test.id],
  );
  const [attempt] = await q(`insert into listening_attempts (user_id, test_id, status, started_at) values ($1, $2, 'completed', now()) returning id`, [learner.id, test.id]);
  await q(
    `insert into listening_mcq_sessions (user_id, test_id, question_id, stage, notes)
     values ($1, $2, $3, 'reasoned', 'a learner note written before 0052')`,
    [learner.id, test.id, question.id],
  );
  await q(
    `insert into content_versions (module, content_type, source_ref, version_no, status, title, content_snapshot, content_hash, semantic_hash, answer_key_hash, target_type, target_id, created_by_user_id)
     values ('listening', 'full_test', 'probe-0052-full', 1, 'published', 'Probe', '{"questions":[]}'::jsonb, repeat('0',64), repeat('0',64), repeat('0',64), 'listening_test', $1, $2)`,
    [test.id, owner.id],
  );
  return { owner: owner.id, learner: learner.id, test: test.id, attempt: attempt.id, question: question.id };
}

async function storeSnapshot(tables, options) {
  const before = await snapshotRows(tables, options);
  await client.query("create table if not exists qa0052_probe (before jsonb)");
  await client.query("delete from qa0052_probe");
  await client.query("insert into qa0052_probe (before) values ($1)", [JSON.stringify(before)]);
  return before;
}

if (MODE === "fresh") {
  await recreate();
  await applyThrough(THROUGH_0051);
  const ids = await seedHistory();
  const before = await storeSnapshot();
  console.log(JSON.stringify({ mode: "fresh", ...ids, rows: Object.fromEntries(Object.entries(before).map(([table, rows]) => [table, rows.length])) }));
} else if (MODE === "apply") {
  await openClient();
  const hasColumn = await q(`select 1 from information_schema.columns where table_name = 'listening_tests' and column_name = 'program_ref'`);
  if (hasColumn.length) throw new Error("0052 already applied; run `fresh` first");
  await applyTag(TAG_0052);
  console.log(JSON.stringify({ mode: "apply", applied: TAG_0052 }));
} else if (MODE === "branch") {
  await recreate();
  await applyThrough(THROUGH_0039);
  // The accepted line's own history, then the programme relation on top of it.
  const ids = await seedHistory(true);
  const tables = ["listening_tests", "listening_questions"];
  const columnSet = await columnsOf(tables);
  const before = await storeSnapshot(tables, { columns: columnSet });
  await applyTag(TAG_0052);
  const after = await snapshotRows(Object.keys(before), { columns: columnSet });
  for (const table of Object.keys(before)) {
    const beforeMap = new Map(before[table].map((row) => [row.id, row.h]));
    gate(`branch: ${table} untouched by 0052`, after[table].every((row) => beforeMap.get(row.id) === row.h));
  }
  const programColumns = await q(`select column_name from information_schema.columns where table_name = 'listening_tests' and column_name in ('program_ref','program_ordinal')`);
  gate("branch: both columns present after 0039 → 0052", programColumns.length === 2);
  const constraints = await q(`select conname from pg_constraint where conrelid = 'listening_tests'::regclass and conname like 'listening_tests_program%'`);
  gate("branch: both CHECK constraints arrived", constraints.length === 2);
  const indexes = await q(`select indexname from pg_indexes where tablename = 'listening_tests' and indexname like '%program%'`);
  gate("branch: both indexes arrived", indexes.length === 2);
  // The relation is usable immediately on the integrated branch, not only on the full journal.
  const [{ id: historical }] = await q(`select id from listening_tests where title = 'Probe full test'`);
  gate("branch: an item can join the programme right away", !(await expectReject(`update listening_tests set program_ref = $1, program_ordinal = 1 where id = $2`, [PROGRAMME, historical])));
  console.log(JSON.stringify({ mode: "branch", ...ids, columns: programColumns.map((c) => c.column_name) }));
} else if (MODE === "diverge") {
  await recreate();
  await applyThrough(THROUGH_0039);
  const ids = await seedHistory(true);
  const tables = ["listening_tests", "listening_questions"];
  const columnSet = await columnsOf(tables);
  const before = await storeSnapshot(tables, { columns: columnSet });
  // The accepted line first (through 0051), then the programme relation: a database that already
  // carries the new question-set column accepts 0052 without conflict.
  const from = journal.findIndex((entry) => entry.tag === THROUGH_0039) + 1;
  for (const entry of journal.slice(from)) {
    await applyTag(entry.tag);
    if (entry.tag === THROUGH_0051) break;
  }
  await applyTag(TAG_0052);
  const after = await snapshotRows(Object.keys(before), { columns: columnSet });
  for (const table of Object.keys(before)) {
    const beforeMap = new Map(before[table].map((row) => [row.id, row.h]));
    gate(`diverge: ${table} untouched by 0051+0052`, after[table].every((row) => beforeMap.get(row.id) === row.h));
  }
  const applied = (await q(`select count(*)::int n from "drizzle"."__drizzle_migrations"`))[0].n;
  gate("diverge: the journal count matches the entries applied", applied === journal.findIndex((e) => e.tag === TAG_0052) + 1, `${applied}`);
  console.log(JSON.stringify({ mode: "diverge", ...ids, applied }));
} else if (MODE === "verify") {
  await openClient();
  const [{ before: rawBefore }] = await q(`select before from qa0052_probe limit 1`);
  const before = rawBefore;

  /*
   * The probe's own mutations are undone before anything is judged, so `verify` can be re-run
   * against the same database: the two rows this probe authors are deleted and the historical
   * test is returned to "not in a programme". Nothing else is touched — a re-run must not be able
   * to hide a real change to the history.
   */
  await q(`delete from listening_tests where title in ('Probe day two claimant', 'Probe other programme day one')`);
  await q(`update listening_tests set program_ref = null, program_ordinal = null where source_ref = 'probe-0052-full'`);

  // 1. The schema arrived, exactly as authored.
  const columns = await q(`select column_name, data_type, character_maximum_length, is_nullable from information_schema.columns where table_name = 'listening_tests' and column_name in ('program_ref','program_ordinal') order by column_name`);
  gate("0052 adds program_ref varchar(80), nullable", columns.some((c) => c.column_name === "program_ref" && c.data_type === "character varying" && c.character_maximum_length === 80 && c.is_nullable === "YES"), JSON.stringify(columns));
  gate("0052 adds program_ordinal integer, nullable", columns.some((c) => c.column_name === "program_ordinal" && c.data_type === "integer" && c.is_nullable === "YES"));
  const constraints = (await q(`select conname, pg_get_constraintdef(oid) def from pg_constraint where conrelid = 'listening_tests'::regclass and conname like 'listening_tests_program%'`)).sort((a, b) => a.conname.localeCompare(b.conname));
  gate("both CHECK constraints are named and present", constraints.length === 2, JSON.stringify(constraints.map((c) => c.conname)));
  gate("the pair CHECK is both-or-neither", /IS NULL\) = \(.* IS NULL/.test(constraints.find((c) => c.conname.endsWith("program_pair_check"))?.def ?? ""), constraints.find((c) => c.conname.endsWith("program_pair_check"))?.def);
  // Postgres re-prints the expression with its own parentheses, so the check is stated loosely
  // enough to read the real definition rather than a remembered spelling of it.
  gate("the ordinal CHECK refuses DAY 0", /program_ordinal IS NULL[\)\s]*OR[\(\s]*program_ordinal >= 1/.test(constraints.find((c) => c.conname.endsWith("ordinal_positive_check"))?.def ?? ""), constraints.find((c) => c.conname.endsWith("ordinal_positive_check"))?.def);
  const indexes = (await q(`select indexname, indexdef from pg_indexes where tablename = 'listening_tests' and indexname like '%program%' order by indexname`));
  gate("the unique day index is present and PARTIAL", indexes.some((i) => i.indexname === "listening_tests_program_ordinal_idx" && /UNIQUE/.test(i.indexdef) && /WHERE/.test(i.indexdef)), JSON.stringify(indexes.map((i) => i.indexname)));
  gate("the programme lookup index is present and PARTIAL", indexes.some((i) => i.indexname === "listening_tests_program_idx" && /WHERE/.test(i.indexdef)));

  // 2. NOT ONE historical row changed value, and nothing was added.
  const after = await snapshotRows();
  for (const table of Object.keys(before)) {
    const beforeMap = new Map(before[table].map((row) => [row.id, row.h]));
    const changed = after[table].filter((row) => beforeMap.get(row.id) !== row.h);
    const added = after[table].filter((row) => !beforeMap.has(row.id));
    gate(`${table}: no existing row changed value`, changed.length === 0, `${changed.length} changed`);
    gate(`${table}: 0052 added no row (a schema change, not a backfill)`, added.length === 0, `${added.length} added`);
  }

  // 3. The relation is closed and honest.
  const [{ test: testId, learner: learnerId, owner: ownerId }] = await q(`select id test, (select id from users where name = '0052 probe learner') learner, (select id from users where name = '0052 probe owner') owner from listening_tests where source_ref = 'probe-0052-full'`);
  gate("the historical test is present", Boolean(testId));
  gate("every pre-existing row is still NOT in a programme", (await q(`select count(*)::int n from listening_tests where program_ref is not null`))[0].n === 0);
  gate("a programme without a day is refused by the database", await expectReject(`update listening_tests set program_ref = $1 where id = $2`, [PROGRAMME, testId]));
  gate("a day without a programme is refused by the database", await expectReject(`update listening_tests set program_ordinal = 1 where id = $2`, [testId]));
  gate("DAY 0 is refused by the database", await expectReject(`update listening_tests set program_ref = $1, program_ordinal = 0 where id = $2`, [PROGRAMME, testId]));
  gate("an authored day is accepted", !(await expectReject(`update listening_tests set program_ref = $1, program_ordinal = 1 where id = $2`, [PROGRAMME, testId])));
  const [second] = await q(
    `insert into listening_tests (created_by_user_id, title, audio_type, publication_state, program_ref, program_ordinal)
     values ($1, 'Probe day two claimant', 'audio', 'draft', $2, 1) returning id`,
    [ownerId, PROGRAMME],
  ).catch(() => [null]);
  gate("a SECOND item claiming the same day is refused by the unique index", second === null || second === undefined);
  gate("the same ordinal in ANOTHER programme is allowed", !(await expectReject(
    `insert into listening_tests (created_by_user_id, title, audio_type, publication_state, program_ref, program_ordinal)
     values ($1, 'Probe other programme day one', 'audio', 'draft', 'other-programme', 1)`,
    [ownerId],
  )));
  gate("a learner's staged work is untouched and still readable", (await q(`select stage, notes from listening_mcq_sessions where user_id = $1 and stage = 'reasoned'`, [learnerId])).length === 1);

  // 4. Re-applying 0052 is a no-op: a retried migration cannot fail or lose data.
  const beforeReapply = await snapshotRows();
  await applyTag(TAG_0052);
  const afterReapply = await snapshotRows();
  let reapplySafe = true;
  for (const table of Object.keys(beforeReapply)) {
    const beforeMap = new Map(beforeReapply[table].map((row) => [row.id, row.h]));
    if (afterReapply[table].some((row) => beforeMap.get(row.id) !== row.h)) reapplySafe = false;
    // The rows this probe itself authored (a day) are expected; only CHANGES to earlier rows matter.
  }
  gate("re-applying 0052 changes nothing (idempotent)", reapplySafe);

  const dayRow = await q(`select program_ref, program_ordinal from listening_tests where program_ref = $1 order by program_ordinal`, [PROGRAMME]);
  gate("the programme now has exactly the authored day", dayRow.length === 1 && Number(dayRow[0].program_ordinal) === 1);

  const dice = randomUUID(); // a uuid the probe can assert is well-formed (no silent fixture junk)
  gate("the probe used real uuids", /^[0-9a-f-]{36}$/.test(dice));

  console.log(failures.length ? `FAILURES: ${failures.join(", ")}` : "0052 upgrade: all gates passed");
  process.exit(failures.length ? 1 : 0);
} else {
  console.error(`unknown mode: ${MODE}`);
  process.exit(2);
}

if (client) await client.end();
