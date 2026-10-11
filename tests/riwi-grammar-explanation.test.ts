import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createTestDatabase } from "./support/pglite";
import { createLlmEvaluationProvider } from "../src/lib/services/coach/providers/shared/llm-provider";
import { composeInstructionPrompt, instructionContractTrace, formatInstructionTeaching } from "../src/lib/services/coach/contracts/instruction-runtime";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { routeRiwiAnswer } from "../src/lib/services/riwi/provider-router";
import { getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import { riwiChatResponseSchema } from "../src/lib/services/riwi/contracts";
import type { CompletionRequest } from "../src/lib/services/coach/providers/shared/llm-provider";
import type { CoachConfig } from "../src/lib/services/coach/config";
import type { Role } from "../src/lib/auth/roles";

const teaching = { kind: "grammar_explanation" as const, rule: "Use a before a consonant sound and an before a vowel sound.",
  contrast: "Choose by sound, rather than the first written letter.", examples: ["a university", "an hour"],
  commonError: "An university is incorrect here: university begins with a consonant sound.",
  checkQuestion: "Which article belongs before honest person, and why?" };
const rollout = { enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: true, knowledgeLearning: true, providerLab: false };
const config: CoachConfig = { aiPrimaryProvider: "grammar-teaching-fixture", externalEnabled: true, timeoutMs: 2000,
  maxAttempts: 1, retryBackoffMs: 0, sttPrimaryProvider: "none", modelOverride: null, ownerFallback: "none" };
const payload = { language: "en" as const, message: "Explain articles", history: [],
  knowledge: [{ ref: "K1", text: "A precedes a consonant sound; an precedes a vowel sound.", authority: 100, version: null }] };
function fixture(value: unknown = teaching, citations = ["K1"]) {
  const calls: CompletionRequest[] = [];
  const provider = createLlmEvaluationProvider({ id: config.aiPrimaryProvider, displayName: "Isolated Grammar fixture", version: "fixture/1",
    model: () => "fixture-model", requiredSecrets: () => [], transport: async request => {
      calls.push(request);
      return { ok: true, text: JSON.stringify({ answer: "GENERIC_FREE_TEXT_MUST_NOT_RENDER", uncertainty: null, citations, teaching: value }) };
    } });
  return { provider, calls };
}

test("Grammar explanation renders all five source teaching stages with bounded examples in English and Uzbek", async () => {
  const f = fixture();
  for (const language of ["en", "uz"] as const) {
    const result = await f.provider.respondToRiwi!({ userId: "external-anonymous", language, instructionTask: "grammar.explanation" }, { ...payload, language });
    assert.ok(result.ok);
    if (!result.ok) return;
    assert.equal(result.answer.answer, formatInstructionTeaching("grammar.explanation", teaching, language));
    assert.ok(!result.answer.answer.includes("GENERIC_FREE_TEXT"));
    assert.ok(result.answer.answer.includes(teaching.checkQuestion));
    assert.deepEqual(result.answer.citations, ["K1"]);
    assert.match(result.answer.answer, language === "en" ? /Rule:.*\n\nContrast:.*\n\nIllustrative examples:/s : /Qoida:.*\n\nFarq:.*\n\nMisollar:/s);
  }
  assert.ok(f.calls[0]!.system.includes(composeInstructionPrompt("grammar.explanation")));
  assert.ok(f.calls[0]!.system.includes("RULE → CONTRAST → EXAMPLES → COMMON ERROR → MINI CHECK"));
});

test("missing source, extra source and conversation history cannot execute Grammar teaching", async () => {
  for (const value of [{ ...payload, knowledge: [] }, { ...payload, knowledge: [...payload.knowledge, { ...payload.knowledge[0]!, ref: "K2" }] },
    { ...payload, history: [{ role: "user" as const, content: "PRIVATE_HISTORY" }] }]) {
    const f = fixture();
    const result = await f.provider.respondToRiwi!({ userId: "external-anonymous", language: "en", instructionTask: "grammar.explanation" }, value);
    assert.equal(result.ok, false);
    assert.equal(f.calls.length, 0);
  }
});

test("the router independently refuses source-free Grammar teaching even from a declared teaching adapter", async () => {
  const f = fixture();
  const result = await routeRiwiAnswer({ actor: { id: randomUUID(), role: "student" }, correlationId: randomUUID(),
    payload: { ...payload, knowledge: [] }, instructionTask: "grammar.explanation" }, {
    readRollout: () => rollout, readConfig: async () => config, getProvider: () => f.provider,
    secretPresent: () => true, writeAudit: async () => {}, writeUsage: async () => {},
  });
  assert.equal(result.status, "external_unavailable");
  if (result.status === "external_unavailable") assert.equal(result.reason, "invalid_request");
  assert.equal(f.calls.length, 0);
});

for (const [label, value, citations] of [
  ["missing contrast", { ...teaching, contrast: undefined }, ["K1"]],
  ["missing mini check", { ...teaching, checkQuestion: "" }, ["K1"]],
  ["one example", { ...teaching, examples: ["an hour"] }, ["K1"]],
  ["duplicate examples", { ...teaching, examples: ["An hour", "AN HOUR"] }, ["K1"]],
  ["invented grade", { ...teaching, band: 9 }, ["K1"]],
  ["uncited source", teaching, []],
  ["duplicate citation", teaching, ["K1", "K1"]],
  ["wrong source", teaching, ["K2"]],
] as const) test("Grammar teaching refuses " + label, async () => {
  const f = fixture(value, [...citations]);
  assert.equal((await f.provider.respondToRiwi!({ userId: "external-anonymous", language: "en", instructionTask: "grammar.explanation" }, payload)).ok, false);
});

for (const role of ["student", "teacher", "admin", "owner"] as Role[]) test(role + ": canonical Grammar chat executes the shared adapter and persists the exact teaching contract", async () => {
  const t = await createTestDatabase(), userId = randomUUID(), other = randomUUID(), topic = randomUUID(), f = fixture();
  try {
    await t.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Grammar teaching QA',$2,'active',now()),($3,'Foreign learner','student','active',now())", [userId, role, other]);
    await t.query("insert into grammar_topics(id,title,explanation,\"order\")values($1,'Articles',$2,1)", [topic, payload.knowledge[0]!.text]);
    await t.query("insert into grammar_exercises(topic_id,\"order\",prompt_text,options,correct_option,explanation,source_owner_user_id)values($1,1,'PRIVATE_EXERCISE','[]','PRIVATE_KEY','PRIVATE_NOTE',$2)", [topic, other]);
    const bound = createRiwiGatewayDependencies(t.db);
    const deps = { ...bound, authenticate: async () => ({ id: userId, role, name: "Grammar teaching QA", email: null,
      accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
      rollout: () => rollout, externalEnabled: async () => true,
      consumeAccountLimit: () => ({ ok: true, remaining: 20, retryAfterSeconds: 0 }),
      isRegisteredProvider: (id: string) => id === f.provider.id,
      retrieveKnowledge: async () => [],
      routeProvider: (input: Parameters<typeof routeRiwiAnswer>[0]) => routeRiwiAnswer(input, { readRollout: () => rollout,
        readConfig: async () => config, getProvider: () => f.provider, secretPresent: () => true,
        writeAudit: bound.writeAudit, writeUsage: async () => {} }) };
    const request = (extra = {}) => new Request("https://grammar-teaching.test.invalid/api/riwi/chat", { method: "POST",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ message: "Explain articles", ...extra }) });
    const snapshot = async () => ({ attempts: await t.query("select to_jsonb(a) state from grammar_attempts a order by id"),
      evaluations: await t.query("select to_jsonb(e) state from evaluations e order by id"),
      activity: await t.query("select id,last_meaningful_activity_at from users order by id") });
    const before = await snapshot();
    const response = await runRiwiGateway(request(), deps), body = riwiChatResponseSchema.parse(response.body);
    assert.equal(body.ok, true, JSON.stringify({ body, audit: await t.query("select action,metadata from audit_log order by created_at") }));
    assert.equal(body.provenance, "external_provider");
    assert.equal(body.answer, formatInstructionTeaching("grammar.explanation", teaching, "en"));
    assert.deepEqual(body.teachingContract, instructionContractTrace("grammar.explanation"));
    assert.equal(f.calls.length, 1);
    assert.ok(!f.calls[0]!.user.includes(userId));
    assert.ok(!f.calls[0]!.user.includes(other));
    assert.ok(!f.calls[0]!.user.includes(topic));
    assert.ok(!f.calls[0]!.user.includes("PRIVATE_"));
    assert.ok(!f.calls[0]!.user.includes("exerciseCount"));
    const history = await getRiwiConversationTranscript({ actor: { id: userId, role }, conversationId: body.conversationId! }, t.db);
    assert.deepEqual(history[1]!.teachingContract, body.teachingContract);
    assert.equal(history[1]!.content, body.answer);
    assert.deepEqual(await snapshot(), before);
    const off = riwiChatResponseSchema.parse((await runRiwiGateway(request(), { ...deps, externalEnabled: async () => false })).body);
    assert.equal(off.ok, true);
    assert.equal(off.teachingContract, undefined);
    assert.ok(off.uncertainty);
    assert.ok(off.answer.includes(payload.knowledge[0]!.text));
    assert.equal(f.calls.length, 1);
    const anonymous = await runRiwiGateway(request(), { ...deps, authenticate: async () => null });
    assert.equal(anonymous.status, 401);
    assert.equal(f.calls.length, 1);
    const forged = await runRiwiGateway(request({ instructionTask: "grammar.explanation" }), deps);
    assert.equal(forged.status, 400);
    assert.equal(f.calls.length, 1);
    const wrongTrace = riwiChatResponseSchema.parse((await runRiwiGateway(request(), { ...deps,
      routeProvider: async () => ({ status: "external_success" as const, answer: "UNTRUSTED_RESULT", uncertainty: null,
        citations: ["K1"], providerId: f.provider.id, model: "fixture-model", durationMs: 1,
        teachingContract: instructionContractTrace("tutoring.simple-explanation") }) })).body);
    assert.equal(wrongTrace.teachingContract, undefined);
    assert.ok(!wrongTrace.answer.includes("UNTRUSTED_RESULT"));
    const approved = riwiChatResponseSchema.parse((await runRiwiGateway(request(), { ...deps, retrieveKnowledge: async () => [
      { ref: "K1", sourceId: randomUUID(), unitId: randomUUID(), title: "Approved article rule", sourceType: "grammar_material",
        authority: 80, version: 4, text: payload.knowledge[0]!.text },
      { ref: "K2", sourceId: randomUUID(), unitId: randomUUID(), title: "Unrelated second source", sourceType: "grammar_material",
        authority: 70, version: 5, text: "UNRELATED_SOURCE_MUST_NOT_BE_SENT" },
    ] })).body);
    assert.equal(approved.ok, true);
    assert.deepEqual(approved.teachingContract, instructionContractTrace("grammar.explanation"));
    assert.deepEqual(approved.citations, [{ source: "Approved article rule", version: 4 }]);
    assert.equal(f.calls.length, 2);
    assert.ok(!f.calls[1]!.user.includes("UNRELATED_SOURCE"));
    assert.deepEqual(await snapshot(), before);
    if (role === "student") {
      const passage = randomUUID();
      await t.query("insert into reading_passages(id,title,body_text)values($1,'Current exam','HIDDEN_EXAM_CONTENT')", [passage]);
      await t.query("insert into reading_attempts(user_id,passage_id,status)values($1,$2,'in_progress')", [userId, passage]);
      const locked = riwiChatResponseSchema.parse((await runRiwiGateway(request(), deps)).body);
      assert.equal(locked.errorCode, "riwi_exam_help_locked");
      assert.equal(f.calls.length, 2);
    }
  } finally { await t.close(); }
});
