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
  togglePreparedTypingPause,
  typingStats,
} from "../src/lib/services/writing/typing-runs";
import {
  computeWordTypingMetrics,
  consistencyFromSamples,
  validateTypingSubmission,
} from "../src/lib/services/writing/typing";
import { groupTypingLines, windowRows } from "../src/lib/services/writing/typing-lines";
import { sanitizeSamples, validateSubmission } from "../src/lib/services/writing/typing-metrics";

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

test("TY1b pre-0048 Preview falls back to the exact bundled corpus instead of showing an error", async () => {
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

/**
 * The INTENT of this test — an early-completed timed passage is still scored over the
 * full preset — is unchanged and still asserted below.
 *
 * What changed is its elapsed time. It used to finish a ~180-word passage 10.1 s after
 * the server-stamped start, i.e. at over 1000 wpm, and that is precisely the forgery the
 * trainer now refuses: /prepare hands the client the canonical words, so submitting all
 * of them instantly proved no typing had happened. Scoring over the full preset caps the
 * WPM such a submission can claim but does not stop it fabricating a completed run.
 * The timing is therefore raised to a speed a person can actually reach; the assertion
 * about preset-based scoring is untouched.
 */
test("TY3b uploaded ready-code scores an early-completed timed passage over the full preset", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_100_000;
    const prepared = (await prepareTypingRun(userId, { preset: 180 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const typedWords = [...prepared.text.words];
    typedWords[0] = typedWords[0] + "x";
    // Finished early, but at ~90 wpm rather than instantly.
    const plausibleMs = Math.ceil((typedWords.length / 90) * 60_000);
    const result = await finishPreparedTypingRun(
      userId,
      { runToken, typedWords, samples: [5, 10, 15, 20] },
      { database: db, now: () => base + 100 + plausibleMs },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.ok(result.result.mistakes > 0);
    assert.equal(result.result.durationMs, 180_000);
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

test("TY5b uploaded ready-code repairs optional telemetry instead of rejecting a valid run", () => {
  assert.deepEqual(sanitizeSamples([5, 10, 7, 12], 12, 30), [5, 10, 10, 12]);
  assert.deepEqual(sanitizeSamples([5, 99], 12, 30), [5, 12]);
  assert.deepEqual(sanitizeSamples("garbage", 12, 30), []);
  assert.equal(validateSubmission(["the", "quick"], ["the", ""], 30), null);

  const service = readFileSync("src/lib/services/writing/typing-runs.ts", "utf8");
  assert.match(service, /sanitizeSamples\(/);
  assert.match(service, /preset \* 1000 \* 0\.6/);
});

test("TY6 visual lines come from measured offsetTop values, never character-count heuristics", () => {
  assert.deepEqual(groupTypingLines([0, 0, 0, 48, 48, 96]), [
    { start: 0, end: 3 },
    { start: 3, end: 5 },
    { start: 5, end: 6 },
  ]);
  assert.deepEqual(groupTypingLines([]), []);
  assert.deepEqual(windowRows(0), [
    { row: -1, role: "out" },
    { row: 0, role: "clear" },
    { row: 1, role: "clear" },
    { row: 2, role: "dim" },
    { row: 3, role: "buffer" },
  ]);
  assert.deepEqual(
    windowRows(1).filter((row) => row.role === "clear" || row.role === "dim").map((row) => row.row),
    [1, 2, 3],
  );
});

test("TY7 client uses uploaded ready-code one-line window with no word-level disappearance", () => {
  const source = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.doesNotMatch(source, /<textarea/);
  assert.doesNotMatch(source, /data-typing-start/);
  assert.match(source, /\/api\/writing\/typing\/prepare/);
  assert.match(source, /\/api\/writing\/typing\/start/);
  assert.match(source, /\/api\/writing\/typing\/finish/);
  assert.match(source, /const topLine = Math.max\(0, activeLine - 1\)/);
  assert.match(source, /ranges.map\(\(line, row\)/);
  assert.match(css, /transition: transform 120ms ease-out/);
  assert.match(css, /\.typing-row-clear \{[\s\S]*opacity: 1/);
  assert.match(css, /\.typing-row-dim,[\s\S]*opacity: \.5/);
  assert.match(source, /ResizeObserver/);
  assert.match(source, /onPaste=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /onDrop=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(source, /spellCheck=\{false\}/);
});

test("TY7b timer is above the typing stage and only three visual rows are visible", () => {
  const source = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.ok(source.indexOf("data-typing-timer") < source.indexOf("data-typing-stage"));
  assert.match(css, /\.typing-stage \{[\s\S]*height: calc\(var\(--typing-line-height\) \* 3\)/);
  assert.match(css, /\.typing-toolbar \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/);
  assert.match(css, /\.typing-toolbar-center \{[\s\S]*justify-self: center/);
  assert.match(css, /\.typing-row-dim,[\s\S]*opacity: \.5/);
  assert.doesNotMatch(css, /typing-word-hide|typing-word-show/);
});

test("TY7bb timed runs tolerate server-start lag but are still scored over the full preset", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_150_000_000;
    const prepared = (await prepareTypingRun(userId, { preset: 30 }, { database: db, now: () => base }))!;
    const token = (await startPreparedTypingRun(userId, prepared.token, () => base + 8_000))!;
    const result = await finishPreparedTypingRun(
      userId,
      { runToken: token, typedWords: [...prepared.text.words.slice(0, 8), ""], samples: [4, 8, 12, 16] },
      { database: db, now: () => base + 27_000 },
    );
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.result.durationMs, 30_000);
  } finally {
    await t.close();
  }
});

test("TY7c a persisted run is returned even if history refresh fails", () => {
  const finishRoute = readFileSync("src/app/api/writing/typing/finish/route.ts", "utf8");
  assert.match(finishRoute, /const result = await finishPreparedTypingRun/);
  assert.match(finishRoute, /saved run, history refresh unavailable/);
  assert.match(finishRoute, /return NextResponse\.json\(\{ run: result\.result \}\)/);
});

test("TY7d learner-facing Typing removes agent-only eyebrow/body copy and Full exposes icon-only pause", () => {
  const page = readFileSync("src/app/app/(shell)/writing/page.tsx", "utf8");
  const ui = readFileSync("src/components/writing/TypingTrainer.tsx", "utf8");
  assert.doesNotMatch(page, /\{t\.eyebrow\}/);
  assert.doesNotMatch(page, /\{t\.body\}/);
  assert.match(ui, /data-typing-full-pause/);
  assert.match(ui, /IconPauseOrb/);
  assert.doesNotMatch(ui, />Pause</);
});

test("TY7e Full-mode pause/resume is signed and excluded from authoritative elapsed time", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_200_000_000;
    const prepared = (await prepareTypingRun(userId, { preset: 0 }, { database: db, now: () => base }))!;
    const started = (await startPreparedTypingRun(userId, prepared.token, () => base + 100))!;
    const paused = await togglePreparedTypingPause(userId, started, "pause", () => base + 5_100);
    assert.ok(paused);
    assert.equal(paused.paused, true);

    const stillPaused = await finishPreparedTypingRun(
      userId,
      { runToken: paused.runToken, typedWords: [...prepared.text.words.slice(0, 4), ""], samples: [] },
      { database: db, now: () => base + 20_100 },
    );
    assert.deepEqual(stillPaused, { ok: false, code: "paused" });

    const resumed = await togglePreparedTypingPause(userId, paused.runToken, "resume", () => base + 20_100);
    assert.ok(resumed);
    assert.equal(resumed.paused, false);
    assert.equal(resumed.pausedMs, 15_000);

    const finished = await finishPreparedTypingRun(
      userId,
      { runToken: resumed.runToken, typedWords: [...prepared.text.words.slice(0, 4), ""], samples: [] },
      { database: db, now: () => base + 24_100 },
    );
    assert.ok(finished.ok, JSON.stringify(finished));
    assert.equal(finished.result.durationMs, 9_000);
  } finally {
    await t.close();
  }
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

test("finish replay after 50 later events returns the original metrics, including altered replay input", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_100_000;
    const prepared = (await prepareTypingRun(userId, { preset: 0 }, { database: db, now: () => base }))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base))!;
    const first = await finishPreparedTypingRun(userId, {runToken, typedWords: [prepared.text.words[0]!, ""], samples: []}, {database: db, now: () => base + 10_000});
    assert.ok(first.ok);
    await t.db.insert(activityEvents).values(Array.from({length: 51}, () => ({userId, type: "TYPING_RUN_COMPLETED", payload: {runTokenId: "later"}})));
    const replay = await finishPreparedTypingRun(userId, {runToken, typedWords: ["changed", ""], samples: []}, {database: db, now: () => base + 20_000});
    assert.deepEqual(replay, first);
    const [row] = await t.query<{n:number}>('select count(*)::int as n from typing_runs');
    assert.equal(row!.n, 1);
  } finally { await t.close(); }
});

test("historical accuracy is verified, persisted and replayed without losing corrected errors", async () => {
  const { t, db, userId } = await setup();
  try {
    const base = 1_800_000_200_000;
    const prepared = (await prepareTypingRun(userId, {preset: 0}, {database: db, now: () => base}))!;
    const runToken = (await startPreparedTypingRun(userId, prepared.token, () => base))!;
    const word = prepared.text.words[0]!;
    const keys = ["~", "\b", ...word, " "];
    const input = {runToken, typedWords: [word, ""], samples: [], keystrokes: keys};
    const deps = {database: db, now: () => base + 10_000};
    const forged = await finishPreparedTypingRun(userId, {...input, keystrokes: [..."wrong "]}, deps);
    assert.deepEqual(forged, {ok: false, code: "bad_submission"});
    const first = await finishPreparedTypingRun(userId, input, deps);
    assert.ok(first.ok, JSON.stringify(first));
    const expected = Math.round((word.length + 1) / (word.length + 2) * 1000) / 10;
    assert.equal(first.result.accuracy, expected);
    assert.equal(first.result.mistakes, 1);
    const [saved] = await t.query<{accuracy: string}>("select accuracy from typing_runs");
    assert.equal(Number(saved!.accuracy), expected);
    const replay = await finishPreparedTypingRun(userId, {...input, keystrokes: [...word, " "]}, deps);
    assert.deepEqual(replay, first);
  } finally {await t.close();}
});
