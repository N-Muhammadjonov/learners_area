import test from "node:test";
import assert from "node:assert/strict";
import { and, eq } from "drizzle-orm";
import {
  contentVersions,
  listeningAnswers,
  listeningAttempts,
  listeningPackages,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { loadSectionExercise } from "../src/lib/listening/section-exercise";
import { listeningInputModeFor, type ListeningInputMode } from "../src/lib/listening/question-control";
import { questionType, resolveQuestionType } from "../src/lib/content/question-types";
import { submitListeningAttempt } from "../src/lib/data/listening-attempt-write";
import { canAuthor, registerModuleAuthors, resolveModuleAuthor } from "../src/lib/content/authors";
import { mayAuthorContentForRole } from "../src/lib/content/authoring-capabilities";
import { getDictionary } from "../src/lib/i18n";
import { createTestDatabase } from "./support/pglite";

/**
 * THE SECTION CONTRACT (§14–§15, §27–§29, §42 G2/G6/G10).
 *
 *   G2  an eight-question MIXED section renders each question with the control its canonical type
 *       demands — a completion question that happens to carry an options list is still TYPED,
 *       never silently turned into a menu, and a row that carries a source alias is resolved too;
 *   G6  submitting eight answers of which six are correct is graded 6/8 by the SERVER, every
 *       answer is recorded against the question it belongs to, and the review reads THIS
 *       section's own set;
 *   G10 role boundaries: a teacher can never author or publish a Listening section, an owner can,
 *       and the decision is the repository's own capability function, not this test's restatement.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const TEACHER = "22222222-2222-4222-8222-222222222222";
const LEARNER = "33333333-3333-4333-8333-333333333333";
const dict = getDictionary("en");

registerModuleAuthors();

type Database = Awaited<ReturnType<typeof createTestDatabase>>;

type FixtureQuestion = {
  /** The value the canonical row carries in `type_code`: a canonical id, or a source alias. */
  typeCode: string;
  type: "multiple_choice" | "short_answer";
  text: string;
  options: string[] | null;
  /** The authored key, stated as the learner would provide it. */
  key: string;
  /** The control the canonical registry demands for this row — the point of the test. */
  expect: ListeningInputMode;
};

/**
 * Eight questions of MIXED canonical types. Every expectation is written out, so the test proves
 * the RULE rather than restating the implementation: a completion row with an options list must
 * still be typed, and an alias-carrying row must resolve to its real answer model.
 */
const MIXED: FixtureQuestion[] = [
  { typeCode: "sentence_completion", type: "short_answer", text: "The museum opens at nine on ____.", options: null, key: "harbour", expect: "text" },
  // A completion question that CARRIES options (a hint list): the registry says text.
  { typeCode: "note_completion", type: "short_answer", text: "The tour costs ____ pounds.", options: ["A) ten", "B) twelve"], key: "twenty", expect: "text" },
  { typeCode: "mcq_single", type: "multiple_choice", text: "Where does the tour start?", options: ["A) the gate", "B) the fountain", "C) the shop"], key: "B", expect: "select" },
  { typeCode: "mcq_single", type: "multiple_choice", text: "How long is the tour?", options: ["A) one hour", "B) two hours", "C) three hours"], key: "A", expect: "select" },
  // Choose two: both letters are required by the registry's `multi_all` rule.
  { typeCode: "mcq_multi", type: "multiple_choice", text: "Which TWO items are included?", options: ["A) a map", "B) a guidebook", "C) a coffee", "D) a ticket"], key: "A,B", expect: "multi" },
  { typeCode: "short_answer", type: "short_answer", text: "Who leads the tour?", options: null, key: "a student", expect: "text" },
  { typeCode: "matching", type: "multiple_choice", text: "Match the room to its floor.", options: ["A) ground", "B) first", "C) second"], key: "B", expect: "select" },
  // A row that arrived through a SOURCE ALIAS, with an options list it must not be judged by.
  { typeCode: "SC", type: "short_answer", text: "What should visitors bring? ____", options: ["A) a passport", "B) a camera"], key: "a notebook", expect: "text" },
];

/** Distinctive key texts that must never appear in a learner's working view. */
const SECRET_KEYS = ["harbour", "twenty", "a student", "a notebook"];
const EXPLANATION = "Authored evidence for this question.";

async function seedSection(database: Database): Promise<string> {
  const { db, query } = database;
  await query(`insert into users (id, name, role) values
    ('${OWNER}', 'Contract owner', 'owner'),
    ('${TEACHER}', 'Contract teacher', 'teacher'),
    ('${LEARNER}', 'Contract learner', 'student')`);
  const [test] = await db
    .insert(listeningTests)
    .values({ title: "Contract mixed section", audioType: "audio", sourceRef: "contract-mixed-section", publicationState: "published", publishAt: new Date(), createdByUserId: OWNER })
    .returning();
  await db.insert(listeningQuestions).values(
    MIXED.map((question, index) => ({
      testId: test!.id,
      order: index + 1,
      type: question.type,
      typeCode: question.typeCode,
      questionText: question.text,
      options: question.options,
      correctAnswer: question.key,
      explanation: EXPLANATION,
    })),
  );
  await db.insert(contentVersions).values({
    module: "listening",
    contentType: "section",
    sourceRef: "contract-mixed-section",
    versionNo: 1,
    status: "published",
    title: "Contract mixed section",
    contentSnapshot: { sectionNo: 2, questions: [] },
    contentHash: "0".repeat(64),
    semanticHash: "0".repeat(64),
    answerKeyHash: "0".repeat(64),
    targetType: "listening_test",
    targetId: test!.id,
    createdByUserId: OWNER,
  });
  return test!.id;
}

async function cleanup(database: Database, testId: string) {
  const { db, query } = database;
  const attempts = await db.select({ id: listeningAttempts.id }).from(listeningAttempts).where(eq(listeningAttempts.testId, testId));
  for (const attempt of attempts) await db.delete(listeningAnswers).where(eq(listeningAnswers.attemptId, attempt.id));
  await db.delete(listeningAttempts).where(eq(listeningAttempts.testId, testId));
  await db.update(listeningQuestions).set({ contentVersionId: null }).where(eq(listeningQuestions.testId, testId));
  await db.delete(listeningQuestions).where(eq(listeningQuestions.testId, testId));
  await db.delete(listeningPackages).where(eq(listeningPackages.testId, testId));
  await db.delete(contentVersions).where(eq(contentVersions.targetId, testId));
  await db.delete(listeningTests).where(eq(listeningTests.id, testId));
  await query(`delete from users where id in ('${OWNER}','${TEACHER}','${LEARNER}')`);
}

test("G2 eight mixed questions: the canonical type decides the control, and options never imply a menu", async () => {
  const database = await createTestDatabase();
  let testId = "";
  try {
    testId = await seedSection(database);
    const view = await loadSectionExercise(testId, { id: LEARNER, role: "student" }, dict, database.db);
    assert.ok(view && view.kind === "exercise");
    if (!view || view.kind !== "exercise") return;

    assert.equal(view.questions.length, 8, "all eight questions reach the exercise");
    assert.deepEqual(
      view.questions.map((question) => question.input),
      MIXED.map((question) => question.expect),
      "every control is the one the registry's answer model demands",
    );

    // The expectation is checked against the REGISTRY, not against the implementation: a row whose
    // type resolves to a text answer model can never be presented as a menu.
    MIXED.forEach((fixture, index) => {
      const descriptor = questionType(fixture.typeCode, "listening") ?? resolveQuestionType(fixture.typeCode, "listening");
      assert.ok(descriptor, `row ${index + 1}: ${fixture.typeCode} resolves in the canonical registry`);
      const modelSays: ListeningInputMode =
        descriptor!.accessibility === "labelled_text_input"
          ? "text"
          : descriptor!.accessibility === "checkbox_group"
            ? "multi"
            : "select";
      assert.equal(view.questions[index]!.input, modelSays, `row ${index + 1} follows ${descriptor!.id}`);
    });

    // The regression this test exists for: a COMPLETION row that carries an options list must stay
    // typed. A menu here would ask the learner to choose an answer they are supposed to write.
    const completionWithOptions = view.questions[1]!;
    assert.equal(completionWithOptions.input, "text");
    assert.ok(completionWithOptions.options.length > 0, "the fixture really does carry options");
    assert.equal(listeningInputModeFor({ typeCode: "note_completion", options: ["A) ten", "B) twelve"] }), "text");
    assert.equal(listeningInputModeFor({ typeCode: "SC", options: ["A) a passport", "B) a camera"] }), "text", "an alias resolves too");
    // And an unknown code keeps the historical rule rather than inventing a model for it.
    assert.equal(listeningInputModeFor({ typeCode: null, options: ["A) one", "B) two"] }), "select");
    assert.equal(listeningInputModeFor({ typeCode: null, options: null }), "text");

    // Nothing secret is in the working view.
    const serialized = JSON.stringify(view);
    assert.equal(serialized.includes("correctAnswer"), false, "the view carries no answer field at all");
    assert.equal(serialized.includes(EXPLANATION), false, "no explanation reaches the exercise");
    for (const key of SECRET_KEYS) assert.equal(serialized.includes(key), false, `the key "${key}" must not reach the exercise`);
  } finally {
    if (testId) await cleanup(database, testId);
    await database.close();
  }
});

test("G6 submitting six of eight is graded 6/8 by the server, and the review reads this section's own set", async () => {
  const database = await createTestDatabase();
  let testId = "";
  try {
    const { db } = database;
    testId = await seedSection(database);
    const view = await loadSectionExercise(testId, { id: LEARNER, role: "student" }, dict, db);
    assert.ok(view && view.kind === "exercise");
    if (!view || view.kind !== "exercise") return;

    const rows = await db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, testId)).orderBy(listeningQuestions.order);
    // Two deliberate mistakes — the last two questions.
    const wrong = new Set([7, 8]);
    const submitted = await submitListeningAttempt(
      LEARNER,
      view.attemptId,
      rows.map((row) => ({ questionId: row.id, answer: wrong.has(row.order) ? "definitely wrong" : MIXED[row.order - 1]!.key })),
      db,
    );
    assert.ok(!("error" in submitted), JSON.stringify(submitted));

    const [attempt] = await db.select().from(listeningAttempts).where(and(eq(listeningAttempts.id, view.attemptId), eq(listeningAttempts.userId, LEARNER)));
    assert.equal(attempt!.score, 6, "six correct answers, counted by the server");
    assert.equal(attempt!.totalQuestions, 8, "out of the section's own eight questions");
    assert.equal(attempt!.status, "completed");

    const answers = await db.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId, view.attemptId));
    assert.equal(answers.length, 8, "every question was recorded");
    assert.equal(answers.filter((row) => row.isCorrect).length, 6);
    assert.equal(new Set(answers.map((row) => row.questionId)).size, 8, "no answer is recorded twice");

    // The registry's own rules graded it: the choose-two row needed BOTH letters, and the
    // completion row that carries options accepted its TYPED answer.
    const multiRow = rows.find((row) => row.typeCode === "mcq_multi")!;
    assert.equal(answers.find((row) => row.questionId === multiRow.id)!.isCorrect, true, "`multi_all` accepted A,B");
    const typedWithOptions = rows.find((row) => row.typeCode === "note_completion")!;
    assert.equal(answers.find((row) => row.questionId === typedWithOptions.id)!.isCorrect, true, "the typed answer was graded as text");

    const afterSubmit = await loadSectionExercise(testId, { id: LEARNER, role: "student" }, dict, db);
    assert.equal(afterSubmit?.kind, "result", "the section now shows its result");
    if (afterSubmit?.kind !== "result") return;
    assert.equal(afterSubmit.score, 6);
    assert.equal(afterSubmit.answers.length, 8, "the review carries the learner's own answers");
    assert.deepEqual(
      [...afterSubmit.questions.map((question) => question.id)].sort(),
      [...rows.map((row) => row.id)].sort(),
      "the review reads THIS section's question set",
    );
    // The review is the one place an authored explanation IS allowed to appear.
    assert.ok(afterSubmit.questions.every((question) => question.explanation === EXPLANATION), "the review carries the authored evidence");
  } finally {
    if (testId) await cleanup(database, testId);
    await database.close();
  }
});

test("G10 role boundaries: a teacher can never author or publish a Listening section, an owner can", async () => {
  const database = await createTestDatabase();
  try {
    const { query } = database;
    await query(`insert into users (id, name, role) values
      ('${OWNER}', 'Boundary owner', 'owner'),
      ('${TEACHER}', 'Boundary teacher', 'teacher')`);

    // The decision is the repository's own function, called with the repository's own registry.
    const registered = (module: string, contentType: string) => canAuthor(module, contentType);
    assert.equal(registered("listening", "section"), true, "a section author exists at all");
    assert.equal(
      mayAuthorContentForRole("teacher", "listening", "section", registered),
      false,
      "a teacher may NOT author a Listening section (Listening full tests and sections are administrator/owner content)",
    );
    assert.equal(mayAuthorContentForRole("owner", "listening", "section", registered), true, "an owner may");
    assert.equal(mayAuthorContentForRole("admin", "listening", "section", registered), true, "an administrator may");
    assert.equal(mayAuthorContentForRole("student", "listening", "section", registered), false, "a student may not");

    // And the author the desk resolves is the section author, with the section payload contract.
    const author = resolveModuleAuthor("listening", "section");
    assert.ok(author, "the section author is registered");
    assert.equal(author!.module, "listening");
    assert.equal(author!.contentType, "section");
  } finally {
    await database.query(`delete from users where id in ('${OWNER}','${TEACHER}')`);
    await database.close();
  }
});
