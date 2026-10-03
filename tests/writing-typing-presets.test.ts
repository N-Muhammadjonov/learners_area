import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { decodeJwt } from "jose";
import { eq } from "drizzle-orm";
import { createTestDatabase } from "./support/pglite";
import { users, writingModelTexts, typingRunTexts, typingRuns } from "../src/db/schema";
import { issueTypingToken, recordModelTextRun, typingStats, TIMED_SUBMIT_GRACE_MS } from "../src/lib/services/writing/typing-runs";
import { TYPING_PRESETS, isTypingPreset } from "../src/lib/services/writing/typing";

process.env.AUTH_SECRET ??= "test-secret-test-secret-123456";
const BODY = "In recent decades, the question of whether university education should be free has become increasingly contentious. ".repeat(8).trim();
const read = (p: string) => readFileSync(p, "utf8");

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `p${Math.random()}@example.test`, name: "P", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const [mt] = await t.db.insert(writingModelTexts).values({ title: "Free university", taskType: "task2", topic: "education", targetBand: "8.5", body: BODY, wordCount: 120, provenance: "Learners Area QA", publicationState: "published" } as typeof writingModelTexts.$inferInsert).returning();
  // Whole seconds, so the JWT iat (seconds) equals t0 exactly.
  const t0 = Math.floor(Date.now() / 1000) * 1000;
  return { t, db: t.db as never, userId: u!.id, textId: mt!.id, t0 };
}

for (const [id, preset] of [["TY10", 60], ["TY11", 120], ["TY12", 180]] as const) {
  test(`${id} ${preset / 60}-minute preset is accepted, recorded and bounded`, async () => {
    const { t, db, userId, textId, t0 } = await setup();
    try {
      const token = await issueTypingToken(userId, textId, db, preset, () => t0);
      assert.ok(token);
      const typed = BODY.slice(0, 300);
      const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: typed, durationMs: preset * 1000, token: token! }, { database: db, now: () => t0 + preset * 1000 + 800 });
      assert.ok(r.ok, JSON.stringify(r));
      assert.equal(r.presetSeconds, preset);
      assert.equal(r.result.durationMs, preset * 1000);
      assert.equal(r.result.wpm, Math.round((300 / 5 / (preset / 60)) * 10) / 10);
    } finally { await t.close(); }
  });
}

test("TY13 unsupported presets are refused by the service and the start API schema", async () => {
  assert.deepEqual([...TYPING_PRESETS], [60, 120, 180]);
  for (const bad of [0, 30, 90, 240, 600, -60, "60"]) assert.equal(isTypingPreset(bad), false, String(bad));
  const { t, db, userId, textId } = await setup();
  try {
    assert.equal(await issueTypingToken(userId, textId, db, 600 as never), null);
    assert.equal(await issueTypingToken(userId, textId, db, 90 as never), null);
  } finally { await t.close(); }
  const route = read("src/app/api/writing/typing/start/route.ts");
  assert.match(route, /presetSeconds: z\.union\(\[z\.literal\(TYPING_PRESETS\[0\]\), z\.literal\(TYPING_PRESETS\[1\]\), z\.literal\(TYPING_PRESETS\[2\]\)\]\)\.nullable\(\)\.optional\(\)/);
  assert.match(route, /\.strict\(\)/);
});

test("TY14 the signed start token binds user, model text and the selected duration (+ short expiry for timed runs)", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const timed = decodeJwt((await issueTypingToken(userId, textId, db, 120, () => t0))!);
    assert.equal(timed.sub, userId);
    assert.equal(timed.mt, textId);
    assert.equal(timed.ps, 120);
    assert.equal(timed.iat, t0 / 1000);
    assert.equal(timed.exp, t0 / 1000 + 120 + TIMED_SUBMIT_GRACE_MS / 1000);
    const untimed = decodeJwt((await issueTypingToken(userId, textId, db, null, () => t0))!);
    assert.equal(untimed.ps, null);
    assert.equal(untimed.exp, t0 / 1000 + 7200);
  } finally { await t.close(); }
});

test("TY15 the client cannot extend the duration: claimed 10 minutes on a 1-minute token is capped; a forged preset field is refused", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db, 60, () => t0))!;
    // Submitted late but inside the grace window, claiming a 10-minute run.
    const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 200), durationMs: 600_000, token }, { database: db, now: () => t0 + 75_000 });
    assert.ok(r.ok);
    assert.equal(r.result.durationMs, 60_000, "never longer than the signed preset");
    // After the grace window the token is dead: no way to keep typing and submit later.
    const late = await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 900), durationMs: 600_000, token }, { database: db, now: () => t0 + 60_000 + TIMED_SUBMIT_GRACE_MS + 2_000 });
    assert.deepEqual(late, { ok: false, code: "expired" });
    // The record API accepts no preset/duration-mode field at all (strict schema).
    const route = read("src/app/api/writing/typing/route.ts");
    assert.match(route, /token: z\.string\(\)\.min\(20\)\.max\(2000\),\n\}\)\.strict\(\)/);
    assert.doesNotMatch(route.split("export async function GET")[0]!, /presetSeconds/);
    // A tampered token (preset rewritten) fails signature verification.
    const [h, , sig] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ ...decodeJwt(token), ps: 180 })).toString("base64url");
    const f = await recordModelTextRun(userId, { modelTextId: textId, typedText: "x".repeat(50), durationMs: 170_000, token: `${h}.${forged}.${sig}` }, { database: db, now: () => t0 + 20_000 });
    assert.deepEqual(f, { ok: false, code: "invalid_token" });
  } finally { await t.close(); }
});

test("TY16 timeout: the trainer locks input at 0:00, finalizes the visible text once, and never auto-retries a failed save", () => {
  const src = read("src/components/writing/TypingTrainer.tsx");
  assert.match(src, /if \(elapsed >= runPreset \* 1000\) onTimeUp\(\)/);
  assert.match(src, /setTimeUp\(true\);\s*setStartedAt\(null\);\s*void finishRef\.current\(\);/, "stop the clock, then finalize");
  assert.match(src, /readOnly=\{timeUp\}/);
  assert.match(src, /if \(timeUp\) return;/, "keystrokes after zero are ignored");
  assert.match(src, /typedText: typedRef\.current/, "the visible text is what gets submitted");
  assert.match(src, /finishing\.current = false;\s*setBusy\(null\); return;/, "a failed save keeps the text and re-enables Finish");
  assert.doesNotMatch(src, /setTyped\(""\);\s*\}\s*catch/, "typed text is never cleared on failure");
  assert.match(src, /disabled=\{running \|\| busy !== null\}/, "the preset is fixed once the run begins");
});

test("TY17 metrics use the bounded authoritative duration (server clock, then the preset ceiling)", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db, 120, () => t0))!;
    // Client claims 20s, but the server observed 45s → the server value wins.
    const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 150), durationMs: 20_000, token }, { database: db, now: () => t0 + 45_000 });
    assert.ok(r.ok);
    assert.equal(r.result.durationMs, 45_000);
    assert.equal(r.result.rawWpm, Math.round((150 / 5 / 0.75) * 10) / 10);
    const [row] = await t.db.select().from(typingRuns).where(eq(typingRuns.id, r.runId));
    assert.equal(row!.durationMs, 45_000);
  } finally { await t.close(); }
});

test("TY18 history records the preset; untimed and pre-preset runs stay NULL (shown as full text, nothing invented)", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const timed = (await issueTypingToken(userId, textId, db, 180, () => t0))!;
    assert.ok((await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 100), durationMs: 30_000, token: timed }, { database: db, now: () => t0 + 30_000 })).ok);
    const untimed = (await issueTypingToken(userId, textId, db, null, () => t0))!;
    assert.ok((await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY.slice(0, 100), durationMs: 40_000, token: untimed }, { database: db, now: () => t0 + 40_000 })).ok);
    const rows = await t.db.select().from(typingRunTexts);
    assert.deepEqual(rows.map((r) => r.presetSeconds).sort(), [180, null].sort());
    const stats = await typingStats(userId, db);
    assert.deepEqual(stats.history.map((h) => h.presetSeconds).sort(), [180, null].sort());
    const migration = read("drizzle/0034_typing_duration_presets.sql");
    assert.match(migration, /ADD COLUMN preset_seconds smallint/);
    assert.match(migration, /preset_seconds IS NULL OR preset_seconds IN \(60, 120, 180\)/);
    assert.doesNotMatch(migration, /UPDATE|DELETE|DROP|NOT NULL|DEFAULT/i, "no backfill, no destructive change");
    const ui = read("src/components/writing/TypingTrainer.tsx");
    assert.match(ui, /data-typing-history-mode=\{h\.presetSeconds \?\? "full"\}/);
  } finally { await t.close(); }
});

test("TY19 untimed full-text mode still works with the existing trusted-duration rules", async () => {
  const { t, db, userId, textId, t0 } = await setup();
  try {
    const token = (await issueTypingToken(userId, textId, db, null, () => t0))!;
    const r = await recordModelTextRun(userId, { modelTextId: textId, typedText: BODY, durationMs: 400_000, token }, { database: db, now: () => t0 + 400_500 });
    assert.ok(r.ok);
    assert.equal(r.presetSeconds, null);
    assert.equal(r.result.durationMs, 400_000, "long untimed runs are not capped by a preset");
    assert.equal(r.result.completion, 100);
    const short = await recordModelTextRun(userId, { modelTextId: textId, typedText: "In", durationMs: 2_000, token }, { database: db, now: () => t0 + 2_000 });
    assert.deepEqual(short, { ok: false, code: "invalid_duration" });
  } finally { await t.close(); }
});

test("Typing presets: UZ/EN strings exist, Uzbek Latin only, and controls are buttons (not a hidden select)", async () => {
  const { default: en } = await import("../src/lib/i18n/en");
  const { default: uz } = await import("../src/lib/i18n/uz");
  for (const k of ["duration", "presetMin", "presetFull", "remaining", "timeUp", "mode", "date"] as const) {
    assert.ok(en.writingWorkspace.typing[k], k);
    assert.ok(uz.writingWorkspace.typing[k], k);
    assert.doesNotMatch(uz.writingWorkspace.typing[k], /[\u0400-\u04FF]/);
  }
  const ui = read("src/components/writing/TypingTrainer.tsx");
  assert.match(ui, /role="radiogroup"/);
  assert.match(ui, /role="radio" aria-checked=\{active\}/);
  assert.match(ui, /grid grid-cols-2 gap-1[^"]*sm:flex/, "wraps on mobile instead of overflowing");
});
