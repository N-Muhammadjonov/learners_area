import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { finishReadingEarly, saveRecallDraft, startOrResumeAttempt, submitAttempt } from "../src/lib/data/retention-attempts";
import { buildAttemptPayload } from "../src/lib/retention/payload";
import { RetentionError } from "../src/lib/retention/errors";
import { RETENTION_LEVEL_CONFIG } from "../src/lib/retention/levels";
import { bodyOfWords, createTestDatabase, simpleStructure, type TestDatabase } from "./support/pglite";

/** N07: server-authoritative "I've finished" reading → recall (PGlite, real migrations). */
let database: TestDatabase;
let ownerId: string;
let learnerId: string;
let otherId: string;
const T0 = new Date("2026-06-01T08:00:00.000Z");
const at = (s: number) => new Date(T0.getTime() + s * 1000);
const MARKER = "zebrafinchmarker";

before(async () => {
  database = await createTestDatabase();
  const rows = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values
      ('O', 'owner', 'active', 'n07.owner@example.test'),
      ('L', 'student', 'active', 'n07.learner@example.test'),
      ('X', 'student', 'active', 'n07.other@example.test') returning id`
  );
  [ownerId, learnerId, otherId] = rows.map((r) => r.id) as [string, string, string];
  await createRetentionText({ level: "B2", bodyText: `${bodyOfWords(RETENTION_LEVEL_CONFIG.B2.targetWords)} ${MARKER}`, scoringStructure: simpleStructure(MARKER), actorUserId: ownerId }, database.db);
});
after(async () => { await database.close(); });

const isCode = (code: string) => (e: unknown) => e instanceof RetentionError && e.code === code;

test("finish-reading is owned, moves deadlines server-side, hides the source and is idempotent", async () => {
  const { attempt } = await startOrResumeAttempt({ userId: learnerId, level: "B2", now: T0 }, database.db);
  const reading = await buildAttemptPayload(attempt, at(10), database.db);
  assert.equal(reading.phase, "reading");

  await assert.rejects(finishReadingEarly({ attemptId: attempt.id, userId: otherId, now: at(30) }, database.db), isCode("retention_attempt_not_found"));

  const first = await finishReadingEarly({ attemptId: attempt.id, userId: learnerId, now: at(30) }, database.db);
  assert.equal(first.idempotent, false);
  assert.equal(first.attempt.readEndsAt.getTime(), at(30).getTime());
  assert.equal(first.attempt.writeStartedAt.getTime(), at(30).getTime());
  assert.equal(first.attempt.writeEndsAt.getTime(), at(210).getTime(), "recall stays a fixed 3:00");
  assert.equal(first.attempt.readStartedAt.getTime(), T0.getTime());

  const payload = await buildAttemptPayload(first.attempt, at(31), database.db);
  assert.equal(payload.phase, "recall");
  assert.ok(!JSON.stringify(payload).includes(MARKER), "no source or rubric after early finish");

  const repeat = await finishReadingEarly({ attemptId: attempt.id, userId: learnerId, now: at(90) }, database.db);
  assert.equal(repeat.idempotent, true);
  assert.equal(repeat.attempt.writeEndsAt.getTime(), at(210).getTime(), "a repeat never extends recall");

  // Persisted: a fresh start/resume sees recall, and drafts are accepted now.
  const resumed = await startOrResumeAttempt({ userId: learnerId, level: "B2", now: at(40) }, database.db);
  assert.equal(resumed.attempt.id, attempt.id);
  assert.equal(resumed.attempt.writeEndsAt.getTime(), at(210).getTime());
  await saveRecallDraft({ attemptId: attempt.id, userId: learnerId, recallText: "draft", now: at(45) }, database.db);

  // Late submit after the moved deadline is timed out, not completed.
  const done = await submitAttempt({ attemptId: attempt.id, userId: learnerId, recallText: "late", now: at(260) }, database.db);
  assert.equal(done.attempt.status, "timed_out");
  await assert.rejects(finishReadingEarly({ attemptId: attempt.id, userId: learnerId, now: at(270) }, database.db), isCode("retention_expired"));
});

test("concurrent finish requests produce one transition and one deadline", async () => {
  const { attempt } = await startOrResumeAttempt({ userId: otherId, level: "B2", now: at(1000) }, database.db);
  const results = await Promise.all([
    finishReadingEarly({ attemptId: attempt.id, userId: otherId, now: at(1020) }, database.db),
    finishReadingEarly({ attemptId: attempt.id, userId: otherId, now: at(1021) }, database.db),
  ]);
  assert.equal(results.filter((r) => !r.idempotent).length, 1);
  assert.equal(results[0]!.attempt.writeEndsAt.getTime(), results[1]!.attempt.writeEndsAt.getTime());
});
