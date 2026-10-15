import test from "node:test";
import assert from "node:assert/strict";
import {
  createRetentionText, permanentlyDeleteRetentionText,
  setRetentionTextActive, getRetentionTextDetail,
} from "../src/lib/data/retention-bank";
import {
  startOrResumeAttempt, submitAttempt, listRetentionHistory,
  getRetentionHistoryRow, findAttemptForUser,
} from "../src/lib/data/retention-attempts";
import { buildAttemptPayload } from "../src/lib/retention/payload";
import { RetentionError } from "../src/lib/retention/errors";
import { bodyOfWords, createTestDatabase, simpleStructure } from "./support/pglite";

test("hard deletion removes source and versions but keeps completed scores and history", async () => {
  const database = await createTestDatabase();
  try {
    const [owner, student] = await database.query<{ id: string }>(`
      insert into users(name,role,account_status,email)
      values ('Delete QA owner','owner','active','retention.delete.owner@example.test'),
             ('Delete QA student','student','active','retention.delete.student@example.test')
      returning id
    `);
    const created = await createRetentionText({
      level: "A2", bodyText: bodyOfWords(110),
      scoringStructure: simpleStructure("delete"), actorUserId: owner.id,
    }, database.db);
    const time = new Date("2026-10-15T09:00:00.000Z");
    const start = await startOrResumeAttempt({ userId: student.id, level: "A2", now: time }, database.db);

    await assert.rejects(
      () => permanentlyDeleteRetentionText({ textId: created.textId, actorUserId: owner.id }, database.db),
      (error: unknown) => error instanceof RetentionError && error.code === "retention_conflict",
      "a live learner must not lose their scoring source",
    );
    assert.ok(await getRetentionTextDetail(created.textId, database.db));

    const done = await submitAttempt({
      attemptId: start.attempt.id, userId: student.id,
      recallText: "The company was founded in 1998 by two students.",
      now: new Date(time.getTime() + 200_000),
    }, database.db);
    assert.equal(done.attempt.status, "completed");
    assert.equal(done.attempt.score, 100);
    const before = await getRetentionHistoryRow({ attemptId: start.attempt.id, userId: student.id }, database.db);

    const deleted = await permanentlyDeleteRetentionText({ textId: created.textId, actorUserId: owner.id }, database.db);
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.preservedAttempts, 1);
    assert.equal(await getRetentionTextDetail(created.textId, database.db), null);

    const rows = await database.query<{
      retention_text_id: string | null; retention_text_version_id: string | null;
      retention_label_snapshot: string; score: number; recall_text: string;
    }>(
      "select retention_text_id,retention_text_version_id,retention_label_snapshot,score,recall_text from retention_attempts where id=$1",
      [start.attempt.id],
    );
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.retention_text_id, null);
    assert.equal(rows[0]!.retention_text_version_id, null);
    assert.equal(rows[0]!.retention_label_snapshot, created.internalLabel);
    assert.equal(rows[0]!.score, 100);
    assert.equal(rows[0]!.recall_text, done.attempt.recallText);

    const versions = await database.query("select id from retention_text_versions where retention_text_id=$1", [created.textId]);
    assert.equal(versions.length, 0);
    const after = await getRetentionHistoryRow({ attemptId: start.attempt.id, userId: student.id }, database.db);
    assert.deepEqual(after, before, "score and title must survive deletion unchanged");
    const history = await listRetentionHistory({ userId: student.id }, database.db);
    assert.equal(history.rows.length, 1);
    assert.equal(history.rows[0]!.score, 100);
    const attempt = await findAttemptForUser({ attemptId: start.attempt.id, userId: student.id }, database.db);
    const payload = await buildAttemptPayload(attempt, new Date(time.getTime() + 500_000), database.db);
    assert.equal(payload.phase, "completed");
    assert.equal(payload.label, created.internalLabel);
    await assert.rejects(
      () => permanentlyDeleteRetentionText({ textId: created.textId, actorUserId: owner.id }, database.db),
      (error: unknown) => error instanceof RetentionError && error.code === "retention_attempt_not_found",
    );
  } finally {
    await database.close();
  }
});

test("archived unused content is truly deleted; other retention texts remain", async () => {
  const database = await createTestDatabase();
  try {
    const [owner] = await database.query<{id:string}>(
      "insert into users(name,role,account_status,email) values('Archived QA owner','owner','active','retention.archive.owner@example.test') returning id"
    );
    const make = () => createRetentionText({
      level: "B1", bodyText: bodyOfWords(170),
      scoringStructure: simpleStructure("archive"), actorUserId: owner.id,
    }, database.db);
    const old = await make();
    const keep = await make();
    await setRetentionTextActive({ textId: old.textId, active: false, actorUserId: owner.id }, database.db);
    await permanentlyDeleteRetentionText({ textId: old.textId, actorUserId: owner.id }, database.db);
    assert.equal(await getRetentionTextDetail(old.textId, database.db), null);
    assert.ok(await getRetentionTextDetail(keep.textId, database.db));
  } finally {
    await database.close();
  }
});
