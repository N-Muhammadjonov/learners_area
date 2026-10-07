import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { and, asc, eq } from "drizzle-orm";
import { contentVersions, lessonBlocks, lessonBlockResponses, lessonNotes, lessons } from "../src/db/schema";
import { saveContentDraft, publishContentVersion, type AuthoringActor } from "../src/lib/content/authoring";
import { loadLessonEditModel, startLessonRevision } from "../src/lib/content/lesson-edit";
import { loadLessonLibraryDetail, listLessonLibrary } from "../src/lib/content/lesson-library";
import { listLessonsForStaff } from "../src/lib/content/lesson-staff";
import { mayAuthorContentForRole } from "../src/lib/content/authoring-capabilities";
import { mayAuthorContent } from "../src/lib/content/authoring-access";
import { versionContent } from "../src/lib/content/versions";
import { saveLessonNote } from "../src/lib/services/notes/lesson-notes";
import { createTestDatabase } from "./support/pglite";
import en from "../src/lib/i18n/en";
import uz from "../src/lib/i18n/uz";

/**
 * THE LESSON AUTHORING SAFETY CORRECTION (C3-A, C3-B, C3-C).
 *
 *   E1–E6  EDITOR REHYDRATION. Selecting a lesson loads exactly what is inside it —
 *          every field, every block, in order, with media metadata and answer keys —
 *          so changing one thing cannot blank the rest;
 *   R1–R7  PUBLISHED → DRAFT REVISION. A published revision is immutable, the live
 *          lesson row is never rewritten while a draft exists, students keep reading
 *          the published revision until an administrator publishes, and one logical
 *          lesson (same id, same source ref) survives with Xulosangiz intact;
 *   A1–A7  THE CAPABILITY MODEL. A teacher authors exactly what the centre's
 *          capability repository grants (a lesson), never every registered module;
 *   N1–N4  NO SECOND SYSTEM, NO FAKE ERRORS: no new migration, block identity kept
 *          (so learner answers survive), uploads never strip media before a save, and
 *          every failure a human sees is a sentence from the dictionary.
 */

const ROOT = join(import.meta.dirname, "..");
const DESK = join(ROOT, "src/components/lessons/LessonAuthoringDesk.tsx");
const AUTHOR_PAGE = join(ROOT, "src/app/app/(shell)/listening/lessons/author/page.tsx");
const STAFF_READER = join(ROOT, "src/lib/content/lesson-staff.ts");
const EDIT_ROUTE = join(ROOT, "src/app/api/admin/content/lessons/[id]/edit/route.ts");
const REVISION_ROUTE = join(ROOT, "src/app/api/admin/content/lessons/[id]/revision/route.ts");
const DRAFTS_ROUTE = join(ROOT, "src/app/api/admin/content/drafts/route.ts");
const PUBLICATION_ROUTE = join(ROOT, "src/app/api/admin/content/versions/[id]/publication/route.ts");
const CAPABILITIES_ROUTE = join(ROOT, "src/app/api/admin/content/authoring-capabilities/route.ts");

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };
const teacher: AuthoringActor = { id: "", role: "teacher", mayPublish: false };

/**
 * Source-scan guards match CODE, not prose, and must not be fooled by a STRING that
 * looks like a comment: `"audio/*"` is an `accept` attribute, not the start of a
 * block comment. A naive strip would swallow everything after it — which is exactly
 * how a guard silently stops guarding.
 */
function code(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    if (two === "//") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
      continue;
    }
    const char = source[i]!;
    if (char === '"' || char === "'" || char === "`") {
      out += char;
      i += 1;
      while (i < source.length) {
        if (source[i] === "\\") {
          out += source.slice(i, i + 2);
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === char) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

const TEXT = (text: string) => ({ type: "text" as const, text });

async function fixture() {
  const database = await createTestDatabase();
  const { query } = database;
  const [ownerUser, admin, teacherUser, student] = await query<{ id: string }>(`
    insert into users (name, role, account_status) values
      ('Owner', 'owner', 'active'),
      ('Admin', 'admin', 'active'),
      ('Teacher', 'teacher', 'active'),
      ('Learner', 'student', 'active')
    returning id
  `);
  const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('c', 'Course') returning id`);
  const [module] = await query<{ id: string }>(`insert into course_modules (course_id, slug, title, "order") values ($1, 'm', 'Module', 1) returning id`, [course!.id]);
  const [unitA] = await query<{ id: string }>(`insert into units (module_id, slug, title, "order") values ($1, 'ua', 'Unit A', 1) returning id`, [module!.id]);
  const [unitB] = await query<{ id: string }>(`insert into units (module_id, slug, title, "order") values ($1, 'ub', 'Unit B', 2) returning id`, [module!.id]);
  return {
    close: database.close,
    db: database.db,
    query: database.query,
    owner: { ...owner, id: ownerUser!.id },
    adminId: admin!.id,
    teacher: { ...teacher, id: teacherUser!.id },
    studentId: student!.id,
    unitA: unitA!.id,
    unitB: unitB!.id,
  };
}

type Fixture = Awaited<ReturnType<typeof fixture>>;

const lessonPayload = (unitId: string, overrides: Record<string, unknown> = {}) => ({
  unitId,
  slug: "why-notes-matter",
  learningArea: "listening",
  summary: "How to take notes while you listen.",
  teacherNotes: "Ask the class to predict the topic from the title first.",
  estimatedMinutes: 25,
  blocks: [TEXT("First paragraph."), TEXT("Second paragraph.")],
  ...overrides,
});

/** Author and publish a lesson through the REAL pipeline, exactly as the desk does. */
async function publishedLesson(database: Fixture, overrides: Record<string, unknown> = {}) {
  const saved = await database.db.transaction((tx) =>
    saveContentDraft(tx, {
      actor: database.owner,
      module: "lesson",
      contentType: "lesson",
      sourceRef: "lesson-why-notes-matter",
      title: "Why notes matter",
      payload: lessonPayload(database.unitA, overrides),
    }),
  );
  assert.equal(saved.ok, true, "the fixture lesson must author cleanly");
  const published = await database.db.transaction((tx) =>
    publishContentVersion(tx, { actor: database.owner, versionId: saved.version.id, to: "published" }),
  );
  assert.equal(published.ok, true, "the fixture lesson must publish cleanly");
  const [row] = await database.db
    .select({ id: lessons.id, unitId: lessons.unitId, publicationState: lessons.publicationState, teacherNotes: lessons.teacherNotes, summary: lessons.summary })
    .from(lessons)
    .where(eq(lessons.sourceRef, "lesson-why-notes-matter"));
  return { lessonId: row!.id, publishedVersionId: saved.version.id, row: row! };
}

/* -------------------------------------------------------------------------- */
/* E1–E6: THE EDITOR REHYDRATES A LESSON EXACTLY                              */
/* -------------------------------------------------------------------------- */

test("E1 selecting a lesson loads its whole editable content, not a blank form", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const model = await loadLessonEditModel(lessonId, database.db);
    assert.ok(model, "the lesson loads");
    assert.equal(model.title, "Why notes matter");
    assert.equal(model.slug, "why-notes-matter");
    assert.equal(model.sourceRef, "lesson-why-notes-matter");
    assert.equal(model.unitId, database.unitA);
    assert.equal(model.learningArea, "listening");
    assert.equal(model.summary, "How to take notes while you listen.", "the description is not blank");
    assert.equal(model.teacherNotes, "Ask the class to predict the topic from the title first.", "teacher notes are not blank");
    assert.equal(model.estimatedMinutes, 25, "the estimated time is not blank");
    assert.deepEqual(
      model.blocks.map((block) => block.text),
      ["First paragraph.", "Second paragraph."],
      "every block is present, in authored order",
    );
    assert.equal(model.contentSource, "lesson", "the live row is what students are reading");
    assert.equal(model.published?.versionNo, 1);
    assert.equal(model.draft, null, "nothing is being edited yet");
  } finally {
    await database.close();
  }
});

test("E2 while a draft revision exists the editor loads the DRAFT, never a blank or the old row", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    assert.equal(started.ok, true);

    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.ok ? started.model.draft!.versionId : null,
        payload: lessonPayload(database.unitA, { summary: "Edited description." }),
      }),
    );
    assert.equal(saved.ok, true);

    const model = await loadLessonEditModel(lessonId, database.db);
    assert.equal(model?.contentSource, "draft");
    assert.equal(model?.summary, "Edited description.", "the editor shows the draft being edited");
    assert.equal(model?.teacherNotes, "Ask the class to predict the topic from the title first.", "and the fields the draft did not change");
    assert.deepEqual(model?.blocks.map((block) => block.text), ["First paragraph.", "Second paragraph."]);
    assert.equal(model?.draft?.versionNo, 2, "an existing editable draft is what a save continues");
    assert.equal(model?.published?.versionNo, 1, "the published revision is still the one students read");
  } finally {
    await database.close();
  }
});

test("E3 a media block comes back with its file identity intact", async () => {
  const database = await fixture();
  try {
    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-media",
        title: "Media lesson",
        payload: lessonPayload(database.unitA, {
          slug: "media-lesson",
          blocks: [
            { type: "image", objectKey: "private/images/diagram.png", originalName: "diagram.png", mimeType: "image/png", size: 20480 },
            { type: "audio", objectKey: "private/audio/segment-1.mp3", originalName: "segment-1.mp3", mimeType: "audio/mpeg", size: 512000 },
          ],
        }),
      }),
    );
    assert.equal(saved.ok, true);
    const [row] = await database.db.select({ id: lessons.id }).from(lessons).where(eq(lessons.sourceRef, "lesson-media"));
    const model = await loadLessonEditModel(row!.id, database.db);
    assert.deepEqual(
      model?.blocks.map((block) => ({ type: block.type, objectKey: block.objectKey, originalName: block.originalName, mimeType: block.mimeType, size: block.size })),
      [
        { type: "image", objectKey: "private/images/diagram.png", originalName: "diagram.png", mimeType: "image/png", size: 20480 },
        { type: "audio", objectKey: "private/audio/segment-1.mp3", originalName: "segment-1.mp3", mimeType: "audio/mpeg", size: 512000 },
      ],
      "a file whose name, type and size were dropped could not be shown to an author again",
    );
  } finally {
    await database.close();
  }
});

test("E4 quiz keys, options and content references hydrate on the staff surface", async () => {
  const database = await fixture();
  try {
    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-quiz",
        title: "Quiz lesson",
        payload: lessonPayload(database.unitA, {
          slug: "quiz-lesson",
          blocks: [
            {
              type: "quiz",
              quiz: {
                questionType: "mcq_single",
                prompt: "Which signal introduces a contrast?",
                options: ["however", "moreover"],
                answer: "however",
                explanation: "Listen for the tone change.",
              },
            },
            {
              type: "content_reference",
              ref: { module: "ted", contentType: "video_lesson", sourceRef: "ted-note-taking", versionId: null },
            },
          ],
        }),
      }),
    );
    assert.equal(saved.ok, true);
    const [row] = await database.db.select({ id: lessons.id }).from(lessons).where(eq(lessons.sourceRef, "lesson-quiz"));
    const model = await loadLessonEditModel(row!.id, database.db);
    const quiz = model?.blocks.find((block) => block.type === "quiz");
    assert.deepEqual(quiz?.quiz, {
      questionType: "mcq_single",
      prompt: "Which signal introduces a contrast?",
      options: ["however", "moreover"],
      answer: "however",
      explanation: "Listen for the tone change.",
    });
    const reference = model?.blocks.find((block) => block.type === "content_reference");
    assert.deepEqual(reference?.ref, { module: "ted", contentType: "video_lesson", sourceRef: "ted-note-taking", versionId: null });
  } finally {
    await database.close();
  }
});

test("E5 the LIST stays lightweight: detail is a second, separate staff request", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const rows = await listLessonsForStaff("listening", database.db);
    const row = rows.find((candidate) => candidate.id === lessonId);
    assert.ok(row, "the lesson is in the staff list");
    assert.equal(row.published?.versionNo, 1, "the list says which revision students read");
    assert.equal(row.draft, null, "and that nothing is being edited");
    // The list row carries no block content at all (no N+1, no blocks in the library query).
    assert.ok(!("blocks" in row), "the list is a list");

    const reader = code(readFileSync(STAFF_READER, "utf8"));
    assert.ok(!/lessonBlocks/.test(reader), "the list query never reads lesson_blocks");
    const desk = code(readFileSync(DESK, "utf8"));
    assert.match(desk, /\/api\/admin\/content\/lessons\/\$\{lessonId\}\/edit/, "selection loads the editable projection");
    assert.match(desk, /method: "GET"/);
    assert.ok(!/lessonRow\.summary|lesson\.summary/.test(desk), "the desk never hydrates itself from a list row");
    // Source identity is stable by construction: an existing lesson's reference is shown
    // and locked, so a save can never fork the lesson into a second logical item.
    assert.match(desk, /readOnly=\{selection !== "new"\}/);
    assert.match(desk, /disabled=\{selection !== "new"\}/);
    assert.match(desk, /data-lesson-authoring-source-ref-locked/);
    assert.match(desk, /t\.sourceRefLocked/);
    for (const route of [EDIT_ROUTE, REVISION_ROUTE]) {
      const source = code(readFileSync(route, "utf8"));
      assert.match(source, /mayAuthorContent\(user\.role, "lesson", "lesson"\)/, `${route} is bounded by the lesson capability`);
      assert.match(source, /requireActiveUser/, `${route} answers 401 before anything else`);
    }
  } finally {
    await database.close();
  }
});

test("E6 changing ONE thing keeps everything else, block rows included", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const before = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
    assert.equal(before.length, 2);

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    assert.equal(started.ok, true, "a revision is started, not an edit of the published one");

    // The author changes the teacher notes and nothing else.
    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.ok ? started.model.draft!.versionId : null,
        payload: lessonPayload(database.unitA, { teacherNotes: "Bring the transcript to class." }),
      }),
    );
    assert.equal(saved.ok, true);
    const published = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.owner, versionId: saved.ok ? saved.version.id : "", to: "published" }),
    );
    assert.equal(published.ok, true);

    const [row] = await database.db
      .select({ title: lessons.title, summary: lessons.summary, teacherNotes: lessons.teacherNotes, estimatedMinutes: lessons.estimatedMinutes, learningArea: lessons.learningArea })
      .from(lessons)
      .where(eq(lessons.id, lessonId));
    assert.deepEqual(row, {
      title: "Why notes matter",
      summary: "How to take notes while you listen.",
      teacherNotes: "Bring the transcript to class.",
      estimatedMinutes: 25,
      learningArea: "listening",
    });

    const after = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
    assert.deepEqual(
      after.map((block) => block.id),
      before.map((block) => block.id),
      "unchanged blocks keep their rows, so learner answers keyed to them stay valid",
    );
    assert.deepEqual(after.map((block) => block.textContent), ["First paragraph.", "Second paragraph."]);
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* R1–R7: PUBLISHED → DRAFT REVISION                                          */
/* -------------------------------------------------------------------------- */

test("R1 starting a revision copies the published content and rewrites nothing", async () => {
  const database = await fixture();
  try {
    const { lessonId, publishedVersionId, row } = await publishedLesson(database);
    const publishedSnapshot = await versionContent(publishedVersionId, database.db);
    assert.ok(publishedSnapshot);

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    assert.equal(started.ok, true);
    if (!started.ok) return;
    assert.equal(started.created, true);
    assert.equal(started.model.draft?.versionNo, 2, "v1 published → v2 editable");
    assert.equal(started.model.published?.versionNo, 1);

    const copied = await versionContent(started.model.draft!.versionId, database.db);
    const publishedAfter = await versionContent(publishedVersionId, database.db);
    assert.deepEqual(publishedAfter, publishedSnapshot, "the published revision is byte-for-byte unchanged");
    assert.equal((copied as { summary: string }).summary, (publishedSnapshot as { summary: string }).summary);
    assert.equal((copied as { teacherNotes: string }).teacherNotes, (publishedSnapshot as { teacherNotes: string }).teacherNotes);
    assert.deepEqual((copied as { blocks: unknown[] }).blocks, (publishedSnapshot as { blocks: unknown[] }).blocks);
    assert.equal((copied as { unitId: string }).unitId, row.unitId, "the copy keeps the lesson's structure");

    const [status] = await database.db.select({ publicationState: contentVersions.publicationState, status: contentVersions.status }).from(contentVersions).where(eq(contentVersions.id, publishedVersionId));
    assert.deepEqual(status, { publicationState: "published", status: "published" }, "starting a revision does not touch the live revision");
    const rows = await database.db.select({ id: lessons.id }).from(lessons).where(eq(lessons.sourceRef, "lesson-why-notes-matter"));
    assert.equal(rows.length, 1, "one logical lesson, no \"... Copy\" row");
  } finally {
    await database.close();
  }
});

test("R2 opening the desk twice does not pile up revisions", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const first = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    const second = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.teacher }));
    assert.equal(first.ok && second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(second.created, false, "the revision already in progress is opened, not duplicated");
    assert.equal(second.model.draft?.versionId, first.model.draft?.versionId);
    const versions = await database.db.select({ versionNo: contentVersions.versionNo }).from(contentVersions).where(eq(contentVersions.sourceRef, "lesson-why-notes-matter"));
    assert.deepEqual(versions.map((row) => row.versionNo), [1, 2], "no v3 exists");
  } finally {
    await database.close();
  }
});

test("R3 a draft save moves neither the live row nor the published revision", async () => {
  const database = await fixture();
  try {
    const { lessonId, publishedVersionId } = await publishedLesson(database);
    const publishedSnapshot = await versionContent(publishedVersionId, database.db);

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.teacher }));
    if (!started.ok) throw new Error("revision failed");
    const edited = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.teacher,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitA, { teacherNotes: "Teacher's improvement, not yet published." }),
      }),
    );
    assert.equal(edited.ok, true);

    // The row still says what students are reading, and the learner read agrees.
    const [row] = await database.db.select({ publicationState: lessons.publicationState, teacherNotes: lessons.teacherNotes }).from(lessons).where(eq(lessons.id, lessonId));
    assert.deepEqual(row, { publicationState: "published", teacherNotes: "Ask the class to predict the topic from the title first." });
    const learner = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(learner?.teacherNotes, "Ask the class to predict the topic from the title first.", "students keep reading the published notes");
    assert.deepEqual(await versionContent(publishedVersionId, database.db), publishedSnapshot);

    // And one save continues the SAME revision: the author always has one draft.
    const model = await loadLessonEditModel(lessonId, database.db);
    assert.equal(model?.draft?.versionNo, 2, "saving writes Draft v2, it does not chase v3, v4, ...");
    assert.equal(model?.teacherNotes, "Teacher's improvement, not yet published.");

    // A save naming the PUBLISHED revision is refused, and changes nothing.
    const refused = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.teacher,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: publishedVersionId,
        payload: lessonPayload(database.unitA, { teacherNotes: "Overwrite attempt." }),
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "published_is_immutable"), "named plainly: a published revision is immutable");
    const [stillThere] = await database.db.select({ teacherNotes: lessons.teacherNotes }).from(lessons).where(eq(lessons.id, lessonId));
    assert.equal(stillThere?.teacherNotes, "Ask the class to predict the topic from the title first.");
  } finally {
    await database.close();
  }
});

test("R4 publishing the draft is what reaches students, and the old revision stays readable", async () => {
  const database = await fixture();
  try {
    const { lessonId, publishedVersionId } = await publishedLesson(database);
    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    if (!started.ok) throw new Error("revision failed");
    const edited = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitA, { summary: "Published description.", teacherNotes: "Published notes." }),
      }),
    );
    if (!edited.ok) throw new Error("save failed");
    const published = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.owner, versionId: edited.version.id, to: "published" }),
    );
    assert.equal(published.ok, true);

    const [row] = await database.db.select({ summary: lessons.summary, teacherNotes: lessons.teacherNotes }).from(lessons).where(eq(lessons.id, lessonId));
    assert.deepEqual(row, { summary: "Published description.", teacherNotes: "Published notes." }, "publication materializes the revision onto the live row");

    const learner = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(learner?.lesson.summary, "Published description.");

    const [old] = await database.db.select({ status: contentVersions.status, publicationState: contentVersions.publicationState }).from(contentVersions).where(eq(contentVersions.id, publishedVersionId));
    assert.equal(old?.publicationState, "published", "the old revision keeps its own state");
    assert.equal(old?.status, "superseded", "and is superseded, never deleted");
    assert.ok(await versionContent(publishedVersionId, database.db), "so anything bound to it stays readable");

    const model = await loadLessonEditModel(lessonId, database.db);
    assert.equal(model?.published?.versionNo, 2, "staff now see Published v2");
    assert.equal(model?.draft, null, "and no draft is open");
  } finally {
    await database.close();
  }
});

test("R5 one lesson, one identity: same id, same source ref, Xulosangiz survives v1→v2", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const note = await saveLessonNote({ userId: database.studentId, lessonId, body: "My own summary of this lesson.", executor: database.db });
    assert.equal(note.ok, true, "the learner writes Xulosangiz on the published lesson");

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    if (!started.ok) throw new Error("revision failed");
    const edited = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter (revision)",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitA, { blocks: [TEXT("Rewritten for the second edition.")] }),
      }),
    );
    if (!edited.ok) throw new Error("save failed");
    const published = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.owner, versionId: edited.version.id, to: "published" }),
    );
    assert.equal(published.ok, true);

    const rows = await database.db.select({ id: lessons.id, slug: lessons.slug }).from(lessons).where(eq(lessons.sourceRef, "lesson-why-notes-matter"));
    assert.deepEqual(rows, [{ id: lessonId, slug: "why-notes-matter" }], "still exactly one lesson row, same id and slug");

    const [storedNote] = await database.db.select({ body: lessonNotes.body, userId: lessonNotes.userId }).from(lessonNotes).where(eq(lessonNotes.lessonId, lessonId));
    assert.deepEqual(storedNote, { body: "My own summary of this lesson.", userId: database.studentId }, "Xulosangiz is untouched by revisioning");

    const learner = await loadLessonLibraryDetail(lessonId, database.studentId, "listening", database.db);
    assert.equal(learner?.note, "My own summary of this lesson.");
    assert.deepEqual(learner?.blocks.map((block) => block.text), ["Rewritten for the second edition."]);
  } finally {
    await database.close();
  }
});

test("R6 moving a lesson to another unit duplicates nothing and orphans nothing", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const before = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    if (!started.ok) throw new Error("revision failed");
    const moved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitB),
      }),
    );
    assert.equal(moved.ok, true);

    // While the draft exists the row has not moved: students still find it where it was.
    const [duringEdit] = await database.db.select({ unitId: lessons.unitId }).from(lessons).where(eq(lessons.id, lessonId));
    assert.equal(duringEdit?.unitId, database.unitA);

    const published = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.owner, versionId: moved.ok ? moved.version.id : "", to: "published" }),
    );
    assert.equal(published.ok, true);
    const [after] = await database.db.select({ unitId: lessons.unitId }).from(lessons).where(eq(lessons.id, lessonId));
    assert.equal(after?.unitId, database.unitB, "the move lands with the publication");

    const rows = await database.db.select({ id: lessons.id }).from(lessons).where(eq(lessons.sourceRef, "lesson-why-notes-matter"));
    assert.equal(rows.length, 1, "no duplicate lesson was created for the new unit");
    const blocks = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
    assert.deepEqual(blocks.map((block) => block.id), before.map((block) => block.id), "the same blocks, not orphaned and re-created");
    assert.equal(blocks.length, 2);
    const allBlocks = await database.db.select({ lessonId: lessonBlocks.lessonId }).from(lessonBlocks);
    assert.ok(allBlocks.every((block) => block.lessonId === lessonId), "no block was orphaned onto another lesson");
  } finally {
    await database.close();
  }
});

test("R7 a teacher cannot publish, and the refusal changes nothing", async () => {
  const database = await fixture();
  try {
    const { lessonId, publishedVersionId } = await publishedLesson(database);
    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.teacher }));
    if (!started.ok) throw new Error("revision failed");
    const edited = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.teacher,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitA, { summary: "Not for students yet." }),
      }),
    );
    if (!edited.ok) throw new Error("save failed");
    const refused = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.teacher, versionId: edited.version.id, to: "published" }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "publish_forbidden"), "teacher publish → publish_forbidden");

    const [row] = await database.db.select({ summary: lessons.summary, publicationState: lessons.publicationState }).from(lessons).where(eq(lessons.id, lessonId));
    assert.deepEqual(row, { summary: "How to take notes while you listen.", publicationState: "published" });
    const [version] = await database.db.select({ status: contentVersions.status }).from(contentVersions).where(eq(contentVersions.id, publishedVersionId));
    assert.equal(version?.status, "published", "the published revision was not displaced by a refused publication");
  } finally {
    await database.close();
  }
});

/* -------------------------------------------------------------------------- */
/* A1–A7: THE CAPABILITY MODEL                                                */
/* -------------------------------------------------------------------------- */

const registered = () => true;

test("A1 a student authors nothing", () => {
  const probe = registered;
  for (const key of ["lesson:lesson", "speaking:material", "ted:video_lesson", "listening:full_test", "reading:passage"]) {
    const [module, contentType] = key.split(":") as [string, string];
    assert.equal(mayAuthorContentForRole("student", module, contentType, probe), false, `a student must not author ${key}`);
  }
  assert.equal(mayAuthorContentForRole(null, "lesson", "lesson", probe), false);
});

test("A2 a teacher authors the lesson capability the repository proves, and no more", () => {
  const probe = registered;
  assert.equal(mayAuthorContentForRole("teacher", "lesson", "lesson", probe), true, "the centre asks teachers to write lessons");
  assert.equal(mayAuthorContentForRole("teacher", "speaking", "material", probe), true, "and speaking material, which teachers already authored");
  assert.equal(mayAuthorContentForRole("teacher", "ted", "video_lesson", probe), true);
  assert.equal(mayAuthorContentForRole("teacher", "ted", "audio_lesson", probe), true);
  assert.equal(mayAuthorContentForRole("teacher", "listening", "full_test", probe), false, "a full test is not a lesson");
  assert.equal(mayAuthorContentForRole("teacher", "reading", "passage", probe), false);
  assert.equal(mayAuthorContentForRole("teacher", "mock", "full_mock", probe), false);
  assert.equal(mayAuthorContentForRole("teacher", "writing", "prompt", probe), false);
});

test("A3 an administrator and the owner author the registered set, and only the registered set", () => {
  // The probe IS the registry truth: "is there an author for this content type at all?"
  const realRegistry = (module: string, contentType: string) => !(module === "invented" || contentType === "not_a_real_type");
  for (const role of ["admin", "owner"] as const) {
    assert.equal(mayAuthorContentForRole(role, "lesson", "lesson", realRegistry), true);
    assert.equal(mayAuthorContentForRole(role, "mock", "full_mock", realRegistry), true);
    assert.equal(mayAuthorContentForRole(role, "reading", "set", realRegistry), true);
    assert.equal(mayAuthorContentForRole(role, "ted", "not_a_real_type", realRegistry), false, "registration is still required");
    assert.equal(mayAuthorContentForRole(role, "invented", "module", realRegistry), false);
  }
  for (const role of ["admin", "owner", "teacher"] as const)
    assert.equal(mayAuthorContentForRole(role, "lesson", "lesson", () => false), false, "nothing registered, nothing authorable");
  // The server-side check asks the REAL registry, and a lesson is authorable by all staff.
  assert.equal(mayAuthorContent("teacher", "lesson", "lesson"), true);
  assert.equal(mayAuthorContent("teacher", "mock", "full_mock"), false);
  assert.equal(mayAuthorContent("admin", "lesson", "lesson"), true);
  assert.equal(mayAuthorContent("student", "lesson", "lesson"), false);
});

test("A4 the generic drafts route asks the capability before it writes", () => {
  const source = code(readFileSync(DRAFTS_ROUTE, "utf8"));
  assert.match(source, /mayAuthorContent\(user\.role, parsed\.data\.module, parsed\.data\.contentType\)/, "the route asks the shared capability");
  assert.match(source, /return NextResponse\.json\(\{ error: "forbidden" \}, \{ status: 403 \}\);/);
  const gate = source.indexOf("mayAuthorContent(user.role");
  const write = source.indexOf("saveContentDraft(tx");
  assert.ok(gate > -1 && write > gate, "the capability is decided BEFORE anything is written");
});

test("A5 the publication route decides who may move a revision, and publication itself stays a separate authority", () => {
  const source = code(readFileSync(PUBLICATION_ROUTE, "utf8"));
  const notFound = source.indexOf('{ error: "not_found" }');
  const capability = source.indexOf("mayAuthorContent(user.role, version.module, version.contentType)");
  const service = source.indexOf("publishContentVersion(tx");
  assert.ok(notFound > -1 && capability > notFound, "an unknown revision is a 404 before any authorization answer");
  assert.ok(service > capability, "and the capability is checked before the service call");
  assert.match(source, /mayPublish: mayPublishImportedContent\(user\.role\)/, "the actor's publication authority is computed from the permission layer, never the client");
  assert.match(source, /status: forbidden \? 403 : 422/, "publish_forbidden is answered 403, other refusals 422");
});

test("A6 the capabilities endpoint tells the truth per role, from the same capability", () => {
  const source = code(readFileSync(CAPABILITIES_ROUTE, "utf8"));
  assert.match(source, /mayAuthorContent\(user\.role, module\.module, contentType\)/, "a content type is authorable for THIS role");
  assert.match(source, /authorableKeys/);
  assert.match(source, /mayPublish: mayPublishImportedContent\(user\.role\)/);
});

test("A7 the desk derives its controls from the capability, never from decoration", () => {
  const page = code(readFileSync(AUTHOR_PAGE, "utf8"));
  assert.match(page, /mayAuthorContent\(user\.role, "lesson", "lesson"\)/, "the page asks the same capability the API enforces");
  assert.match(page, /canPublish=\{mayPublishImportedContent\(user\.role\)\}/, "and the publication control comes from the permission layer");
  const desk = code(readFileSync(DESK, "utf8"));
  assert.match(desk, /canPublish \? \(/, "a role that cannot publish is not shown the buttons");
  assert.match(desk, /t\.cannotPublish/, "instead it is told why");
  assert.ok(!/useState\(canPublish\)|canPublish: true/.test(desk), "the flag is never re-decided on the client");
});

/* -------------------------------------------------------------------------- */
/* N1–N4: NO SECOND SYSTEM, NO FAKE ERRORS                                    */
/* -------------------------------------------------------------------------- */

test("N1 the lesson-authoring correction added no migration of its own", () => {
  /*
   * This correction (hydration, authorization, revisioning of lessons) needed no new column:
   * every migration the repository has shipped at this point was added by another workstream, and
   * 0051 belongs to the GENERAL LISTENING revision-safety correction (the question-set revision
   * column that keeps a published item's questions — and the answers referencing them — intact
   * when a draft is saved). It is additive and rewrites no lesson row, so it changes nothing this
   * suite asserts; the assertion below is what makes that claim checkable rather than assumed.
   */
  const files = readdirSync(join(ROOT, "drizzle")).filter((name) => name.endsWith(".sql")).sort();
  assert.equal(files.length, 52, "52 shipped migrations");
  assert.ok(files.at(-1)!.startsWith("0051"), `newest migration is ${files.at(-1)}`);
  assert.ok(files.some((name) => name.startsWith("0050")), "the lesson learning-area migration is still shipped");
  const listeningRevision = readFileSync(join(ROOT, "drizzle/0051_listening_question_revision.sql"), "utf8");
  assert.match(listeningRevision, /ADD COLUMN IF NOT EXISTS "content_version_id" uuid/);
  assert.doesNotMatch(listeningRevision, /\bUPDATE\s+"?lessons"?\s+SET\b/i, "0051 must not touch a lesson row");
  assert.doesNotMatch(listeningRevision, /\bDELETE\s+FROM\b/i, "0051 must not delete anything");
});

test("N2 an inserted block reuses the rows around it, so learner answers survive", async () => {
  const database = await fixture();
  try {
    const { lessonId } = await publishedLesson(database);
    const before = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
    // A learner has answered against the first block.
    await database.db.insert(lessonBlockResponses).values({ userId: database.studentId, lessonId, blockId: before[0]!.id, answer: { value: "First paragraph." }, correct: true });

    const started = await database.db.transaction((tx) => startLessonRevision(tx, { lessonId, actor: database.owner }));
    if (!started.ok) throw new Error("revision failed");
    const saved = await database.db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: database.owner,
        module: "lesson",
        contentType: "lesson",
        sourceRef: "lesson-why-notes-matter",
        title: "Why notes matter",
        versionId: started.model.draft!.versionId,
        payload: lessonPayload(database.unitA, { blocks: [TEXT("New opening paragraph."), TEXT("First paragraph."), TEXT("Second paragraph.")] }),
      }),
    );
    assert.equal(saved.ok, true);
    const published = await database.db.transaction((tx) =>
      publishContentVersion(tx, { actor: database.owner, versionId: saved.ok ? saved.version.id : "", to: "published" }),
    );
    assert.equal(published.ok, true);

    const after = await database.db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, lessonId)).orderBy(asc(lessonBlocks.position));
    assert.deepEqual(after.map((block) => block.textContent), ["New opening paragraph.", "First paragraph.", "Second paragraph."]);
    assert.equal(after[1]!.id, before[0]!.id, "the block a learner answered keeps its id");
    assert.equal(after[2]!.id, before[1]!.id);
    const [response] = await database.db.select({ id: lessonBlockResponses.id, blockId: lessonBlockResponses.blockId }).from(lessonBlockResponses).where(eq(lessonBlockResponses.blockId, before[0]!.id));
    assert.equal(response?.blockId, before[0]!.id, "the learner's answer was not cascaded away");
  } finally {
    await database.close();
  }
});

test("N3 a failed replacement never strips the media a lesson already has", () => {
  const desk = code(readFileSync(DESK, "utf8"));
  // Save refuses while an upload is still running, so a half-uploaded block cannot be saved.
  assert.match(desk, /uploadState === "uploading"/);
  assert.match(desk, /saveWhileUploading/);
  // The object key is written ONLY on success: the failure path cannot clear it.
  assert.match(desk, /if \(outcome\.ok\) \{/);
  const success = desk.indexOf("if (outcome.ok) {");
  const assignment = desk.indexOf("objectKey: outcome.objectKey", success);
  const failure = desk.indexOf("patchBlock(target, { uploadState: \"failed\"", success);
  assert.ok(assignment > success, "the replacement is applied on success");
  assert.ok(failure > assignment, "and failure only reports the failure");
  const failureBranch = desk.slice(failure, failure + 200);
  assert.ok(!/objectKey/.test(failureBranch), "a failed upload must not clear the saved file");
  assert.match(desk, /mediaKeepHint/);
});

test("N4 every failure an author sees is a sentence, per issue", () => {
  const authoring = (en as unknown as { listening: { lessons: { authoringIssues: Record<string, string> } } }).listening.lessons.authoringIssues;
  const uzAuthoring = (uz as unknown as { listening: { lessons: { authoringIssues: Record<string, string> } } }).listening.lessons.authoringIssues;
  assert.deepEqual(Object.keys(authoring).sort(), Object.keys(uzAuthoring).sort(), "both locales describe the same failures");
  assert.ok(Object.keys(authoring).length >= 20);
  for (const [key, message] of Object.entries(authoring)) {
    assert.ok(message.trim().length > 12, `${key} must read as a sentence`);
    assert.ok(!/[<>`]/.test(message), `${key} carries no markup`);
    assert.ok(!/(Error:|node_modules|\.ts:\d|SELECT |INSERT |sql)/i.test(message), `${key} leaks no internals`);
  }
  // The per-issue labels the server actually emits are all covered.
  for (const issueCode of [
    "missing_source_ref",
    "unstable_source_ref",
    "missing_learning_area",
    "teacher_notes_too_long",
    "unknown_block_type",
    "missing_text",
    "missing_question_type",
    "unknown_question_type",
    "missing_unit",
    "published_is_immutable",
  ])
    assert.ok(authoring[issueCode], `the desk can explain ${issueCode} in words a person understands`);
  // A payload issue carries the SERVER'S own sentence (the field-specific one), so the
  // dictionary deliberately has no catch-all entry that would blur it.
  assert.equal(authoring.invalid_payload, undefined, "no vague catch-all over the server's specific sentence");

  const desk = code(readFileSync(DESK, "utf8"));
  assert.match(desk, /authoringIssues/, "the desk reads the dictionary, not the server's raw text");
  assert.match(desk, /known \?\? issue\.message/, "a code without an entry shows the server's own sentence");
  assert.match(desk, /data-lesson-authoring-issue=\{issue\.code\}/, "one line per issue, tagged by code");
  assert.match(desk, /result\.issues\?\.length \? result\.issues/, "the server's own issues are shown as they came");
});
