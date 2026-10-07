import test from "node:test";
import assert from "node:assert/strict";
import {
  listeningAnswers,
  listeningAttempts,
  listeningQuestions,
  listeningTests,
} from "../src/db/schema";
import { eq } from "drizzle-orm";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { startListeningAttempt, submitListeningAttempt } from "../src/lib/data/listening-attempt-write";
import { generalListeningCards } from "../src/lib/data/listening-general";
import { listeningQuestionsForAttempt, listeningQuestionsForLiveTest } from "../src/lib/listening/question-set";
import { createTestDatabase } from "./support/pglite";

/**
 * REVISION SAFETY — the owner's §41 scenario, on a real PostgreSQL.
 *
 * A published section v1 has two learners: one who SUBMITTED it and one who is still answering.
 * A teacher then authors a draft v2 and the owner publishes it. The contract:
 *
 *   R1  saving a draft changes NOTHING about published content — same title, same questions,
 *       same question ids;
 *   R2  the draft is invisible to learners and its questions are not in the canonical table;
 *   R3  publishing v2 materializes v2's set WITHOUT deleting v1's rows, so the answers that
 *       reference them keep resolving (the defect this closes: replacing the set cascaded into
 *       historical answers);
 *   R4  a finished attempt keeps its own revision's questions and its score;
 *   R5  an attempt in progress keeps the questions it started with, even after v2 is live;
 *   R6  a NEW attempt gets v2, and the catalogue states v2's question count;
 *   R7  nothing is orphaned: every answer row still points at a question row.
 *
 * Everything this test creates is removed, and the removal is asserted.
 */
const OWNER: AuthoringActor = { id: "", role: "owner", mayPublish: true };

const sectionPayload = (questions: { text: string; answer: string; explanation: string }[]) => ({
  audioType: "audio" as const,
  difficultyLevel: "B2",
  audioUrl: "qa2/revision-safety.mp3",
  transcript: "The tour guide met us at the harbour and changed the meeting time.",
  sectionNo: 2,
  questions: questions.map((question) => ({
    type: "short_answer",
    questionText: question.text,
    correctAnswer: question.answer,
    explanation: question.explanation,
  })),
});

async function learner(query: Awaited<ReturnType<typeof createTestDatabase>>["query"], name: string) {
  const rows = await query<{ id: string }>(`insert into users (name, role, account_status) values ($1, 'student', 'active') returning id`, [name]);
  return rows[0]!.id;
}

test("R1–R7 a draft revision cannot touch published content, and publishing it preserves history", async () => {
  const database = await createTestDatabase();
  const { db, query } = database;
  const SOURCE_REF = "revision-safety-section";
  try {
    const [ownerRow] = await query<{ id: string }>(`insert into users (name, role, account_status) values ('Revision owner', 'owner', 'active') returning id`);
    const owner = { ...OWNER, id: ownerRow!.id };
    const studentA = await learner(query, "Revision student A");
    const studentB = await learner(query, "Revision student B");
    // A third learner is the only honest way to observe what a NEW attempt gets: `start` RESUMES
    // an existing open attempt for the same learner and test (which is the correct behaviour, and
    // is exactly what R5 asserts for student B).
    const studentC = await learner(query, "Revision student C");

    /* ---------------------------------------------------------------- v1 published */
    const v1Saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: owner,
        module: "listening",
        contentType: "section",
        sourceRef: SOURCE_REF,
        title: "Section 2 — v1",
        payload: sectionPayload([
          { text: "Where did the guide meet the group?", answer: "harbour", explanation: "The guide says 'the harbour' first." },
          { text: "What time was the meeting changed to?", answer: "ten", explanation: "The time is confirmed at the end." },
        ]),
      }),
    );
    assert.equal(v1Saved.ok, true);
    if (!v1Saved.ok) return;
    const testId = v1Saved.version.targetId!;
    const publishedV1 = await db.transaction((tx) =>
      publishContentVersion(tx, { actor: owner, versionId: v1Saved.version.id, to: "published", publishAt: null }),
    );
    assert.equal(publishedV1.ok, true, JSON.stringify(publishedV1));

    const v1Questions = await listeningQuestionsForLiveTest(testId, db);
    assert.equal(v1Questions.length, 2, "publishing v1 materialized its question set");
    const v1Ids = v1Questions.map((question) => question.id);
    assert.ok(v1Questions.every((question) => question.contentVersionId === v1Saved.version.id), "v1's rows carry the v1 revision");

    /* ------------------------------------------------- two learners use v1 */
    const attemptA = await startListeningAttempt(studentA, testId, db);
    assert.ok(attemptA);
    const questionsForA = await listeningQuestionsForAttempt({ testId, contentVersionId: v1Saved.version.id }, db);
    const graded = await submitListeningAttempt(
      studentA,
      attemptA!,
      questionsForA.map((question) => ({ questionId: question.id, answer: question.correctAnswer })),
      db,
    );
    assert.deepEqual(graded, { score: 2, totalQuestions: 2 }, "v1 grades 2/2 against v1's keys");

    const attemptB = await startListeningAttempt(studentB, testId, db);
    assert.ok(attemptB);
    const bBound = (await db.select({ version: listeningAttempts.contentVersionId }).from(listeningAttempts).where(eq(listeningAttempts.id, attemptB!)))[0];
    assert.equal(bBound?.version, v1Saved.version.id, "the in-progress attempt is bound to v1");

    /* ------------------------------------------------------------ draft v2 */
    const v2Saved = await db.transaction((tx) =>
      saveContentDraft(tx, {
        actor: owner,
        module: "listening",
        contentType: "section",
        sourceRef: SOURCE_REF,
        title: "Section 2 — v2",
        payload: sectionPayload([
          { text: "Where did the guide meet the group?", answer: "harbour", explanation: "REWRITTEN explanation for v2." },
          { text: "What time was the meeting changed to?", answer: "eleven", explanation: "REWRITTEN: the time is confirmed as eleven." },
        ]),
      }),
    );
    assert.equal(v2Saved.ok, true);
    if (!v2Saved.ok) return;
    assert.notEqual(v2Saved.version.id, v1Saved.version.id);
    assert.equal(v2Saved.version.versionNo, 2, "the second save is version 2");

    // R1 — the published row and its question set are untouched by a draft save.
    const [rowAfterDraft] = await db.select().from(listeningTests).where(eq(listeningTests.id, testId));
    assert.equal(rowAfterDraft?.title, "Section 2 — v1", "a draft save must not retitle published content");
    assert.equal(rowAfterDraft?.publicationState, "published", "the published state is unchanged");
    const liveAfterDraft = await listeningQuestionsForLiveTest(testId, db);
    assert.deepEqual(liveAfterDraft.map((question) => question.id), v1Ids, "the live question ids are unchanged");
    assert.equal(liveAfterDraft[0]?.correctAnswer, "harbour");
    assert.ok(
      liveAfterDraft.every((question) => !question.explanation.includes("REWRITTEN")),
      "the draft's text did not reach the live set",
    );

    // R2 — the draft has no materialized set and is invisible to learners.
    const draftRows = await db.select().from(listeningQuestions).where(eq(listeningQuestions.contentVersionId, v2Saved.version.id));
    assert.equal(draftRows.length, 0, "a draft revision has no canonical question rows");
    const catalogueDuringDraft = await generalListeningCards(studentA, 1, db);
    assert.equal(catalogueDuringDraft.total, 1);
    assert.equal(catalogueDuringDraft.cards[0]?.questionCount, 2, "the card states v1's count while v2 is a draft");

    /* --------------------------------------------------------- publish v2 */
    const publishedV2 = await db.transaction((tx) =>
      publishContentVersion(tx, { actor: owner, versionId: v2Saved.version.id, to: "published", publishAt: null }),
    );
    assert.equal(publishedV2.ok, true, JSON.stringify(publishedV2));

    // R3 — v1's rows still exist: replacing a set must never delete another revision's questions.
    const v1RowsStillThere = await db.select().from(listeningQuestions).where(eq(listeningQuestions.contentVersionId, v1Saved.version.id));
    assert.equal(v1RowsStillThere.length, 2, "publishing v2 left v1's questions in place");
    assert.deepEqual(v1RowsStillThere.map((question) => question.id).sort(), [...v1Ids].sort());

    const liveAfterPublish = await listeningQuestionsForLiveTest(testId, db);
    assert.equal(liveAfterPublish.length, 2);
    assert.ok(liveAfterPublish.every((question) => question.contentVersionId === v2Saved.version.id), "the live set is now v2");
    assert.deepEqual(new Set(liveAfterPublish.map((question) => question.id)), new Set(v2IdsOf(liveAfterPublish, v1Ids)), "v2's rows are new rows, not v1's relabelled");

    // R4 — the finished attempt keeps its revision's questions and its score.
    const reviewForA = await listeningQuestionsForAttempt({ testId, contentVersionId: v1Saved.version.id }, db);
    assert.deepEqual(reviewForA.map((question) => question.id).sort(), [...v1Ids].sort(), "A's review still reads v1's questions");
    assert.equal(reviewForA[0]?.correctAnswer, "harbour");
    const [attemptRowA] = await db.select().from(listeningAttempts).where(eq(listeningAttempts.id, attemptA!));
    assert.deepEqual({ score: attemptRowA?.score, total: attemptRowA?.totalQuestions }, { score: 2, total: 2 }, "A's score is unchanged by the publication");

    // R5 — the attempt in progress keeps what it started with.
    const stillB = await listeningQuestionsForAttempt({ testId, contentVersionId: v1Saved.version.id }, db);
    assert.deepEqual(stillB.map((question) => question.id).sort(), [...v1Ids].sort(), "B keeps v1 while answering");

    // R6 — a NEW attempt gets v2, and the catalogue follows the live set.
    const attemptC = await startListeningAttempt(studentC, testId, db);
    const cBound = (await db.select({ version: listeningAttempts.contentVersionId }).from(listeningAttempts).where(eq(listeningAttempts.id, attemptC!)))[0];
    assert.equal(cBound?.version, v2Saved.version.id, "a new attempt binds to the published v2");
    const forC = await listeningQuestionsForAttempt({ testId, contentVersionId: v2Saved.version.id }, db);
    assert.equal(forC[0]?.correctAnswer, "harbour");
    assert.ok(forC.some((question) => question.explanation.includes("REWRITTEN")), "the new attempt reads v2's authored text");
    const catalogueAfterPublish = await generalListeningCards(studentA, 1, db);
    assert.equal(catalogueAfterPublish.cards[0]?.questionCount, 2, "the card states the live set's count, not the sum of both sets");
    const [rowAfterPublish] = await db.select().from(listeningTests).where(eq(listeningTests.id, testId));
    assert.equal(rowAfterPublish?.title, "Section 2 — v2", "publishing is the moment the row follows the revision");

    // R7 — nothing is orphaned.
    const allAnswers = await db.select().from(listeningAnswers);
    const allQuestionIds = new Set((await db.select({ id: listeningQuestions.id }).from(listeningQuestions)).map((row) => row.id));
    assert.ok(allAnswers.length >= 2, "A's answers are still recorded");
    assert.ok(allAnswers.every((answer) => allQuestionIds.has(answer.questionId)), "every answer still points at a question row");
  } finally {
    for (const id of (await query<{ id: string }>(`select id from listening_tests where source_ref = $1`, [SOURCE_REF])).map((row) => row.id)) {
      await db.delete(listeningAnswers).where(eq(listeningAnswers.attemptId, id)); // no rows keyed by attempt id; kept for clarity
      await db.delete(listeningAttempts).where(eq(listeningAttempts.testId, id));
      await db.delete(listeningQuestions).where(eq(listeningQuestions.testId, id));
      await db.delete(listeningTests).where(eq(listeningTests.id, id));
    }
    await query(`delete from content_versions where source_ref = $1`, [SOURCE_REF]);
    await query(`delete from users where role in ('owner','student')`);

    const residue = await query<{ tests: number; questions: number; versions: number; users: number }>(`
      select (select count(*)::integer from listening_tests where source_ref = $1) as tests,
             (select count(*)::integer from listening_questions) as questions,
             (select count(*)::integer from content_versions) as versions,
             (select count(*)::integer from users) as users`, [SOURCE_REF]);
    assert.deepEqual(residue[0], { tests: 0, questions: 0, versions: 0, users: 0 }, "no fixture row remains");
    await database.close();
  }
});

/** The ids v2's set must NOT reuse: a set is new rows, so it cannot share v1's identity. */
function v2IdsOf(live: { id: string }[], v1Ids: string[]) {
  return live.map((question) => question.id).filter((id) => !v1Ids.includes(id));
}
