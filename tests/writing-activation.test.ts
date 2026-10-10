import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createTestDatabase } from "./support/pglite";
import { evaluations, lexemes, users, userVocabulary, vocabularyUsages } from "../src/db/schema";
import { checkActivation, randomActivationItems, activationSessionStats, resolveActivationItems, activationOverview } from "../src/lib/services/writing/activation";
import { activationCheckBody } from "../src/lib/writing/activation-schema";
import { activationScore, ACTIVATION_LEVELS } from "../src/lib/writing/activation-rules";
import { containsItem, cleanCustomItem } from "../src/lib/writing/activation-rules";
import { normalizeCheck, runWritingCheck } from "../src/lib/services/writing/check";
import { composeAssessmentPrompt } from "../src/lib/services/coach/contracts/compose";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import { evaluationResultSchema } from "../src/lib/services/coach/schema";

async function setup(words = ["mitigate", "a double-edged sword"]) {
  const t = await createTestDatabase();
  const [u] = await t.db.insert(users).values({ email: `a${Math.random()}@example.test`, name: "A", passwordHash: "x", accountStatus: "active" } as typeof users.$inferInsert).returning();
  const entries: string[] = [];
  for (const w of words) {
    const [lx] = await t.db.insert(lexemes).values({ term: w, definitionEn: `meaning of ${w}`, translationUz: `uz ${w}`, senseKey: `${w}::${Math.random()}` } as typeof lexemes.$inferInsert).returning();
    const [e] = await t.db.insert(userVocabulary).values({ userId: u!.id, lexemeId: lx!.id } as typeof userVocabulary.$inferInsert).returning();
    entries.push(e!.id);
  }
  return { t, db: t.db as never, userId: u!.id, entries };
}
const ai = (verdict: "correct" | "mostly_correct" | "needs_correction", full = false): typeof runWritingCheck => async (userId, _language, check, deps) => {
  const criteria = full
    ? [{ key: "meaning", band: 8 }, { key: "form", band: 7 }, { key: "collocation", band: 7 }, { key: "naturalness", band: 6 }, { key: "grammar", band: 8 }]
    : [{ key: "meaning", band: 8 }, { key: "grammar", band: 7 }];
  const result = normalizeCheck("activation", { verdict, criteria, issues: [{ message: "Use a stronger verb.", suggestion: "Trees can significantly mitigate urban heat." }] });
  if (!deps?.persist || !userId || check.kind !== "activation") return { ok: true, result };
  const [record] = await deps.persist.database.insert(evaluations).values({ userId, evaluationType: "writing",
    sourceType: "writing_activation", sourceId: deps.persist.sourceId, providerId: "fixture-external",
    providerDisplayName: "Fixture evaluator", providerType: "external", providerVersion: "test",
    promptVersion: "test", rubricVersion: "test", assessmentContractKey: `writing.check.activation-${check.mode}`,
    checkedByName: "RIWI", overallEstimate: null, verdict,
    criteria: criteria.map(c => ({ ...c, label: c.key })),
    issues: [{ category: "VOCAB_COLLOCATION", severity: "low", message: "Use a stronger verb.", suggestion: "Trees can significantly mitigate urban heat." }],
  }).returning();
  return { ok: true, result: { ...result, evaluationId: record!.id } };
};
const base = { mode: "writing" as const, targetLevel: "7.0" as const, uzbekPrompt: false };

const persistedCheck: typeof runWritingCheck = (userId, language, check, deps) => runWritingCheck(userId, language, check, {
  ...deps, control: async () => ({ externalEnabled: true, aiPrimaryProvider: "openai" }),
  resolve: async () => ({ ok: true, attempts: [], extras: {}, result: evaluationResultSchema.parse({
    evaluationId: crypto.randomUUID(), evaluationType: "writing", providerId: "fixture-external",
    providerDisplayName: "Fixture evaluator", providerType: "external", providerVersion: "test", model: "test",
    promptVersion: "test", rubricVersion: "test", assessmentContractKey: "writing.check.activation-writing",
    fallbackUsed: false, fallbackFrom: null, checkedBy: { id: "fixture-external", displayName: "Fixture evaluator", type: "external" },
    overallEstimate: null, confidence: 0.8, verdict: "correct",
    criteria: ["meaning", "form", "collocation", "naturalness", "grammar"].map(key => ({ key, label: key, band: 7 })),
    strengths: [], weaknesses: [], issues: [], nextActions: [], recommendedExercises: [], processedInMs: 1,
    createdAt: new Date().toISOString(),
  }) }),
});

test("Activation persists the real Writing evaluation against the saved answer event before awarding Vocabulary credit", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees mitigate urban heat." }, { database: db, check: persistedCheck });
    assert.ok(r.ok && r.usageRecorded);
    const rows = await t.query<{ evaluation_id: string; status: string }>("select e.id evaluation_id,a.payload->>'status' status from evaluations e join activity_events a on a.id=e.source_id join vocabulary_usages v on v.evaluation_id=e.id where e.user_id=$1 and e.source_type='writing_activation' and v.riwi_accepted=true", [userId]);
    assert.deepEqual(rows, [{ evaluation_id: r.result!.evaluationId!, status: "completed" }]);
    assert.deepEqual(await t.query("select count(*)::int n,sum(points)::int points from vocab_point_events"), [{ n: 1, points: 2 }]);
  } finally { await t.close(); }
});

test("Activation rejects unpersisted, foreign, fallback and wrong-source evaluations without exposing their feedback or earning credit", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const [foreign] = await t.db.insert(users).values({ name: "Foreign learner", accountStatus: "active" }).returning();
    for (const kind of ["unpersisted", "foreign", "source", "contract", "internal", "fallback", "score", "domain"]) {
      const check: typeof runWritingCheck = async (u, l, c, deps) => {
        if (kind === "unpersisted") return { ok: true, result: { ...normalizeCheck("activation", { verdict: "correct" }), evaluationId: crypto.randomUUID() } };
        const outcome = await ai("correct", true)(kind === "foreign" ? foreign!.id : u, l, c,
          kind === "source" ? { ...deps, persist: { ...deps!.persist!, sourceId: crypto.randomUUID() } } : deps);
        assert.ok(outcome.ok);
        const field = { contract: "assessment_contract_key='grammar.correct-it'", internal: "provider_type='internal'", fallback: "fallback_used=true", score: "overall_estimate=7", domain: "evaluation_type='grammar'" }[kind];
        if (field) await t.query(`update evaluations set ${field} where id=$1`, [outcome.result.evaluationId]);
        return outcome;
      };
      const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees mitigate urban heat." }, { database: db, check });
      assert.deepEqual(r, { ok: false, code: "failed" }, kind);
    }
    assert.equal((await t.db.select().from(vocabularyUsages)).length, 0);
    assert.deepEqual(await t.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    const events = await t.query<{ payload: Record<string, unknown> }>("select payload from activity_events where type='WRITING_ACTIVATION_CHECK' and user_id=$1", [userId]);
    assert.equal(events.length, 8);
    for (const { payload } of events) { assert.equal(payload.status, "unavailable"); assert.equal(payload.answer, "Trees mitigate urban heat."); assert.equal(payload.feedback, undefined); assert.equal(payload.verdict, undefined); }
  } finally { await t.close(); }
});

test("Activation completion failure rolls back usage, points and mastery while retaining the pending answer and evaluation", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    await t.query("create function fail_activation_completion() returns trigger language plpgsql as $$ begin if NEW.type='WRITING_ACTIVATION_CHECK' and NEW.payload->>'status'='completed' then raise exception 'fixture completion failure'; end if; return NEW; end $$");
    await t.query("create trigger fail_activation_completion before update on activity_events for each row execute function fail_activation_completion()");
    const input = { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees mitigate urban heat." };
    await assert.rejects(checkActivation(userId, "en", input, { database: db, check: persistedCheck }));
    assert.equal((await t.db.select().from(vocabularyUsages)).length, 0);
    assert.deepEqual(await t.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    assert.deepEqual(await t.query("select active_use_count from user_vocabulary where id=$1", [entries[0]]), [{ active_use_count: 0 }]);
    assert.deepEqual(await t.query("select a.payload->>'status' status from evaluations e join activity_events a on a.id=e.source_id where e.user_id=$1", [userId]), [{ status: "pending" }]);
    await t.query("drop trigger fail_activation_completion on activity_events");
    const retried = await checkActivation(userId, "en", input, { database: db, check: persistedCheck });
    assert.ok(retried.ok && retried.usageRecorded);
    assert.deepEqual(await t.query("select count(*)::int n,sum(points)::int points from vocab_point_events"), [{ n: 1, points: 2 }]);
  } finally { await t.close(); }
});

test("Activation cannot award credit after account revocation while the evaluator is running", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const check: typeof runWritingCheck = async (...args) => {
      const result = await persistedCheck(...args);
      await t.query("update users set account_status='suspended' where id=$1", [userId]);
      return result;
    };
    assert.deepEqual(await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees mitigate urban heat." }, { database: db, check }), { ok: false, code: "failed" });
    assert.equal((await t.db.select().from(vocabularyUsages)).length, 0);
    assert.deepEqual(await t.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    assert.deepEqual(await t.query("select payload->>'status' status from activity_events where user_id=$1", [userId]), [{ status: "unavailable" }]);
  } finally { await t.close(); }
});

test("failed evaluation persistence retains the answer but reports unavailable without inventing a verdict", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    await t.query("create function fail_activation_evaluation() returns trigger language plpgsql as $$ begin raise exception 'fixture evaluation failure'; end $$");
    await t.query("create trigger fail_activation_evaluation before insert on evaluations for each row execute function fail_activation_evaluation()");
    assert.deepEqual(await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees mitigate urban heat." }, { database: db, check: persistedCheck }), { ok: false, code: "failed" });
    assert.deepEqual(await t.query("select count(*)::int n from evaluations"), [{ n: 0 }]);
    assert.deepEqual(await t.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    const [event] = await t.query<{ payload: Record<string, unknown> }>("select payload from activity_events where user_id=$1", [userId]);
    assert.equal(event!.payload.answer, "Trees mitigate urban heat.");
    assert.equal(event!.payload.status, "unavailable");
    assert.equal(event!.payload.verdict, undefined);
  } finally { await t.close(); }
});

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
    const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "I like tea." }, { database: db, check: async (...args) => { calls++; return ai("correct")(...args); } });
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

test("accepted activation without a genuine evaluation reference records the answer but earns no vocabulary credit", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    for (const evaluationId of [null, "not-a-persisted-evaluation"]) {
      const outcome = await ai("correct", true)(userId, "en", { kind: "activation", item: "mitigate", mode: "writing", targetLevel: "7.0", answer: "Trees can mitigate urban heat.", meaningHint: null, uzbekPrompt: null, upgradeFrom: null });
      assert.ok(outcome.ok);
      const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: entries[0], answer: "Trees can mitigate urban heat." }, {
        database: db, check: async () => ({ ok: true, result: { ...outcome.result, evaluationId } }),
      });
      assert.ok(r.ok);
      assert.equal(r.usageRecorded, false);
    }
    assert.equal((await t.db.select().from(vocabularyUsages)).length, 0);
    assert.deepEqual(await t.query("select count(*)::int n from vocab_point_events"), [{ n: 0 }]);
    assert.deepEqual(await t.query("select count(*)::int n from activity_events where type='WRITING_ACTIVATION_CHECK' and payload->>'answer'='Trees can mitigate urban heat.'"), [{ n: 2 }]);
  } finally { await t.close(); }
});

const body = (lvl: string) => ({ sessionId: crypto.randomUUID(), customTerm: "mitigate", mode: "writing", targetLevel: lvl, uzbekPrompt: false, answer: "We mitigate risk." });

test("A5 Activation accepts exactly 5.5, 6.0, 6.5, 7.0, 7.5+ and rejects anything else", () => {
  assert.deepEqual([...ACTIVATION_LEVELS], ["5.5", "6.0", "6.5", "7.0", "7.5+"]);
  for (const l of ACTIVATION_LEVELS) assert.ok(activationCheckBody.safeParse(body(l)).success, l);
  for (const l of ["6", "7", "8", "9.0", "5.0"]) assert.ok(!activationCheckBody.safeParse(body(l)).success, l);
  // Translation keeps its own 6/7/8 contract.
  assert.match(readFileSync("src/lib/writing/translation-rules.ts", "utf8"), /TRANSLATION_BANDS = \[6, 7, 8\]/);
});

test("A6/H1/H2 own-list saved word resolves to the learner's canonical entry and an accepted sentence records usage", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    const items = await resolveActivationItems(userId, ["Mitigate", "double edged sword"], db);
    assert.equal(items[0]!.entryId, entries[0]);
    assert.equal(items[0]!.definitionEn, "meaning of mitigate");
    assert.equal(items[1]!.entryId, entries[1], "hyphen-normalised MWE matches the saved expression");
    const r = await checkActivation(userId, "en", { ...base, sessionId: crypto.randomUUID(), entryId: items[0]!.entryId, answer: "Trees mitigate heat." }, { database: db, check: ai("correct", true) });
    assert.ok(r.ok && r.usageRecorded);
    assert.equal((await t.db.select().from(vocabularyUsages)).filter((u) => u.userVocabularyId === entries[0]).length, 1);
  } finally { await t.close(); }
});

test("A7/H3/H4 unknown own-list item stays custom; another user's identical word is never attached", async () => {
  const a = await setup(["mitigate"]);
  try {
    const [other] = await a.t.db.insert(users).values({ email: `o${Math.random()}@example.test`, name: "O", passwordHash: "x" } as typeof users.$inferInsert).returning();
    const items = await resolveActivationItems(other!.id, ["mitigate", "pivotal role"], a.db);
    assert.deepEqual(items.map((i) => i.entryId), [null, null]);
    assert.deepEqual(items[1], { entryId: null, term: "pivotal role", definitionEn: null, translationUz: null });
  } finally { await a.t.close(); }
});

test("A8 summary feedback is stored with the check (criteria, feedback, better version, fixes) — no extra AI call", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    let calls = 0;
    const sessionId = crypto.randomUUID();
    const r = await checkActivation(userId, "en", { ...base, sessionId, entryId: entries[0], answer: "Trees mitigate heat." }, { database: db, check: async (...args) => { calls++; return ai("correct", true)(...args); } });
    assert.ok(r.ok && r.result);
    assert.equal(Object.keys(r.result.bands).length, 5);
    assert.ok(r.result.improved && r.result.fixes.length <= 3);
    const stats = await activationSessionStats(userId, sessionId, db);
    assert.equal(stats.attempts, 1);
    assert.equal(calls, 1, "stats/summary read stored rows only");
  } finally { await t.close(); }
  const ui = readFileSync("src/components/writing/activation/ActivationLab.tsx", "utf8");
  assert.match(ui, /data-activation-summary-item[\s\S]*<Feedback/, "summary renders the same Feedback block as instant mode");
});

test("A9 MWE pre-check: expression-level occurrence only", () => {
  assert.ok(containsItem("Social media is a double-edged sword.", "a double-edged sword"));
  assert.ok(containsItem("Social media is a double\u2011edged sword.", "a double-edged sword"));
  assert.ok(containsItem("Social media is a double edged sword.", "a double-edged sword"));
  assert.ok(!containsItem("The sword was double the price and edged with gold.", "a double-edged sword"));
  assert.ok(!containsItem("Edged tools and a double bed; a sword.", "a double-edged sword"));
  assert.ok(!containsItem("It is a double-edged issue.", "a double-edged sword"));
  assert.ok(containsItem("She made an important decision.", "make a decision"));
  assert.ok(containsItem("This will help them succeed.", "help sb succeed"));
});

test("A10 activation score is deterministic from five bands; missing criterion → no score", () => {
  assert.equal(activationScore({ meaning: 8, form: 7, collocation: 7, naturalness: 6, grammar: 8 }), 80);
  assert.equal(activationScore({ meaning: 9, form: 9, collocation: 9, naturalness: 9, grammar: 9 }), 100);
  assert.equal(activationScore({ meaning: 8, form: 7, collocation: null, naturalness: 6, grammar: 8 }), null);
  assert.equal(activationScore({ meaning: 8, grammar: 7 }), null);
  assert.equal(activationScore(null), null);
});

test("A11 Uzbek recall never invents a translation for a custom item", async () => {
  const { t, db, userId } = await setup();
  try {
    let seen: unknown;
    const r = await checkActivation(userId, "en", { ...base, uzbekPrompt: true, sessionId: crypto.randomUUID(), customTerm: "pivotal role", answer: "Teachers play a pivotal role." }, { database: db, check: async (...args) => { seen = args[2]; return ai("correct", true)(...args); } });
    assert.ok(r.ok && !r.uzbekApplied);
    assert.equal((seen as { uzbekPrompt: string | null }).uzbekPrompt, null);
  } finally { await t.close(); }
  const ui = readFileSync("src/components/writing/activation/ActivationLab.tsx", "utf8");
  assert.match(ui, /data-activation-uz-unavailable/);
  assert.match(ui, /recallHidden/, "English target is hidden before answering in recall mode");
});

test("A12 last-session and overview stats come from stored events, not client state", async () => {
  const { t, db, userId, entries } = await setup();
  try {
    assert.deepEqual(await activationOverview(userId, db), { wordsActivated: 0, averageActivation: null, dayStreak: 0, lastSession: null });
    const s1 = crypto.randomUUID();
    await checkActivation(userId, "en", { ...base, sessionId: s1, entryId: entries[0], answer: "Trees mitigate heat." }, { database: db, check: ai("correct", true) });
    await checkActivation(userId, "en", { ...base, sessionId: s1, entryId: entries[1], answer: "It is a sword." }, { database: db, check: ai("correct", true) });
    const o = await activationOverview(userId, db);
    assert.equal(o.wordsActivated, 1);
    assert.equal(o.averageActivation, 80);
    assert.equal(o.dayStreak, 1);
    assert.equal(o.lastSession!.stats.attempts, 2);
    assert.equal(o.lastSession!.stats.accepted, 1);
  } finally { await t.close(); }
});

test("A13 speaking mode copy and provider instructions never claim audio evaluation", async () => {
  const { default: en } = await import("../src/lib/i18n/en");
  const { default: uz } = await import("../src/lib/i18n/uz");
  for (const d of [en, uz]) {
    const a = d.writingWorkspace.activation;
    assert.doesNotMatch(`${a.speaking} ${a.speakingDesc}`, /pronunciation|talaffuz|fluency|ravonlik/i);
  }
  assert.match(en.writingWorkspace.activation.speakingHint, /No audio/);
  assert.match(uz.writingWorkspace.activation.speakingHint, /Ovoz yozilmaydi/);
  const activationPrompt = composeAssessmentPrompt({
    contract: getAssessmentContract("writing.check.activation-speaking")!,
  });
  assert.match(activationPrompt, /No audio is available: do not claim pronunciation, fluency, prosody, or speaking performance/);
});

test("Mentor visibility uses the existing teacher student page (staff-guarded)", () => {
  const page = readFileSync("src/app/(app)/teacher/students/[id]/page.tsx", "utf8");
  assert.match(page, /requireStaff/);
  assert.match(page, /activationOverview\(detail\.student\.id\)/);
});
