import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseTranscriptInput } from "../src/lib/services/video/transcript";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("W11: migration 0024 is non-destructive, journaled at idx 24 (in order) and matches the schema", () => {
  const sql = read("drizzle/0024_video_lessons_standalone.sql");
  assert.match(sql, /ALTER TABLE "video_lessons" ALTER COLUMN "lesson_id" DROP NOT NULL;/);
  assert.match(sql, /ALTER TABLE "video_lessons" ADD COLUMN "transcript_text" text;/);
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i);
  const journal = JSON.parse(read("drizzle/meta/_journal.json")) as { entries: { idx: number; tag: string }[] };
  // 0024 was last when written; later additive migrations (0025+) follow it in order.
  const entry = journal.entries.find((e: { tag: string }) => e.tag === "0024_video_lessons_standalone");
  assert.equal(entry?.idx, 24);
  assert.deepEqual(journal.entries.map((e: { idx: number }) => e.idx), journal.entries.map((_: unknown, i: number) => i), "journal contiguous and ordered");
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

test("W12 superseded UI: native captions replace the reveal; legacy transcript storage remains compatible", () => {
  const studio = read("src/components/courses/VideoLessonStudio.tsx");
  // Superseded W12 (owner, TED/PODCAST final UX): a read-only Transcript tab exists only when content exists.
  assert.doesNotMatch(studio, /data-video-transcript-reveal/);
  assert.match(studio, /if \(hasTranscript\) list\.push\("transcript"\);/);
  assert.match(read("src/lib/services/video/provider.ts"), /cc_load_policy: "1"/);
  for (const page of ["src/app/(app)/video-lessons/[id]/page.tsx", "src/app/(app)/courses/ielts/lessons/[lessonId]/page.tsx"]) {
    assert.match(read(page), /transcriptText: (video\.)?videoLesson\.transcriptText \?\? null/);
  }
});


test("standalone learner loader never fetches historical question rows", () => {
  const data = read("src/lib/data/video-lessons.ts");
  const fn = data.slice(
    data.indexOf("export async function getStandaloneVideoLesson"),
    data.indexOf("export async function listStandaloneVideoLessonsForStudent")
  );
  assert.doesNotMatch(fn, /videoLessonQuestions/, "standalone payload must not load stale question rows");
  assert.match(fn, /questions: \[\]/);
});
