import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { contentVersions, lessonBlocks, lessons, lessonNotes, videoLessons } from "../src/db/schema";
import { loadLessonForLearner } from "../src/lib/content/lessons";
import { LESSON_LIBRARY_PAGE_MAX, listLessonLibrary, loadLessonLibraryDetail, teacherNotesFor } from "../src/lib/content/lesson-library";
import { listLessonsForStaff } from "../src/lib/content/lesson-staff";
import { saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { latestVersion, versionContent } from "../src/lib/content/versions";
import { saveLessonNote } from "../src/lib/services/notes/lesson-notes";
import { mayPublishImportedContent } from "../src/lib/import/core/permissions";
import { isAdministrator, isStaff } from "../src/lib/auth/roles";
import { createTestDatabase } from "./support/pglite";

/**
 * Listening → Lessons, under the CORRECTED contract: a lesson is classified by its
 * AUTHORED LEARNING AREA, never by its media type, its title or its course.
 *
 * What is being protected (L1–L16):
 *   L1  a video-only lesson classified `listening` IS a Listening lesson;
 *   L2  a text-heavy lesson classified `listening` IS a Listening lesson;
 *   L3  an audio lesson classified `reading` is NOT a Listening lesson;
 *   L4  an unclassified lesson called "Listening Strategies" is NOT classified by its title;
 *   L5  Teacher Notes live on the lesson, and need no media row at all;
 *   L6  they survive a reload (they are read from the database, not from a request cache);
 *   L7  they are in the VERSIONED representation, and a pre-0050 `{ blocks }` revision
 *       stays readable;
 *   L8  Description and Teacher Notes are independent authored fields;
 *   L9  Xulosangiz stays the learner's own private row, and never reaches a staff read;
 *   L10 a teacher gets exactly the lesson-authoring capability and nothing else;
 *   L11 a teacher gains no unrelated Admin/Owner capability, and the admin workspace
 *       stays administrator-only;
 *   L12 an administrator/owner still authors through the same, single write path;
 *   L13 with more than 60 newer unrelated lessons, legitimate Listening lessons are
 *       still returned (the area is a WHERE clause, never a post-filter on a global cap);
 *   L14 the page bound applies AFTER semantic filtering, and paging is bounded;
 *   L15 a pre-0050 lesson row (no area, no notes) stays readable;
 *   L16 the legacy attached-media notes remain a compatible fallback, and
 *       lesson-level Teacher Notes always win over it.
 */

const ROOT = join(import.meta.dirname, "..");
const ROUTE_DIR = join(ROOT, "src/app/app/(shell)/listening/lessons");
const AUTHOR_PAGE = join(ROUTE_DIR, "author/page.tsx");
const DESK = join(ROOT, "src/components/lessons/LessonAuthoringDesk.tsx");
const ADMIN_WORKSPACE = join(ROOT, "src/app/app/(shell)/admin/content/workspace/page.tsx");
const DRAFTS_ROUTE = join(ROOT, "src/app/api/admin/content/drafts/route.ts");

const ownerActor: AuthoringActor = { id: "", role: "owner", mayPublish: true };

/**
 * Source-scan guards match CODE, not prose: a doc comment that names the admin
 * workspace must not be mistaken for the page reaching into it.
 */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

async function fixture() {
  const database = await createTestDatabase();
  const { query } = database;
  const [owner, admin, teacher, student, other] = await query<{ id: string }>(`
    insert into users (name, role, account_status) values
      ('Lesson owner', 'owner', 'active'),
      ('Lesson admin', 'admin', 'active'),
      ('Lesson teacher', 'teacher', 'active'),
      ('Listener', 'student', 'active'),
      ('Other listener', 'student', 'active')
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
    adminId: admin!.id,
    teacherId: teacher!.id,
    studentId: student!.id,
    otherStudentId: other!.id,
    unitId: unit!.id,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

type BlockType = "text" | "audio" | "video" | "image" | "file" | "link" | "quiz" | "content_reference";

async function addLesson(
  database: Fixture,
  input: {
    slug: string;
    title: string;
    area?: string | null;
    publicationState?: "draft" | "published" | "scheduled" | "archived";
    summary?: string | null;
    teacherNotes?: string | null;
    estimatedMinutes?: number | null;
    updatedAt?: Date;
  },
) {
  const [row] = await database.db
    .insert(lessons)
    .values({
      unitId: database.unitId,
      slug: input.slug,
      title: input.title,
      order: 1,
      publicationState: input.publicationState ?? "published",
      defaultState: "available",
      summary: input.summary ?? null,
      teacherNotes: input.teacherNotes ?? null,
      estimatedMinutes: input.estimatedMinutes ?? null,
      learningArea: input.area === undefined ? null : input.area,
      ...(input.updatedAt ? { updatedAt: input.updatedAt } : {}),
    })
    .returning({ id: lessons.id });
  return row!.id;
}

async function addBlock(database: Fixture, lessonId: string, block: { type: BlockType; position: number; textContent?: string | null; objectKey?: string | null }) {
  await database.db.insert(lessonBlocks).values({
    lessonId,
    position: block.position,
    type: block.type,
    textContent: block.textContent ?? null,
    objectKey: block.objectKey ?? null,
  });
}

/* -------------------------------------------------------------------------- */
/* L1–L4: the learning area classifies; media never does                      */
/* -------------------------------------------------------------------------- */

test("L1 a video-only lesson classified as listening appears in the Listening library", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "mcq-strategy-video", title: "MCQ strategy", area: "listening", summary: "How to eliminate wrong options." });
    await addBlock(database, lessonId, { type: "video", position: 1, objectKey: "private/video-lessons/mcq-strategy.mp4" });

    const { rows } = await listLessonLibrary({ area: "listening" }, database.db);
    assert.deepEqual(rows.map((row) => row.id), [lessonId], "a video lesson about listening is a Listening lesson");
    assert.equal(rows[0]!.hasMedia, true, "the card truthfully says it carries media");

    // The same lesson is NOT a Reading lesson: the area, not the media, decides.
    const reading = await listLessonLibrary({ area: "reading" }, database.db);
    assert.deepEqual(reading.rows, []);
  } finally {
    await database.close();
  }
});

test("L2 a text-heavy lesson classified as listening appears, with no media at all", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "note-taking-guide", title: "Note-taking while you listen", area: "listening" });
    await addBlock(database, lessonId, { type: "text", position: 1, textContent: "The speaker signals a contrast with 'however'." });
    await addBlock(database, lessonId, { type: "text", position: 2, textContent: "Write only the content words." });

    const { rows } = await listLessonLibrary({ area: "listening" }, database.db);
    assert.deepEqual(rows.map((row) => row.id), [lessonId]);
    assert.equal(rows[0]!.hasMedia, false, "no media, and that is not a defect");

    const detail = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(detail?.blocks.length, 2, "the body is the authored text blocks");
  } finally {
    await database.close();
  }
});

test("L3 an audio lesson classified as reading does not appear under Listening", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "reading-audio", title: "Audio passage analysis", area: "reading" });
    await addBlock(database, lessonId, { type: "audio", position: 1, objectKey: "private/audio/passage.mp3" });

    const listening = await listLessonLibrary({ area: "listening" }, database.db);
    assert.deepEqual(listening.rows, [], "media type must never pull a Reading lesson into Listening");
    const reading = await listLessonLibrary({ area: "reading" }, database.db);
    assert.deepEqual(reading.rows.map((row) => row.id), [lessonId]);

    // The detail route agrees: the same id is a 404 under the wrong area.
    assert.equal(await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db), null);
    assert.ok(await loadLessonLibraryDetail(lessonId, database.studentId, "reading", database.db));
  } finally {
    await database.close();
  }
});

test("L4 an unclassified lesson titled \"Listening Strategies\" with an audio block is still unclassified", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "listening-strategies", title: "Listening Strategies", area: null });
    await addBlock(database, lessonId, { type: "audio", position: 1, objectKey: "private/audio/strategy.mp3" });
    await addBlock(database, lessonId, { type: "content_reference", position: 2 });

    // Neither the title nor the audio block nor the reference may classify it.
    assert.deepEqual((await listLessonLibrary({ area: "listening" }, database.db)).rows, []);
    assert.equal(await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db), null);

    // It is still readable as a lesson — the column is nullable on purpose, and staff see
    // it in the authoring desk precisely so an author can classify it.
    const loaded = await loadLessonForLearner(lessonId, database.studentId, database.db);
    assert.ok(loaded, "an unclassified lesson is still a lesson");
    assert.equal(loaded.lesson.learningArea, null);
    const staff = await listLessonsForStaff("listening", database.db);
    assert.ok(staff.some((row) => row.id === lessonId), "the authoring desk surfaces unclassified lessons");
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* L5–L8, L16: Teacher Notes live on the lesson                               */
/* -------------------------------------------------------------------------- */

test("L5 Teacher Notes exist on a lesson with no video_lessons row", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, {
      slug: "connected-speech",
      title: "Connected speech",
      area: "listening",
      teacherNotes: "Play the clip twice: once for gist, once for the linking sounds. Ask them to mark the schwa.",
    });
    await addBlock(database, lessonId, { type: "text", position: 1, textContent: "Linking, elision, assimilation." });

    const mediaRows = await database.query<{ count: string }>(`select count(*)::text as count from video_lessons where lesson_id = $1`, [lessonId]);
    assert.equal(mediaRows[0]!.count, "0", "there is no media row to hang notes on — this is the whole point");

    const detail = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(detail?.media, null);
    assert.match(detail!.teacherNotes!, /linking sounds/);
    assert.equal(detail!.teacherNotesSource, "lesson", "the canonical lesson field is the source");
    assert.equal((await listLessonLibrary({ area: "listening" }, database.db)).rows[0]!.hasTeacherNotes, true);
  } finally {
    await database.close();
  }
});

test("L6 Teacher Notes survive a reload — they are read from the database, not from a request cache", async () => {
  const database = await fixture();
  try {
    const notes = "Model answer: the speaker's attitude is sceptical, not hostile.";
    const lessonId = await addLesson(database, { slug: "attitude", title: "Speaker attitude", area: "listening", teacherNotes: notes });
    await addBlock(database, lessonId, { type: "text", position: 1, textContent: "Intonation carries attitude." });

    const first = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    const second = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(first?.teacherNotes, notes);
    assert.equal(second?.teacherNotes, notes, "a second read — a reload — sees the same authored notes");
    assert.equal((await listLessonLibrary({ area: "listening" }, database.db)).rows[0]!.hasTeacherNotes, true);

    // A different executor (the pool's own client) reads the same stored text.
    const viaRow = await database.db.select({ teacherNotes: lessons.teacherNotes }).from(lessons).where(eq(lessons.id, lessonId));
    assert.equal(viaRow[0]!.teacherNotes, notes, "the text is a column value, not derived at render time");
  } finally {
    await database.close();
  }
});

test("L7 the pinned revision carries the lesson metadata, and a pre-0050 { blocks } revision stays readable", async () => {
  const database = await fixture();
  try {
    const actor = { ...ownerActor, id: database.ownerId };
    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-versioned-notes",
        title: "Versioned notes",
        payload: {
          unitId: database.unitId,
          slug: "versioned-notes",
          learningArea: "listening",
          summary: "Description of the lesson.",
          teacherNotes: "Centre notes for the lesson.",
          estimatedMinutes: 30,
          blocks: [{ type: "text", text: "Body." }],
        },
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    const latest = await latestVersion("lesson", "lesson", "lesson-versioned-notes", database.db);
    assert.ok(latest, "the authoring service pinned a revision");
    const snapshot = (await versionContent(latest.id, database.db)) as { learningArea?: unknown; summary?: unknown; teacherNotes?: unknown; estimatedMinutes?: unknown; blocks?: unknown };
    assert.equal(snapshot.learningArea, "listening", "the version records what the lesson is about");
    assert.equal(snapshot.summary, "Description of the lesson.");
    assert.equal(snapshot.teacherNotes, "Centre notes for the lesson.", "notes are part of the versioned representation");
    assert.equal(snapshot.estimatedMinutes, 30);
    assert.ok(Array.isArray(snapshot.blocks));

    // A revision pinned by the previous contract holds `{ blocks }` only. It must still be
    // readable, and reading the lesson must not depend on the snapshot carrying metadata.
    const [legacy] = await database.db
      .insert(contentVersions)
      .values({
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-legacy-revision",
        versionNo: 1,
        status: "draft",
        title: "Legacy revision",
        track: "unspecified",
        contentHash: "0".repeat(64),
        semanticHash: "0".repeat(64),
        answerKeyHash: "0".repeat(64),
        contentSnapshot: { blocks: [{ position: 1, type: "text", text: "Old body." }] },
        publicationState: "draft",
        targetType: "lesson",
      })
      .returning({ id: contentVersions.id });

    const legacyRead = await latestVersion("lesson", "lesson", "lesson-legacy-revision", database.db);
    const legacyContent = (await versionContent(legacyRead!.id, database.db)) as { blocks?: unknown; teacherNotes?: unknown };
    assert.ok(Array.isArray(legacyContent.blocks), "the old snapshot is still readable");
    assert.equal(legacyContent.teacherNotes, undefined, "it genuinely predates the metadata fields");

    const legacyLessonId = await addLesson(database, {
      slug: "legacy-revision",
      title: "Legacy revision",
      area: "listening",
      summary: "Row description survives.",
      teacherNotes: "Row notes survive.",
    });
    assert.ok(legacy!.id);
    const detail = await loadLessonLibraryDetail(legacyLessonId, database.studentId, "listening", database.db);
    assert.equal(detail?.teacherNotes, "Row notes survive.", "the lesson row, not the snapshot, is the authoring truth");
    assert.equal(detail?.lesson.summary, "Row description survives.");
  } finally {
    await database.close();
  }
});

test("L8 Description and Teacher Notes are independent authored fields", async () => {
  const database = await fixture();
  try {
    const withDescription = await addLesson(database, { slug: "desc-only", title: "Description only", area: "listening", summary: "A description for the learner." });
    const withNotes = await addLesson(database, { slug: "notes-only", title: "Notes only", area: "listening", teacherNotes: "A note for the class." });

    const a = await loadLessonLibraryDetail(withDescription, database.studentId, "listening", database.db);
    assert.equal(a?.lesson.summary, "A description for the learner.");
    assert.equal(a?.teacherNotes, null, "notes are not invented from the description");

    const b = await loadLessonLibraryDetail(withNotes, database.studentId, "listening", database.db);
    assert.equal(b?.lesson.summary, null, "the description is not invented from the notes");
    assert.equal(b?.teacherNotes, "A note for the class.");
  } finally {
    await database.close();
  }
});

test("L16 legacy attached-media notes remain compatible, and lesson-level notes win", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "legacy-media-notes", title: "Ted episode", area: "listening" });
    await database.db.insert(videoLessons).values({
      lessonId,
      mediaKind: "audio",
      provider: "direct",
      videoId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      title: "Episode",
      notes: "Notes that live on the media item.",
      publicationState: "published",
    });

    const legacy = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(legacy?.teacherNotes, "Notes that live on the media item.", "a lesson with no lesson-level notes falls back to its media notes");
    assert.equal(legacy?.teacherNotesSource, "media", "and says so, so a reviewer can see why");

    // Lesson-level notes are added: they WIN, and nothing about the media row is destroyed.
    await database.db.update(lessons).set({ teacherNotes: "Canonical lesson notes." }).where(eq(lessons.id, lessonId));
    const canonical = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(canonical?.teacherNotes, "Canonical lesson notes.");
    assert.equal(canonical?.teacherNotesSource, "lesson");
    const mediaRow = await database.db.select({ notes: videoLessons.notes }).from(videoLessons).where(eq(videoLessons.lessonId, lessonId));
    assert.equal(mediaRow[0]!.notes, "Notes that live on the media item.", "the media item keeps its own meaning");

    // The rule itself, in isolation.
    assert.deepEqual(teacherNotesFor("lesson", "media"), { teacherNotes: "lesson", source: "lesson" });
    assert.deepEqual(teacherNotesFor("   ", "media"), { teacherNotes: "media", source: "media" });
    assert.deepEqual(teacherNotesFor(null, null), { teacherNotes: null, source: null });
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* L9: Xulosangiz stays private                                              */
/* -------------------------------------------------------------------------- */

test("L9 Xulosangiz is the learner's OWN private row and never reaches a staff read", async () => {
  const database = await fixture();
  try {
    const lessonId = await addLesson(database, { slug: "xulosangiz", title: "Xulosangiz lesson", area: "listening", teacherNotes: "Centre notes." });
    await addBlock(database, lessonId, { type: "audio", position: 1, objectKey: "private/audio/x.mp3" });

    await saveLessonNote({ userId: database.studentId, lessonId, body: "Mening xulosam", executor: database.db });
    await saveLessonNote({ userId: database.otherStudentId, lessonId, body: "Boshqa o'quvchi xulosasi", executor: database.db });

    const mine = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    const theirs = await loadLessonLibraryDetail(lessonId, database.otherStudentId, "listening", database.db);
    assert.equal(mine?.note, "Mening xulosam");
    assert.equal(theirs?.note, "Boshqa o'quvchi xulosasi");
    assert.notEqual(mine?.note, theirs?.note, "two learners, two private notes, no crossover");

    const rows = await database.db.select().from(lessonNotes).where(eq(lessonNotes.lessonId, lessonId));
    assert.equal(rows.length, 2, "one row per (learner, lesson)");

    // A note is not progress and not a second store: writing one creates no progress row.
    const progress = await database.query<{ count: string }>(`select count(*)::text as count from lesson_progress where lesson_id = $1`, [lessonId]);
    assert.equal(progress[0]!.count, "0");

    // The staff read model has no notes field at all — student notes never appear on a
    // staff surface, and the canonical Teacher Notes are the lesson's own column.
    const staffSource = readFileSync(join(ROOT, "src/lib/content/lesson-staff.ts"), "utf8");
    assert.ok(!/lessonNotes|lesson_notes/.test(staffSource), "the staff lesson read must not touch the learner's notes table");
    const staff = await listLessonsForStaff("listening", database.db);
    const row = staff.find((candidate) => candidate.id === lessonId)!;
    assert.deepEqual(Object.keys(row).filter((key) => /note/i.test(key)), [], "no note-shaped field leaks into the staff row");
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* L10–L12: the teacher capability boundary                                  */
/* -------------------------------------------------------------------------- */

test("L10 a teacher gets exactly the lesson-authoring capability, through the same services", () => {
  assert.equal(isStaff("teacher"), true, "a teacher is staff");
  assert.equal(mayPublishImportedContent("teacher"), false, "and may not publish");

  // The authoring desk is open to every staff role and is NOT the administrator page.
  const page = readFileSync(AUTHOR_PAGE, "utf8");
  const pageCode = code(page);
  assert.match(pageCode, /const \[user, locale\] = await Promise\.all\(\[requireStaff\(\), getLocale\(\)\]\);/);
  assert.match(pageCode, /if \(!user\) redirect\("\/app"\);/, "a non-staff visitor is redirected, not shown an empty page");
  assert.ok(!/requireAdministrator/.test(pageCode), "the desk must not require an administrator");
  assert.ok(!/requireUser\(\)/.test(pageCode), "a learner must not reach the desk either");

  // The write path is the EXISTING one: the desk posts the same drafts API the admin
  // workspace uses, which is what makes two authoring surfaces one set of rules.
  const desk = readFileSync(DESK, "utf8");
  assert.match(desk, /"\/api\/admin\/content\/drafts"/);
  assert.match(desk, /\/api\/admin\/content\/versions\/\$\{savedVersionId\}\/publication/);
  assert.match(desk, /module: "lesson"/);
  assert.match(desk, /contentType: "lesson"/);
  // Both learning-area choices come from the one vocabulary, and the field is authored.
  assert.match(desk, /LEARNING_AREAS/);

  // The drafts API itself admits staff (so a teacher can write) and pins the actor's
  // real publication capability rather than trusting the client.
  const drafts = readFileSync(DRAFTS_ROUTE, "utf8");
  assert.match(drafts, /if \(!isStaff\(user\.role\)\) return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\);/);
  assert.match(drafts, /mayPublish: mayPublishImportedContent\(user\.role\)/);
  // The desk hides publication controls behind the server-decided flag, and the page
  // passes that flag from the permission layer.
  assert.match(page, /canPublish=\{mayPublishImportedContent\(user\.role\)\}/);
  assert.match(desk, /canPublish \? \(/);
});

test("L11 a teacher gains no unrelated Admin/Owner capability", () => {
  assert.equal(isAdministrator("teacher"), false);
  assert.equal(isAdministrator("admin"), true);
  assert.equal(isAdministrator("owner"), true);

  // The admin workspace remains administrator-only. Fixing the dead link must not have
  // opened the rest of the admin surface to teachers.
  const workspace = readFileSync(ADMIN_WORKSPACE, "utf8");
  assert.match(workspace, /const administrator = await requireAdministrator\(\);/);

  // The desk is scoped: it names no other admin module, no admissions/owners surface and
  // no lesson deletion.
  const desk = code(readFileSync(DESK, "utf8"));
  assert.ok(!/\/app\/admin\//.test(desk), "the desk must not link into the admin workspace");
  assert.ok(!/owners|admissions|user-administration|migration/i.test(desk), "no unrelated administrative surface");
  assert.ok(!/method: "DELETE"|\.delete\(/.test(desk), "the desk offers no deletion path");
  const page = code(readFileSync(AUTHOR_PAGE, "utf8"));
  assert.ok(!/\/app\/admin\//.test(page), "and neither does its page");
});

test("L12 an administrator and the owner still author, through the one lesson author", async () => {
  const database = await fixture();
  try {
    for (const actor of [
      { ...ownerActor, id: database.ownerId, role: "admin" },
      { ...ownerActor, id: database.ownerId, role: "owner" },
    ] as AuthoringActor[]) {
      const saved = await database.db.transaction((tx) =>
        saveContentDraft(tx, {
          actor,
          module: "lesson",
          contentType: "lesson",
          sourceRef: `lesson-${actor.role}`,
          title: `${actor.role} lesson`,
          payload: { unitId: database.unitId, slug: `slug-${actor.role}`, learningArea: "listening", blocks: [] },
        }),
      );
      assert.equal(saved.ok, true, `${actor.role} can author a lesson`);
    }

    // One author, one service: the desk and the admin workspace both go through this.
    const authors = readFileSync(join(ROOT, "src/lib/content/authors.ts"), "utf8");
    assert.match(authors, /saveLessonStructure\(tx as never, \{/);
    const adminApiFiles = ["drafts/route.ts", "versions/[id]/publication/route.ts"].map((suffix) => join(ROOT, "src/app/api/admin/content", suffix));
    for (const file of adminApiFiles) {
      const source = readFileSync(file, "utf8");
      assert.match(source, /isStaff|requireActiveUser/, `${file} keeps its staff gate`);
    }
    assert.ok(existsSync(join(ROOT, "src/lib/content/authors.ts")));
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* L13–L14: classify BEFORE limiting                                          */
/* -------------------------------------------------------------------------- */

test("L13 with 65 newer unrelated lessons, legitimate Listening lessons are still returned", async () => {
  const database = await fixture();
  try {
    // Two Listening lessons, older than the flood.
    const older = await addLesson(database, { slug: "old-listening-1", title: "Form completion", area: "listening", updatedAt: new Date(Date.now() - 3 * 3_600_000) });
    const older2 = await addLesson(database, { slug: "old-listening-2", title: "Map labelling", area: "listening", updatedAt: new Date(Date.now() - 2 * 3_600_000) });

    // 65 READING lessons, all newer: the old code took the latest 60 and then threw them
    // all away, hiding both Listening lessons behind the page bound.
    await database.query(`
      insert into lessons (unit_id, slug, title, "order", publication_state, default_state, learning_area, updated_at)
      select $1, 'flood-' || n, 'Reading flood ' || n, n, 'published', 'available', 'reading', now() + (n || ' minutes')::interval
      from generate_series(1, 65) as n
    `, [database.unitId]);

    const { rows, hasMore } = await listLessonLibrary({ area: "listening" }, database.db);
    assert.deepEqual(rows.map((row) => row.id).sort(), [older, older2].sort(), "the area is filtered BEFORE any bound is applied");
    assert.equal(hasMore, false, "two rows is the whole Listening catalogue");
    assert.ok(rows.every((row) => !row.title.startsWith("Reading flood")), "no unrelated lesson leaks into the area");

    // The bound is a WHERE clause, not a post-filter: prove it by counting what the
    // library would have seen first. 67 lessons exist; the area query must never have
    // needed to consider them.
    const source = readFileSync(join(ROOT, "src/lib/content/lesson-library.ts"), "utf8");
    const whereIndex = source.indexOf("eq(lessons.learningArea, area)");
    const limitIndex = source.indexOf(".limit(limit + 1)");
    assert.ok(whereIndex > -1 && limitIndex > -1, "the area predicate and the bound both exist");
    assert.ok(whereIndex < limitIndex, "the area predicate is written before the bound, in one query");
  } finally {
    await database.close();
  }
});

test("L14 the page bound applies after semantic filtering, and paging is bounded", async () => {
  const database = await fixture();
  try {
    const newest = await addLesson(database, { slug: "l3", title: "Third", area: "listening", updatedAt: new Date(Date.now() - 60_000) });
    const middle = await addLesson(database, { slug: "l2", title: "Second", area: "listening", updatedAt: new Date(Date.now() - 120_000) });
    const oldest = await addLesson(database, { slug: "l1", title: "First", area: "listening", updatedAt: new Date(Date.now() - 180_000) });
    await addLesson(database, { slug: "unrelated", title: "Reading only", area: "reading", updatedAt: new Date() });

    const firstPage = await listLessonLibrary({ area: "listening", limit: 2 }, database.db);
    assert.deepEqual(firstPage.rows.map((row) => row.id), [newest, middle], "newest first, and the page is capped");
    assert.equal(firstPage.hasMore, true, "a next page exists and the UI is told");

    const secondPage = await listLessonLibrary({ area: "listening", limit: 2, offset: 2 }, database.db);
    assert.deepEqual(secondPage.rows.map((row) => row.id), [oldest]);
    assert.equal(secondPage.hasMore, false, "the end of the area's own list");

    // The bound cannot be bypassed by asking for more, and cannot be negative.
    const huge = await listLessonLibrary({ area: "listening", limit: 10_000 }, database.db);
    assert.equal(huge.rows.length, 3);
    assert.equal(LESSON_LIBRARY_PAGE_MAX, 60, "one bounded page size, shared by every lesson area");
    const negative = await listLessonLibrary({ area: "listening", limit: -5, offset: -5 }, database.db);
    assert.equal(negative.rows.length, 1, "a negative limit clamps to 1 and a negative offset to 0");
    assert.deepEqual((await listLessonLibrary({ area: "listening", offset: 99 }, database.db)).rows, [], "an offset past the end is empty, not an error");
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* L15: old data                                                              */
/* -------------------------------------------------------------------------- */

test("L15 a pre-0050 lesson row (no area, no notes) stays readable", async () => {
  const database = await fixture();
  try {
    // Exactly the shape 0049 left behind: no learning_area, no teacher_notes.
    const lessonId = await addLesson(database, { slug: "legacy-row", title: "Legacy lesson", area: null });
    await addBlock(database, lessonId, { type: "text", position: 1, textContent: "Legacy body." });
    await addBlock(database, lessonId, { type: "audio", position: 2, objectKey: "private/audio/legacy.mp3" });

    const raw = await database.db.select({ area: lessons.learningArea, notes: lessons.teacherNotes }).from(lessons).where(eq(lessons.id, lessonId));
    assert.equal(raw[0]!.area, null);
    assert.equal(raw[0]!.notes, null);

    const loaded = await loadLessonForLearner(lessonId, database.studentId, database.db);
    assert.ok(loaded, "historical lesson data must not stop loading");
    assert.equal(loaded.lesson.learningArea, null, "and its unspecified area is reported honestly");
    assert.equal(loaded.blocks.length, 2);

    // Unclassified lessons are absent from every learner area library until an author
    // classifies them — that is the truthful answer, not a guess.
    assert.deepEqual((await listLessonLibrary({ area: "listening" }, database.db)).rows, []);
    assert.deepEqual((await listLessonLibrary({ area: "general" }, database.db)).rows, []);
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* The old media-derived reader is gone                                       */
/* -------------------------------------------------------------------------- */

test("EXTRA GUARD the media-derived listening reader no longer exists", () => {
  assert.equal(existsSync(join(ROOT, "src/lib/listening/lessons.ts")), false, "the media-classification module was deleted, not kept alongside");
  const offenders: string[] = [];
  const importPattern = /@\/lib\/listening\/lessons|from "\.\.\/src\/lib\/listening\/lessons"/;
  const files = [join(ROOT, "src/app/app/(shell)/listening/lessons/page.tsx"), join(ROOT, "src/app/app/(shell)/listening/lessons/[lessonId]/page.tsx")];
  for (const file of files) {
    if (importPattern.test(readFileSync(file, "utf8"))) offenders.push(file);
  }
  assert.deepEqual(offenders, [], "the routes read the generic library only");

  // The learning-area vocabulary is the single classification source, and it is not
  // derived from anything: an authored value, checked by a shared predicate.
  const areas = readFileSync(join(ROOT, "src/lib/content/learning-areas.ts"), "utf8");
  assert.match(areas, /export const LEARNING_AREAS = \[/);
  assert.match(areas, /export function isLearningArea/);

  // The lesson row is the ONE system: no per-skill lesson table was invented.
  const schema = readFileSync(join(ROOT, "src/db/schema.ts"), "utf8");
  assert.ok(!/pgTable\(\s*"listening_lessons"/.test(schema), "never a listening_lessons table");
  assert.ok(!/pgTable\(\s*"reading_lessons"/.test(schema), "never a reading_lessons table");

  // And the historical revision data was not rewritten: 0050 only adds.
  const migration = readFileSync(join(ROOT, "drizzle/0050_lesson_learning_area.sql"), "utf8");
  assert.ok(!/update\s+lessons\s+set/i.test(migration), "0050 must not rewrite historical lesson data");
});
