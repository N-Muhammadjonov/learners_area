import test from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { listeningAnswers, listeningAttempts, listeningDrafts, listeningTests, listeningQuestions } from "../src/db/schema";
import { publishContentVersion, saveContentDraft, type AuthoringActor } from "../src/lib/content/authoring";
import { loadSectionExercise } from "../src/lib/listening/section-exercise";
import { startListeningAttempt, submitListeningAttempt } from "../src/lib/data/listening-attempt-write";
import { getDictionary } from "../src/lib/i18n";
import { createTestDatabase } from "./support/pglite";

/**
 * THE PUBLISHED-v1 / DRAFT-v2 / PUBLISH-v2 SEQUENCE, THROUGH THE REAL READERS (§10, §41/G8).
 *
 * `tests/listening-revision-safety.test.ts` proves the same contract at the data layer; this file
 * proves it at the layer a learner actually touches — the section's own loader — because a
 * defect that leaves the rows correct but hands a learner the wrong SET is just as real:
 *
 *   R1  a draft save changes NOTHING the learner can see (v1 stays live, the draft is invisible);
 *   R2  a learner who is mid-attempt keeps THEIR questions and THEIR saved answers after the draft;
 *   R3  publishing v2 does not disturb the learner who is still working in v1;
 *   R4  a learner who starts AFTER the publication gets v2, and their answers are recorded against
 *       v2's own question rows;
 *   R5  the attempt finished against v1 keeps v1's questions, its score and its answers;
 *   R6  both learners can work at the same time without seeing each other's answers, notes or
 *       attempt — an open attempt is per learner per section;
 *   R7  every fixture is deleted.
 */

const OWNER = "11111111-1111-4111-8111-111111111111";
const LEARNER_A = "22222222-2222-4222-8222-222222222222";
const LEARNER_B = "33333333-3333-4333-8333-333333333333";
const LEARNER_C = "44444444-4444-4444-8444-444444444444";
const dict = getDictionary("en");
const RESIDUE = { tests: 0, questions: 0, attempts: 0, answers: 0, drafts: 0, versions: 0, users: 0 };

type Database = Awaited<ReturnType<typeof createTestDatabase>>;

async function learner(query: Database["query"], name: string, id: string) {
  await query(`insert into users (id, name, role, account_status) values ($1, $2, 'student', 'active')`, [id, name]);
  return id;
}

function sectionPayload(marker: string) {
  return {
    audioType: "audio" as const,
    difficultyLevel: "B2",
    audioUrl: `${marker}.mp3`,
    sectionNo: 2,
    questions: [
      { type: "sentence_completion", questionText: `${marker}: the museum opens at ____.`, correctAnswer: "nine", explanation: `${marker} evidence one.` },
      { type: "sentence_completion", questionText: `${marker}: the tour costs ____ pounds.`, correctAnswer: "twenty", explanation: `${marker} evidence two.` },
    ],
  };
}

test("R1–R7 a revised section: the live set, an open attempt, a new attempt and history all stay correct", async () => {
  const database = await createTestDatabase();
  const { db, query } = database;
  try {
    await learner(query, "Sequence A", LEARNER_A);
    await learner(query, "Sequence B", LEARNER_B);
    await learner(query, "Sequence C", LEARNER_C);
    const owner: AuthoringActor = { id: OWNER, role: "owner", mayPublish: true };
    await query(`insert into users (id, name, role, account_status) values ($1, 'Sequence owner', 'owner', 'active')`, [OWNER]);

    // ---- v1 authored and published ----
    const v1 = await db.transaction((tx) =>
      saveContentDraft(tx, { actor: owner, module: "listening", contentType: "section", sourceRef: "sequence-section", title: "Sequence Section", payload: sectionPayload("v1") }),
    );
    assert.equal(v1.ok, true, JSON.stringify(v1));
    if (!v1.ok) return;
    const targetId = v1.version.targetId!;
    await db.transaction((tx) => publishContentVersion(tx, { actor: owner, versionId: v1.version.id, to: "published", publishAt: null }));

    // Learner A opens the section and answers question 1.
    const aView = await loadSectionExercise(targetId, { id: LEARNER_A, role: "student" }, dict, db);
    assert.ok(aView && aView.kind === "exercise");
    if (!aView || aView.kind !== "exercise") return;
    const v1QuestionIds = aView.questions.map((question) => question.id);
    assert.deepEqual(aView.questions.map((question) => question.text), ["v1: the museum opens at ____.", "v1: the tour costs ____ pounds."]);

    // Learner B opens the SAME section: their OWN attempt, their own (empty) answers.
    const bView = await loadSectionExercise(targetId, { id: LEARNER_B, role: "student" }, dict, db);
    assert.ok(bView && bView.kind === "exercise");
    if (!bView || bView.kind !== "exercise") return;
    assert.notEqual(bView.attemptId, aView.attemptId, "each learner has their own attempt");
    await db.insert(listeningDrafts).values({ attemptId: aView.attemptId, answers: { [v1QuestionIds[0]!]: "nine" }, audioPosition: 7 });

    // ---- v2 saved as a DRAFT (not published) ----
    const v2 = await db.transaction((tx) =>
      saveContentDraft(tx, { actor: owner, module: "listening", contentType: "section", sourceRef: "sequence-section", title: "Sequence Section v2", payload: sectionPayload("v2") }),
    );
    assert.equal(v2.ok, true, JSON.stringify(v2));
    if (!v2.ok) return;

    // R1/R2 — the live set is untouched and both learners keep exactly what they had.
    const aDuringDraft = await loadSectionExercise(targetId, { id: LEARNER_A, role: "student" }, dict, db);
    assert.equal(aDuringDraft?.kind, "exercise");
    if (aDuringDraft?.kind !== "exercise") return;
    assert.equal(aDuringDraft.attemptId, aView.attemptId, "the open attempt is the same attempt");
    assert.deepEqual(aDuringDraft.questions.map((question) => question.id), v1QuestionIds, "the learner keeps v1's question rows");
    assert.deepEqual(aDuringDraft.initial, { [v1QuestionIds[0]!]: "nine" }, "the saved answer survives the draft save");
    assert.equal(aDuringDraft.audioPosition, 7, "the saved audio position survives the draft save");
    assert.equal(JSON.stringify(aDuringDraft).includes("v2:"), false, "no word of the draft reaches a learner");

    // ---- v2 PUBLISHED ----
    await db.transaction((tx) => publishContentVersion(tx, { actor: owner, versionId: v2.version.id, to: "published", publishAt: null }));

    // R3 — the learner who is still working keeps v1.
    const aAfterPublish = await loadSectionExercise(targetId, { id: LEARNER_A, role: "student" }, dict, db);
    assert.equal(aAfterPublish?.kind, "exercise");
    if (aAfterPublish?.kind !== "exercise") return;
    assert.equal(aAfterPublish.attemptId, aView.attemptId);
    assert.deepEqual(aAfterPublish.questions.map((question) => question.id), v1QuestionIds, "an in-progress attempt stays on its own set");
    assert.deepEqual(aAfterPublish.initial, { [v1QuestionIds[0]!]: "nine" });

    // R4 — a learner starting now gets v2, with v2's OWN question rows.
    const cView = await loadSectionExercise(targetId, { id: LEARNER_C, role: "student" }, dict, db);
    assert.ok(cView && cView.kind === "exercise");
    if (!cView || cView.kind !== "exercise") return;
    const v2QuestionIds = cView.questions.map((question) => question.id);
    assert.deepEqual(cView.questions.map((question) => question.text), ["v2: the museum opens at ____.", "v2: the tour costs ____ pounds."]);
    assert.equal(v2QuestionIds.some((id) => v1QuestionIds.includes(id)), false, "v2's questions are new rows, not v1's relabelled");

    // The new learner submits against v2 and is graded on v2's keys.
    const submitted = await submitListeningAttempt(
      LEARNER_C,
      cView.attemptId,
      v2QuestionIds.map((id, index) => ({ questionId: id, answer: index === 0 ? "nine" : "twenty" })),
      db,
    );
    assert.ok(!("error" in submitted), JSON.stringify(submitted));
    const [cAttempt] = await db.select().from(listeningAttempts).where(eq(listeningAttempts.id, cView.attemptId));
    assert.equal(cAttempt!.score, 2, "v2 grades against v2's keys");
    assert.equal(cAttempt!.contentVersionId, v2.version.id, "the attempt records the revision it read");

    // R5 — the v1 learner's finished attempt still reads v1.
    const aFinished = await loadSectionExercise(targetId, { id: LEARNER_A, role: "student" }, dict, db);
    assert.equal(aFinished?.kind, "exercise", "A is still working in v1 — the publication did not close their attempt");
    const aSubmit = await submitListeningAttempt(LEARNER_A, aView.attemptId, [{ questionId: v1QuestionIds[0]!, answer: "nine" }], db);
    assert.ok(!("error" in aSubmit), JSON.stringify(aSubmit));
    const aResult = await loadSectionExercise(targetId, { id: LEARNER_A, role: "student" }, dict, db);
    assert.equal(aResult?.kind, "result", "A now sees their own result");
    if (aResult?.kind !== "result") return;
    assert.equal(aResult.score, 1, "A was graded on v1's set");
    assert.equal(aResult.total, 2);
    assert.deepEqual([...aResult.questions.map((question) => question.id)].sort(), [...v1QuestionIds].sort(), "A's review reads v1's questions");
    assert.ok(aResult.questions.every((question) => question.explanation.startsWith("v1")), "A's review reads v1's evidence");

    // R6 — isolation: each learner has exactly ONE attempt and only their own answers.
    const attempts = await db.select().from(listeningAttempts).where(eq(listeningAttempts.testId, targetId));
    assert.equal(attempts.length, 3, "one attempt per learner, never a shared one");
    const bAttempt = attempts.find((attempt) => attempt.userId === LEARNER_B)!;
    assert.equal(bAttempt.status, "in_progress", "B is still working");
    const bAnswers = await db.select().from(listeningAnswers).where(eq(listeningAnswers.attemptId, bAttempt.id));
    assert.equal(bAnswers.length, 0, "B never received A's answer");
    assert.equal(JSON.stringify(bAnswers).includes("nine"), false);
    // B's live view carries no note or highlight belonging to anyone else: those stores are
    // browser-local and keyed by attempt id (proven in tests/ui/listening-section-notes.test.tsx).
    const bLive = await loadSectionExercise(targetId, { id: LEARNER_B, role: "student" }, dict, db);
    assert.equal(bLive?.kind === "exercise" ? JSON.stringify(bLive.initial) : null, "{}", "B's answer state is their own");
  } finally {
    // R7 — fixtures removed, removal asserted.
    for (const userId of [LEARNER_A, LEARNER_B, LEARNER_C]) {
      const attempts = await db.select({ id: listeningAttempts.id }).from(listeningAttempts).where(eq(listeningAttempts.userId, userId));
      for (const attempt of attempts) {
        await db.delete(listeningAnswers).where(eq(listeningAnswers.attemptId, attempt.id));
        await db.delete(listeningDrafts).where(eq(listeningDrafts.attemptId, attempt.id));
      }
      await db.delete(listeningAttempts).where(eq(listeningAttempts.userId, userId));
    }
    const tests = await db.select({ id: listeningTests.id }).from(listeningTests);
    for (const row of tests) {
      await db.update(listeningQuestions).set({ contentVersionId: null }).where(eq(listeningQuestions.testId, row.id));
      await db.delete(listeningQuestions).where(eq(listeningQuestions.testId, row.id));
    }
    await query(`delete from content_versions`);
    await query(`delete from listening_tests`);
    await query(`delete from users where id in ($1, $2, $3, $4)`, [OWNER, LEARNER_A, LEARNER_B, LEARNER_C]);

    const [residue] = await query<typeof RESIDUE>(`
      select
        (select count(*)::int from listening_tests) tests,
        (select count(*)::int from listening_questions) questions,
        (select count(*)::int from listening_attempts) attempts,
        (select count(*)::int from listening_answers) answers,
        (select count(*)::int from listening_drafts) drafts,
        (select count(*)::int from content_versions) versions,
        (select count(*)::int from users) users`);
    assert.deepEqual(residue, RESIDUE, "no fixture row remains");
    await database.close();
  }
});

test("R8 an attempt is per learner per section: re-opening the same section never creates a second one", async () => {
  const database = await createTestDatabase();
  try {
    const { db, query } = database;
    await learner(query, "Repeat learner", LEARNER_A);
    const owner: AuthoringActor = { id: OWNER, role: "owner", mayPublish: true };
    await query(`insert into users (id, name, role, account_status) values ($1, 'Repeat owner', 'owner', 'active')`, [OWNER]);

    const saved = await db.transaction((tx) =>
      saveContentDraft(tx, { actor: owner, module: "listening", contentType: "section", sourceRef: "repeat-section", title: "Repeat Section", payload: sectionPayload("r") }),
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    const targetId = saved.version.targetId!;
    await db.transaction((tx) => publishContentVersion(tx, { actor: owner, versionId: saved.version.id, to: "published", publishAt: null }));

    const first = await startListeningAttempt(LEARNER_A, targetId, db);
    const second = await startListeningAttempt(LEARNER_A, targetId, db);
    assert.equal(first, second, "starting the same section again resumes the open attempt");
    const rows = await db.select().from(listeningAttempts).where(eq(listeningAttempts.testId, targetId));
    assert.equal(rows.length, 1, "exactly one attempt row");
  } finally {
    await database.query(`delete from listening_attempts where user_id = $1`, [LEARNER_A]);
    await database.query(`update listening_questions set content_version_id = null`);
    await database.query(`delete from listening_questions`);
    await database.query(`delete from content_versions`);
    await database.query(`delete from listening_tests`);
    await database.query(`delete from users where id in ($1, $2)`, [OWNER, LEARNER_A]);
    await database.close();
  }
});
