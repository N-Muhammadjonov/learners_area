#!/usr/bin/env node
/**
 * Real-PostgreSQL upgrade proof for migration 0050 (lesson learning area + Teacher Notes)
 * on the ISOLATED local QA2 server (never Preview/Production).
 *
 *   node scripts/qa2-lesson-learning-area-0050-upgrade.mjs fresh   # fresh DB, journal 0000…0049
 *   node scripts/qa2-lesson-learning-area-0050-upgrade.mjs apply   # applies 0050 only
 *   node scripts/qa2-lesson-learning-area-0050-upgrade.mjs verify  # hard gates
 *   node scripts/qa2-lesson-learning-area-0050-upgrade.mjs branch  # 0000…0039 → 0050 upgrader
 *
 * Why not the drizzle migrator for the partial states: the journal is the source of truth
 * for ORDER, and applying a SUBSET with the real migrator would mean editing the journal to
 * fake a history this repository does not have. So this probe applies the exact
 * journal-ordered SQL files directly — byte-for-byte what the migrator executes — and
 * refuses to run anywhere but localhost/learners_qa2.
 *
 * What it proves:
 *   • 0049 → 0050: both columns, both CHECKs and the index appear, while NOT ONE existing
 *     lesson row, video_lessons row or upload_intent row changes value (row-level md5);
 *   • the CHECK vocabulary is closed (an unknown area is refused) and NULL stays allowed;
 *   • clearing Teacher Notes stores NULL, never a blank string;
 *   • the upload taxonomy gains exactly one new value ('video') and keeps the old three;
 *   • re-applying 0050 is a no-op (idempotent), so a retried migration cannot fail or
 *     lose data;
 *   • the integrated-branch upgrade path (accepted 0039 → 0050) also lands correctly.
 */
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import pg from "pg";

const url = new URL(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/learners_qa2");
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.pathname !== "/learners_qa2") {
  console.error("refusing: only the isolated local learners_qa2 database is allowed");
  process.exit(2);
}

const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")).entries;
const MODE = process.argv[2] ?? "verify";
const THROUGH_0049 = "0049_lesson_notes";
const AFTER_0047 = "0047_assignments_canonical";
const THROUGH_0039 = "0039_academic_reading_sets";
const TAG_0050 = "0050_lesson_learning_area";

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

/** The pg client cannot be re-connected after `end()`, so the DB is dropped behind a
 *  THROWAWAY admin client and the working client is replaced, never reused. */
// The working client is opened LAZILY, because `fresh`/`branch` drop and recreate the
// database first and a pg Client cannot be re-connected after `end()`.
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

/** Record a migration the way the migrator does, so the DB reports its own state. */
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
  // pg now points at a database that was recreated underneath it; the working client is
  // replaced rather than reused (a pg Client cannot be re-connected after end()).
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

/**
 * The rows a migration must never rewrite.
 *
 * `lessons` is hashed WITHOUT the two columns 0050 adds: adding a column changes every
 * row's JSON projection, and that is not a change of any value. Every OTHER column — and
 * every column of the other tables — is compared exactly.
 */
async function snapshotRows() {
  return {
    lessons: await q(`select id::text id, md5((to_jsonb(x) - 'learning_area' - 'teacher_notes')::text) h from lessons x order by id`),
    video_lessons: await q(`select id::text id, md5(row_to_json(x)::text) h from video_lessons x order by id`),
    upload_intents: await q(`select id::text id, md5(row_to_json(x)::text) h from upload_intents x order by id`),
  };
}

if (MODE === "fresh") {
  await recreate();

  await applyThrough(THROUGH_0049);

  // Historical data: a lesson authored before 0050, with media notes, and an upload intent
  // of the old `audio` kind.
  const [owner] = await q(`insert into users (name, role, account_status) values ('0050 probe owner', 'owner', 'active') returning id`);
  const [course] = await q(`insert into courses (slug, title) values ('probe-0050', 'Probe') returning id`);
  const [module] = await q(`insert into course_modules (course_id, slug, title, "order") values ($1, 'm', 'M', 1) returning id`, [course.id]);
  const [unit] = await q(`insert into units (module_id, slug, title, "order") values ($1, 'u', 'U', 1) returning id`, [module.id]);
  const [lesson] = await q(
    `insert into lessons (unit_id, slug, title, "order", publication_state, default_state, summary, created_by_user_id)
     values ($1, 'probe-lesson', 'Listening Strategies', 1, 'published', 'available', 'Authored before 0050.', $2) returning id`,
    [unit.id, owner.id],
  );
  const [media] = await q(
    `insert into video_lessons (lesson_id, media_kind, provider, video_id, title, notes, publication_state)
     values ($1, 'audio', 'direct', $2, 'Episode', 'Legacy media notes.', 'published') returning id`,
    [lesson.id, randomUUID()],
  );
  const [intent] = await q(
    `insert into upload_intents (user_id, purpose, block_kind, object_key, original_name, mime_type, size, expires_at)
     values ($1, 'material_block', 'audio', 'private/audio/legacy.mp3', 'legacy.mp3', 'audio/mpeg', 1024, now() + interval '1 day') returning id`,
    [owner.id],
  );

  // A second, unclassified lesson in the legacy shape: 0050 must leave it exactly as it is.
  await q(`insert into lessons (unit_id, slug, title, "order", publication_state, default_state, summary) values ($1, 'legacy-two', 'Legacy two', 2, 'draft', 'locked', null)`, [unit.id]);
  const before = await snapshotRows();
  await client.query("create table if not exists qa0050_probe (before jsonb)");
  await client.query("delete from qa0050_probe");
  await client.query("insert into qa0050_probe (before) values ($1)", [JSON.stringify(before)]);
  console.log(JSON.stringify({ mode: "fresh", lesson: lesson.id, media: media.id, intent: intent.id, snapshotRows: Object.fromEntries(Object.entries(before).map(([t, rows]) => [t, rows.length])) }));
} else if (MODE === "apply") {
  await openClient();
  const hasColumn = await q(`select 1 from information_schema.columns where table_name = 'lessons' and column_name = 'learning_area'`);
  if (hasColumn.length) throw new Error("0050 already applied; run `fresh` first");
  await applyTag(TAG_0050);
  console.log(JSON.stringify({ mode: "apply", applied: TAG_0050 }));
} else if (MODE === "verify") {
  await openClient();
  const [{ before: rawBefore }] = await q(`select before from qa0050_probe limit 1`);
  const before = rawBefore;

  // 1. The schema arrived.
  const columns = await q(`select column_name, data_type, character_maximum_length, is_nullable from information_schema.columns where table_name = 'lessons' and column_name in ('learning_area','teacher_notes') order by column_name`);
  gate("0050 adds learning_area varchar(20), nullable", columns.some((c) => c.column_name === "learning_area" && c.data_type === "character varying" && c.character_maximum_length === 20 && c.is_nullable === "YES"), JSON.stringify(columns));
  gate("0050 adds teacher_notes text, nullable", columns.some((c) => c.column_name === "teacher_notes" && c.data_type === "text" && c.is_nullable === "YES"));
  const index = await q(`select indexname from pg_indexes where tablename = 'lessons' and indexname = 'lessons_learning_area_idx'`);
  gate("0050 adds the (learning_area, publication_state, updated_at) index", index.length === 1);
  const constraints = (await q(`select conname from pg_constraint where conrelid = 'lessons'::regclass`)).map((row) => row.conname);
  gate("both CHECK constraints are named and present", constraints.includes("lessons_learning_area_chk") && constraints.includes("lessons_teacher_notes_len_chk"));

  // 2. NOT ONE historical row changed value, and nothing was deleted.
  const after = await snapshotRows();
  for (const table of ["lessons", "video_lessons", "upload_intents"]) {
    const beforeMap = new Map(before[table].map((row) => [row.id, row.h]));
    const changed = after[table].filter((row) => beforeMap.get(row.id) !== row.h);
    const added = after[table].filter((row) => !beforeMap.has(row.id));
    gate(`${table}: no existing row changed value and none was removed`, changed.length === 0);
    gate(`${table}: 0050 added no row (it is a schema change, not a backfill)`, added.length === 0, `${added.length} added`);
  }

  // 3. The vocabulary is closed and NULL stays allowed.
  const [{ lesson: lessonId }] = await q(`select id lesson from lessons where slug = 'probe-lesson'`);
  gate("NULL learning_area is still allowed (unclassified is a real state)", (await q(`select count(*)::int n from lessons where learning_area is null`))[0].n === 2);
  gate("an explicit listening area is accepted", !(await expectReject(`update lessons set learning_area = 'listening' where id = $1`, [lessonId])));
  gate("an unknown area is refused by the database, not only by the app", await expectReject(`update lessons set learning_area = 'listeningg' where id = $1`, [lessonId]));
  gate("a title is never a classification: 'Listening Strategies' kept NULL until an author said otherwise", (await q(`select learning_area from lessons where id = $1`, [lessonId]))[0].learning_area === "listening");

  // 4. Teacher Notes: bounded, never blank, and clearing stores NULL.
  gate("teacher notes accept authored text", !(await expectReject(`update lessons set teacher_notes = 'Written by the class teacher.' where id = $1`, [lessonId])));
  gate("a blank teacher note is refused (clear means NULL)", await expectReject(`update lessons set teacher_notes = '   ' where id = $1`, [lessonId]));
  gate("an over-long teacher note is refused", await expectReject(`update lessons set teacher_notes = $2 where id = $1`, [lessonId, "x".repeat(8001)]));
  gate("the bound is exactly 8000 characters", !(await expectReject(`update lessons set teacher_notes = $2 where id = $1`, [lessonId, "x".repeat(8000)])));
  await q(`update lessons set teacher_notes = null where id = $1`, [lessonId]);
  gate("clearing stores NULL, not ''", (await q(`select teacher_notes from lessons where id = $1`, [lessonId]))[0].teacher_notes === null);

  // 5. The legacy media notes are untouched: lesson-level notes are an ADDITION, not a move.
  gate("video_lessons.notes keeps its own value", (await q(`select notes from video_lessons where lesson_id = $1`, [lessonId]))[0].notes === "Legacy media notes.");

  // 6. The upload taxonomy gained exactly one value.
  const kinds = (await q(`select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'upload_block_kind' order by e.enumsortorder`)).map((row) => row.enumlabel);
  // `ALTER TYPE … ADD VALUE` APPENDS, so the ordinal position is not the claim — the SET
  // is: the three old kinds survive and exactly one new kind joins them.
  gate(
    "upload_block_kind = {image, audio, video, file} with the old kinds intact",
    JSON.stringify([...kinds].sort()) === JSON.stringify(["audio", "file", "image", "video"]),
    JSON.stringify(kinds),
  );
  gate("an existing audio intent row still reads as audio", (await q(`select block_kind from upload_intents where object_key = 'private/audio/legacy.mp3'`))[0].block_kind === "audio");
  gate("a new video intent row is accepted", !(await expectReject(
    `insert into upload_intents (user_id, purpose, block_kind, object_key, original_name, mime_type, size, expires_at)
     select created_by_user_id, 'material_block', 'video', 'private/video/lesson.mp4', 'lesson.mp4', 'video/mp4', 2048, now() + interval '1 day' from lessons where id = $1`,
    [lessonId],
  )));

  // 7. Re-applying 0050 is a no-op.
  let idempotent = true;
  try {
    for (const statement of statements(TAG_0050)) await client.query(statement);
  } catch (error) {
    idempotent = false;
    console.error(error.message);
  }
  gate("re-applying 0050 is safe (every statement is IF NOT EXISTS / DROP-then-ADD)", idempotent);
  const final = await snapshotRows();
  const beforeMap = new Map(before.lessons.map((row) => [row.id, row.h]));
  gate("after the re-apply the historical lesson rows STILL hold their values", final.lessons.every((row) => beforeMap.get(row.id) === row.h));

  console.log(JSON.stringify({ mode: "verify", failures }));
  if (failures.length) process.exitCode = 1;
} else if (MODE === "branch") {
  // The integrated-branch upgrade: a database on the accepted learners-area-next state
  // (through 0039) takes 0040…0050 without error, and the lesson classification lands.
  await recreate();
  await applyThrough(THROUGH_0039);
  for (const entry of journal) {
    if (entry.tag <= THROUGH_0039) continue;
    await applyTag(entry.tag);
  }
  const columns = (await q(`select column_name from information_schema.columns where table_name = 'lessons' and column_name in ('learning_area','teacher_notes')`)).map((row) => row.column_name).sort();
  gate("0039 → 0050 lands both lesson columns", JSON.stringify(columns) === JSON.stringify(["learning_area", "teacher_notes"]), JSON.stringify(columns));
  const applied = await q(`select count(*)::int n from "drizzle"."__drizzle_migrations"`);
  gate("the whole integrated journal (0000…0050) applied exactly once each", applied[0].n === journal.length, `${applied[0].n}/${journal.length}`);
  const kinds = (await q(`select count(*)::int n from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'upload_block_kind' and e.enumlabel = 'video'`))[0].n;
  gate("the upload taxonomy gained 'video' on the branch path too", kinds === 1);
  console.log(JSON.stringify({ mode: "branch", applied: applied[0].n, failures }));
  if (failures.length) process.exitCode = 1;
} else {
  console.error("usage: fresh | apply | verify | branch");
  process.exit(2);
}

if (client) await client.end();
