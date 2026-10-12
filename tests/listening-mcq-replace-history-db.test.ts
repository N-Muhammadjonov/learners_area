import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { listeningMcqSessions, listeningQuestions, listeningTests } from "../src/db/schema";
import { reconcileListeningQuestions } from "../src/lib/import/listening/importer";
import type { ListeningPackage } from "../src/lib/listening/package";
import { MCQ_FINAL_STAGE, MCQ_PROGRAM_REF } from "../src/lib/listening/mcq-program";
import { createTestDatabase } from "./support/pglite";

/**
 * GOLDEN-05b — REPLACING A DAY'S CONTENT MUST NOT DESTROY LEARNER HISTORY.
 *
 * §08: "Replacing Day 8 with new content does not mutate a finished old Day 8 session into a new
 * quiz", and "Do NOT cascade-delete real learner history". The importer already knows this — its
 * own comment says question rows are reconciled by `order` rather than deleted and re-created
 * "because `listening_answers` and `listening_mcq_sessions` reference these rows, so re-inserting
 * them would erase real learner history".
 *
 * The surplus-row branch did not honour that comment. It refused to delete a question only when a
 * `listening_attempts` row existed for the test — and a dedicated MCQ DAY never creates one. The
 * drill's history lives exclusively in `listening_mcq_sessions`, whose `question_id` foreign key is
 * ON DELETE CASCADE. So re-importing Day 8 with fewer (or renumbered) questions silently deleted
 * the learner's completed work.
 *
 * These fixtures are created and removed here; the removal is asserted.
 */

const OWNER = "77777777-7777-4777-8777-777777777777";
const LEARNER = "88888888-8888-4888-8888-888888888888";

type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;

/** Only the fields the reconciler actually reads — nothing about the payload is invented. */
function packageWithQuestions(count: number): ListeningPackage {
  return {
    questions: Array.from({ length: count }, (_, index) => ({
      number: index + 1,
      kind: "multiple_choice",
      typeCode: "mcq_single",
      text: `Replacement question ${index + 1}`,
      options: ["A) the museum", "B) the library", "C) the theatre"],
      key: "A) the museum",
      evidence: { why: "Replacement explanation." },
    })),
  } as unknown as ListeningPackage;
}

async function seedFinishedDay(database: TestDatabase): Promise<{ testId: string }> {
  await database.query(`insert into users (id, name, role) values
    ('${OWNER}', 'Replace owner', 'owner'),
    ('${LEARNER}', 'Replace learner', 'student')`);
  const [row] = await database.db
    .insert(listeningTests)
    .values({
      title: "QA replace fixture — MCQ Day 8",
      audioType: "audio",
      sourceRef: "listening-mcq-replace-8",
      createdByUserId: OWNER,
      publicationState: "published",
      programRef: MCQ_PROGRAM_REF,
      programOrdinal: 8,
    })
    .returning();
  const testId = row!.id;
  await database.db.insert(listeningQuestions).values(
    [1, 2, 3, 4, 5].map((order) => ({
      testId,
      order,
      type: "multiple_choice" as const,
      typeCode: "mcq_single",
      questionText: `Original day 8 question ${order}`,
      options: ["A) the museum", "B) the library", "C) the theatre"],
      correctAnswer: "A) the museum",
      explanation: "Original explanation.",
    })),
  );
  // The learner FINISHES all five. A dedicated MCQ Day produces NO listening_attempts row — this
  // is the whole reason the old guard missed it.
  const questions = await database.db
    .select({ id: listeningQuestions.id })
    .from(listeningQuestions)
    .where(eq(listeningQuestions.testId, testId));
  await database.db.insert(listeningMcqSessions).values(
    questions.map((question) => ({
      userId: LEARNER,
      testId,
      questionId: question.id,
      stage: MCQ_FINAL_STAGE as "reasoned",
    })),
  );
  return { testId };
}

test("GOLDEN-05b re-importing a Day with fewer questions never cascade-deletes finished MCQ history", async () => {
  const database = await createTestDatabase();
  try {
    const { testId } = await seedFinishedDay(database);
    const before = await database.db
      .select({ id: listeningMcqSessions.id })
      .from(listeningMcqSessions)
      .where(eq(listeningMcqSessions.testId, testId));
    assert.equal(before.length, 5, "the learner finished all five questions");

    // THE REPLACEMENT: staff re-import Day 8 with a shorter package. Questions 4 and 5 become
    // surplus rows. They must NOT be deleted, because learner sessions point at them.
    await reconcileListeningQuestions(database.db as never, testId, packageWithQuestions(3));

    const after = await database.db
      .select({ id: listeningMcqSessions.id, stage: listeningMcqSessions.stage })
      .from(listeningMcqSessions)
      .where(eq(listeningMcqSessions.testId, testId));
    assert.equal(after.length, 5, "the learner's five completed MCQ sessions survive the re-import");
    assert.ok(
      after.every((session) => session.stage === MCQ_FINAL_STAGE),
      "and they are still at their terminal reasoned stage",
    );

    // The rows the sessions point at must still exist — a session with a dangling question is not
    // history, it is corruption.
    const surviving = await database.db
      .select({ id: listeningQuestions.id, order: listeningQuestions.order })
      .from(listeningQuestions)
      .where(eq(listeningQuestions.testId, testId));
    for (const order of [4, 5])
      assert.ok(
        surviving.some((question) => question.order === order),
        `question ${order} is retained because finished learner history references it`,
      );
  } finally {
    await database.close();
  }
});

test("the replace fixtures are removed and the removal is proven", async () => {
  const database = await createTestDatabase();
  try {
    const { testId } = await seedFinishedDay(database);
    await database.query(`delete from listening_mcq_sessions where test_id = '${testId}'`);
    await database.query(`delete from listening_questions where test_id = '${testId}'`);
    await database.query(`delete from listening_tests where id = '${testId}'`);
    const residue = await database.query<{ tests: number; questions: number; sessions: number }>(`
      select (select count(*)::integer from listening_tests where source_ref like 'listening-mcq-replace-%') as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from listening_mcq_sessions) as sessions`);
    assert.deepEqual(residue[0], { tests: 0, questions: 0, sessions: 0 }, "no QA row remains");
  } finally {
    await database.close();
  }
});
