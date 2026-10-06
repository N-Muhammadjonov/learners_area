import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { lessonBlocks, lessonNotes, lessons, users, videoLessons } from "../src/db/schema";
import { classifyListeningLessons, listListeningLessons, loadListeningLesson } from "../src/lib/listening/lessons";
import { saveLessonNote } from "../src/lib/services/notes/lesson-notes";
import { loadLessonForLearner } from "../src/lib/content/lessons";
import { createTestDatabase } from "./support/pglite";

/**
 * Listening → Lessons: the library, the lesson body and the three learner controls.
 *
 * What is being protected:
 *   • a "listening lesson" is DERIVED from authored facts (an audio block, a
 *     reference to an audio lesson, or an attached audio media item) — a text-only
 *     lesson is never listed, and nothing is seeded to make the page look busy;
 *   • the publication gate is the lesson layer's own: a draft is invisible and a
 *     non-listening lesson is a 404 on the detail route;
 *   • Description and Teacher notes read canonical authored columns only, and say so
 *     when they are empty;
 *   • Xulosangiz is the SAME private store as the course lessons (migration 0049),
 *     keyed by this lesson's stable id — the learner's own row, never anybody else's,
 *     and never written into progress;
 *   • the tabs are URL-driven, so a reload keeps the section the learner was reading.
 */

const ROOT = join(import.meta.dirname, "..");
const ROUTE_DIR = join(ROOT, "src/app/app/(shell)/listening/lessons");

async function fixture() {
  const database = await createTestDatabase();
  const { query } = database;
  const [owner, student, other] = await query<{ id: string }>(`
    insert into users (name, role, account_status) values ('Lesson owner', 'owner', 'active'), ('Listener', 'student', 'active'), ('Other listener', 'student', 'active')
    returning id
  `);
  const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('lsn', 'Listening') returning id`);
  const [module] = await query<{ id: string }>(`insert into course_modules (course_id, slug, title, "order") values ($1, 'm', 'M', 1) returning id`, [course!.id]);
  const [unit] = await query<{ id: string }>(`insert into units (module_id, slug, title, "order") values ($1, 'u', 'U', 1) returning id`, [module!.id]);
  return {
    close: database.close,
    db: database.db,
    query: database.query,
    ownerId: owner!.id,
    studentId: student!.id,
    otherStudentId: other!.id,
    unitId: unit!.id,
  };
}

async function addLesson(
  database: Awaited<ReturnType<typeof fixture>>,
  input: { slug: string; title: string; publicationState?: "draft" | "published" | "scheduled" | "archived"; summary?: string | null },
) {
  const { query } = database;
  const [lesson] = await query<{ id: string }>(
    `insert into lessons (unit_id, slug, title, "order", publication_state, default_state, summary) values ($1, $2, $3, 1, $4, 'available', $5) returning id`,
    [database.unitId, input.slug, input.title, input.publicationState ?? "published", input.summary ?? null],
  );
  return lesson!.id;
}

type BlockType = "text" | "audio" | "video" | "image" | "file" | "link" | "quiz" | "content_reference";

async function addBlock(
  database: Awaited<ReturnType<typeof fixture>>,
  lessonId: string,
  block: { type: BlockType; position: number; objectKey?: string | null; refModule?: string | null; refContentType?: string | null; refSourceRef?: string | null; textContent?: string | null },
) {
  await database.db.insert(lessonBlocks).values({
    lessonId,
    position: block.position,
    type: block.type,
    textContent: block.textContent ?? null,
    objectKey: block.objectKey ?? null,
    refModule: block.refModule ?? null,
    refContentType: block.refContentType ?? null,
    refSourceRef: block.refSourceRef ?? null,
  });
}

test("LL1 the card list library is derived from authored facts, never seeded", async () => {
  const database = await fixture();
  try {
    const audioLesson = await addLesson(database, { slug: "audio-body", title: "Audio body lesson" });
    await addBlock(database, audioLesson, { type: "audio", position: 1, objectKey: "private/audio.mp3" });
    await addBlock(database, audioLesson, { type: "text", position: 2, textContent: "Listen and answer." });

    const textOnly = await addLesson(database, { slug: "text-only", title: "Text only lesson" });
    await addBlock(database, textOnly, { type: "text", position: 1, textContent: "Just reading here." });

    const referenced = await addLesson(database, { slug: "audio-reference", title: "Referenced audio lesson" });
    await addBlock(database, referenced, { type: "content_reference", position: 1, refModule: "ted", refContentType: "audio_lesson", refSourceRef: "podcast-episode-1" });

    const attached = await addLesson(database, { slug: "attached-audio", title: "Lesson with attached audio" });
    await database.db.insert(videoLessons).values({
      lessonId: attached,
      mediaKind: "audio",
      provider: "direct",
      videoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      title: "Podcast episode",
      notes: "Teacher notes for the episode.",
      publicationState: "published",
    });

    const draftAudio = await addLesson(database, { slug: "draft-audio", title: "Draft audio lesson", publicationState: "draft" });
    await addBlock(database, draftAudio, { type: "audio", position: 1, objectKey: "private/draft.mp3" });

    const ids = [audioLesson, textOnly, referenced, attached, draftAudio];
    const blocks = await database.db.select().from(lessonBlocks);
    const attachedAudioIds = new Set(
      (await database.query<{ lesson_id: string }>(`select lesson_id from video_lessons where media_kind = 'audio'`)).map((row) => row.lesson_id),
    );
    const classification = classifyListeningLessons(
      ids,
      blocks.map((row) => ({ lessonId: row.lessonId, type: row.type, refModule: row.refModule, refContentType: row.refContentType })),
      attachedAudioIds,
    );

    assert.equal(classification.get(audioLesson), "audio_block", "an audio block is listening material");
    assert.equal(classification.get(referenced), "audio_reference", "a reference to an audio lesson is listening material");
    assert.equal(classification.get(attached), "attached_media", "an attached audio media item is listening material");
    assert.equal(classification.has(textOnly), false, "a text-only lesson is NOT a listening lesson");
    assert.equal(classification.has(draftAudio), true, "classification is about the content; the publication gate is separate");

    // The publication gate is the lesson layer's own — a draft lesson is not loadable
    // by a learner even though its blocks say "audio".
    const draftLoad = await loadLessonForLearner(draftAudio, database.studentId, database.db);
    assert.equal(draftLoad, null, "a draft lesson must not be readable");
    const liveLoad = await loadLessonForLearner(audioLesson, database.studentId, database.db);
    assert.equal(liveLoad?.blocks[0]?.type, "audio");

    // Every resolved block carries the id its own quiz answers are posted against.
    assert.ok(liveLoad!.blocks.every((block) => typeof block.blockId === "string" && block.blockId.length > 0));
  } finally {
    await database.close();
  }
});

test("LL2 an audio lesson's body answer key is never handed to the browser before the learner answers", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "quiz-body", title: "Quiz body lesson" });
    await addBlock(database, lessonId, { type: "audio", position: 1, objectKey: "private/audio.mp3" });
    await database.db.insert(lessonBlocks).values({
      lessonId,
      position: 2,
      type: "quiz",
      quizQuestionType: "multiple_choice",
      quizPayload: { prompt: "What did the speaker say?", options: ["A", "B", "C"], answer: "B", explanation: "B is correct." },
    });

    const loaded = await loadLessonForLearner(lessonId, database.studentId, database.db);
    const quiz = loaded!.blocks.find((block) => block.type === "quiz")!;
    assert.equal(quiz.quiz?.answerKey, undefined, "no key before the learner answers");
    assert.equal(quiz.quiz?.explanation, undefined, "no explanation before the learner answers");
    assert.deepEqual(quiz.quiz?.options, ["A", "B", "C"], "the options are the authored ones");
  } finally {
    await database.close();
  }
});

test("LL3 Xulosangiz on a listening lesson is the learner's PRIVATE row, never another learner's and never progress", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "notes-lesson", title: "Notes lesson" });
    await addBlock(database, lessonId, { type: "audio", position: 1, objectKey: "private/audio.mp3" });

    await saveLessonNote({ userId: database.studentId, lessonId, body: "Mening xulosam", executor: database.db });
    await saveLessonNote({ userId: database.otherStudentId, lessonId, body: "Boshqa o'quvchi xulosasi", executor: database.db });

    const rows = await database.db.select().from(lessonNotes).where(eq(lessonNotes.lessonId, lessonId));
    assert.equal(rows.length, 2, "one private row per learner on the same lesson");
    assert.equal(rows.find((row) => row.userId === database.studentId)?.body, "Mening xulosam");

    // A note is not progress: the lesson-progress column stays untouched and no state
    // is created by writing a note.
    const progress = await database.query<{ count: string }>(`select count(*)::text as count from lesson_progress where lesson_id = $1`, [lessonId]);
    assert.equal(progress[0]!.count, "0", "writing a note must not create progress");

    // The lesson notes table has no role column to be widened, and the schema keeps the
    // (user, lesson) identity unique.
    const schema = readFileSync(join(ROOT, "src/db/schema.ts"), "utf8");
    const notesTable = schema.slice(schema.indexOf('export const lessonNotes'));
    assert.match(notesTable.slice(0, 1200), /uniqueIndex\("lesson_notes_user_lesson_uq"\)\.on\(table\.userId, table\.lessonId\)/);
  } finally {
    await database.close();
  }
});

test("LL4 the lesson page is body-first, then exactly the three approved tabs, driven by the URL", () => {
  const page = readFileSync(join(ROUTE_DIR, "[lessonId]/page.tsx"), "utf8");
  const list = readFileSync(join(ROUTE_DIR, "page.tsx"), "utf8");

  // Exactly three tabs, in the approved order and labels.
  assert.match(page, /const TABS = \["description", "teacher-notes", "xulosangiz"\] as const;/);
  assert.match(page, /t\.tabs\[candidate === "teacher-notes" \? "teacherNotes" : candidate\]/);
  assert.match(page, /resolveTab\(query\.tab\)/);
  assert.match(page, /searchParams: Promise<\{ tab\?: string \}>/);
  // The tab is in the href, so a reload lands on the same section.
  assert.match(page, /href=\{`\/app\/listening\/lessons\/\$\{detail\.lesson\.id\}\?tab=\$\{candidate\}`\}/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /aria-selected=\{tab === candidate\}/);

  // The body is rendered BEFORE the tabs in source order.
  assert.ok(
    page.indexOf("<ListeningLessonBody") < page.indexOf("data-listening-lesson-tabs"),
    "the lesson body must come before the three controls",
  );
  assert.match(page, /<ListeningLessonBody dict=\{dict\} blocks=\{detail\.blocks\} \/>/);

  // Xulosangiz reuses the ONE notes panel — no second notes system.
  assert.match(page, /import \{ LessonNotesPanel \} from "@\/components\/notes\/LessonNotesPanel"/);
  assert.match(page, /<LessonNotesPanel dict=\{dict\} lessonId=\{detail\.lesson\.id\} initialNotes=\{detail\.note\} \/>/);
  assert.ok(!/notes-route|student-note|localStorage/.test(page), "no second note path, no browser storage");

  // Description and Teacher notes read canonical authored columns only.
  assert.match(page, /detail\.lesson\.summary/);
  assert.match(page, /detail\.media\?\.focus/);
  assert.match(page, /detail\.media\?\.notes/);
  assert.match(page, /data-listening-description-empty/);
  assert.match(page, /data-listening-teacher-notes-empty/);

  // The list page: cards from the derived library, a truthful empty state, and the
  // authoring path for STAFF only.
  assert.match(list, /const lessons = await listListeningLessons\(\);/);
  assert.match(list, /data-listening-lessons-empty/);
  assert.match(list, /const staff = isStaff\(user\.role\);/);
  assert.match(list, /staff && \(/);
  assert.match(list, /href="\/app\/admin\/content\/workspace"/);
  // No fabricated content anywhere: the page never declares its own lesson data.
  assert.ok(!/const (sample|demo|placeholder|mock)\w*\s*[:=]/i.test(list + page), "no sample/demo data may be declared on these pages");
  assert.ok(!/Lorem ipsum/i.test(list + page));
});

test("LL5 the routes exist where the namespace expects them and nothing secret is exposed in the URL", () => {
  assert.ok(existsSync(join(ROUTE_DIR, "page.tsx")), "/app/listening/lessons must exist");
  assert.ok(existsSync(join(ROUTE_DIR, "[lessonId]/page.tsx")), "/app/listening/lessons/[lessonId] must exist");

  const page = readFileSync(join(ROUTE_DIR, "[lessonId]/page.tsx"), "utf8");
  assert.ok(!/query\.(note|answer|key)/.test(page), "the note and any answer never travel in the URL");
  // A non-listening, non-live or unknown lesson takes the not-found path.
  //
  // Honest limitation, observed on the built server: because the shell streams (the
  // (shell) layout plus its loading boundary flush before the page resolves), Next has
  // already committed the HTTP status, so the response is 200 with
  // `NEXT_HTTP_ERROR_FALLBACK;404` in the payload and the not-found boundary rendering
  // on the client. This is the app's EXISTING behaviour for every page-level
  // `notFound()` under the shell (e.g. /app/reading/attempts/not-a-uuid), not something
  // introduced here — which is why the claim is "takes the not-found path", not
  // "answers HTTP 404".
  assert.match(page, /if \(!detail\) notFound\(\);/);
  assert.match(page, /if \(!isUuid\(lessonId\)\) notFound\(\);/, "a malformed id is a 404, not a database error");

  // The lesson id in the URL is the learner's stable lesson identity — the same one
  // the private note is keyed by, and the same one the media library uses for its own
  // route. No content-hash or title identity is invented here.
  const service = readFileSync(join(ROOT, "src/lib/listening/lessons.ts"), "utf8");
  assert.match(service, /readLessonNote\(userId, lessonId\)/);
  assert.match(service, /loadLessonForLearner\(lessonId, userId, executor\)/);
  assert.match(service, /isLive\(\{ publicationState: row\.publicationState, publishAt: row\.publishAt \}\)/);
});

test("LL6 no other surface starts rendering listening lessons' private notes", () => {
  const offenders: string[] = [];
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? walk(path) : /\.(ts|tsx)$/.test(entry) ? [path] : [];
    });
  for (const file of walk(join(ROOT, "src"))) {
    const relativePath = relative(ROOT, file);
    const source = readFileSync(file, "utf8");
    if (!/loadListeningLesson|listListeningLessons|href=["'`][^"'`]*\/app\/listening\/lessons/.test(source)) continue;
    const allowed =
      relativePath === "src/lib/listening/lessons.ts" ||
      relativePath === "src/app/app/(shell)/listening/lessons/page.tsx" ||
      relativePath === "src/app/app/(shell)/listening/lessons/[lessonId]/page.tsx" ||
      relativePath === "src/app/app/(shell)/listening/page.tsx";
    if (!allowed) offenders.push(relativePath);
  }
  assert.deepEqual(offenders, [], "the listening lesson library has exactly one data module and its two routes");
});

test("LL7 the real library query returns only live listening lessons, with the learner's OWN note on the detail load", async () => {
  const database = await fixture();
  try {
    const audio = await addLesson(database, { slug: "live-audio", title: "Live audio lesson", summary: "Listen and summarise." });
    await addBlock(database, audio, { type: "audio", position: 1, objectKey: "private/live.mp3" });
    await addBlock(database, audio, { type: "text", position: 2, textContent: "Body text." });

    const textOnly = await addLesson(database, { slug: "live-text", title: "Live text lesson" });
    await addBlock(database, textOnly, { type: "text", position: 1, textContent: "Only reading." });

    const draft = await addLesson(database, { slug: "draft-audio", title: "Draft audio lesson", publicationState: "draft" });
    await addBlock(database, draft, { type: "audio", position: 1, objectKey: "private/draft.mp3" });

    const attached = await addLesson(database, { slug: "attached", title: "Attached audio lesson" });
    await database.db.insert(videoLessons).values({
      lessonId: attached,
      mediaKind: "audio",
      provider: "direct",
      videoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      title: "Episode 2",
      notes: "Centre notes for episode 2.",
      beforeYouWatch: "Predict what the speaker will claim.",
      publicationState: "published",
    });

    const cards = await listListeningLessons(database.db);
    const titles = cards.map((card) => card.title).sort();
    assert.deepEqual(titles, ["Attached audio lesson", "Live audio lesson"], "only live listening lessons are listed");
    assert.equal(cards.find((card) => card.id === audio)?.source, "audio_block");
    assert.equal(cards.find((card) => card.id === attached)?.source, "attached_media");
    assert.equal(cards.find((card) => card.id === attached)?.hasTeacherNotes, true, "the notes flag comes from the authored notes column");

    // The detail load: the caller's own note only.
    await saveLessonNote({ userId: database.studentId, lessonId: audio, body: "Mening shaxsiy xulosam", executor: database.db });
    await saveLessonNote({ userId: database.otherStudentId, lessonId: audio, body: "Boshqa o'quvchi matni", executor: database.db });

    const mine = await loadListeningLesson(audio, database.studentId, database.db);
    assert.equal(mine?.note, "Mening shaxsiy xulosam");
    const theirs = await loadListeningLesson(audio, database.otherStudentId, database.db);
    assert.equal(theirs?.note, "Boshqa o'quvchi matni");
    assert.notEqual(mine?.note, theirs?.note, "two learners, two private notes, no crossover");

    // The description and the teacher notes come from authored columns.
    const withMedia = await loadListeningLesson(attached, database.studentId, database.db);
    assert.equal(withMedia?.lesson.summary, null, "nothing is invented when the description column is empty");
    assert.equal(withMedia?.media?.notes, "Centre notes for episode 2.");
    assert.equal(withMedia?.media?.focus, "Predict what the speaker will claim.");

    // A draft, a text-only lesson and an unknown id are all the same answer: null.
    assert.equal(await loadListeningLesson(draft, database.studentId, database.db), null);
    assert.equal(await loadListeningLesson(textOnly, database.studentId, database.db), null, "a text-only lesson is not a listening lesson");
    assert.equal(await loadListeningLesson(randomUUID(), database.studentId, database.db), null);
  } finally {
    await database.close();
  }
});
