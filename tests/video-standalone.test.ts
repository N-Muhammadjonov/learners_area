import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTranscriptInput } from "../src/lib/services/video/transcript";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("W11: migration 0024 is non-destructive, journaled last and matches the schema", () => {
  const sql = read("drizzle/0024_video_lessons_standalone.sql");
  assert.match(sql, /ALTER TABLE "video_lessons" ALTER COLUMN "lesson_id" DROP NOT NULL;/);
  assert.match(sql, /ALTER TABLE "video_lessons" ADD COLUMN "transcript_text" text;/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i);
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };
  assert.equal(journal.entries.at(-1)?.tag, "0024_video_lessons_standalone");
  assert.equal(journal.entries.at(-1)?.idx, 24);
  const schema = read("src/db/schema.ts");
  assert.match(schema, /lessonId: uuid\("lesson_id"\)\.references\(\(\) => lessons\.id/);
  assert.match(schema, /transcriptText: text\("transcript_text"\)/);
});

test("W11: admin authoring works with zero roadmap lessons and standalone is the default", () => {
  const form = read("src/components/admin/NewVideoLessonForm.tsx");
  assert.doesNotMatch(form, /if \(lessons\.length === 0\)/);
  assert.match(form, /useState\(""\)/);
  assert.match(form, /lessonId: lessonId \|\| null/);
  const route = read("src/app/api/admin/video-lessons/route.ts");
  assert.match(route, /lessonId: z\.string\(\)\.uuid\(\)\.optional\(\)\.nullable\(\)/);
  assert.match(route, /video_exists/);
  assert.match(route, /requireStaff\(\)/);
});

test("W11: learners open standalone items on a native URL, live-only, without course joins", () => {
  const data = read("src/lib/data/video-lessons.ts");
  const fn = data.slice(data.indexOf("export async function getStandaloneVideoLesson"), data.indexOf("export async function listStandaloneVideoLessonsForStudent"));
  assert.match(fn, /isNull\(videoLessons\.lessonId\)/);
  assert.match(fn, /liveWhere\(/);
  const page = read("src/app/(app)/video-lessons/[id]/page.tsx");
  assert.match(page, /requireActiveUser\(\)/);
  assert.match(page, /notFound\(\)/);
  const index = read("src/app/(app)/video-lessons/page.tsx");
  assert.match(index, /href=\{`\/video-lessons\/\$\{row\.id\}`\}/);
  // Legacy course-linked items still route through their lesson.
  assert.match(index, /\/courses\/\$\{row\.courseSlug\}\/lessons\/\$\{row\.lesson\.id\}/);
});

test("W12: plain transcript is kept, timed lines stay timed, mixed input is refused", () => {
  assert.deepEqual(parseTranscriptInput("  \n "), { kind: "empty" });
  const plain = parseTranscriptInput("First paragraph of the talk.\nStill first.\n\n\n\nSecond paragraph.");
  assert.equal(plain.kind, "plain");
  if (plain.kind === "plain") {
    assert.equal(plain.paragraphs, 2);
    assert.match(plain.text, /First paragraph of the talk\.\nStill first\.\n\nSecond paragraph\./);
  }
  const timed = parseTranscriptInput("0:12 Welcome.\n1:02:03 Later.");
  assert.deepEqual(timed, { kind: "timed", lines: [{ startSeconds: 12, text: "Welcome." }, { startSeconds: 3723, text: "Later." }] });
  assert.deepEqual(parseTranscriptInput("0:12 Welcome.\nno timestamp here"), { kind: "mixed", untimedLines: [2] });
});

test("W12: the studio renders a plain transcript behind the same explicit reveal", () => {
  const studio = read("src/components/courses/VideoLessonStudio.tsx");
  assert.match(studio, /else if \(plainParagraphs\.length > 0\) list\.push\("transcript"\);/);
  assert.match(studio, /data-video-transcript-kind="plain"/);
  for (const page of ["src/app/(app)/video-lessons/[id]/page.tsx", "src/app/(app)/courses/ielts/lessons/[lessonId]/page.tsx"]) {
    assert.match(read(page), /transcriptText: (video\.)?videoLesson\.transcriptText \?\? null/);
  }
});
