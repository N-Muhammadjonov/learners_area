/**
 * Typing trainer integrity: run-token replay and elapsed-time forgery.
 *
 * Both defects covered here were found by reading the production code, not by a failing
 * probe, and both are exploitable from an ordinary browser session:
 *
 *  P1-REPLAY   finishPreparedTypingRun() detected replay by scanning the latest 50
 *              TYPING_RUN_COMPLETED activity events. A still-valid run token pushed out
 *              of that window by later activity minted a SECOND typing_runs row. The
 *              schema has carried `typing_runs.run_token_id` plus a partial unique index
 *              since 0048, but the trainer persistence path never wrote the column, so
 *              the database invariant protected nothing.
 *
 *  P1-INSTANT  The elapsed-time floor was skipped entirely when the submission contained
 *              the full canonical text (`!complete && ...`). /prepare hands the client
 *              those canonical words, so a script could prepare, start and immediately
 *              submit every word and bank a "completed" timed run having typed nothing.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eq, sql } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { activityEvents, typingRuns, users } from "../src/db/schema";
import {
  finishPreparedTypingRun,
  prepareTypingRun,
  startPreparedTypingRun,
} from "../src/lib/services/writing/typing-runs";

process.env.AUTH_SECRET ??= "test-secret-test-secret-1234567890";

async function setup() {
  const t = await createTestDatabase();
  const [user] = await t.db
    .insert(users)
    .values({
      email: `typing-integrity-${Math.random()}@example.test`,
      name: "Typing Integrity QA",
      passwordHash: "x",
    } as typeof users.$inferInsert)
    .returning();
  return { t, db: t.db as never, userId: user!.id };
}

/** A plausible elapsed time for `words` typed at `wpm`, in ms. */
const msToType = (words: number, wpm: number) => Math.ceil((words / wpm) * 60_000);

test("TI1 replay of a still-valid token mints no second run even past the 50-event window", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_200_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const typedWords = [...prepared.text.words.slice(0, 40), ""];

    const first = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_100 },
    );
    assert.ok(first.ok, JSON.stringify(first));

    // Push the original completion far outside any bounded recent-event lookup.
    for (let i = 0; i < 60; i += 1) {
      await t.db.insert(activityEvents).values({
        userId,
        type: "TYPING_RUN_COMPLETED",
        payload: { runId: `filler-${i}`, runTokenId: `filler-token-${i}` },
      });
    }
    const before = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(before.length, 1, "setup: exactly one real run before replay");

    // Replay the ORIGINAL, still-valid token.
    const replay = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_500 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.runId, first.result.runId, "replay must return the same run");

    const after = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(after.length, 1, "replay must not mint a second typing_runs row");
  } finally {
    await t.close();
  }
});

test("TI2 the authoritative run-token identity is persisted on the run row", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_300_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words.slice(0, 40), ""], samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_100 },
    );
    assert.ok(result.ok, JSON.stringify(result));

    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, result.result.runId));
    assert.ok(row, "the returned runId must name a real row");
    assert.ok(row!.runTokenId, "run_token_id must be persisted, or the unique index guards nothing");

    // The event payload's runTokenId is the same authoritative JTI.
    const events = await t.db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
    const payload = events.find((e) => (e.payload as Record<string, unknown>)?.runId === row!.id)
      ?.payload as Record<string, unknown>;
    assert.equal(row!.runTokenId, payload.runTokenId);
  } finally {
    await t.close();
  }
});

test("TI3 the database unique index is the final guard against a duplicate token", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_400_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words.slice(0, 40), ""], samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_100 },
    );
    assert.ok(result.ok, JSON.stringify(result));
    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, result.result.runId));

    // Even bypassing the service entirely, the schema must refuse a second row.
    // Assert the SQLSTATE, not the message: drizzle rewraps the driver error as
    // "Failed query: ..." so matching on text would pass for any failure at all.
    let sqlState: string | undefined;
    let constraint: string | undefined;
    try {
      await t.db.execute(sql`
        insert into "typing_runs" ("user_id","target_chars","typed_chars","duration_ms","wpm","accuracy","run_token_id")
        values (${userId}, 100, 100, 60000, '40.0', '99.0', ${row!.runTokenId})
      `);
    } catch (error) {
      const cause = (error as { cause?: { code?: string; constraint_name?: string; constraint?: string } }).cause;
      sqlState = cause?.code;
      constraint = cause?.constraint_name ?? cause?.constraint;
    }
    assert.equal(sqlState, "23505", "typing_runs_run_token_uq must reject a duplicate run token");
    if (constraint) assert.match(constraint, /typing_runs_run_token_uq/);
  } finally {
    await t.close();
  }
});

test("TI4 a concurrent double finish creates exactly one row and returns one id", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_500_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const typedWords = [...prepared.text.words.slice(0, 40), ""];

    const [a, b] = await Promise.all([
      finishPreparedTypingRun(userId, { runToken, typedWords, samples: [5, 10] }, { database: db, now: () => base + 60_100 }),
      finishPreparedTypingRun(userId, { runToken, typedWords, samples: [5, 10] }, { database: db, now: () => base + 60_100 }),
    ]);
    assert.ok(a.ok, JSON.stringify(a));
    assert.ok(b.ok, JSON.stringify(b));
    assert.equal(a.result.runId, b.result.runId, "both callers must see the same run");

    const rows = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(rows.length, 1, "a race must not mint two rows");
  } finally {
    await t.close();
  }
});

test("TI5 an instant submission of the full canonical text is rejected", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_600_000;
    const prepared = (await prepareTypingRun(userId, { preset: 180 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;

    // /prepare handed us the canonical words. Submit all of them immediately.
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words], samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 400 },
    );
    assert.equal(result.ok, false, "a full-text submit with no elapsed typing time must be refused");
    assert.equal((result as { code: string }).code, "too_early");

    const rows = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(rows.length, 0, "a refused forgery must persist nothing");
  } finally {
    await t.close();
  }
});

test("TI6 an instant PARTIAL submission is still rejected", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_700_000;
    const prepared = (await prepareTypingRun(userId, { preset: 180 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words.slice(0, 30), ""], samples: [5, 10] },
      { database: db, now: () => base + 400 },
    );
    assert.equal(result.ok, false);
    assert.equal((result as { code: string }).code, "too_early");
  } finally {
    await t.close();
  }
});

test("TI7 a genuine early completion at a human speed is still accepted", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_800_000;
    const prepared = (await prepareTypingRun(userId, { preset: 180 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const words = [...prepared.text.words];
    words[0] = `${words[0]}x`;

    // Finished the whole passage early, but at a speed a person can actually reach.
    const elapsed = msToType(words.length, 90);
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: words, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 100 + elapsed },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(result.result.mistakes > 0);
    // Early completion is still scored over the FULL preset, which can only lower WPM.
    assert.equal(result.result.durationMs, 180_000);
  } finally {
    await t.close();
  }
});

test("TI8 a normal timed completion and the serverless latency tolerance both still work", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_900_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const typedWords = [...prepared.text.words.slice(0, 50), ""];

    // The 60% floor exists because a serverless /start can land after typing began:
    // 40 s of observed time on a 60 s preset must remain acceptable.
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 100 + 40_000 },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.result.durationMs, 60_000);
  } finally {
    await t.close();
  }
});

test("TI9 no client-supplied duration or metric is trusted", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_001_000_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const result = await finishPreparedTypingRun(
      userId,
      {
        runToken,
        typedWords: [...prepared.text.words.slice(0, 40), ""],
        samples: [5, 10, 15, 20],
        // Hostile extras: none of these may influence the stored run.
        durationMs: 1,
        wpm: 999,
        accuracy: 100,
      } as never,
      { database: db, now: () => base + 60_100 },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.result.durationMs, 60_000);
    assert.ok(result.result.wpm < 200, `server must recompute wpm, got ${result.result.wpm}`);

    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, result.result.runId));
    assert.equal(row!.durationMs, 60_000);
    assert.equal(Number(row!.wpm), result.result.wpm);
  } finally {
    await t.close();
  }
});
