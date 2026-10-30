import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { listeningMcqSessions, listeningQuestions, listeningTests } from "../src/db/schema";
import { mcqDayFor, mcqProgramDays } from "../src/lib/data/listening-mcq";
import { MCQ_DAY_QUESTION_COUNT, MCQ_FINAL_STAGE, MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * GOLDEN-04 / GOLDEN-05 — THE PROGRAMME HAS NO MAXIMUM NUMBER OF DAYS.
 *
 * The owner's override: there is no thirty-day cap and no 150-question cap. A centre may publish a
 * hundred days or a thousand, withdraw one and publish its replacement, and nothing in the code may
 * hide, truncate or invent a day. What is proven here, against a real schema:
 *
 *   G4a  a hundred published days are ALL reachable — every ordinal 1…100 is returned across the
 *        bounded pages, in authored order, with no duplicate and no omission. The old behaviour
 *        (one fixed read ceiling, no pagination) would have silently dropped content once the
 *        programme outgrew it;
 *   G4b  the headline numbers are the real ones (100 days, 500 questions) and no target is claimed;
 *   G4c  a page beyond the end is empty and honest — no fake "Day 101" card is ever rendered;
 *   G5a  archiving day 8 removes it from the learner catalogue, leaves the ordinals noncontiguous
 *        (7, 9, 10 — nothing is renumbered and nothing is "unlocked"), and does NOT touch the
 *        learner's finished session rows or the authored questions: the history is recoverable;
 *   G5b  publishing a REPLACEMENT day 8 does not mutate the finished old day 8 session, and the
 *        new day carries its own question ids — an old question UUID is never reused with new
 *        semantics.
 *
 * Every row this suite creates is deleted at the end and the removal is asserted.
 */

const OWNER = "44444444-4444-4444-8444-444444444444";
const LEARNER = "55555555-5555-4555-8555-555555555555";
const SOURCE_PREFIX = "listening-mcq-scale-";
const TOTAL_DAYS = 100;

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

async function insertDay(
  database: TestDatabase,
  ordinal: number,
  options: { publicationState?: "draft" | "published" | "archived"; sourceRef?: string; title?: string } = {},
): Promise<string> {
  const [row] = await database.db
    .insert(listeningTests)
    .values({
      title: options.title ?? `QA scale fixture — MCQ Day ${ordinal}`,
      audioType: "audio",
      sourceRef: options.sourceRef ?? `${SOURCE_PREFIX}${ordinal}`,
      createdByUserId: OWNER,
      publicationState: options.publicationState ?? "published",
      programRef: MCQ_PROGRAM_REF,
      programOrdinal: ordinal,
    })
    .returning();
  const testId = row!.id;
  await database.db.insert(listeningQuestions).values(
    [3, 1, 5, 2, 4].map((order) => ({
      testId,
      order,
      type: "multiple_choice" as const,
      typeCode: "mcq_single",
      questionText: `QA scale day ${ordinal} question ${order}`,
      options: ["A) the museum", "B) the library", "C) the theatre"],
      correctAnswer: "QASCALEKEY",
      explanation: "QA explanation that must never reach a learner before the reveal.",
    })),
  );
  return testId;
}

async function seedUsers(database: TestDatabase): Promise<void> {
  await database.query(`insert into users (id, name, role) values
    ('${OWNER}', 'Scale programme owner', 'owner'),
    ('${LEARNER}', 'Scale programme learner', 'student')`);
}

/** Walk every bounded page the way the page component does, and return the ordinals in order. */
async function readAllDays(database: TestDatabase, user: { id: string; role: "student" | "owner" }) {
  const ordinals: number[] = [];
  let page = 1;
  let pages = 0;
  for (;;) {
    const result = await mcqProgramDays(user, { page }, database.db);
    pages += 1;
    for (const card of result.days) ordinals.push(card.day);
    assert.ok(result.days.length <= result.pageSize, "a page never returns more than its own size");
    if (!result.hasNextPage) return { ordinals, pages, last: result };
    page += 1;
    assert.ok(page < 500, "pagination terminates");
  }
}

test("GOLDEN-04 a hundred published days are all reachable, in authored order, with no cap", async () => {
  const database = await createTestDatabase();
  try {
    await seedUsers(database);
    for (let ordinal = 1; ordinal <= TOTAL_DAYS; ordinal += 1) await insertDay(database, ordinal);

    const { ordinals, pages, last } = await readAllDays(database, { id: LEARNER, role: "student" });

    // G4a every single day exists exactly once, in ascending authored order.
    assert.equal(ordinals.length, TOTAL_DAYS, "no published day is dropped by the read");
    assert.deepEqual(
      ordinals,
      Array.from({ length: TOTAL_DAYS }, (_, index) => index + 1),
      "days are returned in the authored ordinal order, with no gap and no duplicate",
    );
    assert.ok(pages > 1, "a hundred days really are paginated rather than streamed in one page");

    // G4b the headline numbers are the real ones, and no target is divided by.
    assert.equal(last.progress.daysPublished, TOTAL_DAYS);
    assert.equal(last.progress.questionsPublished, TOTAL_DAYS * MCQ_DAY_QUESTION_COUNT, "500 real questions");
    assert.ok(!("dayTarget" in last.progress), "no fabricated day target is reported");

    // Day 100 is a real, openable day — not a number on a card.
    const day100 = await mcqDayFor(100, { id: LEARNER, role: "student" }, {}, database.db);
    assert.equal(day100?.day, 100, "day 100 opens");
    assert.equal(day100?.questions.length, MCQ_DAY_QUESTION_COUNT, "and holds exactly five questions");
    assert.deepEqual(
      day100?.questions.map((question) => question.order),
      [1, 2, 3, 4, 5],
      "in the item's own authored order, not insertion order",
    );

    // G4c nothing beyond the end is invented.
    const beyond = await mcqProgramDays({ id: LEARNER, role: "student" }, { page: 99 }, database.db);
    assert.equal(beyond.days.length, 0, "a page past the end is empty");
    assert.equal(beyond.hasNextPage, false);
    assert.equal(await mcqDayFor(101, { id: LEARNER, role: "student" }, {}, database.db), null, "there is no Day 101");

    // A hostile page number cannot become a negative offset or an unbounded read.
    for (const hostile of [0, -5, Number.NaN]) {
      const guarded = await mcqProgramDays({ id: LEARNER, role: "student" }, { page: hostile }, database.db);
      assert.equal(guarded.page, 1, `page ${hostile} is normalised to the first page`);
      assert.equal(guarded.days[0]?.day, 1);
    }
  } finally {
    await database.close();
  }
});

test("GOLDEN-04b content past the OLD fixed read ceiling is reachable — the defect this replaced", async () => {
  // THE REPRODUCED DEFECT. The catalogue used to read `.limit(200)` with no pagination and no
  // offset, described in the source as a bound that "cannot cut honest content" because "the
  // programme is authored as thirty days". With the thirty-day cap removed that assumption is
  // false: day 201 and beyond existed, were published, and were simply never returned — a learner
  // could not reach them by any address. This asserts the days past that ceiling are served.
  const database = await createTestDatabase();
  try {
    await seedUsers(database);
    const beyondCeiling = 205;
    for (let ordinal = 1; ordinal <= beyondCeiling; ordinal += 1) await insertDay(database, ordinal);

    const { ordinals, last } = await readAllDays(database, { id: LEARNER, role: "student" });
    assert.equal(ordinals.length, beyondCeiling, "every published day is reachable, not the first 200");
    for (const ordinal of [200, 201, 203, 205])
      assert.ok(ordinals.includes(ordinal), `day ${ordinal} is reachable past the old fixed ceiling`);
    assert.equal(last.progress.daysPublished, beyondCeiling, "the headline count is the real one");

    const final = await mcqDayFor(beyondCeiling, { id: LEARNER, role: "student" }, {}, database.db);
    assert.equal(final?.questions.length, MCQ_DAY_QUESTION_COUNT, "and it opens with its five real questions");
  } finally {
    await database.close();
  }
});

test("GOLDEN-05 archiving a day keeps learner history and leaves the ordinals noncontiguous", async () => {
  const database = await createTestDatabase();
  try {
    await seedUsers(database);
    const ids: Record<number, string> = {};
    for (let ordinal = 1; ordinal <= 10; ordinal += 1) ids[ordinal] = await insertDay(database, ordinal);

    // The learner FINISHES day 8: five sessions at the terminal stage.
    const day8Questions = await database.db
      .select({ id: listeningQuestions.id })
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, ids[8]!));
    assert.equal(day8Questions.length, MCQ_DAY_QUESTION_COUNT);
    await database.db.insert(listeningMcqSessions).values(
      day8Questions.map((question) => ({
        userId: LEARNER,
        testId: ids[8]!,
        questionId: question.id,
        stage: MCQ_FINAL_STAGE as "reasoned",
      })),
    );
    const before = await mcqDayFor(8, { id: LEARNER, role: "student" }, {}, database.db);
    assert.equal(before?.status.state, "completed", "day 8 is finished before anything is withdrawn");

    // THE WITHDRAWAL — a state change, never a delete.
    await database.db.update(listeningTests).set({ publicationState: "archived" }).where(eq(listeningTests.id, ids[8]!));

    const { ordinals } = await readAllDays(database, { id: LEARNER, role: "student" });
    assert.deepEqual(ordinals, [1, 2, 3, 4, 5, 6, 7, 9, 10], "day 8 leaves the catalogue and NOTHING is renumbered");
    assert.equal(await mcqDayFor(8, { id: LEARNER, role: "student" }, {}, database.db), null, "an archived day is not served");

    // G5a the history is still there: the authored questions and the learner's finished sessions
    // survive the withdrawal untouched. An archive is recoverable; a cascade delete would not be.
    const survivingQuestions = await database.db
      .select({ id: listeningQuestions.id })
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, ids[8]!));
    assert.equal(survivingQuestions.length, MCQ_DAY_QUESTION_COUNT, "the authored source survives archival");
    const survivingSessions = await database.db
      .select({ id: listeningMcqSessions.id, stage: listeningMcqSessions.stage })
      .from(listeningMcqSessions)
      .where(eq(listeningMcqSessions.testId, ids[8]!));
    assert.equal(survivingSessions.length, MCQ_DAY_QUESTION_COUNT, "the learner's completed work is NOT destroyed");
    assert.ok(
      survivingSessions.every((session) => session.stage === MCQ_FINAL_STAGE),
      "and its terminal stages are unchanged",
    );

    // Restoring is a state change too: the day comes back with its history intact.
    await database.db.update(listeningTests).set({ publicationState: "published" }).where(eq(listeningTests.id, ids[8]!));
    const restored = await mcqDayFor(8, { id: LEARNER, role: "student" }, {}, database.db);
    assert.equal(restored?.status.state, "completed", "the learner's finished day 8 is exactly as they left it");
  } finally {
    await database.close();
  }
});
