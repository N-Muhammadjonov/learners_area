import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { users, writingLanguagePatterns, writingModelTexts, writingPatternBank } from "../src/db/schema";
import { advanceStealing, getStealing, stealingLibrary, stealingSources, startPractice, startStealing, submitPractice } from "../src/lib/services/writing/stealing";
import { nearCopy } from "../src/lib/writing/stealing-rules";
import { normalizeCheck, type CheckOutcome } from "../src/lib/services/writing/check";

const PATTERN = "While X has clear benefits, it also raises serious concerns about Y";
const EXAMPLE = "While remote work has clear benefits, it also raises serious concerns about employee isolation.";
const MODEL = "MODEL-BODY-SECRET Some people believe remote work is better. ".repeat(10);

async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `s${Math.random()}@example.test`, name: "S", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const [mt] = await t.db.insert(writingModelTexts).values({ title: "Remote work", taskType: "task2", topic: "work", targetBand: "8.5", body: MODEL, wordCount: 90, provenance: "Learners Area QA", publicationState: "published" } as typeof writingModelTexts.$inferInsert).returning();
  const [p] = await t.db.insert(writingLanguagePatterns).values({ pattern: PATTERN, function: "concession", taskType: "task2", topic: "work", targetBand: 8, example: EXAMPLE, usageNote: "Balance an argument.", provenance: "INTERNAL-PROVENANCE", publicationState: "published", sourceRef: mt!.id } as typeof writingLanguagePatterns.$inferInsert).returning();
  await t.db.insert(writingLanguagePatterns).values({ pattern: "draft pattern", function: "trend", taskType: "task1", example: "x", provenance: "p", publicationState: "draft" } as typeof writingLanguagePatterns.$inferInsert);
  return { t, db: t.db as never, userId: u!.id, patternId: p!.id, textId: mt!.id };
}
const ai = (verdict: "correct" | "mostly_correct" | "needs_correction", adaptation: number): (() => Promise<CheckOutcome>) => async () => ({
  ok: true, result: { ...normalizeCheck("pattern", { verdict, criteria: [{ key: "grammar", band: 7 }, { key: "meaning", band: 8 }, { key: "pattern", band: 8 }, { key: "adaptation", band: adaptation }], issues: [] }), evaluationId: null },
});

test("LS1/LS2/LS3 deterministic near-copy guard: exact, punctuation/case-only and one-word substitution are rejected", () => {
  assert.equal(nearCopy(EXAMPLE, EXAMPLE, PATTERN).reason, "exact");
  assert.equal(nearCopy("while REMOTE work has clear benefits it also raises serious concerns about employee isolation!!", EXAMPLE, PATTERN).reason, "exact");
  assert.ok(nearCopy("While remote study has clear benefits, it also raises serious concerns about employee isolation.", EXAMPLE, PATTERN).nearCopy);
  assert.ok(nearCopy("While remote work has clear advantages, it also raises serious worries about employee isolation.", EXAMPLE, PATTERN).nearCopy);
  assert.ok(!nearCopy("While online learning has clear benefits for rural students, it also raises serious concerns about the quality of assessment.", EXAMPLE, PATTERN).nearCopy);
});

test("LS1 a copy never reaches the AI and earns no credit; LS4 an adapted sentence proceeds to AI", async () => {
  const { t, db, userId, patternId } = await setup();
  try {
    const start = await startPractice(patternId, db);
    assert.ok(start && start.newTopic !== "work" && !start.topics.includes("work"));
    let calls = 0;
    const copy = await submitPractice(userId, "en", { patternId, newTopic: start.newTopic, answer: EXAMPLE }, { database: db, check: async () => { calls++; return ai("correct", 9)(); } });
    assert.ok(copy.ok && copy.verdict === "needs_revision" && copy.copy.nearCopy && !copy.canSave);
    assert.equal(calls, 0);
    const good = await submitPractice(userId, "en", { patternId, newTopic: start.newTopic, answer: "While online learning has clear benefits for rural students, it also raises serious concerns about the quality of assessment." }, { database: db, check: async () => { calls++; return ai("correct", 8)(); } });
    assert.ok(good.ok && good.verdict === "correct" && good.canSave);
    assert.equal(calls, 1);
    const bad = await submitPractice(userId, "en", { patternId, newTopic: "work", answer: "anything new here about other things entirely" }, { database: db, check: ai("correct", 8) });
    assert.ok(!bad.ok && bad.code === "invalid_topic", "the source topic is not a NEW topic");
  } finally { await t.close(); }
});

test("LS5 low AI adaptation band → needs_revision even if the provider says correct; LS6 accepted pattern can be saved to the bank", async () => {
  const { t, db, userId, patternId } = await setup();
  try {
    const start = (await startPractice(patternId, db))!;
    const low = await submitPractice(userId, "en", { patternId, newTopic: start.newTopic, answer: "While cars have clear benefits for families, it also raises serious concerns about city air quality." }, { database: db, check: ai("correct", 3) });
    assert.ok(low.ok && low.verdict === "needs_revision" && !low.canSave);
    const lib0 = await stealingLibrary(userId, {}, db);
    assert.equal(lib0.patterns.length, 1, "drafts are never in the library");
    assert.ok(!JSON.stringify(lib0).includes("INTERNAL-PROVENANCE"), "provenance stays server-side");
    await t.db.insert(writingPatternBank).values({ userId, patternId });
    const lib = await stealingLibrary(userId, { saved: true }, db);
    assert.equal(lib.patterns.length, 1);
    assert.equal((await stealingLibrary(userId, { task: "task1" }, db)).patterns.length, 0);
    assert.equal((await stealingLibrary(userId, { fn: "concession", topic: "Work", band: 8 }, db)).patterns.length, 1);
  } finally { await t.close(); }
});

test("LS7 7-step flow is server-enforced: model hidden until Analyse, minimums, recall, Day-3 lock", async () => {
  const { t, db, userId, textId, patternId } = await setup();
  try {
    assert.equal((await stealingSources(db)).length, 1);
    const now = new Date("2026-10-03T10:00:00Z");
    const v1 = (await startStealing(userId, textId, db, now))!;
    assert.equal(v1.step, 1);
    assert.equal(v1.modelBody, null, "source essay body hidden before brainstorm/draft");
    assert.equal(v1.patterns, null);
    assert.ok(!(await advanceStealing(userId, v1.id, { action: "draft", text: "x" }, db, now)).ok, "cannot skip steps");
    assert.ok((await advanceStealing(userId, v1.id, { action: "read" }, db, now)).ok);
    const short = await advanceStealing(userId, v1.id, { action: "brainstorm", text: "too short" }, db, now);
    assert.ok(!short.ok && short.code === "too_short");
    assert.ok((await advanceStealing(userId, v1.id, { action: "brainstorm", text: "flexible hours, no commute, isolation risk, weaker teamwork, savings" }, db, now)).ok);
    const draft = "Remote work is becoming common. ".repeat(10);
    const d = await advanceStealing(userId, v1.id, { action: "draft", text: draft }, db, now);
    assert.ok(d.ok && d.view.step === 4 && d.view.modelBody?.includes("MODEL-BODY-SECRET") && d.view.patterns?.length === 1);
    assert.ok((await advanceStealing(userId, v1.id, { action: "analyse", patternIds: [patternId] }, db, now)).ok);
    const c = await advanceStealing(userId, v1.id, { action: "compare", text: "The model balances both sides with a concession while my draft only listed benefits." }, db, now);
    assert.ok(c.ok && c.view.step === 6);
    assert.equal(c.view.patterns![0]!.pattern, "", "pattern hidden during recall");
    assert.ok(!c.view.patterns![0]!.example.includes("clear benefits"), "example masks pattern words");
    const wrong = await advanceStealing(userId, v1.id, { action: "recall", patternId, attempt: "something else" }, db, now);
    assert.ok(wrong.ok && wrong.recalled === false && wrong.view.step === 6);
    const right = await advanceStealing(userId, v1.id, { action: "recall", patternId, attempt: "while x has clear benefits it also raises serious concerns about y" }, db, now);
    assert.ok(right.ok && right.recalled && right.view.step === 7 && !right.view.rewriteUnlocked);
    assert.equal(right.view.modelBody, null, "Day-3 rewrite is done without the model");
    const rw = `While remote work has clear benefits, it also raises serious concerns about loneliness. ${"Teams must adapt. ".repeat(12)}`;
    const locked = await advanceStealing(userId, v1.id, { action: "rewrite", text: rw }, db, now);
    assert.ok(!locked.ok && locked.code === "locked");
    const later = new Date(now.getTime() + 3 * 86_400_000 + 1000);
    const done = await advanceStealing(userId, v1.id, { action: "rewrite", text: rw }, db, later);
    assert.ok(done.ok && done.view.completedAt && done.view.rewritePatternIds.includes(patternId));
    const other = await getStealing(crypto.randomUUID(), v1.id, db);
    assert.equal(other, null, "another learner cannot open the session");
  } finally { await t.close(); }
});

test("LS8 practice goes through the shared Coach check (no second AI connector) and the tab is wired", () => {
  const svc = readFileSync("src/lib/services/writing/stealing.ts", "utf8");
  assert.match(svc, /runWritingCheck/);
  assert.doesNotMatch(svc, /openai/i);
  assert.match(readFileSync("src/app/(app)/writing/page.tsx", "utf8"), /tab === "language-stealing"/);
});
