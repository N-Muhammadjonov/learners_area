import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { users, writingTranslationSets, writingTranslationSentences } from "../src/db/schema";
import { startTranslationAttempt, getTranslationView, submitTranslationAnswer, listTranslationSets } from "../src/lib/services/writing/translation";
import { TRANSLATION_QUESTION_TYPES, matchesAccepted } from "../src/lib/writing/translation-rules";
import { normalizeCheck } from "../src/lib/services/writing/check";
import type { CheckOutcome } from "../src/lib/services/writing/check";

const MODELS = ["SECRET-MODEL-ONE is the answer.", "SECRET-MODEL-TWO follows here.", "SECRET-MODEL-THREE ends it."];
async function setup() {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `t${Math.random()}@example.test`, name: "T", passwordHash: "x" } as typeof users.$inferInsert).returning();
  const [set] = await t.db.insert(writingTranslationSets).values({ title: "Free university", topic: "education", questionType: "opinion", targetBand: 7, promptText: "Some people think university should be free.", provenance: "Learners Area QA", publicationState: "published" } as typeof writingTranslationSets.$inferInsert).returning();
  await t.db.insert(writingTranslationSentences).values(MODELS.map((m, i) => ({
    setId: set!.id, position: i + 1, uzbekSource: `Uzbek gap ${i + 1}`, modelEnglish: m,
    acceptedAlternatives: [`SECRET-ALT-${i + 1}`], notes: [`SECRET-NOTE-${i + 1}`], targetLexicalItems: i === 0 ? ["tuition fees"] : [],
  })));
  return { t, db: t.db as never, userId: u!.id, setId: set!.id };
}
const ai = (verdict: "correct" | "mostly_correct" | "needs_correction", meaning = 9): (() => Promise<CheckOutcome>) => async () => ({
  ok: true, result: normalizeCheck("translation", { verdict, criteria: [{ key: "meaning", band: meaning }, { key: "grammar", band: 7 }, { key: "vocabulary", band: 6.5 }], issues: verdict === "needs_correction" ? [{ message: "Tense is wrong.", suggestion: "Better version." }] : [] }),
});

test("T1 exactly five question families", () => {
  assert.deepEqual([...TRANSLATION_QUESTION_TYPES], ["opinion", "discussion", "problem_solution", "advantages_disadvantages", "two_part"]);
});

test("T2/T3/T4 the view holds only the current sentence's Uzbek; no model, alternative or note for current/future", async () => {
  const { t, db, userId, setId } = await setup();
  try {
    assert.equal((await listTranslationSets(db))[0]!.sentences, 3);
    const s = await startTranslationAttempt(userId, { setId }, db);
    assert.ok(s.ok);
    const view = (await getTranslationView(userId, s.attemptId, db))!;
    const json = JSON.stringify(view);
    assert.equal(view.current!.position, 1);
    assert.ok(!/SECRET-(MODEL|ALT|NOTE)/.test(json), "nothing reference-side leaks before a sentence is finished");
    assert.ok(!json.includes("Uzbek gap 2"), "future source sentences are not sent either");
    // After finishing sentence 1, only sentence 1's reference appears.
    const r = await submitTranslationAnswer(userId, s.attemptId, 1, "secret-model-one is the answer", "en", { database: db, aiReady: false });
    assert.ok(r.ok);
    const after = JSON.stringify(r.view);
    assert.ok(after.includes("SECRET-MODEL-ONE") && after.includes("SECRET-NOTE-1"));
    assert.ok(!/SECRET-(MODEL-TWO|MODEL-THREE|ALT-2|ALT-3|NOTE-2|NOTE-3)/.test(after));
    // Cannot answer a future sentence directly.
    assert.deepEqual(await submitTranslationAnswer(userId, s.attemptId, 3, "x", "en", { database: db, aiReady: false }), { ok: false, code: "not_current" });
  } finally { await t.close(); }
});

test("T5 a reviewed alternative is accepted by Stage A without any AI call", async () => {
  assert.ok(matchesAccepted("  Secret-alt-1. ", ["SECRET-ALT-1"]));
  const { t, db, userId, setId } = await setup();
  try {
    const s = await startTranslationAttempt(userId, { setId }, db);
    assert.ok(s.ok);
    const r = await submitTranslationAnswer(userId, s.attemptId, 1, "secret-alt-1", "en", { database: db, check: async () => { throw new Error("AI must not be called"); } });
    assert.ok(r.ok && r.verdict === "correct");
  } finally { await t.close(); }
});

test("T6 a non-exact paraphrase goes to the external AI check; T7 needs_revision allows a retry on the same sentence", async () => {
  const { t, db, userId, setId } = await setup();
  try {
    const s = await startTranslationAttempt(userId, { setId }, db);
    assert.ok(s.ok);
    let calls = 0;
    const bad = async () => { calls++; return ai("needs_correction", 4)(); };
    const r1 = await submitTranslationAnswer(userId, s.attemptId, 1, "something different", "en", { database: db, check: bad });
    assert.ok(r1.ok && r1.verdict === "needs_revision");
    assert.equal(calls, 1);
    assert.equal(r1.view.current!.position, 1, "retry stays on the same sentence");
    assert.equal(r1.view.current!.lastFeedback, "Tense is wrong.");
    assert.ok(!JSON.stringify(r1.view).includes("SECRET-MODEL-ONE"), "a failed try does not reveal the model");
    const r2 = await submitTranslationAnswer(userId, s.attemptId, 1, "a valid paraphrase", "en", { database: db, check: ai("mostly_correct") });
    assert.ok(r2.ok && r2.verdict === "acceptable");
    assert.equal(r2.view.current!.position, 2);
    // Keyword-overlap nonsense: meaning lost → never accepted even if the provider says "correct".
    const r3 = await submitTranslationAnswer(userId, s.attemptId, 2, "secret model two words", "en", { database: db, check: ai("correct", 3) });
    assert.ok(r3.ok && r3.verdict === "needs_revision");
  } finally { await t.close(); }
});

test("T8/T9 completion persists a reproducible result with at most three fixes; AI unavailable is honest", async () => {
  const { t, db, userId, setId } = await setup();
  try {
    const s = await startTranslationAttempt(userId, { setId }, db);
    assert.ok(s.ok);
    await submitTranslationAnswer(userId, s.attemptId, 1, "Free tuition fees help everyone", "en", { database: db, check: ai("mostly_correct") });
    for (let i = 0; i < 3; i++) await submitTranslationAnswer(userId, s.attemptId, 2, `wrong ${i}`, "en", { database: db, check: ai("needs_correction", 4) });
    const last = await submitTranslationAnswer(userId, s.attemptId, 3, "not checkable", "en", { database: db, aiReady: false });
    assert.ok(last.ok && last.verdict === "unchecked");
    const v1 = (await getTranslationView(userId, s.attemptId, db))!;
    assert.equal(v1.status, "completed");
    assert.ok(v1.result);
    assert.ok(v1.result.topFixes.length <= 3);
    assert.deepEqual(v1.result.bandWords, { used: ["tuition fees"], total: 1 });
    assert.equal(v1.result.checked, 2);
    assert.equal(v1.result.grammar, 7);
    assert.equal(v1.finished.find((f) => f.position === 3)!.status, "unavailable");
    const v2 = (await getTranslationView(userId, s.attemptId, db))!;
    assert.deepEqual(v2.result, v1.result, "reload reproduces the same persisted result");
    assert.deepEqual(await submitTranslationAnswer(userId, s.attemptId, 1, "x", "en", { database: db, aiReady: false }), { ok: false, code: "completed" });
    assert.equal(await getTranslationView("00000000-0000-0000-0000-000000000009", s.attemptId, db), null);
  } finally { await t.close(); }
});

test("Writing checks go through the Coach resolver with fallback none (no second OpenAI client)", () => {
  const src = readFileSync("src/lib/services/writing/check.ts", "utf8");
  assert.match(src, /\{ fallback: "none" \}/);
  assert.match(src, /providerType !== "external" \|\| r\.fallbackUsed/);
  assert.doesNotMatch(src, /api\.openai\.com|new OpenAI/);
});

test("Translation tab is a real workflow, not the empty placeholder; client code imports server modules as types only", () => {
  const page = readFileSync("src/app/(app)/writing/page.tsx", "utf8");
  assert.match(page, /tab === "translation" \?[\s\S]*WritingTranslationTab/);
  for (const f of ["TranslationRunner", "TranslationStartForm", "TranslationResultView"]) {
    const src = readFileSync(`src/components/writing/translation/${f}.tsx`, "utf8");
    assert.doesNotMatch(src, /^import \{[^}]*\} from "@\/lib\/services\/writing\/translation"/m, `${f} must use import type`);
    assert.doesNotMatch(src, /modelEnglish|acceptedAlternatives/);
  }
});
