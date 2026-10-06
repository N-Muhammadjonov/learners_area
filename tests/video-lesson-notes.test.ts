import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createTestDatabase, type TestDatabase } from "./support/pglite";

/**
 * D.6 — TED / PODCAST is its own module, and both the transcript and the study
 * notes are OPTIONAL.
 *
 * The point of these tests is the absence rule: when a talk has no authored
 * transcript there must be no transcript control, and when it has no notes there
 * must be no notes control. An empty tab that gives the centre's data model away
 * (or worse, invites a learner to click into nothing) is the defect, so the
 * student surface builds both tabs from content existence, never from a fixed
 * list. The authoring path stays behind `requireStaff`, and the notes column is
 * shipped as a real migration, verified below against a real PostgreSQL.
 */

const read = (path: string) => readFileSync(path, "utf8");

test("the notes column ships as migration 0023 and is journaled", () => {
  const sql = read("drizzle/0023_video_lesson_notes.sql");
  assert.match(sql, /ALTER TABLE "video_lessons" ADD COLUMN "notes" text;/);

  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as {
    entries: { idx: number; tag: string }[];
  };
  // 0023 stays journaled in order; later migrations (0024 standalone video)
  // append after it and must never rewrite it.
  const index = journal.entries.findIndex((entry) => entry.tag === "0023_video_lesson_notes");
  assert.equal(index, 23);
  assert.equal(journal.entries[index]?.idx, 23);
  assert.match(read("src/db/schema.ts"), /notes: text\("notes"\)/);
});

test("notes are optional at the data layer and blank notes collapse to null", () => {
  const data = read("src/lib/data/video-lessons.ts");
  assert.match(data, /notes\?: string \| null;/);
  assert.match(data, /notes: input\.notes && input\.notes\.trim\(\)\.length > 0 \? input\.notes : null,/);
});

test("the authoring API keeps notes optional and behind the staff gate", () => {
  const route = read("src/app/api/admin/video-lessons/route.ts");
  assert.match(route, /notes: z\.string\(\)\.max\(4000\)\.optional\(\)\.nullable\(\),/);
  // Both handlers read the caller from the database before doing anything else.
  assert.equal(route.match(/await requireStaff\(\)/g)?.length, 2);
  assert.match(route, /hasNotes: Boolean\(parsed\.data\.notes\?\.trim\(\)\)/);
});

test("the admin form authors notes and Management reports whether they exist", () => {
  const form = read("src/components/admin/NewVideoLessonForm.tsx");
  assert.match(form, /data-video-notes-input/);
  assert.match(form, /notes: notes\.trim\(\) \|\| null,/);

  const page = read("src/app/app/(shell)/admin/video-lessons/page.tsx");
  assert.match(page, /data-video-admin-notes=\{videoLesson\.notes \? "yes" : "no"\}/);
});

test("captions stay inside the player; optional notes retain their reveal control", () => {
  const studio = read("src/components/courses/VideoLessonStudio.tsx");
  // Superseded W12 (owner, TED/PODCAST final UX): Transcript appears only when authored content exists;
  // captions still stay in the native player and there is still no below-player reveal control.
  assert.match(studio, /if \(hasTranscript\) list\.push\("transcript"\);/);
  assert.doesNotMatch(studio, /data-video-transcript-reveal/);
  assert.match(studio, /if \(notes\.length > 0\) list\.push\("notes"\);/);
  assert.match(studio, /data-video-notes-reveal/);
  assert.match(studio, /aria-expanded=\{notesShown\}/);
  assert.match(studio, /notesShown \? "" : "hidden"/);
  assert.match(studio, /sandbox="allow-scripts allow-same-origin allow-presentation"/);
  assert.doesNotMatch(studio, /watchUrlFor|allow-popups|allow-top-navigation/);
  // The lesson page must pass the stored notes through, never invent them.
  const page = read("src/app/app/(shell)/courses/ielts/lessons/[lessonId]/page.tsx");
  assert.match(page, /notes: video\.videoLesson\.notes \?\? null,/);
});

test("the student index never ships note bodies into the list payload", () => {
  const data = read("src/lib/data/video-lessons.ts");
  const studentQuery = data.slice(data.indexOf("export async function listVideoLessonsForStudent"));
  assert.ok(
    !/notes: videoLessons\.notes/.test(studentQuery),
    "the index only needs lesson identity, not the body a learner opens on purpose"
  );
});

let database: TestDatabase;

before(async () => {
  database = await createTestDatabase();
});

after(async () => {
  await database.close();
});

test("notes round-trip through the real column and can be cleared back to null", async () => {
  const [lesson] = await database.query<{ id: string }>(`
    with course as (
      insert into courses (slug, title) values ('qa-notes', 'QA Notes') returning id
    ), module as (
      insert into course_modules (course_id, slug, title, "order")
      select id, 'qa-notes', 'QA Notes', 1 from course returning id
    ), unit as (
      insert into units (module_id, slug, title, "order")
      select id, 'qa-notes', 'QA Notes', 1 from module returning id
    )
    insert into lessons (unit_id, slug, title, "order")
    select id, 'qa-notes', 'QA Notes', 1 from unit
    returning id
  `);
  assert.ok(lesson?.id);

  const body = "First line.\n\u2022 Second line.";
  const [authored] = await database.query<{ id: string; notes: string | null }>(
    `insert into video_lessons (lesson_id, provider, video_id, title, notes)
     values ($1, 'youtube', 'dQw4w9WgXcQ', 'QA Talk', $2)
     returning id, notes`,
    [lesson!.id, body]
  );
  assert.equal(authored!.notes, body);

  // One video per lesson is a real constraint, so the second write is an update.
  await database.query(`update video_lessons set notes = null where id = $1`, [authored!.id]);
  const [cleared] = await database.query<{ notes: string | null }>(
    `select notes from video_lessons where id = $1`,
    [authored!.id]
  );
  assert.equal(cleared!.notes, null);
});
