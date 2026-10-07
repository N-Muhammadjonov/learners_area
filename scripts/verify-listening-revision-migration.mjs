#!/usr/bin/env node
/**
 * 0051 upgrade rehearsal: apply the revision column on an ACCEPTED-STATE database.
 *
 * The QA2 gates always migrate a FRESH database, which cannot tell us what happens to a
 * database that already holds real rows. This probe builds the pre-0051 state on real
 * PostgreSQL, loads representative Listening history into it, then applies 0051 and proves:
 *   • the upgrade is additive (nothing is lost, no row is rewritten),
 *   • existing rows are unversioned (`content_version_id is null`) — i.e. the legacy set stays
 *     the legacy set,
 *   • the FK really is ON DELETE SET NULL (deleting a revision never deletes a question),
 *   • re-applying 0051 is a no-op.
 *
 * Run (QA2 real PostgreSQL, never Preview/Production):
 *   LD_LIBRARY_PATH=/tmp/qa2-pg/package/native/lib node scripts/verify-listening-revision-migration.mjs
 *
 * A scratch database is created and dropped; the QA2 database itself is never touched.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import pg from "pg";

const ADMIN = "postgres://postgres@localhost:5432/postgres";
const DB = "learners_qa2_up0051";
const URL = `postgres://postgres@localhost:5432/${DB}`;
const statements = readFileSync("drizzle/0051_listening_question_revision.sql", "utf8")
  .split("--> statement-breakpoint")
  .map((part) => part.trim())
  .filter(Boolean);

const results = [];
const check = (name, ok, detail = "") => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
};

async function withAdmin(fn) {
  const client = new pg.Client({ connectionString: ADMIN });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function withDb(fn) {
  const client = new pg.Client({ connectionString: URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function main() {
  await withAdmin(async (client) => {
    await client.query(`drop database if exists ${DB}`);
    await client.query(`create database ${DB}`);
  });
  console.log(`# scratch database ${DB} created`);

  // The same migrator the gate uses, against the scratch database only.
  execFileSync("npx", ["drizzle-kit", "migrate"], { env: { ...process.env, DATABASE_URL: URL }, stdio: "pipe" });

  // Roll the schema back to the ACCEPTED (pre-0051) state, keeping every row.
  await withDb(async (client) => {
    await client.query(`alter table listening_questions drop constraint if exists listening_questions_content_version_id_content_versions_id_fk`);
    await client.query(`drop index if exists listening_questions_version_set_idx`);
    await client.query(`alter table listening_questions drop column if exists content_version_id`);
    const [column] = (
      await client.query(
        `select count(*)::int n from information_schema.columns where table_name = 'listening_questions' and column_name = 'content_version_id'`,
      )
    ).rows;
    check("pre-0051 state has no content_version_id", column.n === 0);
  });

  // Representative Listening history in the accepted state: a published test with a legacy
  // question set, a bound attempt, and answers pointing at those questions.
  const ids = await withDb(async (client) => {
    const one = async (sql, params) => (await client.query(sql, params)).rows[0].id;
    const userId = await one(`insert into users (name, role, account_status) values ('Upgrade learner','student','active') returning id`);
    const testId = await one(
      `insert into listening_tests (title, audio_type, difficulty_level, created_by_user_id, source_ref, publication_state)
       values ('Upgrade test','audio','B2',$1,'upgrade-0051','published') returning id`,
      [userId],
    );
    const q1 = await one(
      `insert into listening_questions (test_id, "order", type, question_text, correct_answer, explanation)
       values ($1, 1, 'short_answer', 'Legacy one', 'yes', 'authored') returning id`,
      [testId],
    );
    const q2 = await one(
      `insert into listening_questions (test_id, "order", type, question_text, correct_answer, explanation)
       values ($1, 2, 'short_answer', 'Legacy two', 'no', 'authored') returning id`,
      [testId],
    );
    const versionId = await one(
      `insert into content_versions (module, content_type, source_ref, version_no, status, title, content_hash, semantic_hash, answer_key_hash, publication_state, created_by_user_id, target_type, target_id, content_snapshot)
       values ('listening','full_test','upgrade-0051',1,'published','Upgrade test','upgrade-hash','upgrade-semantic','upgrade-key','published',$1,'listening_test',$2,'{"questions":[]}'::jsonb) returning id`,
      [userId, testId],
    );
    const attemptId = await one(
      `insert into listening_attempts (user_id, test_id, status, content_version_id)
       values ($1,$2,'completed',$3) returning id`,
      [userId, testId, versionId],
    );
    await client.query(
      `insert into listening_answers (attempt_id, question_id, user_answer, is_correct) values ($1,$2,'yes',true),($1,$3,'no',false)`,
      [attemptId, q1, q2],
    );
    return { userId, testId, q1, q2, versionId, attemptId };
  });
  console.log("# accepted-state history written (1 test, 2 questions, 1 attempt, 2 answers)");

  const before = await withDb(async (client) => {
    const counts = (
      await client.query(
        `select
           (select count(*)::int from listening_questions) questions,
           (select count(*)::int from listening_answers) answers,
           (select count(*)::int from listening_attempts) attempts,
           (select count(*)::int from content_versions) versions`,
      )
    ).rows[0];
    return counts;
  });

  // ---- the upgrade itself, exactly the file the migrator applies ----
  await withDb(async (client) => {
    for (const statement of statements) await client.query(statement);
  });

  await withDb(async (client) => {
    const column = (
      await client.query(
        `select is_nullable, data_type from information_schema.columns
          where table_name = 'listening_questions' and column_name = 'content_version_id'`,
      )
    ).rows;
    check("0051 adds listening_questions.content_version_id", column.length === 1, `${column[0]?.data_type} nullable=${column[0]?.is_nullable}`);
    check("0051 adds the (test_id, content_version_id) index", (await client.query(
      `select 1 from pg_indexes where tablename = 'listening_questions' and indexname = 'listening_questions_version_set_idx'`,
    )).rowCount === 1);
    check("0051 adds the revision foreign key", (await client.query(
      `select 1 from pg_constraint where conname = 'listening_questions_content_version_id_content_versions_id_fk'`,
    )).rowCount === 1);

    const after = (
      await client.query(
        `select
           (select count(*)::int from listening_questions) questions,
           (select count(*)::int from listening_answers) answers,
           (select count(*)::int from listening_attempts) attempts,
           (select count(*)::int from content_versions) versions`,
      )
    ).rows[0];
    check(
      "no row is created or destroyed by the upgrade",
      JSON.stringify(after) === JSON.stringify(before),
      `${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );

    const legacy = (
      await client.query(`select count(*)::int n from listening_questions where content_version_id is null`)
    ).rows[0];
    check("every existing question stays UNVERSIONED (the legacy set is untouched)", legacy.n === 2, `${legacy.n} legacy rows`);

    const orphan = (
      await client.query(
        `select count(*)::int n from listening_answers ans left join listening_questions q on q.id = ans.question_id where q.id is null`,
      )
    ).rows[0];
    check("no answer is orphaned by the upgrade", orphan.n === 0);

    // Bind one question to the revision, then delete the revision: the question must SURVIVE,
    // unbound, because deleting content must never take a question (and its answers) with it.
    await client.query(`update listening_questions set content_version_id = $1 where id = $2`, [ids.versionId, ids.q1]);
    await client.query(`delete from content_versions where id = $1`, [ids.versionId]);
    const survived = (
      await client.query(`select content_version_id as v from listening_questions where id = $1`, [ids.q1])
    ).rows[0];
    check("deleting a revision sets content_version_id to NULL instead of cascading", survived?.v === null, `value=${survived?.v}`);
    const answersStill = (
      await client.query(`select count(*)::int n from listening_answers where question_id = $1`, [ids.q1])
    ).rows[0];
    check("the question's answers survive a revision delete", answersStill.n === 1);

    // Idempotency: the same file applied again changes nothing.
    for (const statement of statements) await client.query(statement);
    const repeated = (
      await client.query(`select count(*)::int n from listening_questions where test_id = $1`, [ids.testId])
    ).rows[0];
    check("re-applying 0051 is a no-op", repeated.n === 2, `${repeated.n} questions`);
  });

  await withAdmin(async (client) => {
    await client.query(`drop database ${DB}`);
  });
  console.log("# scratch database dropped");

  const failed = results.filter((result) => !result.ok);
  console.log(`\n0051 upgrade rehearsal: TOTAL ${results.length} · PASS ${results.length - failed.length} · FAIL ${failed.length}`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
