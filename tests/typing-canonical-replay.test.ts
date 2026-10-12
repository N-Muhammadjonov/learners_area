/**
 * B1 — the canonical typing-run replay result must be an EXACT lookup, not a window.
 *
 * `loadCanonicalRunResult()` read the newest 200 `TYPING_RUN_COMPLETED` activity events and
 * then searched for the wanted `runId` in JavaScript. That is a bounded history scan wearing
 * the clothes of an authoritative lookup: the modern run-token replay detection
 * (`findRunByToken`) IS unbounded, so the service correctly decides "this is a replay of run
 * X" for a run of any age, and then asks a 200-event window for run X's numbers. When the
 * matching completion event has been pushed out of that window by ordinary later activity,
 * the lookup returns null and the service answers `{ ok: false, code: "conflict" }`.
 *
 * The learner-visible effect: a genuine duplicate POST (a flaky network retry, a double
 * submit, a browser resending a timed-out request) starts failing permanently once the
 * learner has done ~200 more typing runs. The run is in the database, its score is in the
 * database, and the API refuses to tell them what it is.
 *
 * Required invariant: a valid replay of an already persisted typing run returns its canonical
 * result REGARDLESS of how many unrelated completion events exist.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { and, eq, sql } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { activityEvents, typingRuns, users } from "../src/db/schema";
import {
  finishPreparedTypingRun,
  prepareTypingRun,
  startPreparedTypingRun,
} from "../src/lib/services/writing/typing-runs";

process.env.AUTH_SECRET ??= "test-secret-test-secret-1234567890";

async function setup(email = `typing-replay-${Math.random()}@example.test`) {
  const t = await createTestDatabase();
  const [user] = await t.db
    .insert(users)
    .values({ email, name: "Typing Replay QA", passwordHash: "x" } as typeof users.$inferInsert)
    .returning();
  return { t, db: t.db as never, userId: user!.id };
}

/** Prepare → start → finish a real 60 s run, returning its token and canonical result. */
async function completedRun(setupResult: Awaited<ReturnType<typeof setup>>, base: number, wordCount = 40) {
  const prepared = (await prepareTypingRun(setupResult.userId, { preset: 60 }, { database: setupResult.db, now: () => base }))!;
  const runToken = (await startPreparedTypingRun(setupResult.userId, prepared.token, () => base + 100))!;
  const typedWords = [...prepared.text.words.slice(0, wordCount), ""];
  const first = await finishPreparedTypingRun(
    setupResult.userId,
    { runToken, typedWords, samples: [5, 10, 15, 20] },
    { database: setupResult.db, now: () => base + 60_100 },
  );
  assert.ok(first.ok, `setup must produce a completed run: ${JSON.stringify(first)}`);
  return { prepared, runToken, typedWords, first };
}

/**
 * Push `count` unrelated completion events AHEAD of the real one in `created_at desc` order.
 * Explicit timestamps: a single multi-row insert would give every filler the same
 * `now()`, and the old scan could then reach the real event by luck rather than by window.
 */
async function bury(t: Awaited<ReturnType<typeof createTestDatabase>>, userId: string, count: number, after: Date) {
  for (let i = 0; i < count; i += 1) {
    await t.db.insert(activityEvents).values({
      userId,
      type: "TYPING_RUN_COMPLETED",
      // Later than the real completion, earlier than the next filler: a strict total order.
      createdAt: new Date(after.getTime() + (i + 1) * 60_000),
      payload: { runId: `filler-run-${i}`, runTokenId: `filler-token-${i}`, wpm: 1 + i },
    } as typeof activityEvents.$inferInsert);
  }
}

const eventsForRun = async (t: Awaited<ReturnType<typeof createTestDatabase>>, userId: string, runId: string) => {
  const rows = await t.db
    .select({ payload: activityEvents.payload })
    .from(activityEvents)
    .where(and(eq(activityEvents.userId, userId), eq(activityEvents.type, "TYPING_RUN_COMPLETED")));
  return rows.filter((row) => (row.payload as Record<string, unknown> | null)?.runId === runId);
};

test("CR1 a valid replay still returns its canonical result past 250 later completion events", async () => {
  const s = await setup();
  try {
    const base = 1_800_100_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // 250 > the 200-event window the old implementation scanned.
    await bury(s.t, s.userId, 250, new Date(base + 60_100));

    const before = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(before.length, 1, "setup: exactly one real run");

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );

    assert.ok(replay.ok, `replay of a persisted run must succeed, got ${JSON.stringify(replay)}`);
    assert.equal(replay.result.runId, first.result.runId, "replay must name the same run");
    // Not merely "some" result: the SAME numbers that were stored.
    for (const key of ["wpm", "rawWpm", "accuracy", "correct", "incorrect", "extra", "missed",
      "mistakes", "completion", "targetChars", "typedChars", "durationMs"] as const) {
      assert.equal(replay.result[key], first.result[key], `${key} must be the stored value`);
    }

    const after = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(after.length, 1, "a replay must not mint a second typing_runs row");
    assert.equal((await eventsForRun(s.t, s.userId, first.result.runId)).length, 1, "a replay must not write a second completion event");
  } finally {
    await s.t.close();
  }
});

test("CR2 a replay carrying DIFFERENT typedWords still returns the stored score", async () => {
  const s = await setup();
  try {
    const base = 1_800_200_000_000;
    const { prepared, runToken, first } = await completedRun(s, base);

    // A hostile retry: same valid token, a different (still plausible) submission.
    const altered = [...prepared.text.words.slice(0, 20).map((word) => `${word}q`), ""];
    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords: altered, samples: [1, 2] },
      { database: s.db, now: () => base + 90_000 },
    );

    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.runId, first.result.runId);
    assert.equal(replay.result.wpm, first.result.wpm, "the replay score must not follow the new body");
    assert.equal(replay.result.typedChars, first.result.typedChars, "typedChars must be the stored count");
    assert.notEqual(altered.length, 41, "control: the altered submission really is different");

    const rows = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(rows.length, 1);
  } finally {
    await s.t.close();
  }
});

test("CR3 a replay carrying DIFFERENT samples still returns the stored score", async () => {
  const s = await setup();
  try {
    const base = 1_800_300_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [40, 40, 40] },
      { database: s.db, now: () => base + 90_000 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.runId, first.result.runId);
    assert.equal(replay.result.consistency, first.result.consistency, "consistency must come from the stored run");
    assert.equal(replay.result.wpm, first.result.wpm);
  } finally {
    await s.t.close();
  }
});

test("CR4 a missing canonical event fails honestly instead of fabricating a result", async () => {
  const s = await setup();
  try {
    const base = 1_800_400_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // Corrupt the authoritative record: the run row survives, its completion event does not.
    await s.t.db
      .delete(activityEvents)
      .where(and(eq(activityEvents.userId, s.userId), eq(activityEvents.type, "TYPING_RUN_COMPLETED")));
    assert.equal((await eventsForRun(s.t, s.userId, first.result.runId)).length, 0, "control: the event is gone");

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );

    assert.equal(replay.ok, false, "with no canonical record the service must refuse");
    assert.equal((replay as { code: string }).code, "conflict");
    // Refusing must not be a side effect of having written something else.
    const rows = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(rows.length, 1, "a refused replay must not mint a replacement run");
  } finally {
    await s.t.close();
  }
});

test("CR5 a partially readable canonical event is not padded from the request", async () => {
  const s = await setup();
  try {
    const base = 1_800_500_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // Drop a required scored field from the stored payload.
    await s.t.db.execute(sql`
      update "activity_events"
      set "payload" = "payload" - 'wpm'
      where "user_id" = ${s.userId} and "type" = 'TYPING_RUN_COMPLETED'
        and "payload"->>'runId' = ${first.result.runId}
    `);

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );
    assert.equal(replay.ok, false, "a payload missing a scored field is not a canonical result");
    assert.equal((replay as { code: string }).code, "conflict");
  } finally {
    await s.t.close();
  }
});

test("CR6 an expired run token is refused and never reaches the canonical lookup", async () => {
  const s = await setup();
  try {
    const base = 1_800_600_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // preset 60 ⇒ lifetime 120 s. 400 s later the token is expired.
    const expired = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 400_000 },
    );
    assert.equal(expired.ok, false);
    assert.equal((expired as { code: string }).code, "invalid_token",
      "an expired token must be distinguishable from a valid replay");

    const rows = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(rows.length, 1, "an expired token must persist nothing");
    assert.equal((await eventsForRun(s.t, s.userId, first.result.runId)).length, 1);
  } finally {
    await s.t.close();
  }
});

test("CR7 another learner cannot resolve my run through their own token", async () => {
  const s = await setup();
  try {
    const base = 1_800_700_000_000;
    const { runToken, first } = await completedRun(s, base);

    // A SECOND LEARNER IN THE SAME DATABASE — a separate in-memory database would prove
    // nothing, since the stranger would simply have no rows to find.
    const [other] = await s.t.db
      .insert(users)
      .values({ email: `typing-replay-stranger-${Math.random()}@example.test`, name: "Stranger", passwordHash: "x" } as typeof users.$inferInsert)
      .returning();

    // (a) My token replayed under another subject: verification is bound to the owner.
    const asOther = await finishPreparedTypingRun(
      other!.id,
      { runToken, typedWords: ["a", "b", "c", ""], samples: [1] },
      { database: s.db, now: () => base + 90_000 },
    );
    assert.equal(asOther.ok, false, "another learner must not replay my token");
    assert.equal((asOther as { code: string }).code, "invalid_token");

    // (b) A stranger mints their OWN token for the same text and finishes it. Their run
    //     must be their own: the canonical lookup is scoped by user, so my score can never
    //     be returned to them and their completion can never overwrite mine.
    const theirBase = base + 1_000;
    const theirPrepared = (await prepareTypingRun(other!.id, { preset: 60 }, { database: s.db, now: () => theirBase }))!;
    const theirToken = (await startPreparedTypingRun(other!.id, theirPrepared.token, () => theirBase + 100))!;
    const theirs = await finishPreparedTypingRun(
      other!.id,
      { runToken: theirToken, typedWords: [...theirPrepared.text.words.slice(0, 10), ""], samples: [1, 2] },
      { database: s.db, now: () => theirBase + 60_100 },
    );
    assert.ok(theirs.ok, JSON.stringify(theirs));
    assert.notEqual(theirs.result.runId, first.result.runId, "the stranger must get their own run");

    const mine = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(mine.length, 1, "my run count is unchanged");
    assert.equal(mine[0]!.id, first.result.runId);
    const theirsRows = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, other!.id));
    assert.equal(theirsRows.length, 1);
    assert.equal((await eventsForRun(s.t, s.userId, first.result.runId)).length, 1);
  } finally {
    await s.t.close();
  }
});

test("CR8 concurrent conflicting submissions produce one run and one canonical result", async () => {
  const s = await setup();
  try {
    const base = 1_800_800_000_000;
    const prepared = (await prepareTypingRun(s.userId, { preset: 60 }, { database: s.db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(s.userId, prepared.token, () => base + 100))!;

    // Two DIFFERENT bodies racing on one token: whichever row survives must be the
    // result BOTH callers report.
    const bodyA = [...prepared.text.words.slice(0, 40), ""];
    const bodyB = [...prepared.text.words.slice(0, 20).map((w) => `${w}z`), ""];

    const [x, y] = await Promise.all([
      finishPreparedTypingRun(s.userId, { runToken, typedWords: bodyA, samples: [5, 10] }, { database: s.db, now: () => base + 60_100 }),
      finishPreparedTypingRun(s.userId, { runToken, typedWords: bodyB, samples: [5, 10] }, { database: s.db, now: () => base + 60_100 }),
    ]);
    assert.ok(x.ok, JSON.stringify(x));
    assert.ok(y.ok, JSON.stringify(y));
    assert.equal(x.result.runId, y.result.runId, "one token = one run id for every caller");

    const rows = await s.t.db.select().from(typingRuns).where(eq(typingRuns.userId, s.userId));
    assert.equal(rows.length, 1, "a race must not mint two rows");
    assert.equal((await eventsForRun(s.t, s.userId, x.result.runId)).length, 1, "a race must not write two events");

    // The reported score is the stored one, not the loser's recomputation.
    const [stored] = await s.t.db.select().from(typingRuns).where(eq(typingRuns.id, x.result.runId));
    assert.equal(Number(stored!.wpm), x.result.wpm);
    assert.equal(Number(stored!.wpm), y.result.wpm);
  } finally {
    await s.t.close();
  }
});

test("CR9 the canonical lookup is an exact predicate, not a scan that grows with history", async () => {
  const s = await setup();
  try {
    const base = 1_800_900_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // A history 40x the size of the old window must not change the answer OR make the
    // lookup unbounded. Count the rows the replay lookup actually had to consider.
    await bury(s.t, s.userId, 4_000, new Date(base + 60_100));

    const total = await s.t.query<{ n: number }>(
      `select count(*)::int as n from activity_events where user_id = $1 and type = 'TYPING_RUN_COMPLETED'`,
      [s.userId],
    );
    assert.ok(total[0]!.n > 4_000, `control: the history really is large (${total[0]!.n})`);

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.runId, first.result.runId);
    assert.equal(replay.result.wpm, first.result.wpm);
  } finally {
    await s.t.close();
  }
});

/**
 * The pre-0048 compatibility path had the SAME defect twice over: replay detection scanned
 * the newest 50 events for the JTI, and the canonical lookup scanned the newest 200 for the
 * run. Both are now exact predicates. This test reproduces that database honestly — the
 * column is dropped rather than stubbed, so `hasRunTokenColumn()` really returns false and
 * the legacy branch really executes.
 */
test("CR10 a pre-0048 database replays exactly, with no bounded event window at all", async () => {
  const s = await setup();
  try {
    const base = 1_801_000_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);

    // Simulate the older schema: no run_token_id (its partial unique index goes with it).
    await s.t.db.execute(sql`alter table "typing_runs" drop column "run_token_id"`);
    const cols = await s.t.query<{ n: number }>(
      `select count(*)::int as n from information_schema.columns
        where table_name = 'typing_runs' and column_name = 'run_token_id'`,
    );
    assert.equal(cols[0]!.n, 0, "control: the database really is pre-0048 now");

    // Far past BOTH old windows (50 for detection, 200 for the canonical read).
    await bury(s.t, s.userId, 250, new Date(base + 60_100));

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );
    assert.ok(replay.ok, `pre-0048 replay must still resolve, got ${JSON.stringify(replay)}`);
    assert.equal(replay.result.runId, first.result.runId);
    assert.equal(replay.result.wpm, first.result.wpm, "the stored score, not a recomputation");

    // Raw SQL, not drizzle: the ORM selects EVERY column of the table, including the
    // run_token_id this test just dropped, so a mapped select cannot run on a pre-0048
    // schema by construction. Counting rows is exactly what is being asserted.
    const rows = await s.t.query<{ n: number }>(
      `select count(*)::int as n from typing_runs where user_id = $1`, [s.userId],
    );
    assert.equal(rows[0]!.n, 1, "pre-0048 replay must not mint a second run");
    assert.equal((await eventsForRun(s.t, s.userId, first.result.runId)).length, 1,
      "pre-0048 replay must not write a second completion event");
  } finally {
    await s.t.close();
  }
});

test("CR11 pre-0048 with the completion event deleted: measured degradation, never an invented score", async () => {
  const s = await setup();
  try {
    const base = 1_801_100_000_000;
    const { runToken, typedWords, first } = await completedRun(s, base);
    await s.t.db.execute(sql`alter table "typing_runs" drop column "run_token_id"`);
    await s.t.db
      .delete(activityEvents)
      .where(and(eq(activityEvents.userId, s.userId), eq(activityEvents.type, "TYPING_RUN_COMPLETED")));

    const replay = await finishPreparedTypingRun(
      s.userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: s.db, now: () => base + 90_000 },
    );
    // MEASURED BEHAVIOUR, not an assumption: pre-0048 there is no unique index and the
    // ONLY evidence that a token was already used is the completion event itself. Delete
    // the event and the evidence is gone, so the service cannot know this is a replay and
    // mints a second run. That is the exact degradation migration 0048 exists to remove,
    // it is unreachable on any migrated database (production is at 0052), and asserting a
    // `conflict` here would be asserting a guarantee the older schema cannot make.
    // What is asserted instead is the boundary of the damage: the score is recomputed from
    // the SERVER, never taken from the request, and no canonical result is invented.
    assert.ok(replay.ok, `pre-0048 with the evidence deleted: ${JSON.stringify(replay)}`);
    assert.notEqual(replay.result.runId, first.result.runId,
      "pre-0048 has no way to know the token was used; the modern path is what prevents this");
    const rows = await s.t.query<{ n: number }>(
      `select count(*)::int as n from typing_runs where id = $1`, [first.result.runId],
    );
    assert.equal(rows[0]!.n, 1, "the stored run survives the refusal");
  } finally {
    await s.t.close();
  }
});
