import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { versionsForContent } from "./support/version-helpers";
import { saveContentDraft, publishContentVersion } from "../src/lib/content/authoring";
import { startAcademicSet } from "../src/lib/data/reading-assessments";
import { getAttemptDetail, saveDraftAnswers } from "../src/lib/data/reading";
import { listGeneralSets, saveGeneralProgress, generalProgress } from "../src/lib/data/general-reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { db } from "../src/db/client";
import { users, readingPassages, readingQuestions, readingAttempts } from "../src/db/schema";

/**
 * Historical safety invariants for Academic Reading revisions that the existing
 * R-V4-22 journey does not assert.
 *
 * The product rule under test: a published revision is IMMUTABLE for every
 * attempt that already bound it. A newer revision materialises its own canonical
 * rows and is withdrawn from new starts only — it never edits, re-keys or
 * deletes the rows an older attempt reads, and it never touches unrelated
 * Reading content or another learner's General progress.
 */

import { after, before } from "node:test";
import { createResidueGuard, finishResidueGuard, type ResidueGuard } from "./support/qa2-residue";

/*
 * Fixtures this file creates are removed when it finishes, exception-safely, and only rows that did
 * not exist when it started can be removed — so seeded records are unreachable by construction.
 * The QA2 database is shared by every gated file, so one file’s leftovers change what the next one
 * observes; this is what makes two consecutive runs against the same database meaningful.
 */
const QA2_RESIDUE_GUARD = process.env.QA2_DATABASE_TESTS === "1";
let qa2ResidueGuard: ResidueGuard | null = null;
before(async () => {
  if (!QA2_RESIDUE_GUARD) return;
  qa2ResidueGuard = await createResidueGuard("reading-v4-history-invariants");
  await qa2ResidueGuard.capture();
});
after(async () => {
  if (!qa2ResidueGuard) return;
  await finishResidueGuard("reading-v4-history-invariants", qa2ResidueGuard);
  qa2ResidueGuard = null;
});

type Actor = { id: string; role: "owner"; mayPublish: true };

const passagesOf = (version: number, keyPrefix: string) =>
  [1, 2, 3].map((p) => ({
    title: `V${version} Passage ${p}`,
    bodyText: `Revision ${version}, passage ${p}. ` + "Authored QA passage text. ".repeat(5),
    questions: Array.from({ length: p === 3 ? 14 : 13 }, (_, i) => ({
      typeCode: "short_answer",
      questionText: `V${version} question ${i + 1}`,
      correctAnswer: `${keyPrefix}${version}`,
      evidenceQuote: `Revision ${version}`,
      explanation: `Explanation V${version}`,
    })),
  }));

async function draftSet(
  env: Awaited<ReturnType<typeof createTestDatabase>>,
  actor: Actor,
  sourceRef: string,
  version: number,
  keyPrefix = "key",
) {
  const result = await env.db.transaction((tx) =>
    saveContentDraft(tx, {
      actor,
      module: "reading",
      contentType: "general_set",
      sourceRef,
      title: `QA ${sourceRef} version ${version}`,
      track: "academic",
      payload: { suggestedMinutes: 60, passages: passagesOf(version, keyPrefix) },
    }),
  );
  assert.ok(result.ok, `draft ${sourceRef} v${version} must save`);
  if (!result.ok) throw Error("draft");
  return result.version;
}

const publish = (env: Awaited<ReturnType<typeof createTestDatabase>>, actor: Actor, versionId: string) =>
  env.db.transaction((tx) => publishContentVersion(tx, { actor, versionId, to: "published" }));

async function seed(env: Awaited<ReturnType<typeof createTestDatabase>>) {
  const [owner, a, b] = await env.query<{ id: string }>(
    "insert into users(name,role) values ('Owner','owner'),('A','student'),('B','student') returning id",
  );
  return { actor: { id: owner!.id, role: "owner", mayPublish: true } as Actor, a: a!.id, b: b!.id };
}

test("RV-HIST-09 a replayed publication is a safe refused no-op: one active set, one membership, attempts untouched", async () => {
  const env = await createTestDatabase();
  try {
    const { actor, a, b } = await seed(env);
    const v1 = await draftSet(env, actor, "qa-idempotent", 1);
    assert.equal((await publish(env, actor, v1.id)).ok, true);

    const attempt = await startAcademicSet(a, v1.targetId!, env.db);
    assert.ok(attempt);
    const before = (await getAttemptDetail(attempt!, a, env.db))!;
    assert.equal(before.questions.length, 40);

    // Publishing the SAME version again (a retry, a double click, a replayed job).
    // The shared CMS contract refuses a no-op transition (`from === to`) for EVERY
    // module, so the retry is a safe refusal rather than a silent second publish.
    // What matters historically is that the refusal changes absolutely nothing.
    for (let i = 0; i < 3; i += 1) {
      const retry = await publish(env, actor, v1.id);
      assert.equal(retry.ok, false, "a replayed publication is refused, not applied twice");
      assert.deepEqual(
        retry.issues?.map((issue) => issue.code),
        ["publication_transition_refused"],
        "and it is refused for the explicit transition reason, not a crash",
      );
    }

    assert.deepEqual(
      (await listGeneralSets(b, { academic: true }, env.db)).map((s) => s.id),
      [v1.targetId],
      "one active catalogue row, never duplicated by a publication retry",
    );
    assert.equal(
      (await env.query<{ n: number }>("select count(*)::int n from general_reading_passages where set_id=$1", [v1.targetId!]))[0]!.n,
      3,
      "membership is not re-inserted",
    );
    assert.equal(
      (await env.query<{ n: number }>("select count(*)::int n from content_versions where source_ref='qa-idempotent' and status='published'"))[0]!.n,
      1,
      "exactly one published revision for the source",
    );
    assert.equal((await env.query<{ n: number }>("select count(*)::int n from reading_questions"))[0]!.n, 40, "no duplicated questions");
    assert.deepEqual((await getAttemptDetail(attempt!, a, env.db))!.questions, before.questions, "a republish cannot move a bound attempt");
    assert.equal(await startAcademicSet(a, v1.targetId!, env.db), attempt, "resume, never a second attempt");

    // A second revision published twice behaves the same way, and V1 is archived once.
    const v2 = await draftSet(env, actor, "qa-idempotent", 2);
    assert.equal((await publish(env, actor, v2.id)).ok, true);
    assert.equal((await publish(env, actor, v2.id)).ok, false, "the replay is refused here too");
    assert.deepEqual((await listGeneralSets(b, { academic: true }, env.db)).map((s) => s.id), [v2.targetId]);
    const statuses = (await versionsForContent("reading", "general_set", "qa-idempotent", env.db)).map((v) => v.status);
    assert.equal(statuses.filter((s) => s === "published").length, 1, "only the newest revision stays published");
    assert.deepEqual((await getAttemptDetail(attempt!, a, env.db))!.questions, before.questions, "V1 attempt still reads V1");
    assert.equal((await env.query<{ n: number }>("select count(*)::int n from reading_questions"))[0]!.n, 80, "both revisions retained");
  } finally {
    await env.close();
  }
});

test("RV-HIST-11 a legacy attempt with no revision binding keeps reading, saving, submitting and reviewing its own rows", async () => {
  const env = await createTestDatabase();
  try {
    const { actor, a } = await seed(env);
    const v1 = await draftSet(env, actor, "qa-legacy", 1);
    assert.equal((await publish(env, actor, v1.id)).ok, true);
    const bound = await startAcademicSet(a, v1.targetId!, env.db);
    assert.ok(bound);

    // A pre-V4 single-passage attempt: no content_version_id was ever recorded.
    const [passage] = await env.query<{ id: string }>(
      "select p.passage_id as id from general_reading_passages p where p.set_id=$1 order by p.passage_no limit 1",
      [v1.targetId!],
    );
    const [legacy] = await env.query<{ id: string; content_version_id: string | null }>(
      "insert into reading_attempts(user_id,passage_id) values ($1,$2) returning id, content_version_id",
      [a, passage!.id],
    );
    assert.equal(legacy!.content_version_id, null, "the fixture really is an unbound historical row");

    const detail = (await getAttemptDetail(legacy!.id, a, env.db))!;
    assert.ok(detail, "a legacy attempt is still readable");
    assert.equal(detail.attempt.contentVersionId, null, "no revision is invented for it");
    assert.equal(detail.sections.length, 1, "it keeps its own single-passage scope, not the three-passage set");
    assert.equal(detail.questions.length, 13);

    const entries = detail.questions.map((q) => ({ questionId: q.id, answer: "key1" }));
    assert.equal((await saveDraftAnswers(legacy!.id, a, entries, env.db)).saved, 13);
    const submitted = await submitReadingAttempt(legacy!.id, a, entries, env.db);
    assert.deepEqual(submitted, { ok: true, score: 13, totalQuestions: 13 });

    // Publishing a newer revision must not rewrite or orphan the legacy attempt.
    const v2 = await draftSet(env, actor, "qa-legacy", 2);
    assert.equal((await publish(env, actor, v2.id)).ok, true);
    const review = (await getAttemptDetail(legacy!.id, a, env.db))!;
    assert.equal(review.attempt.contentVersionId, null, "still truthfully unbound after a new publication");
    assert.equal(review.attempt.score, 13);
    assert.ok(review.questions.every((q) => q.explanation === "Explanation V1"), "it reviews its own authored source");
    assert.equal(review.answers.length, 13, "its answers survive the publication");
    assert.deepEqual((await getAttemptDetail(bound!, a, env.db))!.questions.length, 40, "the bound attempt is unaffected too");
  } finally {
    await env.close();
  }
});

test("RV-HIST-12 publishing a revision leaves unrelated Reading sources and General learning progress untouched", async () => {
  const env = await createTestDatabase();
  try {
    const { actor, a, b } = await seed(env);
    const other = await draftSet(env, actor, "qa-unrelated", 1, "other");
    assert.equal((await publish(env, actor, other.id)).ok, true);
    const target = await draftSet(env, actor, "qa-revised", 1);
    assert.equal((await publish(env, actor, target.id)).ok, true);

    const otherPassages = await env.query<{ passage_id: string }>(
      "select passage_id from general_reading_passages where set_id=$1 order by passage_no",
      [other.targetId!],
    );
    const otherRows = await env.query<{ id: string; publication_state: string; body_text: string }>(
      "select id,publication_state,body_text from reading_passages where id = any($1) order by id",
      [otherPassages.map((p) => p.passage_id)],
    );
    const otherQuestions = await env.query<{ id: string; correct_answer: string }>(
      "select id,correct_answer from reading_questions where passage_id = any($1) order by id",
      [otherPassages.map((p) => p.passage_id)],
    );

    // A learner is genuinely working inside the unrelated General set.
    const learningPassage = otherPassages[0]!.passage_id;
    const questionIds = (
      await env.query<{ id: string }>("select id from reading_questions where passage_id=$1 order by question_no limit 3", [learningPassage])
    ).map((r) => r.id);
    const answers = Object.fromEntries(questionIds.map((id, i) => [id, `draft answer ${i}`]));
    const saved = await saveGeneralProgress({ userId: b, role: "student", passageId: learningPassage, answers, check: false }, env.db);
    assert.ok(saved, "the learner's General progress is stored");
    const progressBefore = await generalProgress(b, other.targetId!, env.db);

    const attempt = await startAcademicSet(a, target.targetId!, env.db);
    assert.ok(attempt);

    // Now revise and publish ONLY the other source.
    const v2 = await draftSet(env, actor, "qa-revised", 2);
    assert.equal((await publish(env, actor, v2.id)).ok, true);

    assert.deepEqual(
      await env.query("select id,publication_state,body_text from reading_passages where id = any($1) order by id", [
        otherPassages.map((p) => p.passage_id),
      ]),
      otherRows,
      "unrelated passages keep their ids, publication state and text",
    );
    assert.deepEqual(
      await env.query("select id,correct_answer from reading_questions where passage_id = any($1) order by id", [
        otherPassages.map((p) => p.passage_id),
      ]),
      otherQuestions,
      "unrelated keys are untouched",
    );
    assert.deepEqual(await generalProgress(b, other.targetId!, env.db), progressBefore, "the learner's General progress survives");
    const catalogue = (await listGeneralSets(b, { academic: true }, env.db)).map((s) => s.id).sort();
    assert.deepEqual(catalogue, [other.targetId!, v2.targetId!].sort(), "the unrelated set is still offered");
    assert.deepEqual((await getAttemptDetail(attempt!, a, env.db))!.sections.length, 3);
  } finally {
    await env.close();
  }
});

/**
 * Real PostgreSQL, separate pooled connections. PGlite is one in-process server,
 * so a genuine race between a learner's write and a staff publication can only
 * be observed here.
 */
const enabled = process.env.QA2_DATABASE_TESTS === "1";
const guard = () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(
    ["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2",
    "only the isolated QA database is allowed",
  );
};

test(
  "RV-HIST-14 real PostgreSQL: concurrent start/autosave/submit against a concurrent publication stays consistent",
  { skip: !enabled && "set QA2_DATABASE_TESTS=1 for the isolated learners_qa2 database" },
  async () => {
    guard();
    const marker = `qa-hist14-${randomUUID().slice(0, 8)}`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await db.insert(users).values(
      ids.map((id, i) => ({
        id,
        name: `QA HIST14 ${i}`,
        role: i === 0 ? ("owner" as const) : ("student" as const),
        accountStatus: "active" as const,
        email: `qa.hist14.${id}@example.test`,
      })),
    );
    const [owner, learner, newcomer] = ids as [string, string, string];
    const actor = { id: owner, role: "owner", mayPublish: true } as Actor;
    const createdPassages: string[] = [];
    try {
      const v1 = await db.transaction((tx) =>
        saveContentDraft(tx, {
          actor,
          module: "reading",
          contentType: "general_set",
          sourceRef: marker,
          title: `QA ${marker} v1`,
          track: "academic",
          payload: { suggestedMinutes: 60, passages: passagesOf(1, "key") },
        }),
      );
      assert.ok(v1.ok);
      if (!v1.ok) throw Error("v1");
      assert.equal((await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: v1.version.id, to: "published" }))).ok, true);

      // Eight concurrent starts on separate connections: exactly one attempt.
      const started = await Promise.all(Array.from({ length: 8 }, () => startAcademicSet(learner, v1.version.targetId!, db)));
      assert.equal(new Set(started).size, 1, "concurrent starts resolve to ONE attempt");
      const attempt = started[0]!;
      assert.ok(attempt);
      const detail = (await getAttemptDetail(attempt, learner, db))!;
      assert.equal(detail.questions.length, 40);
      const entries = detail.questions.map((q) => ({ questionId: q.id, answer: "key1" }));

      // A learner autosaving and submitting WHILE staff publishes the next revision.
      const v2 = await db.transaction((tx) =>
        saveContentDraft(tx, {
          actor,
          module: "reading",
          contentType: "general_set",
          sourceRef: marker,
          title: `QA ${marker} v2`,
          track: "academic",
          payload: { suggestedMinutes: 60, passages: passagesOf(2, "key") },
        }),
      );
      assert.ok(v2.ok);
      if (!v2.ok) throw Error("v2");

      const [saves, publication, submits] = await Promise.all([
        Promise.all(Array.from({ length: 4 }, () => saveDraftAnswers(attempt, learner, entries, db))),
        db.transaction((tx) => publishContentVersion(tx, { actor, versionId: v2.version.id, to: "published" })),
        Promise.all(Array.from({ length: 4 }, () => submitReadingAttempt(attempt, learner, entries, db))),
      ]);
      assert.equal(publication.ok, true, "publication still succeeds under learner load");
      assert.ok(saves.every((s) => s.reason === "ok" || s.reason === "already_submitted"), "no autosave crashes or writes past submit");
      assert.equal(submits.filter((s) => s.ok).length, 1, "exactly one submit grades the attempt");

      const after = (await getAttemptDetail(attempt, learner, db))!;
      assert.equal(after.attempt.status, "completed");
      assert.equal(after.attempt.score, 40, "graded on its own V1 keys, not the newly published V2");
      assert.equal(after.answers.length, 40);
      assert.ok(after.answers.every((row) => row.isCorrect === true));
      assert.equal(after.attempt.contentVersionId, v1.version.id);
      assert.ok(after.questions.every((q) => q.explanation === "Explanation V1"));

      // A newcomer starting now gets V2 only, and cannot start the withdrawn V1.
      assert.equal(await startAcademicSet(newcomer, v1.version.targetId!, db), null);
      const fresh = await startAcademicSet(newcomer, v2.version.targetId!, db);
      assert.ok(fresh);
      assert.equal((await getAttemptDetail(fresh!, newcomer, db))!.attempt.contentVersionId, v2.version.id);
      assert.equal(await getAttemptDetail(attempt, newcomer, db), null, "cross-learner isolation holds");

      for (const version of [v1.version, v2.version]) {
        const snapshot = version.contentSnapshot as { canonicalPassageIds?: string[] } | null;
        for (const id of snapshot?.canonicalPassageIds ?? []) createdPassages.push(id);
      }
    } finally {
      // Exact-id cleanup of this test's own fixtures only.
      const attempts = await db.select({ id: readingAttempts.id }).from(readingAttempts).where(eq(readingAttempts.userId, ids[1]!));
      for (const row of attempts) await db.execute(`delete from reading_assessment_passages where attempt_id='${row.id}'` as never).catch(() => {});
      await db.execute(`delete from reading_assessments using reading_attempts r where reading_assessments.attempt_id=r.id and r.user_id in ('${ids[1]}','${ids[2]}')` as never).catch(() => {});
      await db.execute(`delete from reading_attempts where user_id in ('${ids[1]}','${ids[2]}')` as never).catch(() => {});
      await db.execute(`delete from activity_events where user_id in ('${ids[1]}','${ids[2]}')` as never).catch(() => {});
      await db.execute(`delete from general_reading_passages where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from reading_questions where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from reading_question_groups where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from general_reading_sets where id in (select target_id from content_versions where source_ref='${marker}' and target_id is not null)` as never).catch(() => {});
      await db.delete(readingQuestions).where(eq(readingQuestions.passageId, createdPassages[0] ?? randomUUID())).catch(() => {});
      await db.delete(readingPassages).where(eq(readingPassages.sourceRef, marker)).catch(() => {});
      await db.execute(`delete from content_versions where source_ref='${marker}'` as never).catch(() => {});
      await db.delete(users).where(eq(users.id, ids[0]!)).catch(() => {});
      await db.delete(users).where(eq(users.id, ids[1]!)).catch(() => {});
      await db.delete(users).where(eq(users.id, ids[2]!)).catch(() => {});
      const residue = await db.select({ id: readingPassages.id }).from(readingPassages).where(eq(readingPassages.sourceRef, marker));
      assert.equal(residue.length, 0, "fixture residue 0");
    }
  },
);
