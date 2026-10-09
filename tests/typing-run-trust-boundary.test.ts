/**
 * Typing trainer trust boundaries: the schema probe and the replay response.
 *
 * Both defects here were found by reading production code. Neither is visible as a
 * failing assertion anywhere else, because both produce a successful-looking response.
 *
 *  A1-FAILOPEN  hasRunTokenColumn() answered `false` for ANY exception — a transient
 *               outage, a permission error, a driver fault — not only for a genuinely
 *               pre-0048 database. On a fully migrated database that silently selected
 *               the weaker legacy write path, whose replay detection is a bounded
 *               50-event scan, while the unique index that actually protects the
 *               invariant went unused. A failed schema query must never downgrade an
 *               integrity guarantee.
 *
 *  A2-REPLAY    The replay branch returned `{ ...metrics, runId: existingRun }` where
 *               `metrics` was recomputed from the CURRENT request body. The database
 *               stayed idempotent, but a second POST under the same run token carrying
 *               different typedWords received a DIFFERENT score attached to the SAME
 *               run id — disagreeing with the history the learner reads on the next
 *               screen. Invariant: ONE RUN TOKEN = ONE PERSISTED RESULT = ONE CANONICAL
 *               REPLAY RESULT.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { eq } from "drizzle-orm";
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
      email: `typing-trust-${Math.random()}@example.test`,
      name: "Typing Trust QA",
      passwordHash: "x",
    } as typeof users.$inferInsert)
    .returning();
  return { t, db: t.db as never, userId: user!.id };
}

/** Run a normal, valid, scored run and return everything needed to replay it. */
async function completeRun(db: never, userId: string, base: number, wordCount = 40) {
  const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
  const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
  const typedWords = [...prepared.text.words.slice(0, wordCount), ""];
  const first = await finishPreparedTypingRun(
    userId,
    { runToken, typedWords, samples: [5, 10, 15, 20] },
    { database: db, now: () => base + 60_100 },
  );
  assert.ok(first.ok, JSON.stringify(first));
  return { prepared, runToken, typedWords, first };
}

/* ------------------------------------------------------------------ A1 ---- */

test("A1 a schema-probe failure must NOT silently select the weaker legacy path", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_000_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;

    // A database whose schema inspection fails: permission denied, outage, driver
    // fault — the probe cannot tell, and must therefore not guess "pre-0048".
    const failing = new Proxy(db as object, {
      get(target, prop, receiver) {
        if (prop === "execute") {
          return async (query: unknown) => {
            const text = String((query as { queryChunks?: unknown[] })?.queryChunks?.join("") ?? query);
            if (text.includes("information_schema")) {
              const error = new Error("permission denied for table columns") as Error & { code?: string };
              error.code = "42501";
              throw error;
            }
            return (Reflect.get(target, prop, receiver) as (q: unknown) => unknown)(query);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as never;

    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words.slice(0, 40), ""], samples: [5, 10, 15, 20] },
      { database: failing, now: () => base + 60_100 },
    );

    // Fail CLOSED. The request is refused rather than written through a path whose
    // replay protection is weaker than the one this database actually supports.
    assert.equal(result.ok, false, "a schema-probe failure must not produce a scored run");
    assert.equal((result as { code: string }).code, "conflict");

    // Nothing was persisted through the degraded path.
    const runs = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(runs.length, 0, "no run may be written when the schema could not be verified");
  } finally {
    await t.close();
  }
});

test("A1 a healthy migrated database still uses the token path, and persists the token", async () => {
  const { t, db, userId } = await setup();
  try {
    const { first } = await completeRun(db, userId, 1_800_100_100_000);
    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, first.result.runId));
    assert.ok(row, "the returned runId must name a real row");
    assert.ok(row!.runTokenId, "the modern path must persist run_token_id");
  } finally {
    await t.close();
  }
});

/* ------------------------------------------------------------------ A2 ---- */

test("A2 an identical replay returns the identical canonical result", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_200_000;
    const { runToken, typedWords, first } = await completeRun(db, userId, base);

    const replay = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_500 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.runId, first.result.runId);
    assert.equal(replay.result.wpm, first.result.wpm);
    assert.equal(replay.result.accuracy, first.result.accuracy);
    assert.equal(replay.result.typedChars, first.result.typedChars);

    const runs = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(runs.length, 1, "an identical retry must stay idempotent");
  } finally {
    await t.close();
  }
});

test("A2 a replay with DIFFERENT typedWords must not invent an alternate score", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_300_000;
    // First submission types 40 words.
    const { prepared, runToken, first } = await completeRun(db, userId, base, 40);

    // Second submission, same token, a very different amount of work.
    const altered = [...prepared.text.words.slice(0, 5), ""];
    const replay = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: altered, samples: [1, 2] },
      { database: db, now: () => base + 60_900 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));

    // Same run id AND the originally persisted numbers — not the ones this payload
    // would have produced.
    assert.equal(replay.result.runId, first.result.runId, "replay must name the same run");
    assert.equal(replay.result.typedChars, first.result.typedChars, "replay returned a recomputed typedChars");
    assert.equal(replay.result.wpm, first.result.wpm, "replay invented an alternate WPM");
    assert.equal(replay.result.accuracy, first.result.accuracy, "replay invented an alternate accuracy");
    assert.equal(replay.result.correct, first.result.correct);
    assert.equal(replay.result.mistakes, first.result.mistakes);

    // And the API answer agrees with the authoritative row.
    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, first.result.runId));
    assert.equal(Number(row!.typedChars), replay.result.typedChars, "API disagrees with the persisted row");
    assert.equal(Number(row!.wpm), Number(replay.result.wpm.toFixed(1)), "API disagrees with the persisted WPM");

    const runs = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(runs.length, 1, "a conflicting replay must not mint a second row");
  } finally {
    await t.close();
  }
});

test("A2 a replay with altered samples still returns the canonical result", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_400_000;
    const { runToken, typedWords, first } = await completeRun(db, userId, base);

    const replay = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [99, 1, 99, 1, 99, 1] },
      { database: db, now: () => base + 61_000 },
    );
    assert.ok(replay.ok, JSON.stringify(replay));
    assert.equal(replay.result.consistency, first.result.consistency, "samples must not re-derive consistency");

    const runs = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(runs.length, 1);
  } finally {
    await t.close();
  }
});

test("A2 a replay emits no second completion event", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_500_000;
    const { runToken, typedWords, first } = await completeRun(db, userId, base);

    const countFor = async () => {
      const rows = await t.db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
      return rows.filter((row) => (row.payload as Record<string, unknown>)?.runId === first.result.runId).length;
    };
    assert.equal(await countFor(), 1);

    await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 61_200 },
    );
    assert.equal(await countFor(), 1, "a replay must not duplicate the activity event");
  } finally {
    await t.close();
  }
});

test("A2 concurrent conflicting finishes agree on one run and one score", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_100_600_000;
    const prepared = (await prepareTypingRun(userId, { preset: 60 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;

    // Two finishes of the SAME token, racing, with different submitted work.
    const [a, b] = await Promise.all([
      finishPreparedTypingRun(
        userId,
        { runToken, typedWords: [...prepared.text.words.slice(0, 40), ""], samples: [5, 10, 15, 20] },
        { database: db, now: () => base + 60_100 },
      ),
      finishPreparedTypingRun(
        userId,
        { runToken, typedWords: [...prepared.text.words.slice(0, 20), ""], samples: [3, 6] },
        { database: db, now: () => base + 60_150 },
      ),
    ]);

    const runs = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(runs.length, 1, "exactly one row may survive a concurrent double finish");

    // Whichever succeeded, no successful response may contradict the stored row.
    const stored = runs[0]!;
    for (const outcome of [a, b]) {
      if (!outcome.ok) continue;
      assert.equal(outcome.result.runId, stored.id, "a response named a run that is not the stored one");
      assert.equal(outcome.result.typedChars, Number(stored.typedChars), "a response disagreed with the stored row");
    }
  } finally {
    await t.close();
  }
});

test("A2 one learner's token can never resolve to another learner's run", async () => {
  const { t, db, userId } = await setup();
  try {
    const [other] = await t.db
      .insert(users)
      .values({
        email: `typing-trust-other-${Math.random()}@example.test`,
        name: "Other Learner",
        passwordHash: "x",
      } as typeof users.$inferInsert)
      .returning();

    const base = 1_800_100_700_000;
    const { runToken, typedWords, first } = await completeRun(db, userId, base);

    // The second learner presents the first learner's run token.
    const stolen = await finishPreparedTypingRun(
      other!.id,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 60_800 },
    );

    if (stolen.ok) {
      assert.notEqual(stolen.result.runId, first.result.runId, "a stolen token resolved to another learner's run");
      const rows = await t.db.select().from(typingRuns).where(eq(typingRuns.id, stolen.result.runId));
      assert.equal(rows[0]!.userId, other!.id, "a run was attributed to the wrong learner");
    }

    // The original learner still owns exactly one run.
    const mine = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(mine.length, 1);
  } finally {
    await t.close();
  }
});
