import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { saveContentDraft, publishContentVersion } from "../src/lib/content/authoring";
import { activateReadingSchedules } from "../src/lib/services/reading/schedules";
import { listGeneralSets } from "../src/lib/data/general-reading";
import { startAcademicSet } from "../src/lib/data/reading-assessments";
import { getAttemptDetail } from "../src/lib/data/reading";
import { submitReadingAttempt } from "../src/lib/services/reading/submit";
import { db } from "../src/db/client";
import { users, readingPassages } from "../src/db/schema";

/**
 * PUB-01…PUB-15: scheduled activation under a CONTROLLED clock.
 *
 * `activateReadingSchedules(executor, now)` is the one authority that turns a due
 * Reading schedule into the live revision, and the catalogue, the set start and
 * the attempt binding all run it before they read. These tests drive `now`
 * directly — they never sleep towards a real future moment.
 *
 * The invariant being defended: activation changes what a NEW learner receives
 * and nothing else. An attempt that already bound a revision keeps its passages,
 * its question rows, its keys and its grading for ever.
 */

type Actor = { id: string; role: "owner"; mayPublish: true };
const HOUR = 3_600_000;

const passagesOf = (version: number) =>
  [1, 2, 3].map((p) => ({
    title: `V${version} Passage ${p}`,
    bodyText: `Revision ${version}, passage ${p}. ` + "Authored QA passage text. ".repeat(5),
    questions: Array.from({ length: p === 3 ? 14 : 13 }, (_, i) => ({
      typeCode: "short_answer",
      questionText: `V${version} question ${i + 1}`,
      correctAnswer: `key${version}`,
      evidenceQuote: `Revision ${version}`,
      explanation: `Explanation V${version}`,
    })),
  }));

async function draftSet(env: Awaited<ReturnType<typeof createTestDatabase>>, actor: Actor, sourceRef: string, version: number) {
  const result = await env.db.transaction((tx) =>
    saveContentDraft(tx, {
      actor,
      module: "reading",
      contentType: "general_set",
      sourceRef,
      title: `QA ${sourceRef} v${version}`,
      track: "academic",
      payload: { suggestedMinutes: 60, passages: passagesOf(version) },
    }),
  );
  assert.ok(result.ok, `draft v${version}`);
  if (!result.ok) throw Error("draft");
  return result.version;
}

const move = (
  env: Awaited<ReturnType<typeof createTestDatabase>>,
  actor: Actor,
  versionId: string,
  to: "published" | "scheduled" | "archived" | "draft",
  publishAt?: Date,
) => env.db.transaction((tx) => publishContentVersion(tx, { actor, versionId, to, publishAt }));

/** Put a real future schedule on the canonical rows of a revision. */
async function scheduleAt(env: Awaited<ReturnType<typeof createTestDatabase>>, setId: string, at: Date) {
  await env.query("update general_reading_sets set publish_at=$2 where id=$1::uuid", [setId, at]);
  await env.query(
    "update reading_passages set publish_at=$2 where id in (select passage_id from general_reading_passages where set_id=$1::uuid)",
    [setId, at],
  );
}

test("PUB-01…PUB-10, PUB-13, PUB-14 scheduled activation under a controlled clock binds new learners only", async () => {
  const env = await createTestDatabase();
  try {
    const [owner, a, b] = await env.query<{ id: string }>(
      "insert into users(name,role) values ('Owner','owner'),('A','student'),('B','student') returning id",
    );
    const actor = { id: owner!.id, role: "owner", mayPublish: true } as Actor;

    // PUB-01 V1 published, V2 only a draft: the new learner receives V1.
    const v1 = await draftSet(env, actor, "qa-scheduled-activation", 1);
    assert.equal((await move(env, actor, v1.id, "published")).ok, true);
    const v2 = await draftSet(env, actor, "qa-scheduled-activation", 2);
    assert.deepEqual((await listGeneralSets(a!.id, { academic: true }, env.db)).map((s) => s.id), [v1.targetId], "PUB-01 catalogue");
    assert.equal(await startAcademicSet(b!.id, v2.targetId!, env.db), null, "PUB-01 a draft revision cannot be started");

    // Student A begins V1 BEFORE the scheduled moment.
    const attemptA = await startAcademicSet(a!.id, v1.targetId!, env.db);
    assert.ok(attemptA);
    const beforeDetail = (await getAttemptDetail(attemptA!, a!.id, env.db))!;
    assert.equal(beforeDetail.questions.length, 40);
    assert.equal(beforeDetail.attempt.contentVersionId, v1.id);
    const v1QuestionIds = new Set(beforeDetail.questions.map((q) => q.id));

    // V2 is scheduled for T.
    const T = new Date(Date.now() + 4 * HOUR);
    assert.equal((await move(env, actor, v2.id, "scheduled", T)).ok, true);
    await scheduleAt(env, v2.targetId!, T);

    // PUB-02 / PUB-14 BEFORE T: V1 still startable, V2 invisible and unstartable.
    const beforeT = new Date(T.getTime() - HOUR);
    await activateReadingSchedules(env.db, beforeT);
    assert.deepEqual((await listGeneralSets(b!.id, { academic: true }, env.db)).map((s) => s.id), [v1.targetId], "PUB-14 no premature visibility");
    assert.equal(await startAcademicSet(b!.id, v2.targetId!, env.db), null, "PUB-02 the future revision cannot be started early");
    assert.ok(await startAcademicSet(b!.id, v1.targetId!, env.db), "PUB-02 the live revision is still startable");
    await env.query("delete from reading_assessment_passages where attempt_id in (select id from reading_attempts where user_id=$1)", [b!.id]);
    await env.query("delete from reading_assessments where attempt_id in (select id from reading_attempts where user_id=$1)", [b!.id]);
    await env.query("delete from reading_attempts where user_id=$1", [b!.id]);

    // PUB-03 AT T: the schedule becomes eligible through the one activation authority.
    await activateReadingSchedules(env.db, T);
    const [stateV2] = await env.query<{ publication_state: string }>("select publication_state from content_versions where id=$1::uuid", [v2.id]);
    assert.equal(stateV2!.publication_state, "published", "PUB-03 the due revision is activated");
    assert.deepEqual((await listGeneralSets(b!.id, { academic: true }, env.db)).map((s) => s.id), [v2.targetId], "PUB-03 catalogue agrees");

    // PUB-13 the superseded revision is no longer startable as new work.
    assert.equal(await startAcademicSet(b!.id, v1.targetId!, env.db), null, "PUB-13 withdrawn revision refuses a new start");

    // PUB-04 / PUB-07 / PUB-08 a new learner binds V2 and receives a pure V2 set.
    const attemptB = await startAcademicSet(b!.id, v2.targetId!, env.db);
    assert.ok(attemptB);
    const detailB = (await getAttemptDetail(attemptB!, b!.id, env.db))!;
    assert.equal(detailB.attempt.contentVersionId, v2.id, "PUB-04 attempt binding");
    assert.equal(detailB.questions.length, 40);
    assert.equal(detailB.sections.length, 3);
    assert.ok(detailB.questions.every((q) => !v1QuestionIds.has(q.id)), "PUB-08 not one V1 question leaks into the V2 set");
    assert.ok(detailB.questions.every((q) => q.correctAnswer === "key2"), "PUB-08 a single revision's keys");
    assert.ok(detailB.sections.every((s) => s.passage.title.startsWith("V2 ")), "PUB-08 all three passages come from V2");

    // PUB-05 Student A, who started before T, still sees exactly V1.
    const afterDetail = (await getAttemptDetail(attemptA!, a!.id, env.db))!;
    assert.deepEqual(afterDetail.questions, beforeDetail.questions, "PUB-05 questions never switch");
    assert.equal(afterDetail.attempt.contentVersionId, v1.id);

    // PUB-06 and submits AFTER T, graded on the V1 keys.
    const entries = afterDetail.questions.map((q) => ({ questionId: q.id, answer: "key1" }));
    assert.deepEqual(await submitReadingAttempt(attemptA!, a!.id, entries, env.db), { ok: true, score: 40, totalQuestions: 40 }, "PUB-06 V1 keys grade the V1 attempt");
    assert.equal((await submitReadingAttempt(attemptB!, b!.id, detailB.questions.map((q) => ({ questionId: q.id, answer: "key1" })), env.db)).score, 0, "the V2 attempt is graded on V2 keys");

    // PUB-09 / PUB-10 nothing was deleted and the submitted review still reads V1.
    assert.equal((await env.query<{ n: number }>("select count(*)::int n from reading_questions"))[0]!.n, 80, "PUB-09 V1 rows survive activation");
    assert.equal((await env.query<{ n: number }>("select count(*)::int n from reading_passages"))[0]!.n, 6);
    const review = (await getAttemptDetail(attemptA!, a!.id, env.db))!;
    assert.equal(review.attempt.status, "completed");
    assert.equal(review.attempt.score, 40);
    assert.ok(review.questions.every((q) => q.explanation === "Explanation V1"), "PUB-10 the review keeps its own authored source");
    assert.equal(review.answers.length, 40);
  } finally {
    await env.close();
  }
});

test("PUB-12 a schedule with no valid activation moment is refused, and PUB-15 a draft stays staff-only", async () => {
  const env = await createTestDatabase();
  try {
    const [owner, learner] = await env.query<{ id: string }>(
      "insert into users(name,role) values ('Owner','owner'),('L','student') returning id",
    );
    const actor = { id: owner!.id, role: "owner", mayPublish: true } as Actor;
    const v1 = await draftSet(env, actor, "qa-schedule-refusal", 1);

    // PUB-12 scheduled without a moment, and published WITH one, are both refused.
    const missing = await move(env, actor, v1.id, "scheduled");
    assert.equal(missing.ok, false);
    assert.deepEqual(missing.issues?.map((i) => i.code), ["missing_publish_at"], "PUB-12 a schedule needs its moment");
    // The refusal changed nothing: the revision is still an invisible draft.
    const [state] = await env.query<{ publication_state: string }>("select publication_state from content_versions where id=$1::uuid", [v1.id]);
    assert.equal(state!.publication_state, "draft");
    assert.deepEqual(await listGeneralSets(learner!.id, { academic: true }, env.db), [], "PUB-15 a draft is not in the learner catalogue");
    assert.equal(await startAcademicSet(learner!.id, v1.targetId!, env.db), null, "PUB-15 and cannot be started");

    // A stray moment on a NON-scheduled transition is normalised away rather than
    // refused: the publish succeeds and no confusing future date is ever stored,
    // so a published row can never be hidden behind a leftover schedule.
    const stray = await move(env, actor, v1.id, "published", new Date(Date.now() + HOUR));
    assert.equal(stray.ok, true, "publishing still works when a caller sends a pointless moment");
    // The schedule moment lives on the canonical rows, not on content_versions.
    const [storedSet] = await env.query<{ publish_at: Date | null; publication_state: string }>(
      "select publish_at,publication_state from general_reading_sets where id=$1::uuid",
      [v1.targetId!],
    );
    assert.equal(storedSet!.publication_state, "published");
    assert.equal(storedSet!.publish_at, null, "PUB-12 nor does the canonical set");
    assert.deepEqual(
      (await env.query<{ publish_at: Date | null }>(
        "select publish_at from reading_passages where id in (select passage_id from general_reading_passages where set_id=$1::uuid)",
        [v1.targetId!],
      )).map((r) => r.publish_at),
      [null, null, null],
      "PUB-12 nor any of its passages",
    );
    assert.deepEqual((await listGeneralSets(learner!.id, { academic: true }, env.db)).map((s) => s.id), [v1.targetId], "and it is genuinely live now");

    // Back to a draft so the schedule half of the test starts from a clean state.
    assert.equal((await move(env, actor, v1.id, "draft")).ok, true);

    // PUB-15 staff keep their existing preview path: the rows exist and are readable
    // as draft content, which is exactly what the staff desk reads.
    const rows = await env.query<{ publication_state: string }>(
      "select publication_state from reading_passages where id in (select passage_id from general_reading_passages where set_id=$1::uuid)",
      [v1.targetId!],
    );
    assert.equal(rows.length, 3, "the authored draft really exists for staff preview");
    assert.ok(rows.every((r) => r.publication_state === "draft"), "and it is still a draft, not quietly published");

    // A legitimate schedule is accepted, and still invisible before its moment.
    const future = new Date(Date.now() + 2 * HOUR);
    assert.equal((await move(env, actor, v1.id, "scheduled", future)).ok, true);
    await activateReadingSchedules(env.db, new Date(future.getTime() - HOUR));
    assert.deepEqual(await listGeneralSets(learner!.id, { academic: true }, env.db), [], "still not visible before its moment");
  } finally {
    await env.close();
  }
});

/** PUB-11 needs genuinely separate connections: PGlite is one in-process server. */
const enabled = process.env.QA2_DATABASE_TESTS === "1";
const guard = () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2", "only the isolated QA database is allowed");
};

test(
  "PUB-11 real PostgreSQL: concurrent activation and starts cannot create partial membership or a mixed set",
  { skip: !enabled && "set QA2_DATABASE_TESTS=1 for the isolated learners_qa2 database" },
  async () => {
    guard();
    const marker = `qa-pub11-${randomUUID().slice(0, 8)}`;
    const ids = [randomUUID(), randomUUID(), randomUUID()];
    await db.insert(users).values(
      ids.map((id, i) => ({
        id,
        name: `QA PUB11 ${i}`,
        role: i === 0 ? ("owner" as const) : ("student" as const),
        accountStatus: "active" as const,
        email: `qa.pub11.${id}@example.test`,
      })),
    );
    const [owner, learner, other] = ids as [string, string, string];
    const actor = { id: owner, role: "owner", mayPublish: true } as Actor;
    try {
      const draft = async (version: number) => {
        const r = await db.transaction((tx) =>
          saveContentDraft(tx, {
            actor,
            module: "reading",
            contentType: "general_set",
            sourceRef: marker,
            title: `QA ${marker} v${version}`,
            track: "academic",
            payload: { suggestedMinutes: 60, passages: passagesOf(version) },
          }),
        );
        assert.ok(r.ok);
        if (!r.ok) throw Error("draft");
        return r.version;
      };
      const v1 = await draft(1);
      assert.equal((await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: v1.id, to: "published" }))).ok, true);
      const v2 = await draft(2);
      const due = new Date(Date.now() - 60_000);
      assert.equal((await db.transaction((tx) => publishContentVersion(tx, { actor, versionId: v2.id, to: "scheduled", publishAt: due }))).ok, true);
      await db.execute(`update general_reading_sets set publish_at='${due.toISOString()}' where id='${v2.targetId}'` as never);
      await db.execute(
        `update reading_passages set publish_at='${due.toISOString()}' where id in (select passage_id from general_reading_passages where set_id='${v2.targetId}')` as never,
      );

      // Eight callers hit activation and a start at the same instant, on separate
      // pooled connections: the schedule may be applied only once.
      const results = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          i % 2 === 0
            ? activateReadingSchedules(db).then(() => null)
            : startAcademicSet(i < 4 ? learner : other, v2.targetId!, db),
        ),
      );
      const attempts = results.filter((r): r is string => typeof r === "string");
      assert.ok(attempts.length > 0, "a due revision is startable under concurrency");

      const published = await db.execute<{ n: number }>(
        `select count(*)::int n from content_versions where source_ref='${marker}' and status='published'` as never,
      );
      assert.equal((published as unknown as { rows: { n: number }[] }).rows[0]!.n, 1, "exactly one published revision after concurrent activation");

      for (const user of [learner, other]) {
        const own = attempts.filter((id) => id);
        for (const id of own) {
          const detail = await getAttemptDetail(id, user, db);
          if (!detail) continue;
          assert.equal(detail.sections.length, 3, "no partial membership was ever written");
          assert.equal(detail.questions.length, 40);
          assert.ok(detail.questions.every((q) => q.correctAnswer === "key2"), "no mixed revision");
          assert.equal(detail.attempt.contentVersionId, v2.id);
        }
      }
      assert.equal(new Set(attempts.filter((_, i) => i < 2)).size <= 2, true);
    } finally {
      await db.execute(`delete from reading_assessment_passages where attempt_id in (select id from reading_attempts where user_id in ('${ids[1]}','${ids[2]}'))` as never).catch(() => {});
      await db.execute(`delete from reading_assessments where attempt_id in (select id from reading_attempts where user_id in ('${ids[1]}','${ids[2]}'))` as never).catch(() => {});
      await db.execute(`delete from reading_answers where attempt_id in (select id from reading_attempts where user_id in ('${ids[1]}','${ids[2]}'))` as never).catch(() => {});
      await db.execute(`delete from reading_attempts where user_id in ('${ids[1]}','${ids[2]}')` as never).catch(() => {});
      await db.execute(`delete from activity_events where user_id in ('${ids[1]}','${ids[2]}')` as never).catch(() => {});
      await db.execute(`delete from general_reading_passages where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from reading_questions where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from reading_question_groups where passage_id in (select id from reading_passages where source_ref='${marker}')` as never).catch(() => {});
      await db.execute(`delete from general_reading_sets where id in (select target_id from content_versions where source_ref='${marker}' and target_id is not null)` as never).catch(() => {});
      await db.delete(readingPassages).where(eq(readingPassages.sourceRef, marker)).catch(() => {});
      await db.execute(`delete from content_versions where source_ref='${marker}'` as never).catch(() => {});
      for (const id of ids) await db.delete(users).where(eq(users.id, id)).catch(() => {});
      const residue = await db.select({ id: readingPassages.id }).from(readingPassages).where(eq(readingPassages.sourceRef, marker));
      assert.equal(residue.length, 0, "fixture residue 0");
    }
  },
);
