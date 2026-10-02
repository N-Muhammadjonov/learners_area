import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { users, writingModelTexts, typingRunTexts, writingPrompts } from "../src/db/schema";
import { issueTypingToken, recordModelTextRun, listWritingModelTexts, typingStats } from "../src/lib/services/writing/typing-runs";
import { computeTypingResult } from "../src/lib/services/writing/typing";

process.env.AUTH_SECRET ??= "test-secret-test-secret-123456";
const BODY = "In recent decades, the question of whether university education should be free has become increasingly contentious. ".repeat(3).trim();

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `y${Math.random()}@example.test`, name: "Y", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const [mt] = await t.db.insert(writingModelTexts).values({ title: "Free university", taskType: "task2", topic: "education", targetBand: "8.5", body: BODY, wordCount: 45, provenance: "Learners Area QA", publicationState: "published" } as typeof writingModelTexts.$inferInsert).returning();
  await t.db.insert(writingPrompts).values({ taskType: "task2", category: "x", prompt: "PROMPT-TEXT-MUST-NOT-BE-TYPED", targetWordCount: 250 } as typeof writingPrompts.$inferInsert);
  return { t, db: t.db as never, userId: u!.id, textId: mt!.id };
}

test("TY1/TY2 typing texts come from writing_model_texts, never prompt.prompt", async () => {
  const { t, db } = await setup();
  try {
    const texts = await listWritingModelTexts(db);
    assert.equal(texts.length, 1);
    assert.equal(texts[0]!.body, BODY);
    assert.ok(!JSON.stringify(texts).includes("PROMPT-TEXT"));
    const page = readFileSync("src/app/(app)/writing/page.tsx", "utf8");
    assert.doesNotMatch(page, /prompts\.map\(\(prompt\) => \(\{[^}]*text: prompt\.prompt/);
    assert.doesNotMatch(page, /listActivePromptsWithResources/);
    assert.match(page, /listWritingModelTexts/);
  } finally { await t.close(); }
});

test("TY3/TY4/TY5 the client names a modelTextId; the server loads the canonical body; targetText is refused", async () => {
  const route = readFileSync("src/app/api/writing/typing/route.ts", "utf8");
  assert.match(route, /modelTextId: z\.string\(\)\.uuid\(\)/);
  assert.match(route, /\.strict\(\)/, "an extra targetText field fails validation");
  assert.doesNotMatch(route, /targetText/);
  const { t, db, userId, textId } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db))!;
    const t0 = Date.now();
    // A tampered client "types" its own easy target; the server scores against the model body.
    const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: "aaaa aaaa aaaa aaaa", durationMs: 30_000, token }, { database: db, now: () => t0 + 30_000 });
    assert.ok(r.ok);
    assert.equal(r.result.targetChars, BODY.length);
    assert.ok(r.result.accuracy < 30);
    // A token for another text or user is rejected.
    const other = await recordModelTextRun("00000000-0000-0000-0000-000000000002", { modelTextId: textId, typedText: "x", durationMs: 30_000, token }, { database: db, now: () => t0 + 30_000 });
    assert.deepEqual(other, { ok: false, code: "invalid_token" });
  } finally { await t.close(); }
});

test("TY6/TY7 WPM and accuracy are server-derived; a client duration shorter than the server elapsed is ignored", async () => {
  const exact = computeTypingResult(BODY, BODY.slice(0, 100), 60_000);
  assert.equal(exact.wpm, 20); assert.equal(exact.rawWpm, 20); assert.equal(exact.accuracy, 100); assert.equal(exact.mistakes, 0);
  const one = computeTypingResult("abcdefghij", "abcdefghiX", 60_000);
  assert.equal(one.mistakes, 1); assert.equal(one.correctChars, 9); assert.equal(one.accuracy, 90); assert.equal(one.rawWpm, 2); assert.equal(one.wpm, 1.8);
  const { t, db, userId, textId } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db))!;
    const t0 = Date.now();
    const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 100), durationMs: 6_000, token }, { database: db, now: () => t0 + 60_000 });
    assert.ok(r.ok);
    assert.ok(Math.abs(r.result.durationMs - 60_000) < 1500, "the server's elapsed time wins over an implausibly short client duration");
    assert.ok(r.result.wpm <= 21);
  } finally { await t.close(); }
});

test("TY8/TY9 mistakes are persisted against the model text and appear in history with bests", async () => {
  const { t, db, userId, textId } = await setup();
  try {
    const t0 = Date.now();
    for (const typed of [BODY.slice(0, 80), BODY.slice(0, 79) + "#"]) {
      const token = (await issueTypingToken(userId, textId, db))!;
      const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: typed, durationMs: 20_000, token }, { database: db, now: () => t0 + 20_000 });
      assert.ok(r.ok);
    }
    const rows = await t.db.select().from(typingRunTexts).where(eq(typingRunTexts.modelTextId, textId));
    assert.deepEqual(rows.map((r) => r.mistakes).sort(), [0, 1]);
    const stats = await typingStats(userId, db);
    assert.equal(stats.count, 2);
    assert.equal(stats.history.length, 2);
    assert.equal(stats.history[0]!.title, "Free university");
    assert.equal(stats.bestAccuracy, 100);
  } finally { await t.close(); }
});
