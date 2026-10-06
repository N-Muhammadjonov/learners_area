import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import {
  activityEvents,
  typingRunTexts,
  typingRuns,
  users,
  writingModelTexts,
} from "../src/db/schema";
import {
  finishPreparedTypingRun,
  issueTypingToken,
  listTypingTexts,
  prepareTypingRun,
  recordModelTextRun,
  startPreparedTypingRun,
  typingStats,
} from "../src/lib/services/writing/typing-runs";
import {
  computeWordTypingMetrics,
  consistencyFromSamples,
  validateTypingSubmission,
} from "../src/lib/services/writing/typing";
import { groupTypingLines } from "../src/lib/services/writing/typing-lines";

process.env.AUTH_SECRET ??= "test-secret-test-secret-1234567890";

async function setup() {
  const t = await createTestDatabase();
  const [user] = await t.db
    .insert(users)
    .values({ email: `typing-${Math.random()}@example.test`, name: "Typing QA", passwordHash: "x" } as typeof users.$inferInsert)
    .returning();
  return { t, db: t.db as never, userId: user!.id };
}

test("TY1 dedicated B1/B2 corpus ships all 30 owner-supplied passages", async () => {
  const { t, db } = await setup();
  try {
    const texts = await listTypingTexts(db);
    assert.equal(texts.length, 30);
    assert.deepEqual(texts.map((row) => row.externalId), Array.from({ length: 30 }, (_, i) => `la-typing-b1b2-${String(i + 1).padStart(2, "0")}`));
    for (const row of texts) {
      assert.equal(row.difficulty, "B1/B2");
      assert.ok(row.wordCount >= 150 && row.wordCount <= 200, row.title);
      assert.equal(row.wordCount, row.body.trim().split(/\s+/).length, row.title);
    }
    const [countRow] = await t.query<{ n: string }>('select count(*)::text as n from typing_texts');
    assert.equal(Number(countRow!.n), 30);
  } finally {
    await t.close();
  }
});

test("TY1b pre-0040 Preview falls back to the exact bundled corpus instead of showing an error", async () => {
  const { t, db, userId } = await setup();
  try {
    await t.query('alter table typing_run_texts drop constraint if exists typing_run_texts_one_target_chk');
    await t.query('alter table typing_run_texts drop constraint if exists typing_run_texts_preset_seconds_chk');
    await t.query('alter table typing_run_texts drop column if exists typing_text_id');
    await t.query('drop table if exists typing_texts');
    await t.query('alter table typing_runs drop column if exists run_token_id');
    await t.query('alter table typing_runs drop column if exists raw_wpm');
    await t.query('alter table typing_runs drop column if exists consistency');
    await t.query('alter table typing_runs drop column if exists chars_correct');
    await t.query('alter table typing_runs drop column if exists chars_incorrect');
    await t.query('alter table typing_runs drop column if exists chars_extra');
    await t.query('alter table typing_runs drop column if exists chars_missed');
    await t.query('alter table typing_runs drop column if exists started_at');
    await t.query('alter table typing_runs drop column if exists finished_at');

    const texts = await listTypingTexts(db);
    assert.equal(texts.length, 30);
    assert.equal(texts[0]!.externalId, "la-typing-b1b2-01");

    const prepared = (await prepareTypingRun(userId, { preset: 30 }, { database: db, now: () => 1_800_100_000_000 }))!;
    assert.ok(prepared);
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => 1_800_100_000_100))!;
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...prepared.text.words.slice(0, 6), ""], samples: [4, 8, 12, 16] },
      { database: db, now: () => 1_800_100_030_100 },
    );
    assert.ok(result.ok, JSON.stringify(result));

    const stats = await typingStats(userId, db);
    assert.equal(stats.count, 1);
    assert.equal(stats.history.length, 1);
    assert.equal(stats.history[0]!.title, prepared.text.title);
  } finally {
    await t.close();
  }
});

test("TY2 prepare supports 30/60/120/180/Full and Repeat/Next preserve corpus identity", async () => {
  const { t, db, userId } = await setup();
  try {
    for (const preset of [0, 30, 60, 120, 180] as const) {
      const prepared = await prepareTypingRun(userId, { preset }, { database: db, now: () => 1_800_000_000_000 });
      assert.ok(prepared);
      assert.equal(prepared.text.words.length, prepared.text.wordCount);
    }
    const first = (await prepareTypingRun(userId, { preset: 30 }, { database: db }))!;
    const repeat = (await prepareTypingRun(userId, { preset: 30, textId: first.text.id }, { database: db }))!;
    const next = (await prepareTypingRun(userId, { preset: 30, excludeTextId: first.text.id }, { database: db }))!;
    assert.equal(repeat.text.id, first.text.id);
    assert.notEqual(next.text.id, first.text.id);
  } finally {
    await t.close();
  }
});

test("TY3 first valid keystroke creates a server-timed run token and finish is idempotent", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_000_000;
    const prepared = (await prepareTypingRun(userId, { preset: 30 }, { database: db, now: () => base }))!;
    const runToken = await startPreparedTypingRun(userId, prepared.token, () => base + 100);
    assert.ok(runToken);

    const typedWords = [...prepared.text.words.slice(0, 8), ""];
    const samples = [5, 10, 15, 20, 25, 30];
    const first = await finishPreparedTypingRun(userId, { runToken: runToken!, typedWords, samples }, { database: db, now: () => base + 30_100 });
    assert.ok(first.ok);
    const second = await finishPreparedTypingRun(userId, { runToken: runToken!, typedWords, samples }, { database: db, now: () => base + 30_200 });
    assert.ok(second.ok);
    assert.equal(second.result.runId, first.result.runId);

    const rows = await t.db.select().from(typingRuns).where(eq(typingRuns.userId, userId));
    assert.equal(rows.length, 1);
    const events = await t.db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
    const typingEvent = events.find((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      return event.type === "TYPING_RUN_COMPLETED" && payload?.runId === rows[0]!.id;
    });
    assert.ok(typingEvent);
    const payload = typingEvent!.payload as Record<string, unknown>;
    assert.equal(payload.typingTextId, prepared.text.id);
    assert.equal(payload.presetSeconds, 30);
  } finally {
    await t.close();
  }
});

test("TY3b completing the whole passage may finish a timed run early even with earlier mistakes", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_100_000;
    const prepared = (await prepareTypingRun(userId, { preset: 180 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const typedWords = [...prepared.text.words];
    typedWords[0] = typedWords[0] + "x";
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 10_100 },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(result.result.mistakes > 0);
    assert.equal(result.result.durationMs, 10_000);
  } finally {
    await t.close();
  }
});

test("TY4 server derives WPM/accuracy/raw/consistency from canonical words and samples", () => {
  const target = "the quick brown fox jumps over the lazy dog".split(" ");
  const perfect = computeWordTypingMetrics(target, ["the", "quick", "brown", ""], 30, [5, 10, 15, 20, 25, 30]);
  assert.equal(perfect.correct, 13);
  assert.equal(perfect.incorrect + perfect.extra + perfect.missed, 0);
  assert.equal(perfect.accuracy, 100);
  assert.equal(perfect.consistency, 100);

  const mistakes = computeWordTypingMetrics(target, ["thx", "quickkk", "bro", ""], 60, [2, 6, 10, 12]);
  assert.equal(mistakes.incorrect, 1);
  assert.equal(mistakes.extra, 2);
  assert.equal(mistakes.missed, 2);
  assert.equal(mistakes.wpm, 0);
  assert.ok(mistakes.rawWpm > 0);
  assert.ok(mistakes.accuracy < 100);
});

test("TY5 forged samples, words and implausible speed are rejected", () => {
  const target = "the quick brown fox jumps over the lazy dog".split(" ");
  assert.equal(validateTypingSubmission(target, ["a".repeat(81), ""], [], 30), "bad_words");
  assert.equal(validateTypingSubmission(target, ["the", ""], [3, 2], 30), "bad_samples");
  assert.equal(validateTypingSubmission(target, ["the", "quick", ""], [0, 100], 30), "bad_samples");
  assert.equal(consistencyFromSamples([5, 10]), null);
});

test("TY5b corrected/backspaced samples remain monotonic and bounded before finish", () => {
  const source = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  assert.match(source, /Math\.max\(previous, current\)/);
  assert.match(source, /\.map\(\(value\) => Math\.min\(value, finalChars\)\)/);
  assert.match(source, /response\.error === "too_early"/);
});

test("TY6 visual lines come from measured offsetTop values, never character-count heuristics", () => {
  assert.deepEqual(groupTypingLines([0, 0, 0, 48, 48, 96]), [
    { start: 0, end: 3 },
    { start: 3, end: 5 },
    { start: 5, end: 6 },
  ]);
  assert.deepEqual(groupTypingLines([]), []);
});

test("TY7 client contract has no textarea or Start button and blocks paste/drop", () => {
  const source = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  assert.doesNotMatch(source, /<textarea/);
  assert.doesNotMatch(source, /data-typing-start/);
  assert.match(source, /\/api\/writing\/typing\/prepare/);
  assert.match(source, /\/api\/writing\/typing\/start/);
  assert.match(source, /\/api\/writing\/typing\/finish/);
  assert.match(source, /onPaste=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /onDrop=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /spellCheck=\{false\}/);
  assert.match(source, /autoCorrect="off"/);
  assert.match(source, /autoCapitalize="off"/);
  assert.match(source, /const rollingLineIndexes = \[[\s\S]*windowStart,[\s\S]*windowStart \+ 1,[\s\S]*windowStart \+ 2,[\s\S]*windowStart \+ 3/);
  assert.match(source, /const fraction = topRange/);
  assert.match(source, /typing-word-hide/);
  assert.match(source, /typing-word-show/);
  assert.match(source, /translateY\(-\\\$\{lineHeight\}px\)/, "only one full visual line shifts upward");
  assert.match(source, /flushSync\(\(\) => setWindowStart\(nextStart\)\)/, "line-window rebase happens in the same painted frame");
  assert.match(source, /ResizeObserver/);
  assert.match(source, /window\.clearInterval\(timer\.current\)/, "run timer is explicitly cleared");
  assert.match(source, /window\.clearTimeout\(lineTransitionTimer\.current\)/, "line transition timer is cleared");
  assert.match(source, /observer\.disconnect\(\)/, "ResizeObserver is released on unmount");
  assert.match(source, /cancelAnimationFrame\(frame\)/, "pending measurement frame is cancelled");
});

test("TY7b timer is above the typing stage and only three visual rows are visible", () => {
  const source = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.ok(source.indexOf("data-typing-timer") < source.indexOf("data-typing-stage"));
  assert.match(css, /\.typing-stage \{[\s\S]*height: calc\(var\(--typing-line-height\) \* 3\)/);
  assert.match(css, /\.typing-row-top \.typing-word-hide/);
  assert.match(css, /\.typing-row-bottom \.typing-word-show/);
});

test("TY7c a persisted run is returned even if history refresh fails", () => {
  const finishRoute = readFileSync("src/app/api/writing/typing/finish/route.ts", "utf8");
  assert.match(finishRoute, /const result = await finishPreparedTypingRun/);
  assert.match(finishRoute, /saved run, history refresh unavailable/);
  assert.match(finishRoute, /return NextResponse\.json\(\{ run: result\.result \}\)/);
});

test("TY8 prepare API explicitly accepts 30 seconds and rejects 29/31 by schema", () => {
  const source = readFileSync("src/app/api/writing/typing/prepare/route.ts", "utf8");
  assert.match(source, /z\.literal\(0\)/);
  assert.match(source, /TYPING_PRESETS\[0\]/);
  const metrics = readFileSync("src/lib/services/writing/typing.ts", "utf8");
  assert.match(metrics, /TYPING_PRESETS = \[30, 60, 120, 180\]/);
  assert.doesNotMatch(metrics, /\b29\b|\b31\b/);
});

test("TY9 legacy model-text history still records beside new typing-text history", async () => {
  const { t, db, userId } = await setup();
  try {
    const body = "Legacy model text ".repeat(30).trim();
    const [model] = await t.db.insert(writingModelTexts).values({
      title: "Legacy model",
      taskType: "task2",
      topic: "education",
      targetBand: "8.5",
      body,
      wordCount: body.split(/\s+/).length,
      provenance: "Learners Area QA",
      publicationState: "published",
    } as typeof writingModelTexts.$inferInsert).returning();

    const token = (await issueTypingToken(userId, model!.id, db, null, () => 1_800_000_000_000))!;
    const recorded = await recordModelTextRun(
      userId,
      { modelTextId: model!.id, typedText: body.slice(0, 80), durationMs: 30_000, token },
      { database: db, now: () => 1_800_000_030_000 },
    );
    assert.ok(recorded.ok);

    const newPrepared = (await prepareTypingRun(userId, { preset: 30 }, { database: db, now: () => 1_800_000_040_000 }))!;
    const runToken = (await startPreparedTypingRun(userId, newPrepared.token, () => 1_800_000_040_100))!;
    const newRun = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords: [...newPrepared.text.words.slice(0, 6), ""], samples: [4, 8, 12, 16] },
      { database: db, now: () => 1_800_000_070_100 },
    );
    assert.ok(newRun.ok);

    const stats = await typingStats(userId, db);
    assert.equal(stats.count, 2);
    assert.ok(stats.history.some((row) => row.title === "Legacy model"));
    assert.ok(stats.history.some((row) => row.title === newPrepared.text.title));

    const links = await t.db.select().from(typingRunTexts);
    assert.equal(links.length, 1);
    assert.ok(links.some((row) => row.modelTextId === model!.id));
    const events = await t.db.select().from(activityEvents).where(eq(activityEvents.userId, userId));
    assert.ok(events.some((event) => {
      const payload = event.payload as Record<string, unknown> | null;
      return event.type === "TYPING_RUN_COMPLETED" && payload?.typingTextId === newPrepared.text.id;
    }));
  } finally {
    await t.close();
  }
});
