import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { lessonBlocks, lessons, units, courseModules, courses } from "../src/db/schema";
import {
  LESSON_BLOCK_DESCRIPTORS,
  LESSON_BLOCK_TYPES,
  gradeLessonQuiz,
  quizContract,
  validateLessonBlocks,
  validateLessonForPublication,
  type LessonBlockInput,
} from "../src/lib/content/blocks";
import { answerLessonQuiz, lessonPublicationGate, loadLessonForLearner, saveLessonStructure } from "../src/lib/content/lessons";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { createTestDatabase } from "./support/pglite";

/**
 * Lesson architecture and typed blocks (§26, §27, §28).
 *
 * What is being protected:
 *   • a lesson is typed blocks — never stored HTML that a browser would execute;
 *   • a quiz block is graded by the canonical registry, not by a second grader;
 *   • a lesson REFERENCES canonical content, so fixing the content fixes the lesson;
 *   • a draft lesson is invisible to learners, and a reference to unpublished
 *     content is reported instead of rendering an empty block.
 */

const owner: AuthoringActor = { id: "", role: "owner", mayPublish: true };

async function structure(database: Awaited<ReturnType<typeof createTestDatabase>>) {
  const { db, query } = database;
  const [actor] = await query<{ id: string }>(`insert into users (name, role) values ('Lesson owner', 'owner') returning id`);
  const [course] = await query<{ id: string }>(`insert into courses (slug, title) values ('ielts-lessons', 'IELTS Lessons') returning id`);
  const [module] = await db.insert(courseModules).values({ courseId: course!.id, slug: "m1", title: "Module 1", order: 1 }).returning({ id: courseModules.id });
  const [unit] = await db.insert(units).values({ moduleId: module!.id, slug: "u1", title: "Unit 1", order: 1 }).returning({ id: units.id });
  return { db, query, actorId: actor!.id, courseId: course!.id, unitId: unit!.id };
}

const lessonBlocksInput: LessonBlockInput[] = [
  { type: "text", text: "Today we look at matching headings." },
  { type: "quiz", quiz: { questionType: "mcq_single", prompt: "Which strategy is best?", options: ["Skim", "Read every word"], answer: "Skim" } },
];

test("LB1 the block contract is a closed typed set, and text is plain text", () => {
  assert.deepEqual([...LESSON_BLOCK_TYPES], ["text", "image", "audio", "video", "file", "link", "quiz", "content_reference"]);
  assert.equal(LESSON_BLOCK_DESCRIPTORS.quiz.graded, true);
  assert.equal(LESSON_BLOCK_DESCRIPTORS.content_reference.referencesContent, true);
  assert.equal((LESSON_BLOCK_TYPES as readonly string[]).includes("html"), false, "there is deliberately no executable HTML block");

  const issues = validateLessonBlocks([{ type: "markdown", text: "# hi" }]);
  assert.deepEqual(issues.map((issue) => issue.code), ["unknown_block_type"]);

  const html = validateLessonBlocks([{ type: "text", text: "<script>alert(1)</script>" }]);
  assert.deepEqual(html, [], "text is stored and rendered as plain text — markup is not a validation concern, execution is impossible");
});

test("LB2 links must be https, media must be a private object, and a quiz must name a known type", () => {
  assert.deepEqual(
    validateLessonBlocks([{ type: "link", url: "http://example.com" }]).map((issue) => issue.code),
    ["insecure_url"],
  );
  assert.deepEqual(
    validateLessonBlocks([{ type: "link", url: "javascript:alert(1)" }]).map((issue) => issue.code),
    ["insecure_url"],
  );
  assert.deepEqual(validateLessonBlocks([{ type: "link", url: "https://example.com/reading" }]), []);
  assert.deepEqual(
    validateLessonBlocks([{ type: "video", url: "https://youtube.com/watch?v=x" }]).map((issue) => issue.code),
    ["missing_object_key"],
    "a video block takes an uploaded object key, not an author-supplied URL",
  );
  assert.deepEqual(
    validateLessonBlocks([{ type: "quiz", quiz: { questionType: "guess_the_answer", prompt: "?", answer: "x" } }]).map((issue) => issue.code),
    ["unknown_question_type"],
  );
  assert.deepEqual(
    validateLessonBlocks([
      { type: "quiz", quiz: { questionType: "mcq_single", prompt: "Pick one", options: ["only"], answer: "only" } },
    ]).map((issue) => issue.code),
    ["option_count"],
  );
  assert.equal(quizContract("mcq_single")?.requiresOptions, true);
  assert.equal(quizContract("short_answer")?.requiresOptions, false);
  assert.equal(quizContract("nope"), null);
});

test("LB3 a content reference must be coherent with the shared taxonomy", () => {
  const issues = validateLessonBlocks([
    { type: "content_reference", ref: { module: "listening", contentType: "not_a_type", sourceRef: "x" } },
  ]);
  assert.ok(issues.some((issue) => issue.code === "unknown_content_type"));
  assert.deepEqual(validateLessonBlocks([{ type: "content_reference", ref: { module: "reading", contentType: "general_set", sourceRef: "reading-1" } }]), []);
});

test("LB4 grading a lesson quiz goes through the canonical registry", () => {
  const graded = gradeLessonQuiz("mcq_single", { answer: "Skim", key: "Skim", options: ["Skim", "Read every word"] });
  assert.equal(graded?.correct, true);
  assert.equal(graded?.typeId, "mcq_single");
  assert.equal(gradeLessonQuiz("short_answer", { answer: "Skim", key: "skimming" })?.correct, false);
  assert.equal(gradeLessonQuiz("short_answer", { answer: "skimming", key: "skimming" })?.correct, true);
  assert.equal(gradeLessonQuiz("invented_type", { answer: "x", key: "x" }), null, "no registry entry, no verdict");
});

test("LB5 saving a lesson writes typed blocks and a draft revision, and invalid input writes nothing", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { actorId, unitId } = await structure(database);
    const actor = { ...owner, id: actorId };

    const refused = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "bad-lesson",
        title: "Bad",
        sourceRef: "lesson-bad-1",
        blocks: [{ type: "link", url: "http://insecure.example" }],
      }),
    );
    assert.equal(refused.ok, false);
    if (!refused.ok) assert.ok(refused.issues.some((issue) => issue.code === "insecure_url"));
    assert.equal((await db.select().from(lessons)).length, 0, "nothing was written");

    const saved = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "matching-headings",
        title: "Matching headings",
        summary: "Strategy first, then practice.",
        estimatedMinutes: 25,
        sourceRef: "lesson-matching-headings",
        blocks: [...lessonBlocksInput],
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.equal(saved.created, true);
    assert.equal(saved.blockCount, 2);
    assert.equal(saved.version.publicationState, "draft");

    const [row] = await db.select().from(lessons).where(eq(lessons.id, saved.lessonId));
    assert.equal(row!.publicationState, "draft", "an authored lesson is not live before publication");
    assert.equal(row!.estimatedMinutes, 25);
    const blocks = await db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, saved.lessonId)).orderBy(lessonBlocks.position);
    assert.deepEqual(blocks.map((block) => block.type), ["text", "quiz"]);
    assert.equal(blocks[1]!.quizQuestionType, "mcq_single");
    assert.equal((blocks[1]!.quizPayload as { answer: string }).answer, "Skim");
    // Positions are the storage contract, not a convention.
    await assert.rejects(
      db.insert(lessonBlocks).values({ lessonId: saved.lessonId, position: 1, type: "text", textContent: "dup" }),
    );
  } finally {
    await database.close();
  }
});

test("LB6 a lesson publishing gate needs blocks, live references, and a recorded revision", async () => {
  const database = await createTestDatabase();
  try {
    const { db } = database;
    const { actorId, unitId } = await structure(database);
    const actor = { ...owner, id: actorId };

    const empty = await db.transaction((tx) =>
      saveLessonStructure(tx, { actor, unitId, slug: "empty", title: "Empty lesson", sourceRef: "lesson-empty-1", blocks: [] }),
    );
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    const emptyGate = await lessonPublicationGate(empty.lessonId, db);
    assert.equal(emptyGate.canPublish, false);
    assert.ok(emptyGate.reasons.some((reason) => reason.code === "empty_lesson"));
    assert.ok(validateLessonForPublication([]).some((issue) => issue.code === "empty_lesson"));

    // A lesson referencing content that is not published cannot be published either.
    const draftReading = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "reading",
        contentType: "general_set",
        sourceRef: "lesson-ref-reading",
        title: "Lesson reference reading",
        track: "academic",
        payload: {
          passages: [
            {
              title: "Reference passage",
              bodyText: "A synthetic passage used to prove that a lesson reference resolves to canonical content.",
              questions: [{ typeCode: "short_answer", questionText: "Question 1", correctAnswer: "a", explanation: "synthetic" }],
            },
          ],
        },
      }),
    );
    assert.equal(draftReading.ok, true);
    if (!draftReading.ok) return;

    const referencing = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "with-reference",
        title: "With reference",
        sourceRef: "lesson-with-reference",
        blocks: [
          { type: "text", text: "Read the passage, then answer." },
          { type: "content_reference", ref: { module: "reading", contentType: "general_set", sourceRef: "lesson-ref-reading", versionId: draftReading.version.id } },
        ],
      }),
    );
    assert.equal(referencing.ok, true);
    if (!referencing.ok) return;

    // Publish the reading revision, and the lesson gate opens.
    const published = await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: draftReading.version.id, to: "published" }));
    assert.equal(published.ok, true);
    const gate = await lessonPublicationGate(referencing.lessonId, db);
    assert.deepEqual(gate.reasons.map((reason) => reason.code), []);
    assert.equal(gate.canPublish, true);

    // Archive the referenced revision and the lesson is blocked with a named reason.
    await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: draftReading.version.id, to: "archived" }));
    const blocked = await lessonPublicationGate(referencing.lessonId, db);
    assert.equal(blocked.canPublish, false);
    assert.ok(blocked.reasons.some((reason) => reason.code === "reference_archived"));
  } finally {
    await database.close();
  }
});

test("LB7 a learner cannot read a draft lesson, and a published one resolves its references", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const { actorId, unitId } = await structure(database);
    const actor = { ...owner, id: actorId };
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Lesson learner', 'student') returning id`);

    const reading = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor,
        module: "reading",
        contentType: "general_set",
        sourceRef: "learner-ref-reading",
        title: "Learner reference",
        track: "academic",
        payload: {
          passages: [
            {
              title: "Learner passage",
              bodyText: "Synthetic passage body for the learner-facing lesson reference resolution test.",
              questions: [{ typeCode: "short_answer", questionText: "Question 1", correctAnswer: "a", explanation: "synthetic" }],
            },
          ],
        },
      }),
    );
    assert.equal(reading.ok, true);
    if (!reading.ok) return;
    await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: reading.version.id, to: "published" }));

    const saved = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "learner-lesson",
        title: "Learner lesson",
        sourceRef: "lesson-learner-1",
        blocks: [
          { type: "text", text: "Read this." },
          { type: "content_reference", ref: { module: "reading", contentType: "general_set", sourceRef: "learner-ref-reading", versionId: reading.version.id } },
          { type: "quiz", quiz: { questionType: "mcq_single", prompt: "Ready?", options: ["Yes", "No"], answer: "Yes" } },
        ],
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;

    assert.equal(await loadLessonForLearner(saved.lessonId, student!.id, db), null, "a draft lesson is invisible to a learner");

    // Publish the lesson revision and its row (both, like every other content type).
    await query(`update lessons set publication_state = 'published' where id = $1`, [saved.lessonId]);
    const loaded = await loadLessonForLearner(saved.lessonId, student!.id, db);
    assert.ok(loaded);
    assert.equal(loaded!.blocks.length, 3);
    assert.ok(loaded!.blocks[1]!.referenced, "the reference resolved to canonical content");
    assert.equal(loaded!.blocks[1]!.referenced!.versionId, reading.version.id);
    assert.equal(loaded!.blocks[1]!.referenceProblem, null);
    assert.equal(loaded!.blocks[2]!.response, null, "not answered yet");
    assert.equal(loaded!.blocks[2]!.quiz?.answerKey, undefined, "the answer key is NOT shipped to a learner who has not answered");
    assert.equal(loaded!.blocks[2]!.quiz?.explanation, undefined, "and neither is the explanation that gives it away");
    assert.equal(JSON.stringify(loaded!.blocks[2]).includes("Skim"), false, "nothing in the payload leaks the key");
  } finally {
    await database.close();
  }
});

test("LB8 answering a quiz block is graded once, kept, and the key is not handed over on a wrong answer", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    const { actorId, unitId } = await structure(database);
    const actor = { ...owner, id: actorId };
    const [student] = await query<{ id: string }>(`insert into users (name, role) values ('Quiz learner', 'student') returning id`);

    const saved = await db.transaction((tx) =>
      saveLessonStructure(tx, {
        actor,
        unitId,
        slug: "quiz-lesson",
        title: "Quiz lesson",
        sourceRef: "lesson-quiz-1",
        blocks: [{ type: "quiz", quiz: { questionType: "mcq_single", prompt: "Which is correct?", options: ["A", "B"], answer: "B", explanation: "B is correct." } }],
      }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const [block] = await db.select().from(lessonBlocks).where(eq(lessonBlocks.lessonId, saved.lessonId));

    // A draft lesson refuses an answer: it is not live.
    const beforePublish = await db.transaction((tx) => answerLessonQuiz(tx, { userId: student!.id, blockId: block!.id, answer: "B" }));
    assert.deepEqual(beforePublish, { ok: false, reason: "lesson_not_live" });

    await query(`update lessons set publication_state = 'published' where id = $1`, [saved.lessonId]);
    const wrong = await db.transaction((tx) => answerLessonQuiz(tx, { userId: student!.id, blockId: block!.id, answer: "A" }));
    assert.deepEqual(wrong, { ok: true, correct: false, correctAnswer: null }, "a wrong answer does not reveal the key");

    const right = await db.transaction((tx) => answerLessonQuiz(tx, { userId: student!.id, blockId: block!.id, answer: "B" }));
    assert.deepEqual(right, { ok: true, correct: true, correctAnswer: "B" });

    const rows = await query<{ count: string; correct: boolean }>(`select count(*)::text as count, max(correct::text)::boolean as correct from lesson_block_responses`);
    assert.equal(rows[0]!.count, "1", "one response per learner per block, updated not duplicated");
    assert.equal(rows[0]!.correct, true);

    const loaded = await loadLessonForLearner(saved.lessonId, student!.id, db);
    assert.equal(loaded!.blocks[0]!.response?.correct, true, "the learner sees their own verdict");
    // Only after answering does the key (and its explanation) appear, for review.
    assert.equal(loaded!.blocks[0]!.quiz?.answerKey, "B");
    assert.equal(loaded!.blocks[0]!.quiz?.explanation, "B is correct.");
  } finally {
    await database.close();
  }
});
