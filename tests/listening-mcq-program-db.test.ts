import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import {
  contentVersions,
  listeningMcqSessions,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { mcqDayFor, mcqProgramDays } from "../src/lib/data/listening-mcq";
import { MCQ_FINAL_STAGE, MCQ_PROGRAM_REF, mcqActivePosition } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * THE MCQ PROGRAMME, READ THE WAY A LEARNER AND A MEMBER OF STAFF READ IT.
 *
 * These fixtures are QA content created here and deleted at the end (the removal is asserted), and
 * they are deliberately NOT shaped like the owner's material: no claim in this repository says the
 * owner's 150 questions exist. What is proven is the ARCHITECTURE:
 *
 *   C1  the catalogue lists published Programme DAYS only — an Academic test that happens to carry
 *       an MCQ (the Test 11 shape), a General section whose five questions are MCQs, a draft day and
 *       another programme's item are all invisible here;
 *   C2  the catalogue's numbers are real: published days (not the target), and this learner's own
 *       finished days — never 150 questions before thirty days exist;
 *   C3  a day's questions are read in the item's AUTHORED order (positions are never incidental DB
 *       order), with the learner's own persisted stages, and a day is complete only at the final
 *       stage;
 *   C4  resuming picks the first unfinished question, and a requested position never invents one;
 *   C5  one learner's work is invisible to another, including a staff member's;
 *   C6  before a question's stage arrives, neither the options nor the key nor the explanation are
 *       anywhere in what the server builds;
 *   C7  0052's guards hold in a real database: no half-stated programme relation, no DAY 0, and no
 *       two items claiming the same day.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const KEY = "QASECRETKEY-MUSEUM";
const OPTION_TEXT = "QAOPTION-TRAM-STATION";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

type Fixtures = {
  database: TestDatabase;
  day1: string;
  day2: string;
  day3: string;
  academic: string;
  general: string;
  otherProgramme: string;
  day1Questions: { id: string; order: number }[];
};

async function insertTest(
  database: TestDatabase,
  input: {
    title: string;
    sourceRef: string;
    publicationState?: "draft" | "published" | "archived" | "scheduled";
    publishAt?: Date | null;
    programRef?: string | null;
    programOrdinal?: number | null;
    audioUrl?: string | null;
  },
): Promise<string> {
  const [row] = await database.db
    .insert(listeningTests)
    .values({
      title: input.title,
      audioType: "audio",
      sourceRef: input.sourceRef,
      createdByUserId: OWNER,
      publicationState: input.publicationState ?? "published",
      publishAt: input.publishAt ?? null,
      programRef: input.programRef ?? null,
      programOrdinal: input.programOrdinal ?? null,
      audioUrl: input.audioUrl ?? null,
    })
    .returning();
  return row!.id;
}

/** Five canonical MCQs, inserted in a SHUFFLED order so the read cannot pass by luck. */
async function insertDayQuestions(database: TestDatabase, testId: string, prefix: string): Promise<void> {
  const authored = [
    { order: 3, text: `${prefix} question three` },
    { order: 1, text: `${prefix} question one` },
    { order: 5, text: `${prefix} question five` },
    { order: 2, text: `${prefix} question two` },
    { order: 4, text: `${prefix} question four` },
  ];
  await database.db.insert(listeningQuestions).values(
    authored.map((question) => ({
      testId,
      order: question.order,
      type: "multiple_choice" as const,
      typeCode: "mcq_single",
      questionText: question.text,
      options: [`A) ${OPTION_TEXT}`, "B) the library", "C) the theatre"],
      correctAnswer: KEY,
      explanation: "QA explanation that must never reach a learner before the reveal.",
    })),
  );
}

async function seed(): Promise<Fixtures> {
  const database = await createTestDatabase();
  const { db, query } = database;
  await query(`insert into users (id, name, role) values
    ('${OWNER}', 'Programme owner', 'owner'),
    ('${LEARNER}', 'Programme learner', 'student'),
    ('${OTHER}', 'Other learner', 'student')`);

  // The programme: DAY 1 (published), DAY 2 (published), DAY 3 (a draft being authored).
  const day1 = await insertTest(database, {
    title: "QA fixture — MCQ Day 1",
    sourceRef: "listening-mcq-day-1",
    programRef: MCQ_PROGRAM_REF,
    programOrdinal: 1,
    audioUrl: "https://cdn.example.test/qa/day-1.mp3",
  });
  await insertDayQuestions(database, day1, "Day 1");
  const day2 = await insertTest(database, {
    title: "QA fixture — MCQ Day 2",
    sourceRef: "listening-mcq-day-2",
    programRef: MCQ_PROGRAM_REF,
    programOrdinal: 2,
  });
  await insertDayQuestions(database, day2, "Day 2");
  const day3 = await insertTest(database, {
    title: "QA fixture — MCQ Day 3 (draft)",
    sourceRef: "listening-mcq-day-3",
    publicationState: "draft",
    programRef: MCQ_PROGRAM_REF,
    programOrdinal: 3,
  });
  await insertDayQuestions(database, day3, "Day 3");

  // An Academic full test whose hub happens to offer a staged MCQ (the Test 11 shape): it is
  // published, it holds genuine MCQs, and it is NOT part of the programme.
  const academic = await insertTest(database, { title: "QA fixture — Academic full test", sourceRef: "listening-mcq-academic" });
  await insertDayQuestions(database, academic, "Academic");
  await db.insert(contentVersions).values({
    module: "listening",
    contentType: "full_test",
    sourceRef: "listening-mcq-academic",
    versionNo: 1,
    status: "published",
    title: "QA fixture — Academic full test",
    contentSnapshot: { questions: [] },
    contentHash: "0".repeat(64),
    semanticHash: "0".repeat(64),
    answerKeyHash: "0".repeat(64),
    targetType: "listening_test",
    targetId: academic,
    createdByUserId: OWNER,
  });

  // A General Listening section that also holds five MCQs — a different product again.
  const general = await insertTest(database, { title: "QA fixture — General section", sourceRef: "listening-general-qa" });
  await insertDayQuestions(database, general, "General");
  await db.insert(contentVersions).values({
    module: "listening",
    contentType: "section",
    sourceRef: "listening-general-qa",
    versionNo: 1,
    status: "published",
    title: "QA fixture — General section",
    contentSnapshot: { sectionNo: 1, questions: [] },
    contentHash: "0".repeat(64),
    semanticHash: "0".repeat(64),
    answerKeyHash: "0".repeat(64),
    targetType: "listening_test",
    targetId: general,
    createdByUserId: OWNER,
  });

  // Another programme, at the same ordinal: a day number is only a day WITHIN its programme.
  const otherProgramme = await insertTest(database, {
    title: "QA fixture — another programme day 1",
    sourceRef: "listening-other-programme-1",
    programRef: "another-programme",
    programOrdinal: 1,
  });

  // The learner's own staged work on DAY 1: Q1/Q2 reasoned, Q3 committed, Q4/Q5 untouched.
  const day1Questions = await db.select().from(listeningQuestions).where(eq(listeningQuestions.testId, day1)).orderBy(listeningQuestions.order);
  await db.insert(listeningMcqSessions).values([
    { userId: LEARNER, testId: day1, questionId: day1Questions[0]!.id, stage: "reasoned" },
    { userId: LEARNER, testId: day1, questionId: day1Questions[1]!.id, stage: "reasoned" },
    { userId: LEARNER, testId: day1, questionId: day1Questions[2]!.id, stage: "committed" },
    // Another learner finished the whole day: it must not move the learner's own numbers (C5).
    ...day1Questions.map((question) => ({ userId: OTHER, testId: day1, questionId: question.id, stage: "reasoned" as const })),
  ]);

  return { database, day1, day2, day3, academic, general, otherProgramme, day1Questions };
}

test("C1 the catalogue lists published programme DAYS only — never an Academic test's MCQ, a General section, a draft or another programme", async () => {
  const fixtures = await seed();
  try {
    const { database, day1, day2, day3, academic, general, otherProgramme } = fixtures;
    const catalogue = await mcqProgramDays({ id: LEARNER, role: "student" }, {}, database.db);
    const listed = catalogue.days.map((day) => day.day);

    assert.deepEqual(listed, [1, 2], "the two published days, in authored order");
    assert.equal(catalogue.days[0]!.testId, day1);
    assert.equal(catalogue.days[1]!.testId, day2);

    for (const [name, testId] of Object.entries({
      "an Academic full test holding MCQs (the Test 11 shape)": academic,
      "a General section holding five MCQs": general,
      "a draft day": day3,
      "another programme's day 1": otherProgramme,
    }))
      assert.ok(!catalogue.days.some((day) => day.testId === testId), `${name} must not be a programme day`);

    // Even a learner asking for ONE day cannot reach a row that is not this programme's day.
    assert.equal(await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db).then((day) => day?.testId), day1);
    assert.equal(await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db).then((day) => day?.day), 1);
    assert.equal(await mcqDayFor(4, { id: LEARNER, role: "student" }, {}, database.db), null, "day 4 does not exist");
    assert.equal(await mcqDayFor(0, { id: LEARNER, role: "student" }, {}, database.db), null, "there is no day 0");
    assert.equal(await mcqDayFor(-2, { id: LEARNER, role: "student" }, {}, database.db), null);
    assert.equal(await mcqDayFor(1.5, { id: LEARNER, role: "student" }, {}, database.db), null, "a day is a whole number");
  } finally {
    await fixtures.database.close();
  }
});

test("C1b a draft day is invisible to a learner and visible — and labelled — to staff previewing the programme", async () => {
  const fixtures = await seed();
  try {
    const { database, day3 } = fixtures;

    // A learner: no draft in the catalogue, and no way to open it by URL.
    const learnerPage = await mcqProgramDays({ id: LEARNER, role: "student" }, { includeDrafts: true }, database.db);
    assert.deepEqual(learnerPage.days.map((day) => day.day), [1, 2], "a learner asking for drafts still gets no draft");
    assert.equal(await mcqDayFor(3, { id: LEARNER, role: "student" }, { includeDrafts: true }, database.db), null);

    // Staff: the draft day is there, and says what it is.
    const staffPage = await mcqProgramDays({ id: OWNER, role: "owner" }, { includeDrafts: true }, database.db);
    assert.deepEqual(staffPage.days.map((day) => day.day), [1, 2, 3], "staff see the day being authored");
    const draftCard = staffPage.days.find((day) => day.day === 3)!;
    assert.equal(draftCard.draft, true, "and it is labelled a draft");
    assert.equal(draftCard.testId, day3);
    assert.ok(staffPage.days.filter((day) => day.day !== 3).every((day) => day.draft === false), "published days are not labelled drafts");

    const staffDay = await mcqDayFor(3, { id: OWNER, role: "owner" }, { includeDrafts: true }, database.db);
    assert.equal(staffDay?.draft, true);
    assert.equal(staffDay?.questions.length, 5, "a draft day may hold five questions while it is being prepared");

    // A TEACHER may prepare; the publication decision is not theirs (checked in the authoring gate),
    // but previewing a draft is a staff read.
    assert.equal((await mcqDayFor(3, { id: OWNER, role: "teacher" }, { includeDrafts: true }, database.db))?.draft, true);

    // A draft day's progress does not inflate the learner's headlines.
    assert.equal(staffPage.progress.daysPublished, 2, "drafts are not published days");
    assert.equal(staffPage.progress.questionsPublished, 10);
  } finally {
    await fixtures.database.close();
  }
});

test("C2/C3 the day is read in its AUTHORED order with the learner's own stages, and completion means the final stage", async () => {
  const fixtures = await seed();
  try {
    const { database, day1Questions } = fixtures;
    const day = await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db);
    assert.ok(day);
    assert.equal(day.day, 1);
    assert.equal(day.audioUrl, "https://cdn.example.test/qa/day-1.mp3", "the day's own audio is carried, never guessed");
    assert.deepEqual(day.questions.map((question) => question.order), [1, 2, 3, 4, 5], "positions are authored, not incidental");
    assert.deepEqual(
      day.questions.map((question) => question.questionText),
      ["Day 1 question one", "Day 1 question two", "Day 1 question three", "Day 1 question four", "Day 1 question five"],
    );
    assert.deepEqual(day.questions.map((question) => question.id), day1Questions.map((question) => question.id));

    // The owner's example: Q1/Q2 reasoned, Q3 committed, Q4/Q5 untouched → In progress 2/5.
    assert.deepEqual(day.questions.map((question) => question.stage), ["reasoned", "reasoned", "committed", null, null]);
    assert.equal(day.status.completed, 2);
    assert.equal(day.status.inProgress, 1);
    assert.equal(day.status.total, 5);
    assert.equal(day.status.state, "in_progress");
    assert.notEqual(day.status.state, "completed", "a committed question is not a finished day");

    // A day nobody opened, and the day's real size.
    const day2 = await mcqDayFor(2, { id: LEARNER, role: "student" }, {}, database.db);
    assert.equal(day2?.status.state, "not_started");
    assert.equal(day2?.questions.length, 5);

    // The catalogue states the same truth, and its numbers are derived — not the target.
    const catalogue = await mcqProgramDays({ id: LEARNER, role: "student" }, {}, database.db);
    const card = catalogue.days.find((entry) => entry.day === 1)!;
    assert.equal(card.status.state, "in_progress");
    assert.equal(card.status.completed, 2);
    assert.equal(card.questionCount, 5, "a card states the questions the day really has");
    assert.equal(catalogue.progress.daysPublished, 2);
    assert.equal(catalogue.progress.daysCompleted, 0, "no day is finished yet");
    assert.equal(catalogue.progress.questionsPublished, 10, "two published days of five");
    assert.ok(!("dayTarget" in catalogue.progress), "no fabricated day target is reported");
    assert.notEqual(catalogue.progress.questionsPublished, 150, "150 is never claimed before the days exist");
  } finally {
    await fixtures.database.close();
  }
});

test("C3b a finished day is complete only when all five questions reach the final stage", async () => {
  const fixtures = await seed();
  try {
    const { database } = fixtures;
    const day = await mcqDayFor(1, { id: OTHER, role: "student" }, {}, database.db);
    assert.equal(day?.status.state, "completed");
    assert.equal(day?.status.completed, 5);
    const catalogue = await mcqProgramDays({ id: OTHER, role: "student" }, {}, database.db);
    assert.equal(catalogue.progress.daysCompleted, 1);
    assert.equal(catalogue.progress.questionsCompleted, 5);
    assert.equal(catalogue.progress.questionsPublished, 10, "the published total does not move because a learner progressed");
  } finally {
    await fixtures.database.close();
  }
});

test("C4 resuming lands on the first unfinished question, and a requested position never invents one", async () => {
  const fixtures = await seed();
  try {
    const { database } = fixtures;
    const day = (await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db))!;

    // Mid-day return: Q1/Q2 finished, Q3 committed → the learner is on question 3, at `committed`.
    assert.equal(mcqActivePosition(day.questions, null), 3, "resume where they stopped, not at question 1");
    assert.equal(day.questions[2]!.stage, "committed", "and the stage they reached is the stage they return to");
    // The day's own 1…5 navigation: an authored position is honoured…
    assert.equal(mcqActivePosition(day.questions, 5), 5);
    assert.equal(mcqActivePosition(day.questions, 1), 1);
    // …but a URL never invents question 6, and never a positional zero.
    assert.equal(mcqActivePosition(day.questions, 6), 3);
    assert.equal(mcqActivePosition(day.questions, 0), 3);
    assert.equal(mcqActivePosition(day.questions, -1), 3);
    assert.equal(mcqActivePosition(day.questions, Number.NaN), 3);

    // A finished day opens at question 1 for review; an untouched day at question 1 to start.
    const finished = (await mcqDayFor(1, { id: OTHER, role: "student" }, {}, database.db))!;
    assert.equal(mcqActivePosition(finished.questions, null), 1);
    const untouched = (await mcqDayFor(2, { id: LEARNER, role: "student" }, {}, database.db))!;
    assert.equal(mcqActivePosition(untouched.questions, null), 1);
    // Nothing to resume into when a day holds no questions: no position is invented.
    assert.equal(mcqActivePosition([], null), 0);
  } finally {
    await fixtures.database.close();
  }
});

test("C5 one learner's staged work is invisible to another — and staff never see a learner's private notes", async () => {
  const fixtures = await seed();
  try {
    const { database, day1Questions } = fixtures;
    // A private note and reasoning, written by the learner on question 1.
    await database.query(
      `update listening_mcq_sessions set notes = 'QA-PRIVATE-NOTE', reasoning = 'QA-PRIVATE-REASONING'
        where user_id = '${LEARNER}' and question_id = '${day1Questions[0]!.id}'`,
    );

    const otherLearner = await mcqDayFor(1, { id: OTHER, role: "student" }, {}, database.db);
    assert.equal(otherLearner?.status.completed, 5, "the other learner has their own finished day");
    const staffView = await mcqDayFor(1, { id: OWNER, role: "owner" }, { includeDrafts: true }, database.db);
    // The staff read is the day's SHAPE, never the learner's work: no note, no reasoning, no choice.
    const serialised = JSON.stringify(staffView);
    assert.ok(!serialised.includes("QA-PRIVATE-NOTE"), "a learner's notes are never on a staff surface");
    assert.ok(!serialised.includes("QA-PRIVATE-REASONING"), "and neither is their reasoning");
    assert.ok(!serialised.includes(KEY), "nor the answer key");
    assert.ok(
      staffView?.questions.every((question) => question.stage === null),
      "a staff view states no learner's progress at all",
    );

    // And the learner's own read does not borrow the other learner's stages for untouched questions.
    const learnerDay = await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db);
    assert.deepEqual(learnerDay?.questions.map((question) => question.stage), ["reasoned", "reasoned", "committed", null, null]);
  } finally {
    await fixtures.database.close();
  }
});

test("C6 before its stage, neither the options nor the key nor the explanation are in what the server builds", async () => {
  const fixtures = await seed();
  try {
    const { database } = fixtures;
    const catalogue = await mcqProgramDays({ id: LEARNER, role: "student" }, {}, database.db);
    const day = (await mcqDayFor(1, { id: LEARNER, role: "student" }, {}, database.db))!;
    const untouchedDay = (await mcqDayFor(2, { id: LEARNER, role: "student" }, {}, database.db))!;

    for (const [surface, payload] of [
      ["the catalogue", catalogue],
      ["a day with two questions answered", day],
      ["a day nobody opened", untouchedDay],
    ] as const) {
      const serialised = JSON.stringify(payload);
      assert.ok(!serialised.includes(KEY), `${surface} must not carry the answer key`);
      assert.ok(!serialised.includes(OPTION_TEXT), `${surface} must not carry an option's text`);
      assert.ok(!serialised.includes("QA explanation"), `${surface} must not carry the explanation`);
      // The question text itself IS shown — the drill needs it — and it is the only content here.
      if (surface !== "the catalogue") assert.ok(serialised.includes("question one"), `${surface} carries the question text`);
    }
    // The catalogue is a list of days: it has no field that could hold a question at all.
    assert.ok(!("questions" in (catalogue.days[0] as object)), "a card is not a question payload");
  } finally {
    await fixtures.database.close();
  }
});

test("C7 0052's guards hold in a real database: no half statement, no DAY 0, no two items for one day", async () => {
  const fixtures = await seed();
  try {
    const { database } = fixtures;
    const { query } = database;

    // A programme without a position (and the reverse) is an incomplete statement about a day.
    await assert.rejects(
      () =>
        query(
          `insert into listening_tests (created_by_user_id, title, audio_type, program_ref)
           values ('${OWNER}', 'QA half statement', 'audio', '${MCQ_PROGRAM_REF}')`,
        ),
      /pair/i,
      "a programme reference without an ordinal is refused",
    );
    await assert.rejects(
      () =>
        query(
          `insert into listening_tests (created_by_user_id, title, audio_type, program_ordinal)
           values ('${OWNER}', 'QA half statement', 'audio', 7)`,
        ),
      /pair/i,
      "an ordinal without a programme is refused",
    );

    // DAY 0 is not a day.
    await assert.rejects(
      () =>
        query(
          `insert into listening_tests (created_by_user_id, title, audio_type, program_ref, program_ordinal)
           values ('${OWNER}', 'QA day zero', 'audio', '${MCQ_PROGRAM_REF}', 0)`,
        ),
      /ordinal|check/i,
      "DAY 0 is refused",
    );

    // A duplicated import cannot create a second DAY 1.
    await assert.rejects(
      () =>
        query(
          `insert into listening_tests (created_by_user_id, title, audio_type, program_ref, program_ordinal)
           values ('${OWNER}', 'QA duplicate day 1', 'audio', '${MCQ_PROGRAM_REF}', 1)`,
        ),
      /duplicate|unique/i,
      "a second DAY 1 in the same programme is refused",
    );

    // …but the SAME ordinal in a different programme is a different day, and is allowed: a day
    // number only means something WITHIN its programme.
    const [other] = await query<{ id: string }>(
      `insert into listening_tests (created_by_user_id, title, audio_type, program_ref, program_ordinal)
       values ('${OWNER}', 'QA second programme day 1', 'audio', 'second-programme', 1) returning id`,
    );
    assert.ok(other?.id, "another programme may also have a day 1");
    // And an item that is not in any programme is completely unaffected by the new relation.
    const [plain] = await query<{ id: string }>(
      `insert into listening_tests (created_by_user_id, title, audio_type) values ('${OWNER}', 'QA plain item', 'audio') returning id`,
    );
    assert.ok(plain?.id, "an item with no programme keeps working exactly as before");
  } finally {
    await fixtures.database.close();
  }
});

test("the fixtures are removed: no programme day remains and the removal is proven", async () => {
  const fixtures = await seed();
  try {
    const { database } = fixtures;
    const { query } = database;
    assert.equal((await mcqProgramDays({ id: LEARNER, role: "student" }, {}, database.db)).days.length, 2);

    await query(`delete from listening_mcq_sessions where test_id in (select id from listening_tests where source_ref like 'listening-mcq-%' or source_ref like 'listening-general-qa' or source_ref like 'listening-other-programme-%')`);
    await query(`delete from listening_questions where test_id in (select id from listening_tests where source_ref like 'listening-mcq-%' or source_ref like 'listening-general-qa' or source_ref like 'listening-other-programme-%')`);
    await query(`delete from content_versions where source_ref like 'listening-mcq-%' or source_ref like 'listening-general-qa'`);
    await query(`delete from listening_tests where source_ref like 'listening-mcq-%' or source_ref like 'listening-general-qa' or source_ref like 'listening-other-programme-%'`);

    const page = await mcqProgramDays({ id: LEARNER, role: "student" }, { includeDrafts: true }, database.db);
    assert.equal(page.days.length, 0, "the programme is empty again");
    assert.equal(page.progress.questionsPublished, 0);
    const residue = await query<{ tests: number; questions: number; sessions: number; versions: number }>(`
      select (select count(*)::integer from listening_tests where source_ref like 'listening-%qa%' or source_ref like 'listening-mcq-%' or source_ref like 'listening-other-programme-%') as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from listening_mcq_sessions) as sessions,
             (select count(*)::integer from content_versions where source_ref like 'listening-mcq-%' or source_ref like 'listening-general-qa') as versions`);
    assert.deepEqual(
      residue[0],
      { tests: 0, questions: 0, sessions: 0, versions: 0 },
      "no QA row remains — every fixture this suite created was deleted",
    );
  } finally {
    await fixtures.database.close();
  }
});

test("the final stage constant is the engine's own last stage, so 'completed' has one definition", () => {
  assert.equal(MCQ_FINAL_STAGE, "reasoned");
});
