import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createRetentionText } from "../src/lib/data/retention-bank";
import {
  findAttemptForUser,
  saveRecallDraft,
  startOrResumeAttempt,
  submitAttempt,
} from "../src/lib/data/retention-attempts";
import { assertLearnerSafe, buildAttemptPayload } from "../src/lib/retention/payload";
import type { RetentionAttemptPayload } from "../src/lib/retention/types";
import { bodyOfWords, createTestDatabase, simpleStructure, type TestDatabase } from "./support/pglite";

/**
 * Source and rubric privacy, checked on the REAL payload the learner receives.
 *
 * The Reading phase must return the source; the Recall phase must return neither
 * the source nor the rubric; the terminal phase must return the learner-safe
 * scores only. `assertLearnerSafe` is not a comment — it throws, and this suite
 * proves both that the real payloads pass it and that a payload which leaks would
 * fail it.
 */

let database: TestDatabase;
let ownerId: string;
let learnerId: string;

const T0 = new Date("2026-04-01T09:00:00.000Z");
const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

// Distinctive strings that must NOT survive into the recall payload.
const BODY_MARKER = "ZEBRA-CANARY-9931";
const ANY_OF_MARKER = "KIWI-PARROT-4477";
// Lives ONLY inside an author alternative, never in a claim label.
const RUBRIC_ONLY_MARKER = "MANGO-OTTER-5512";

before(async () => {
  database = await createTestDatabase();
  const rows = await database.query<{ id: string }>(
    `insert into users (name, role, account_status, email) values
       ('QA Owner', 'owner', 'active', 'qa.payload.owner@example.test'),
       ('QA Learner', 'student', 'active', 'qa.payload.learner@example.test')
     returning id`
  );
  ownerId = rows[0]!.id;
  learnerId = rows[1]!.id;
});

after(async () => {
  await database.close();
});

async function fixture() {
  const structure = simpleStructure(ANY_OF_MARKER);
  structure.claims[0]!.groups[0]!.anyOf = [RUBRIC_ONLY_MARKER, "company"];
  const text = await createRetentionText(
    {
      level: "B1",
      bodyText: `${bodyOfWords(170)} ${BODY_MARKER}`,
      scoringStructure: structure,
      actorUserId: ownerId,
    },
    database.db
  );
  const started = await startOrResumeAttempt({ userId: learnerId, level: "B1", now: T0, random: () => 0 }, database.db);
  return { text, attemptId: started.attempt.id };
}

test("the reading payload carries the source and never the measurement structure", async () => {
  const { attemptId } = await fixture();
  const attempt = await findAttemptForUser({ attemptId, userId: learnerId, now: at(10) }, database.db);
  const payload = await buildAttemptPayload(attempt, at(10), database.db);

  assert.equal(payload.phase, "reading");
  assertLearnerSafe(payload);
  const serialized = JSON.stringify(payload);
  assert.match(serialized, new RegExp(BODY_MARKER), "reading must show the text");
  assert.ok(!serialized.includes(RUBRIC_ONLY_MARKER), "the rubric must never reach the learner");
  assert.ok(!serialized.includes("anyOf"));
  assert.ok(!serialized.includes("scoringStructure"));
});

test("the recall payload drops the source body entirely — not hidden, absent", async () => {
  const { attemptId } = await fixture();
  await saveRecallDraft({ attemptId, userId: learnerId, recallText: "I remember the company", now: at(130) }, database.db);
  const attempt = await findAttemptForUser({ attemptId, userId: learnerId, now: at(140) }, database.db);
  const payload = await buildAttemptPayload(attempt, at(140), database.db);

  assert.equal(payload.phase, "recall");
  assertLearnerSafe(payload);
  const serialized = JSON.stringify(payload);
  assert.ok(!serialized.includes(BODY_MARKER), "the source must be absent from the recall payload");
  assert.ok(!serialized.includes(RUBRIC_ONLY_MARKER));
  assert.match(serialized, /I remember the company/, "the learner's own draft is returned");
  assert.ok(!("bodyText" in payload), "no bodyText key exists to be revealed by a toggle");
  // The deadline the browser renders comes from the server row, timed from T0.
  assert.equal(new Date(payload.writeEndsAt).getTime(), T0.getTime() + 300_000);
});

test("the terminal payload is a learner-safe breakdown: no alternatives, no phrases, no source", async () => {
  const { attemptId } = await fixture();
  await saveRecallDraft({ attemptId, userId: learnerId, recallText: "the company was founded in 1998", now: at(130) }, database.db);
  const submitted = await submitAttempt({ attemptId, userId: learnerId, recallText: "the company was founded in 1998", now: at(140) }, database.db);
  const payload = await buildAttemptPayload(submitted.attempt, at(141), database.db);

  assert.equal(payload.phase, "completed");
  assertLearnerSafe(payload);
  assert.equal(payload.score, 100);
  const serialized = JSON.stringify(payload);
  for (const forbidden of [BODY_MARKER, RUBRIC_ONLY_MARKER, "anyOf", "acceptedPhrases", "rejectPhrases", "scoringStructure", "groups"]) {
    assert.ok(!serialized.includes(forbidden), `terminal payload must not leak ${forbidden}`);
  }
  // What the learner DOES get: their own result, claim by claim.
  assert.ok(payload.breakdown.claims.length > 0);
  assert.equal(payload.breakdown.claims[0]!.claimLabel, `The QA fixture fact (${ANY_OF_MARKER}).`);
  assert.equal(typeof payload.breakdown.totals.mainIdeasRemembered, "number");
});

test("assertLearnerSafe actually refuses a leaking payload", () => {
  const base: RetentionAttemptPayload = {
    attemptId: "00000000-0000-0000-0000-000000000000",
    level: "B1",
    label: "B1-001",
    readStartedAt: T0.toISOString(),
    readEndsAt: at(120).toISOString(),
    writeStartedAt: at(120).toISOString(),
    writeEndsAt: at(300).toISOString(),
    phase: "recall",
    serverNow: at(130).toISOString(),
    recallDraft: "",
  };
  assert.doesNotThrow(() => assertLearnerSafe(base));
  // A learner is allowed to TYPE any word they like — that is text, not a leak.
  assert.doesNotThrow(() => assertLearnerSafe({ ...base, recallDraft: 'I wrote "anyOf" and groups here' }));
  // A rubric travelling as DATA is a leak, at any depth.
  assert.throws(
    () => assertLearnerSafe({ ...base, recallDraft: "x", bodyText: "the source" } as never),
    /leaks the source body/
  );
  assert.throws(
    () => assertLearnerSafe({ ...base, breakdown: { claims: [{ anyOf: ["company"] }] } } as never),
    /anyOf/
  );
  assert.throws(
    () => assertLearnerSafe({ ...base, breakdown: { scoringStructure: {} } } as never),
    /scoringStructure/
  );
  assert.throws(
    () => assertLearnerSafe({ ...base, breakdown: { groups: [] } } as never),
    /groups/
  );
});
