import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeJwt } from "jose";
import { createTestDatabase } from "./support/pglite";
import { users, writingModelTexts } from "../src/db/schema";
import {
  issueTypingToken,
  recordModelTextRun,
  TIMED_SUBMIT_GRACE_MS,
} from "../src/lib/services/writing/typing-runs";
import { TYPING_PRESETS, isTypingPreset } from "../src/lib/services/writing/typing";

process.env.AUTH_SECRET ??= "test-secret-test-secret-123456789";
const BODY = "Typing practice remains compatible with old model answer history. ".repeat(20).trim();
const read = (p: string) => readFileSync(p, "utf8");

async function setup() {
  const t = await createTestDatabase();
  const [user] = await t.db.insert(users).values({
    email: `preset-${Math.random()}@example.test`,
    name: "Preset QA",
    passwordHash: "x",
  } as typeof users.$inferInsert).returning();
  const [model] = await t.db.insert(writingModelTexts).values({
    title: "Legacy model",
    taskType: "task2",
    topic: "education",
    targetBand: "8.5",
    body: BODY,
    wordCount: BODY.split(/\s+/).length,
    provenance: "Learners Area QA",
    publicationState: "published",
  } as typeof writingModelTexts.$inferInsert).returning();
  const t0 = Math.floor(Date.now() / 1000) * 1000;
  return { t, db: t.db as never, userId: user!.id, textId: model!.id, t0 };
}

test("TY10 presets are exactly 30/60/120/180 seconds; Full is represented separately", () => {
  assert.deepEqual([...TYPING_PRESETS], [30, 60, 120, 180]);
  for (const value of [30, 60, 120, 180]) assert.equal(isTypingPreset(value), true);
  for (const value of [0, 29, 31, 90, 240, -30, "30"]) assert.equal(isTypingPreset(value), false, String(value));

  const prepare = read("src/app/api/writing/typing/prepare/route.ts");
  assert.match(prepare, /z\.literal\(0\)/, "Full mode is accepted only by the prepare schema");
  for (const index of [0, 1, 2, 3]) assert.match(prepare, new RegExp(`TYPING_PRESETS\\[${index}\\]`));
  assert.match(prepare, /\.strict\(\)/);
});

for (const preset of [30, 60, 120, 180] as const) {
  test(`legacy compatibility: ${preset}s signed model-text runs remain bounded`, async () => {
    const { t, db, userId, textId, t0 } = await setup();
    try {
      const token = await issueTypingToken(userId, textId, db, preset, () => t0);
      assert.ok(token);
      const typed = BODY.slice(0, Math.min(120, BODY.length));
      const run = await recordModelTextRun(
        userId,
        { modelTextId: textId, typedText: typed, durationMs: preset * 1000, token: token! },
        { database: db, now: () => t0 + preset * 1000 + 500 },
      );
      assert.ok(run.ok, JSON.stringify(run));
      assert.equal(run.presetSeconds, preset);
      assert.equal(run.result.durationMs, preset * 1000);
    } finally {
      await t.close();
    }
  });
}

test("TY11 legacy signed token still binds user, canonical model id and duration", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db, 120, () => t0))!;
    const decoded = decodeJwt(token);
    assert.equal(decoded.sub, userId);
    assert.equal(decoded.mt, textId);
    assert.equal(decoded.ps, 120);
    assert.equal(decoded.iat, t0 / 1000);
    assert.equal(decoded.exp, t0 / 1000 + 120 + TIMED_SUBMIT_GRACE_MS / 1000);
  } finally {
    await t.close();
  }
});

test("TY12 new UI starts on first keystroke, has no Start control, and preserves fixed duration", () => {
  const ui = read("src/components/writing/TypingTrainer.tsx");
  assert.match(ui, /const startIfNeeded = \(\) =>/);
  assert.match(ui, /\/api\/writing\/typing\/start/);
  assert.doesNotMatch(ui, /data-typing-start/);
  assert.doesNotMatch(ui, /<textarea/);
  assert.match(ui, /disabled=\{busy\}/);
  assert.match(ui, /role="radiogroup"/);
  assert.match(ui, /role="radio"/);
});

test("TY13 EN/UZ include all new preset and result labels without Uzbek Cyrillic", async () => {
  const { default: en } = await import("../src/lib/i18n/en");
  const { default: uz } = await import("../src/lib/i18n/uz");
  const keys = [
    "duration", "s30", "m1", "m2", "m3", "presetFull", "remaining",
    "repeat", "next", "rawWpm", "characters", "consistency", "graph",
  ] as const;
  for (const key of keys) {
    assert.ok(en.writingWorkspace.typing[key], key);
    assert.ok(uz.writingWorkspace.typing[key], key);
    assert.doesNotMatch(uz.writingWorkspace.typing[key], /[\u0400-\u04FF]/);
  }
});

test("TY14 applied migration 0034 stays untouched; 0040 widens presets additively", () => {
  const oldMigration = read("drizzle/0034_typing_duration_presets.sql");
  assert.match(oldMigration, /IN \(60, 120, 180\)/);
  const migration = read("drizzle/0040_typing_trainer.sql");
  assert.match(migration, /IN \(30,60,120,180\)/);
  assert.match(migration, /ALTER COLUMN "model_text_id" DROP NOT NULL/);
  assert.match(migration, /typing_text_id/);
  assert.match(migration, /typing_run_texts_one_target_chk/);
});
