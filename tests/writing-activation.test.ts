import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { lexemes, users, userVocabulary, vocabularyUsages } from "../src/db/schema";
import { checkActivation, randomActivationItems, activationSessionStats } from "../src/lib/services/writing/activation";
import { containsItem, cleanCustomItem } from "../src/lib/writing/activation-rules";
import { normalizeCheck, type CheckOutcome } from "../src/lib/services/writing/check";

async function setup(words = ["mitigate", "a double-edged sword"]) {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `a${Math.random()}@example.test`, name: "A", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const entries: string[] = [];
  for (const w of words) {
    const [lx] = await t.db.insert(lexemes).values({ term: w, definitionEn: `meaning of ${w}`, translationUz: `uz ${w}`, senseKey: `${w}::${Math.random()}` } as typeof lexemes.$inferInsert).returning();
    const [e] = await t.db.insert(userVocabulary).values({ userId: u!.id, lexemeId: lx!.id } as typeof userVocabulary.$inferInsert).returning();
    entries.push(e!.id);
  }
  return { t, db: t.db as never, userId: u!.id, entries };
}
const ai = (verdict: "correct" | "mostly_correct" | "needs_correction"): (() => Promise<CheckOutcome>) => async () => ({
  ok: true, result: { ...normalizeCheck("activation", { verdict, criteria: [{ key: "meaning", band: 8 }, { key: "grammar", band: 7 }], issues: [] }), evaluationId: crypto.randomUUID() },
});
const base = { mode: "writing" as const, targetLevel: "7" as const, uzbekPrompt: false };

test("A1 random items come only from the learner's own Vocabulary; item matching tolerates inflection", async () => {
  const { t, db, userId } = await setup();
  try {
    const items = await randomActivationItems(userId, 10, db);
    assert.deepEqual(items.map((i) => i.term).sort(), ["a double-edged sword", "mitigate"]);
    assert.ok(containsItem("Governments mitigated the damage.", "mitigate"));
    assert.ok(!containsItem("Governments reduced the damage.", "mitigate"));
    assert.equal(cleanCustomItem("<script>"), null);
  } finally { await t.close(); }
});

test("A2 a sentence without the item is not sent to AI and records no evidence", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    let calls = 0;
    const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "I like tea." }, { database: db, check: async () => { calls++; return ai("correct")(); } });
    assert.ok(r.ok && r.itemMissing && r.verdict === "needs_revision" && !r.usageRecorded);
    assert.equal(calls, 0);
  } finally { await t.close(); }
});

test("A3 an accepted sentence becomes real usage evidence; needs_revision does not; stats come from stored rows", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const sessionId = crypto.randomUUID();
    const bad = await checkActivation(userId, "en", { ...base, sessionId, entryId: entries[0], answer: "Mitigate is good thing." }, { database: db, check: ai("needs_correction") });
    assert.ok(bad.ok && bad.verdict === "needs_revision" && !bad.usageRecorded);
    const good = await checkActivation(userId, "en", { ...base, sessionId, entryId: entries[0], answer: "Trees can mitigate urban heat." }, { database: db, check: ai("correct") });
    assert.ok(good.ok && good.usageRecorded);
    const usages = await t.db.select().from(vocabularyUsages);
    assert.equal(usages.filter((u) => u.userVocabularyId === entries[0]).length >= 1, true);
    const stats = await activationSessionStats(userId, sessionId, db);
    assert.equal(stats.attempts, 2); assert.equal(stats.accepted, 1); assert.equal(stats.needsRevision, 1); assert.equal(stats.items, 1);
    const other = await checkActivation(crypto.randomUUID(), "en", { ...base, sessionId, entryId: entries[0], answer: "Trees mitigate heat." }, { database: db, check: ai("correct") });
    assert.ok(!other.ok && other.code === "not_found", "another user's entry is not usable");
  } finally { await t.close(); }
});

test("A4 AI unavailable is honest: no verdict invented, UI has an unavailable state and calls only the API", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "We must mitigate risks." }, { database: db, check: async () => ({ ok: false, reason: "unavailable" }) });
    assert.ok(!r.ok && r.code === "unavailable");
  } finally { await t.close(); }
  const ui = readFileSync("src/components/writing/activation/ActivationLab.tsx", "utf8");
  assert.match(ui, /data-activation-unavailable/);
  assert.match(ui, /\/api\/writing\/activation\/check/);
  assert.doesNotMatch(ui, /openai/i);
  const page = readFileSync("src/app/(app)/writing/page.tsx", "utf8");
  assert.match(page, /tab === "activation"/);
});
