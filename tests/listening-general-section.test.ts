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
import { listeningPackageSchema, type ListeningPackage } from "../src/lib/listening/package";
import { loadSectionExercise } from "../src/lib/listening/section-exercise";
import { submitListeningAttempt } from "../src/lib/data/listening-attempt-write";
import { getDictionary } from "../src/lib/i18n";
import { createTestDatabase } from "./support/pglite";

/**
 * THE SECTION'S OWN ADDRESS (`/app/listening/general/<sectionId>`) — §12, §13, §23–§29.
 *
 * The owner's contract for the address a learner reaches from the catalogue:
 *
 *   S1  it resolves to the SAME section every time — reload, back, forward, a bookmark — and the
 *       page behind it is the exercise itself, not a hub and not an attempt URL the learner has
 *       to know;
 *   S2  the ONE exercise it shows carries the section's OWN questions and NOTHING secret: no key,
 *       no explanation, no answer-linked hint reaches the view a learner is working in;
 *   S3  resuming is truthful — a saved draft's answers and audio position come back, another
 *       learner never sees them, and a learner with no attempt has exactly ONE created;
 *   S4  a FINISHED section shows the learner's own result and does NOT silently start a new
 *       attempt (taking it again is an explicit action);
 *   S5  the gate is the catalogue's own decision: a draft, an archived item, an Academic full
 *       test, a dedicated MCQ package, question-type practice, an Essential recording and a
 *       malformed id all resolve to nothing — and a refused address creates no attempt at all;
 *   S6  every fixture is deleted and the removal is asserted.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "44444444-4444-4444-8444-444444444444";
const SECRET = "QASECRETKEY-MUSEUM";
const HIDDEN = "Hidden explanation that must never reach a learner.";

const dict = getDictionary("en");

type Database = Awaited<ReturnType<typeof createTestDatabase>>;

function sectionPackage(overrides: Partial<ListeningPackage> = {}): ListeningPackage {
  return listeningPackageSchema.parse({
    schemaVersion: 1,
    collection: "general",
    testId: "fixture-section-exercise",
    title: "Fixture — Section exercise",
    category: "full",
    provenance: "QA fixture, authored for the section exercise contract",
    audio: { path: "audio.mp3", durationSec: 480 },
    imagePath: null,
    sections: [{ number: 2, title: "Section 2", transcript: "", reviewRequired: false }],
    questions: [
      { number: 1, section: 2, text: "Packaged question one", instruction: "Choose", kind: "mcq", options: ["A) one", "B) two"], key: SECRET, alternatives: [], pair: [], evidence: { at: 10, why: "authored" } },
      { number: 2, section: 2, text: "Packaged question two", instruction: "Choose", kind: "mcq", options: ["A) one", "B) two"], key: SECRET, alternatives: [], pair: [], evidence: { at: 20, why: "authored" } },
    ],
    keyword1: [],
    keyword2: [],
    vocabulary: [],
    ...overrides,
  });
}

function academicFullTest(): ListeningPackage {
  return listeningPackageSchema.parse({
    ...sectionPackage(),
    collection: "academic",
    testId: "fixture-academic-full",
    title: "Fixture — Academic full test",
    audio: { path: "audio.mp3", durationSec: 1800 },
    sections: [1, 2, 3, 4].map((number) => ({ number, title: `Part ${number}`, transcript: "", reviewRequired: false })),
    questions: [1, 2, 3, 4].map((number) => ({ number, section: number, text: `Q${number}`, instruction: "Choose", kind: "completion", options: [], key: SECRET, alternatives: [], pair: [], evidence: { at: number, why: "authored" } })),
  });
}

async function seed(database: Database) {
  const { db, query } = database;
  await query(`insert into users (id, name, role) values
    ('${OWNER}', 'Section owner', 'owner'),
    ('${LEARNER}', 'Section learner', 'student'),
    ('${OTHER}', 'Other section learner', 'student')`);

  const insertTest = async (title: string, sourceRef: string, publicationState: "published" | "draft" | "archived") => {
    const [row] = await db
      .insert(listeningTests)
      .values({ title, audioType: "audio", sourceRef, publicationState, createdByUserId: OWNER, publishAt: publicationState === "published" ? new Date() : null })
      .returning();
    return row!.id;
  };
  const attachPackage = async (testId: string, payload: ListeningPackage, sourceId: string) => {
    await db.insert(listeningPackages).values({
      testId,
      sourceId,
      payload,
      audioObjectKey: `qa/${sourceId}/audio.mp3`,
      sourceHash: "0".repeat(64),
      legacyRuntime: false,
    });
    await db.insert(listeningQuestions).values(
      payload.questions.map((q) => ({
        testId,
        order: q.number,
        questionText: q.text,
        correctAnswer: q.key,
        explanation: HIDDEN,
        options: q.options,
        type: q.kind === "mcq" ? ("multiple_choice" as const) : ("short_answer" as const),
      })),
    );
  };
  const authorSectionVersion = async (testId: string, sourceRef: string, sectionNo: number) => {
    await db.insert(contentVersions).values({
      module: "listening",
      contentType: "section",
      sourceRef,
      versionNo: 1,
      status: "published",
      title: "Fixture section",
      contentSnapshot: { sectionNo, questions: [] },
      contentHash: "0".repeat(64),
      semanticHash: "0".repeat(64),
      answerKeyHash: "0".repeat(64),
      targetType: "listening_test",
      targetId: testId,
      createdByUserId: OWNER,
    });
  };

  const section = await insertTest("Fixture section (published, authored)", "section-exercise-1", "published");
  await db.insert(listeningQuestions).values([
    { testId: section, order: 1, questionText: "Authored question one", correctAnswer: SECRET, explanation: HIDDEN, options: null, type: "short_answer" as const },
    { testId: section, order: 2, questionText: "Authored question two", correctAnswer: SECRET, explanation: HIDDEN, options: null, type: "short_answer" as const },
  ]);
  await authorSectionVersion(section, "section-exercise-1", 3);

  const packaged = await insertTest("Fixture section (packaged)", "section-exercise-2", "published");
  await attachPackage(packaged, sectionPackage(), "fixture-section-exercise");

  const academic = await insertTest("Fixture academic full test", "section-exercise-3", "published");
  await attachPackage(academic, academicFullTest(), "fixture-academic-full");

  const mcq = await insertTest("Fixture MCQ package", "section-exercise-4", "published");
  await attachPackage(mcq, sectionPackage({ collection: "mcq", testId: "fixture-mcq" }), "fixture-mcq");

  const questionTypes = await insertTest("Fixture question types", "section-exercise-5", "published");
  await attachPackage(questionTypes, sectionPackage({ collection: "question_types", testId: "fixture-qtypes" }), "fixture-qtypes");

  const essential = await insertTest("Fixture essential recording", "section-exercise-6", "published");
  await attachPackage(essential, sectionPackage({ collection: "essential", testId: "fixture-essential" }), "fixture-essential");

  const draft = await insertTest("Fixture draft section", "section-exercise-7", "draft");
  await db.insert(listeningQuestions).values([
    { testId: draft, order: 1, questionText: "Draft question", correctAnswer: SECRET, explanation: HIDDEN, options: null, type: "short_answer" as const },
  ]);
  await authorSectionVersion(draft, "section-exercise-7", 1);

  return {
    section,
    packaged,
    academic,
    mcq,
    questionTypes,
    essential,
    draft,
    /** Every row this fixture created — cleanup must not depend on which id a test used. */
    all: [section, packaged, academic, mcq, questionTypes, essential, draft],
  };
}

/** Everything this file created, in the order the foreign keys require. */
async function cleanup(database: Database, ids: string[]) {
  const { db, query } = database;
  for (const id of ids) {
    await db.delete(listeningAnswers).where(
      eq(listeningAnswers.questionId, (await db.select({ id: listeningQuestions.id }).from(listeningQuestions).where(eq(listeningQuestions.testId, id)).limit(1))[0]?.id ?? "00000000-0000-0000-0000-000000000000"),
    );
  }
  for (const id of ids) {
    const attemptIds = (await db.select({ id: listeningAttempts.id }).from(listeningAttempts).where(eq(listeningAttempts.testId, id))).map((row) => row.id);
    for (const attemptId of attemptIds) await db.delete(listeningAnswers).where(eq(listeningAnswers.attemptId, attemptId));
    await db.delete(listeningAttempts).where(eq(listeningAttempts.testId, id));
    await db.update(listeningQuestions).set({ contentVersionId: null }).where(eq(listeningQuestions.testId, id));
    await db.delete(listeningQuestions).where(eq(listeningQuestions.testId, id));
    await db.delete(listeningPackages).where(eq(listeningPackages.testId, id));
    await db.delete(contentVersions).where(eq(contentVersions.targetId, id));
    await db.delete(listeningTests).where(eq(listeningTests.id, id));
  }
  await query(`delete from users where id in ('${OWNER}','${LEARNER}','${OTHER}')`);
}

test("S1/S2/S3 one section, one exercise: the address is stable, the questions are its own, and nothing secret leaks", async () => {
  const database = await createTestDatabase();
  const ids: string[] = [];
  try {
    const { db, query } = database;
    const seeded = await seed(database);
    ids.push(...seeded.all);

    const first = await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db);
    assert.ok(first, "a published authored section resolves");
    assert.equal(first.kind, "exercise");
    if (first.kind !== "exercise") return;

    // S1 — the same address, loaded again: still the SAME section, still the SAME attempt.
    const second = await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db);
    assert.equal(second?.kind, "exercise");
    assert.equal(second?.attemptId, first.attemptId, "reloading resumes the same attempt instead of creating another");
    assert.equal(second?.testId, seeded.section, "the address always resolves to the same section");
    const attempts = await db.select().from(listeningAttempts).where(and(eq(listeningAttempts.testId, seeded.section), eq(listeningAttempts.userId, LEARNER)));
    assert.equal(attempts.length, 1, "exactly one attempt exists for the learner");

    // S2 — the exercise carries THIS section's authored questions, in order, and no answers.
    assert.deepEqual(
      first.questions.map((question) => question.text),
      ["Authored question one", "Authored question two"],
      "the exercise shows the section's own questions",
    );
    assert.deepEqual(first.questions.map((question) => question.number), [1, 2]);
    assert.equal(first.questions[0]!.section, 3, "the authored section number is the one the revision states");
    const serialized = JSON.stringify(first);
    assert.equal(serialized.includes(SECRET), false, "no key reaches the exercise view");
    assert.equal(serialized.includes(HIDDEN), false, "no hidden explanation reaches the exercise view");
    assert.equal(serialized.includes("correctAnswer"), false, "the view carries no answer field at all");

    // The packaged section behaves identically: the learner never learns HOW it was authored.
    const packaged = await loadSectionExercise(seeded.packaged, { id: LEARNER, role: "student" }, dict, db);
    assert.equal(packaged?.kind, "exercise");
    assert.deepEqual(
      packaged && packaged.kind === "exercise" ? packaged.questions.map((q) => q.text) : [],
      ["Packaged question one", "Packaged question two"],
    );

    // S3 — a saved draft is what the learner resumes; another learner gets their OWN attempt.
    await query(`insert into listening_drafts (attempt_id, answers, audio_position) values ($1, '{"q1":"harbour"}'::jsonb, 42)`, [first.attemptId]);
    const resumed = await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db);
    assert.equal(resumed?.kind === "exercise" ? resumed.audioPosition : null, 42, "the audio position comes back");
    assert.deepEqual(resumed?.kind === "exercise" ? resumed.initial : null, { q1: "harbour" }, "the learner's own saved answers come back");

    const other = await loadSectionExercise(seeded.section, { id: OTHER, role: "student" }, dict, db);
    assert.ok(other && other.kind === "exercise");
    if (other?.kind !== "exercise") return;
    assert.notEqual(other.attemptId, first.attemptId, "another learner gets their own attempt");
    assert.deepEqual(other.initial, {}, "another learner never inherits a saved answer");
  } finally {
    await cleanup(database, ids);
    const residue = await database.query<{ tests: string; questions: string; attempts: string; versions: string; users: string }>(`
      select
        (select count(*)::text from listening_tests) tests,
        (select count(*)::text from listening_questions) questions,
        (select count(*)::text from listening_attempts) attempts,
        (select count(*)::text from content_versions) versions,
        (select count(*)::text from users) users`);
    assert.deepEqual(residue[0], { tests: "0", questions: "0", attempts: "0", versions: "0", users: "0" }, "no fixture row remains");
    await database.close();
  }
});

test("S4 a finished section shows its own result and does not silently start a new attempt", async () => {
  const database = await createTestDatabase();
  const ids: string[] = [];
  try {
    const { db } = database;
    const seeded = await seed(database);
    ids.push(...seeded.all);

    const view = await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db);
    assert.ok(view && view.kind === "exercise");
    if (!view || view.kind !== "exercise") return;

    const questions = await db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, seeded.section));
    const submitted = await submitListeningAttempt(
      LEARNER,
      view.attemptId,
      questions.map((question, index) => ({ questionId: question.id, answer: index === 0 ? SECRET : "wrong" })),
      db,
    );
    assert.ok(!("error" in submitted), JSON.stringify(submitted));

    const afterSubmit = await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db);
    assert.equal(afterSubmit?.kind, "result", "a finished section shows the result");
    if (afterSubmit?.kind !== "result") return;
    assert.equal(afterSubmit.attemptId, view.attemptId, "the result belongs to the attempt the learner finished");
    assert.equal(afterSubmit.score, 1, "the score is the server's own grade");
    assert.equal(afterSubmit.total, 2);
    assert.equal(afterSubmit.answers.length, 2, "the learner's own answers are what the review reads");
    assert.deepEqual(
      [...afterSubmit.questions.map((question) => question.id)].sort(),
      [...questions.map((question) => question.id)].sort(),
      "the review reads this section's own question set",
    );

    // Opening it again must NOT create a second attempt: taking it again is a separate action.
    const attempts = await db.select().from(listeningAttempts).where(eq(listeningAttempts.testId, seeded.section));
    assert.equal(attempts.length, 1, "re-opening a finished section creates no hidden attempt");
    assert.equal(attempts[0]!.status, "completed");
  } finally {
    await cleanup(database, ids);
    await database.close();
  }
});

test("S5 the gate is the catalogue's own decision, and a refused address creates no attempt", async () => {
  const database = await createTestDatabase();
  const ids: string[] = [];
  try {
    const { db } = database;
    const seeded = await seed(database);
    ids.push(...seeded.all);

    const refused: [string, string][] = [
      [seeded.draft, "a draft section"],
      [seeded.academic, "an Academic full test"],
      [seeded.mcq, "a dedicated MCQ package"],
      [seeded.questionTypes, "question-type practice"],
      [seeded.essential, "an Essential recording"],
      ["not-a-uuid", "a malformed id"],
      ["99999999-9999-4999-8999-999999999999", "an id that does not exist"],
    ];
    for (const [id, what] of refused) {
      const view = await loadSectionExercise(id, { id: LEARNER, role: "student" }, dict, db);
      assert.equal(view, null, `${what} must not open as a section`);
    }

    // A refused address must leave nothing behind: no attempt was created for any of them.
    const attempts = await db.select().from(listeningAttempts);
    assert.equal(attempts.length, 0, "a refused address creates no attempt");

    // Archived content is refused too, and the published section still opens.
    await db.update(listeningTests).set({ publicationState: "archived" }).where(eq(listeningTests.id, seeded.section));
    assert.equal(await loadSectionExercise(seeded.section, { id: LEARNER, role: "student" }, dict, db), null, "an archived section does not open");
    assert.equal((await db.select().from(listeningAttempts)).length, 0, "an archived section creates no attempt either");
  } finally {
    await cleanup(database, ids);
    await database.close();
  }
});
