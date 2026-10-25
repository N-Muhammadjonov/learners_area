import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { lessons, lessonBlocks } from "../src/db/schema";
import { listLessonLibrary, loadLessonLibraryDetail } from "../src/lib/content/lesson-library";
import { createTestDatabase } from "./support/pglite";

const read = (path: string) => readFileSync(path, "utf8");

test("Grammar lesson routes use canonical authoring permissions and classified published lesson/media reads", () => {
  const library = read("src/app/app/(shell)/grammar/lessons/page.tsx");
  const author = read("src/app/app/(shell)/grammar/lessons/author/page.tsx");
  const detail = read("src/app/app/(shell)/grammar/lessons/[lessonId]/page.tsx");
  assert.match(library, /requireActiveUser\(\)/);
  assert.match(library, /listLessonLibrary\(\{ area: "grammar", limit: 24/);
  assert.match(library, /data-grammar-lessons-empty/);
  assert.match(author, /requireStaff\(\)/);
  assert.match(author, /mayAuthorContent\(user\.role, "lesson", "lesson"\)/);
  assert.match(author, /listLessonsForStaff\("grammar"\)/);
  assert.match(author, /area="grammar"/);
  assert.match(author, /canPublish=\{mayPublishImportedContent\(user\.role\)\}/);
  assert.match(detail, /loadLessonLibraryDetail\(lessonId, user\.id, "grammar"\)/);
  assert.match(detail, /resolveDirectMedia\(detail\.media\.provider, detail\.media\.videoId\)/);
  assert.match(detail, /<LessonNotesPanel dict=\{dict\} lessonId=\{detail\.lesson\.id\}/);
});

test("Grammar lessons exclude drafts and other areas while published video/text and learner detail remain accessible", async () => {
  const database = await createTestDatabase();
  try {
    const [user] = await database.query<{ id: string }>("insert into users (name, role, account_status) values ('Grammar learner', 'student', 'active') returning id");
    const [course] = await database.query<{ id: string }>("insert into courses (slug, title) values ('grammar-lessons-qa', 'Grammar') returning id");
    const [module] = await database.query<{ id: string }>(`insert into course_modules (course_id, slug, title, "order") values ($1, 'module', 'Module', 1) returning id`, [course!.id]);
    const [unit] = await database.query<{ id: string }>(`insert into units (module_id, slug, title, "order") values ($1, 'unit', 'Unit', 1) returning id`, [module!.id]);
    const created = await database.db.insert(lessons).values([
      { unitId: unit!.id, slug: 'grammar-live', title: 'Conditional structures', learningArea: 'grammar', publicationState: 'published', defaultState: 'available', order: 1, teacherNotes: 'Use an if-clause.' },
      { unitId: unit!.id, slug: 'grammar-draft', title: 'Unpublished structures', learningArea: 'grammar', publicationState: 'draft', defaultState: 'locked', order: 2 },
      { unitId: unit!.id, slug: 'reading-live', title: 'Reading strategies', learningArea: 'reading', publicationState: 'published', defaultState: 'available', order: 3 },
    ]).returning({ id: lessons.id });
    const grammarId = created[0]!.id;
    await database.db.insert(lessonBlocks).values([
      { lessonId: grammarId, position: 1, type: 'text', textContent: 'Practice the first conditional.' },
      { lessonId: grammarId, position: 2, type: 'video', objectKey: 'private/video-lessons/conditional.mp4' },
    ]);
    const catalogue = await listLessonLibrary({ area: 'grammar', limit: 24 }, database.db);
    assert.deepEqual(catalogue.rows.map(row => row.id), [grammarId]);
    assert.equal(catalogue.rows[0]!.hasMedia, true);
    assert.equal(catalogue.rows[0]!.hasTeacherNotes, true);
    const detail = await loadLessonLibraryDetail(grammarId, user!.id, 'grammar', database.db);
    assert.equal(detail?.lesson.title, 'Conditional structures');
    assert.equal(detail?.blocks.length, 2);
    assert.equal(detail?.teacherNotes, 'Use an if-clause.');
    assert.equal(await loadLessonLibraryDetail(created[1]!.id, user!.id, 'grammar', database.db), null);
    assert.equal(await loadLessonLibraryDetail(created[2]!.id, user!.id, 'grammar', database.db), null);
    assert.equal(await loadLessonLibraryDetail(grammarId, user!.id, 'reading', database.db), null);
  } finally { await database.close(); }
});
