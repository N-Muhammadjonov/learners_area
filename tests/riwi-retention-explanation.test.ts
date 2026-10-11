import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase, bodyOfWords, simpleStructure } from "./support/pglite";
import { createRetentionText } from "../src/lib/data/retention-bank";
import { startOrResumeAttempt, submitAttempt } from "../src/lib/data/retention-attempts";
import { evaluateRecall } from "../src/lib/retention/evaluator";
import { validateMeasurementStructure } from "../src/lib/retention/measurement";
import { explainLatestReadingRecall, explainStoredReadingRecall } from "../src/lib/services/riwi/retention-explanation";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import type { Role } from "../src/lib/auth/roles";

const structure = validateMeasurementStructure(simpleStructure("canonical recall"));
const scored = evaluateRecall("The company was founded.", structure);
const record = { id: randomUUID(), retentionTextVersionId: randomUUID(), score: scored.score,
  evaluatorVersion: scored.breakdown.evaluatorVersion, scoreBreakdown: scored.breakdown };

test("recall explanation follows remembered/missed/distorted/cue from the immutable result and preserves paraphrase grading", () => {
  for (const language of ["en", "uz"] as const) {
    const copy = JSON.stringify(record);
    const result = explainStoredReadingRecall(record, 1, language);
    assert.equal(result.status, "ready");
    if (result.status === "ready") {
      assert.equal(result.score, scored.score);
      assert.equal(result.contractKey, "retention.reading-recall");
      assert.ok(result.answer.includes(language === "en" ? "Partially remembered" : "Qisman eslangan"));
      assert.ok(result.answer.includes(language === "en" ? "Retrieval cue" : "Eslash mashqi"));
      assert.ok(result.answer.includes(language === "en" ? "does not establish a stable weakness" : "barqaror zaiflikni isbotlamaydi"));
    }
    assert.equal(JSON.stringify(record), copy);
  }
  const alternative = evaluateRecall("The business began in 1998.", structure);
  const result = explainStoredReadingRecall({ ...record, score: alternative.score, scoreBreakdown: alternative.breakdown }, 1, "en");
  assert.equal(result.status, "ready");
  if (result.status === "ready") assert.equal(result.score, alternative.score);
});

test("stored score, versions, totals, group identities and claim contradictions cannot be forged into a valid explanation", () => {
  for (const change of [
    { id: "not-a-valid-source" }, { retentionTextVersionId: "not-a-valid-version" },
    { score: 100 }, { evaluatorVersion: "forged" }, { scoreBreakdown: { ...scored.breakdown, score: 100 } },
    { scoreBreakdown: { ...scored.breakdown, totals: { ...scored.breakdown.totals, mainIdeasRemembered: 9 } } },
    { scoreBreakdown: { ...scored.breakdown, claims: [scored.breakdown.claims[0], scored.breakdown.claims[0]] } },
    { scoreBreakdown: { ...scored.breakdown, claims: scored.breakdown.claims.map(claim => ({ ...claim, status: "captured" })) } },
    { scoreBreakdown: { ...scored.breakdown, claims: scored.breakdown.claims.map(claim => ({ ...claim, missingCriticalGroupIds: ["fake"] })) } },
  ]) assert.deepEqual(explainStoredReadingRecall({ ...record, ...change }, 1, "en"), { status: "unavailable", reason: "invalid_evidence" });
  assert.deepEqual(explainStoredReadingRecall(record, 0, "en"), { status: "unavailable", reason: "invalid_evidence" });
});

for (const role of ["student", "teacher", "admin", "owner"] as Role[])
  test(role + ": real SQL gateway explains only owned terminal recall without source/recall disclosure, provider dispatch or result mutation", async () => {
    const database = await createTestDatabase();
    const owner = randomUUID(), userId = randomUUID(), foreign = randomUUID();
    try {
      await database.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Author','owner','active',now()),($2,'Recall learner',$3,'active',now()),($4,'Other learner','student','active',now())", [owner, userId, role, foreign]);
      await createRetentionText({ level: "B1", bodyText: "HIDDEN_SOURCE_BODY_MUST_NOT_RENDER " + bodyOfWords(175), scoringStructure: simpleStructure("canonical recall"), actorUserId: owner }, database.db);
      const now = new Date("2026-01-01T00:00:00Z");
      const session = await startOrResumeAttempt({ userId, level: "B1", now }, database.db);
      await submitAttempt({ userId, attemptId: session.attempt.id, recallText: "The company was founded. PRIVATE_RECALL_TEXT_MUST_NOT_RENDER", now: new Date(now.getTime() + 121_000) }, database.db);
      const snapshot = async () => (await database.query("select to_jsonb(a) as state from retention_attempts a order by id"));
      const before = await snapshot();
      const deps = createRiwiGatewayDependencies(database.db);
      const overrides = { ...deps, authenticate: async () => ({ id: userId, name: "Recall learner", role, email: null,
        accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
        rollout: () => ({ enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: false, knowledgeLearning: false, providerLab: false }),
        consumeAccountLimit: () => ({ ok: true, remaining: 5, retryAfterSeconds: 0 }),
        routeProvider: async () => { assert.fail("retention explanation must never call a provider"); },
        retrieveKnowledge: async () => { assert.fail("saved recall must not be substituted with generic knowledge"); },
      };
      const request = (extra = {}) => new Request("https://retention.test.invalid/api/riwi/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Explain my latest retention recall result", ...extra }) });
      const result = await runRiwiGateway(request(), overrides);
      assert.equal(result.status, 200);
      assert.ok("ok" in result.body && result.body.ok);
      if (!("ok" in result.body)) return;
      const answer = result.body.answer;
      assert.equal(result.body.intent, "retention_recall");
      assert.equal(result.body.provenance, "deterministic_learning_data");
      assert.match(result.body.answer, /Retrieval cue/);
      assert.ok(!JSON.stringify(result.body).includes("HIDDEN_SOURCE_BODY_MUST_NOT_RENDER"));
      assert.ok(!JSON.stringify(result.body).includes("PRIVATE_RECALL_TEXT_MUST_NOT_RENDER"));
      assert.deepEqual(await snapshot(), before);
      const history = await getRiwiConversationTranscript({ actor: { id: userId, role }, conversationId: result.body.conversationId! }, database.db);
      assert.ok(history.some(message => message.role === "assistant" && message.content === answer));
      assert.ok(history.every(message => !message.content.includes("HIDDEN_SOURCE_BODY_MUST_NOT_RENDER")));
      const denied = await runRiwiGateway(request({ targetUserId: foreign }), overrides);
      assert.ok("ok" in denied.body && !denied.body.ok);
      const anonymous = await runRiwiGateway(request(), { ...overrides, authenticate: async () => null });
      assert.equal(anonymous.status, 401);
      assert.deepEqual(await explainLatestReadingRecall({ id: foreign, role: "student", accountStatus: "active" }, "en", database.db), { status: "unavailable", reason: "not_found" });
      const live = await startOrResumeAttempt({ userId, level: "B1", now: new Date(now.getTime() + 1_000_000) }, database.db);
      assert.equal(live.attempt.status, "reading");
      assert.deepEqual(await explainLatestReadingRecall({ id: userId, role, accountStatus: "active" }, "en", database.db), { status: "unavailable", reason: "locked" });
      assert.deepEqual(await explainLatestReadingRecall({ id: userId, role: role === "owner" ? "student" : "owner", accountStatus: "active" }, "en", database.db), { status: "unavailable", reason: "not_found" });
    } finally { await database.close(); }
  });
