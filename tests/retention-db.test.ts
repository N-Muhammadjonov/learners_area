import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../src/db/client";
import { activityEvents, auditLog, lexemes, listeningAttempts, listeningTests, speakingAttempts, uploadIntents, userVocabulary, users } from "../src/db/schema";
import { monthsAgo, runRetention } from "../src/lib/services/retention";
import { attachRecordingToAttempt, cleanupAbandonedUploads } from "../src/lib/data/uploads";
import { getStorageService } from "../src/lib/services/storage";
import { applyScheduledReview, recordGameAnswer } from "../src/lib/services/vocabulary/engine";

const enabled = process.env.QA2_DATABASE_TESTS === "1";
function isolated() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname) && url.pathname === "/learners_qa2");
  assert.equal(process.env.STORAGE_PROVIDER, "local");
}

test("active vocabulary and listening learners survive stale activity clocks and old attempt start dates", { skip: !enabled }, async () => {
  isolated();
  const now = new Date();
  const old = monthsAgo(20, now);
  const ids = Array.from({ length: 4 }, () => randomUUID());
  const [vocab, listening, idle, staff] = ids as [string, string, string, string];
  const lexemeId = randomUUID();
  const testId = randomUUID();
  const attemptId = randomUUID();
  await db.insert(users).values(ids.map((id) => ({
    id, name: `QA2 activity ${id}`, role: id === staff ? "teacher" as const : "student" as const,
    accountStatus: "active" as const, createdAt: old, lastMeaningfulActivityAt: null,
  })));
  try {
    await db.insert(lexemes).values({ id: lexemeId, term: "retention fixture", definitionEn: "An isolated test word" });
    await db.insert(userVocabulary).values({ userId: vocab, lexemeId, createdAt: old, lastReviewedAt: now });
    await db.insert(listeningTests).values({ id: testId, createdByUserId: staff, title: "QA2 retention fixture", audioType: "link" });
    await db.insert(listeningAttempts).values([
      { id: attemptId, userId: listening, testId, status: "completed", startedAt: old, submittedAt: now },
      { userId: idle, testId, status: "in_progress", startedAt: now },
    ]);
    // A login, opened attempt, or feedback from a teacher is not learner work.
    await db.insert(activityEvents).values({ userId: idle, type: "TEACHER_FEEDBACK_RECEIVED", createdAt: now });
    await runRetention({ dryRun: false, now, actorUserId: staff });
    const accounts = await db.select().from(users).where(inArray(users.id, ids));
    for (const id of [vocab, listening]) {
      assert.equal(accounts.find((row) => row.id === id)?.accountStatus, "active", `${id === vocab ? "Vocabulary" : "Listening"} work must protect a learner with a stale clock`);
    }
    assert.equal(accounts.find((row) => row.id === idle)?.statusReason, "anonymised_by_retention", "genuine inactivity still expires");
    assert.equal((await db.select().from(listeningAttempts).where(eq(listeningAttempts.id, attemptId))).length, 1, "recently submitted work cannot expire using its old start date");
  } finally {
    await db.delete(auditLog).where(eq(auditLog.actorUserId, staff));
    await db.delete(listeningAttempts).where(inArray(listeningAttempts.userId, ids));
    await db.delete(listeningTests).where(eq(listeningTests.id, testId));
    await db.delete(users).where(inArray(users.id, ids));
    await db.delete(lexemes).where(eq(lexemes.id, lexemeId));
  }
});

test("retention owns a transaction lock; a concurrent runner does no work", { skip: !enabled }, async () => {
  isolated();
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('learners_area.retention'))`);
    const blocked = await runRetention({ dryRun: false });
    assert.equal(blocked.locked, false);
    assert.deepEqual(blocked.results.map((row) => row.rule), ["run"]);
  });
  await db.transaction(async (tx) => {
    const result = await tx.execute<{ got: boolean }>(sql`select pg_try_advisory_xact_lock(hashtext('learners_area.retention')) as got`);
    assert.equal(result.rows[0]?.got, true, "the lock was released by commit");
  });
});

test("a freshly attached recording on an old draft survives cleanup and duplicate attachment has one winner", { skip: !enabled }, async () => {
  isolated();
  const userId = randomUUID();
  const attemptId = randomUUID();
  const uploadId = randomUUID();
  const key = `qa2-retention/${randomUUID()}.webm`;
  const old = monthsAgo(20, new Date());
  const storage = getStorageService();
  await db.insert(users).values({ id: userId, name: "QA2 recording activity", role: "student", accountStatus: "active", createdAt: old });
  try {
    await db.insert(speakingAttempts).values({ id: attemptId, userId, part: "part1", createdAt: old });
    await storage.put({ key, body: Buffer.from("new"), contentType: "audio/webm" });
    await db.insert(uploadIntents).values({ id: uploadId, userId, speakingAttemptId: attemptId, purpose: "speaking_recording", objectKey: key, originalName: "new.webm", mimeType: "audio/webm", size: 3, status: "finalized", finalizedAt: new Date(), expiresAt: new Date(Date.now() + 900_000) });
    const results = await Promise.all(Array.from({ length: 4 }, () => attachRecordingToAttempt({ userId, attemptId, uploadId })));
    assert.equal(results.filter((r) => r.ok).length, 1, "only one request may consume an upload intent");
    await runRetention({ dryRun: false, actorUserId: userId });
    assert.equal((await db.query.users.findFirst({ where: eq(users.id, userId) }))?.accountStatus, "active", "real recording work counts before final submission");
    assert.equal((await db.query.speakingAttempts.findFirst({ where: eq(speakingAttempts.id, attemptId) }))?.recordingObjectKey, key);
    assert.ok(await storage.head(key), "new recording cannot expire with its old draft");
  } finally {
    await db.delete(auditLog).where(eq(auditLog.actorUserId, userId));
    await db.delete(users).where(eq(users.id, userId));
    await storage.delete(key);
  }
});

test("cleanup during a blocked audio attachment preserves the fresh object and commits one intact relationship", { skip: !enabled, timeout: 15_000 }, async () => {
  isolated();
  const userId = randomUUID();
  const attemptId = randomUUID();
  const uploadId = randomUUID();
  const key = `qa2-retention/${randomUUID()}.webm`;
  const old = monthsAgo(20, new Date());
  const storage = getStorageService();
  let attachment: ReturnType<typeof attachRecordingToAttempt> | undefined;
  await db.insert(users).values({ id: userId, name: "QA2 concurrent recording", role: "student", accountStatus: "active", createdAt: old });
  try {
    await db.insert(speakingAttempts).values({ id: attemptId, userId, part: "part1", createdAt: old });
    await storage.put({ key, body: Buffer.from("new"), contentType: "audio/webm" });
    await db.insert(uploadIntents).values({ id: uploadId, userId, speakingAttemptId: attemptId, purpose: "speaking_recording", objectKey: key, originalName: "new.webm", mimeType: "audio/webm", size: 3, status: "finalized", finalizedAt: new Date(), expiresAt: new Date(Date.now() + 900_000) });
    const startedAt = new Date();
    await db.transaction(async (lock) => {
      const owner = await lock.execute<{ pid: number }>(sql`select pg_backend_pid() as pid`);
      await lock.select().from(users).where(eq(users.id, userId)).for("update");
      attachment = attachRecordingToAttempt({ userId, attemptId, uploadId });
      // Observe an actual blocked PostgreSQL transaction, rather than assuming
      // a timer happened to overlap two requests. The attachment has already
      // locked the intent and attempt when it waits for this account row.
      let blocked = false;
      for (let tries = 0; tries < 100; tries++) {
        const waiting = await db.execute<{ waiting: boolean }>(sql`select exists (
          select 1 from pg_stat_activity where ${owner.rows[0]!.pid} = any(pg_blocking_pids(pid))
        ) as waiting`);
        if (waiting.rows[0]?.waiting) { blocked = true; break; }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert.ok(blocked, "attachment must be in flight at the database lock");
      const cleanup = await runRetention({ dryRun: false });
      assert.equal(cleanup.locked, true, "cleanup actually ran while attachment was paused");
      assert.ok(await storage.head(key));
      assert.equal((await db.query.uploadIntents.findFirst({ where: eq(uploadIntents.id, uploadId) }))?.status, "finalized", "cleanup must preserve the not-yet-committed intent");
    });
    assert.equal((await attachment)?.ok, true);
    await runRetention({ dryRun: false });
    const account = await db.query.users.findFirst({ where: eq(users.id, userId) });
    const intents = await db.select().from(uploadIntents).where(eq(uploadIntents.speakingAttemptId, attemptId));
    const attempts = await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, attemptId));
    assert.equal(account?.accountStatus, "active");
    assert.ok(account?.lastMeaningfulActivityAt && account.lastMeaningfulActivityAt >= startedAt);
    assert.equal(intents.length, 1);
    assert.equal(intents[0]?.status, "attached");
    assert.ok(intents[0]?.usedAt);
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0]?.recordingObjectKey, intents[0]?.objectKey);
    assert.ok(await storage.head(key));
  } finally {
    await attachment?.catch(() => undefined);
    await db.delete(users).where(eq(users.id, userId));
    await storage.delete(key);
  }
});

test("real SRS and wrong game answers count as activity; games cannot advance SRS or preserve stale accounts forever", { skip: !enabled }, async () => {
  isolated();
  const now = new Date();
  const old = monthsAgo(20, now);
  const id = randomUUID();
  const lexemeId = randomUUID();
  const entryId = randomUUID();
  await db.insert(users).values({ id, name: "QA2 review activity", role: "student", accountStatus: "active", createdAt: old });
  try {
    await db.insert(lexemes).values({ id: lexemeId, term: "fixture", definitionEn: "A test fixture" });
    await db.insert(userVocabulary).values({ id: entryId, userId: id, lexemeId, createdAt: old, nextReviewAt: old });
    assert.equal((await applyScheduledReview({ userId: id, entryId, outcome: "correct", now })).ok, true);
    const account = await db.query.users.findFirst({ where: eq(users.id, id) });
    assert.ok(account?.lastMeaningfulActivityAt && account.lastMeaningfulActivityAt >= now);
    const afterReview = await db.query.userVocabulary.findFirst({ where: eq(userVocabulary.id, entryId) });
    const game = await recordGameAnswer({ userId: id, entryId, setKey: "all", gameId: "race", submission: { kind: "spelling", text: "wrong" } });
    assert.equal(game.ok && game.correct, false);
    assert.equal(game.ok && game.awarded, 0);
    assert.deepEqual(await db.query.userVocabulary.findFirst({ where: eq(userVocabulary.id, entryId) }), afterReview, "practice never changes SRS");
    // Model a legacy/missed summary update: persisted practice remains evidence.
    await db.update(users).set({ lastMeaningfulActivityAt: null }).where(eq(users.id, id));
    await db.update(userVocabulary).set({ lastReviewedAt: old }).where(eq(userVocabulary.id, entryId));
    await db.execute(sql`update vocab_point_events set created_at = ${old} where user_id = ${id}`);
    await runRetention({ dryRun: false, now, actorUserId: id });
    assert.equal((await db.query.users.findFirst({ where: eq(users.id, id) }))?.accountStatus, "active");
    // No synthetic activity: once every real practice record is older than six
    // months, this same account must expire even though its vocabulary remains.
    await db.update(activityEvents).set({ createdAt: monthsAgo(7, now) }).where(eq(activityEvents.userId, id));
    await runRetention({ dryRun: false, now, actorUserId: id });
    assert.equal((await db.query.users.findFirst({ where: eq(users.id, id) }))?.statusReason, "anonymised_by_retention");
  } finally {
    await db.delete(auditLog).where(eq(auditLog.actorUserId, id));
    await db.delete(users).where(eq(users.id, id));
    await db.delete(lexemes).where(eq(lexemes.id, lexemeId));
  }
});

test("retention keeps failed object references and 18-month learning history, then retries safely", { skip: !enabled }, async () => {
  isolated();
  const now = new Date();
  const old = monthsAgo(20, now);
  const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const [active, dormant, boundary, staff] = ids as [string, string, string, string];
  const attemptId = randomUUID();
  const intentId = randomUUID();
  const orphanId = randomUUID();
  const eventIds = [randomUUID(), randomUUID()];
  const key = `qa2-retention/${randomUUID()}.webm`;
  const orphan = `qa2-retention/${randomUUID()}.webm`;
  const storage = getStorageService();
  const originalDelete = storage.delete.bind(storage);
  await db.insert(users).values([
    { id: active, name: "Retention fixture active", role: "student", accountStatus: "active", createdAt: old, lastMeaningfulActivityAt: now },
    { id: dormant, name: "Retention fixture dormant", role: "student", accountStatus: "active", createdAt: old },
    { id: boundary, name: "Retention fixture boundary", role: "student", accountStatus: "active", createdAt: monthsAgo(6, now) },
    { id: staff, name: "Retention fixture staff", role: "teacher", accountStatus: "active", createdAt: old },
  ]);
  try {
    await db.insert(activityEvents).values([
      { id: eventIds[0]!, userId: active, type: "vocabulary.reviewed", createdAt: monthsAgo(3, now) },
      { id: eventIds[1]!, userId: active, type: "vocabulary.reviewed", createdAt: old },
    ]);
    await db.insert(speakingAttempts).values({ id: attemptId, userId: active, part: "part1", recordingObjectKey: key, createdAt: old });
    await db.insert(uploadIntents).values([
      { id: intentId, userId: active, speakingAttemptId: attemptId, purpose: "speaking_recording", objectKey: key, originalName: "fixture.webm", mimeType: "audio/webm", size: 3, status: "attached", expiresAt: old, createdAt: old },
      { id: orphanId, userId: active, purpose: "speaking_recording", objectKey: orphan, originalName: "orphan.webm", mimeType: "audio/webm", size: 3, status: "pending", expiresAt: old, createdAt: old },
    ]);
    await storage.put({ key, body: Buffer.from("one"), contentType: "audio/webm" });
    await storage.put({ key: orphan, body: Buffer.from("two"), contentType: "audio/webm" });
    storage.delete = async (candidate) => {
      if (candidate === key || candidate === orphan) throw new Error("simulated storage outage");
      return originalDelete(candidate);
    };
    const preview = await runRetention({ dryRun: true, now, actorUserId: active });
    assert.equal(preview.dryRun, true);
    assert.equal((await db.select().from(activityEvents).where(inArray(activityEvents.id, eventIds))).length, 2);
    const first = await runRetention({ dryRun: false, now, actorUserId: active });
    assert.equal(first.locked, true);
    assert.equal((await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, attemptId)))[0]?.recordingObjectKey, key, "failed deletion must preserve the retryable attempt");
    assert.equal((await db.select().from(uploadIntents).where(eq(uploadIntents.id, orphanId)))[0]?.status, "aborted", "failed orphan cleanup retains its intent");
    assert.deepEqual((await db.select().from(activityEvents).where(inArray(activityEvents.id, eventIds))).map((row) => row.id), [eventIds[0]], "3-month academic history survives; 20-month history expires");
    const accounts = await db.select().from(users).where(inArray(users.id, ids));
    assert.equal(accounts.find((row) => row.id === dormant)?.name, "Former student");
    for (const id of [active, boundary, staff]) assert.equal(accounts.find((row) => row.id === id)?.accountStatus, "active");
    storage.delete = originalDelete;
    await runRetention({ dryRun: false, now, actorUserId: active });
    assert.equal(await storage.head(key), null);
    assert.equal(await storage.head(orphan), null);
    assert.equal((await db.select().from(speakingAttempts).where(eq(speakingAttempts.id, attemptId))).length, 0);
    assert.equal((await db.select().from(uploadIntents).where(inArray(uploadIntents.id, [intentId, orphanId]))).length, 0);
    const again = await cleanupAbandonedUploads();
    assert.equal(again.removedIntents, 0, "successful retry is idempotent");
  } finally {
    storage.delete = originalDelete;
    await originalDelete(key); await originalDelete(orphan);
    await db.delete(auditLog).where(eq(auditLog.actorUserId, active));
    await db.delete(users).where(inArray(users.id, ids));
  }
});
