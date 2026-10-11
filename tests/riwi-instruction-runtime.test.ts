import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createLlmEvaluationProvider, type CompletionRequest } from "../src/lib/services/coach/providers/shared/llm-provider";
import { composeInstructionPrompt, instructionContractTrace, selectInstructionTask } from "../src/lib/services/coach/contracts/instruction-runtime";
import { INSTRUCTION_RUNTIME_KEYS, type InstructionTaskKey } from "../src/lib/services/coach/contracts/instruction-schema";
import { getAssessmentContract } from "../src/lib/services/coach/contracts/registry";
import type { CoachConfig } from "../src/lib/services/coach/config";
import { routeRiwiAnswer } from "../src/lib/services/riwi/provider-router";
import { createRiwiGatewayDependencies, runRiwiGateway } from "../src/lib/services/riwi/gateway";
import { riwiChatRequestSchema, riwiChatResponseSchema } from "../src/lib/services/riwi/contracts";
import { getRiwiConversationTranscript } from "../src/lib/services/riwi/conversations";
import { createTestDatabase } from "./support/pglite";
import type { Role } from "../src/lib/auth/roles";

const simple = { kind: "simple_explanation" as const, answer: "Retrieval practice means recalling what you learned.",
  explanation: "Try to remember before looking at the source.", example: "Close your notes and explain one idea.",
  illustration: "Close notes → recall → compare with the source.", checkQuestion: "Should you recall the idea before or after reopening your notes?" };
const comparison = { kind: "compare_concepts" as const, conceptA: { name: "Retrieval practice", explanation: "Recall an idea without looking.", example: "Explain one idea with your notes closed." },
  conceptB: { name: "Rereading", explanation: "Read the source again.", example: "Read the same paragraph twice." },
  keyDifference: "Recall uses memory while rereading shows the source again.", commonConfusion: "Recognizing a familiar sentence does not prove you can recall it." };
const payload = { language: "en" as const, message: "Explain retrieval practice", history: [], knowledge: [] };
const rollout = { enabled: true, roles: { student: true, teacher: true, admin: true, owner: true }, externalAi: true, knowledgeLearning: false, providerLab: false };
const config: CoachConfig = { aiPrimaryProvider: "teaching-fixture", externalEnabled: true, timeoutMs: 2000, maxAttempts: 1,
  retryBackoffMs: 0, sttPrimaryProvider: "none", modelOverride: null, ownerFallback: "none" };

function providerFor(teaching: unknown, extra: Record<string, unknown> = {}) {
  const calls: CompletionRequest[] = [];
  const provider = createLlmEvaluationProvider({ id: "teaching-fixture", displayName: "Isolated teaching fixture", version: "fixture/1", model: () => "fixture-model", requiredSecrets: () => [],
    transport: async request => { calls.push(request); return { ok: true, text: JSON.stringify({ answer: "UNVALIDATED_FREE_TEXT_MUST_NOT_RENDER", uncertainty: null, citations: [], teaching, ...extra }) }; } });
  return { provider, calls };
}

for (const key of INSTRUCTION_RUNTIME_KEYS.filter(key => key !== "grammar.explanation")) test(key + ": actual adapter executes the source teaching method and renders validated steps", async () => {
  const fixture = providerFor(key === "tutoring.simple-explanation" ? simple : comparison);
  const result = await fixture.provider.respondToRiwi!({ userId: "external-anonymous", language: "en", instructionTask: key }, payload);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(fixture.calls.length, 1);
  const contract = getAssessmentContract(key)!;
  assert.ok(fixture.calls[0]!.system.includes(contract.taskRules));
  assert.ok(fixture.calls[0]!.system.includes(composeInstructionPrompt(key)));
  assert.ok(!fixture.calls[0]!.user.includes("instructionTask"), "task authority never comes from the untrusted user JSON");
  assert.ok(!result.answer.answer.includes("UNVALIDATED_FREE_TEXT"));
  assert.ok(result.answer.answer.includes(key === "tutoring.simple-explanation" ? simple.checkQuestion : comparison.commonConfusion));
  assert.deepEqual(Object.keys(result.answer).sort(), ["answer", "citations", "uncertainty"]);
});

for (const [name, value] of [
  ["missing retrieval check", { ...simple, checkQuestion: undefined }],
  ["another task's output", comparison],
  ["invented assessment fields", { ...simple, band: 9 }],
  ["empty example", { ...simple, example: "   " }],
  ["missing illustration", { ...simple, illustration: null }],
  ["oversized explanation", { ...simple, explanation: "a".repeat(1201) }],
] as const) test("teaching refuses " + name + " instead of accepting a generic answer", async () => {
  const fixture = providerFor(value);
  const result = await fixture.provider.respondToRiwi!({ userId: "external-anonymous", language: "en", instructionTask: "tutoring.simple-explanation" }, payload);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.failure.reason, "invalid_response");
});

test("comparison needs two distinct concepts and cannot fabricate a second from a one-concept response", async () => {
  for (const value of [{ ...comparison, conceptB: undefined }, { ...comparison, conceptB: { ...comparison.conceptA, name: "RETRIEVAL PRACTICE" } }]) {
    const fixture = providerFor(value);
    const result = await fixture.provider.respondToRiwi!({ userId: "external-anonymous", language: "en", instructionTask: "tutoring.compare-concepts" }, payload);
    assert.equal(result.ok, false);
  }
});

test("learner selectors, assessment contracts and unsupported instruction tasks never reach transport", async () => {
  const fixture = providerFor(simple);
  for (const key of ["grammar.transformation", "reporting.progress", "unknown"])
    assert.throws(() => composeInstructionPrompt(key));
  for (const field of ["instructionTask", "assessmentContractKey", "teachingContract", "systemPrompt"])
    assert.equal(riwiChatRequestSchema.safeParse({ message: "Explain retrieval practice", [field]: "tutoring.compare-concepts" }).success, false);
  assert.equal((await fixture.provider.respondToRiwi!({ userId: "internal", language: "en", instructionTask: "grammar.transformation" as InstructionTaskKey }, payload)).ok, false);
  const grading = getAssessmentContract("grammar.correct-it")!;
  assert.equal((await fixture.provider.respondToRiwi!({ userId: "internal", language: "en", assessmentContract: { key: grading.key, version: grading.version, rubricVersion: grading.rubricVersion, overlay: null, policyScope: null, policyVersion: null } }, payload)).ok, false);
  assert.equal(fixture.calls.length, 0);
});

test("router refuses undeclared teaching capability and never upgrades a generic assistant into a task executor", async () => {
  const fixture = providerFor(simple);
  const provider = { ...fixture.provider, capabilities: fixture.provider.capabilities.filter(capability => capability !== "instruction-teaching") };
  const result = await routeRiwiAnswer({ actor: { id: randomUUID(), role: "student" }, correlationId: randomUUID(), payload, instructionTask: "tutoring.simple-explanation" }, {
    readRollout: () => rollout, readConfig: async () => config, getProvider: () => provider, secretPresent: () => true,
    writeAudit: async () => {}, writeUsage: async () => {},
  });
  assert.equal(result.status, "external_unavailable");
  if (result.status === "external_unavailable") assert.equal(result.reason, "capability_missing");
  assert.equal(fixture.calls.length, 0);
});

test("English, Uzbek and Russian requests select only the server-owned teaching formats", () => {
  for (const message of ["Explain the difference between recall and recognition", "Compare recall and recognition", "Ikkala usulni taqqosla", "Ularning farqi qanday?", "Сравни два подхода"])
    assert.equal(selectInstructionTask(message), "tutoring.compare-concepts");
  assert.equal(selectInstructionTask("Explain retrieval practice simply"), "tutoring.simple-explanation");
});

test("router validates teaching steps even when an adapter declares the capability; usage cannot bypass validation", async () => {
  const fixture = providerFor(simple);
  for (const teaching of [undefined, comparison, { ...simple, checkQuestion: "" }]) {
    const provider = { ...fixture.provider, respondToRiwi: async () => ({ ok: true as const,
      answer: { answer: "GENERIC_MUST_NOT_RENDER", uncertainty: null, citations: [] }, teaching,
      usage: { inputTokens: 4, outputTokens: 8 } }) };
    const result = await routeRiwiAnswer({ actor: { id: randomUUID(), role: "student" }, correlationId: randomUUID(), payload,
      instructionTask: "tutoring.simple-explanation" }, {
      readRollout: () => rollout, readConfig: async () => config, getProvider: () => provider, secretPresent: () => true,
      writeAudit: async () => {}, writeUsage: async () => {},
    });
    assert.equal(result.status, "external_unavailable");
    if (result.status === "external_unavailable") assert.equal(result.reason, "invalid_response");
  }
  const provider = { ...fixture.provider, respondToRiwi: async () => ({ ok: true as const,
    answer: { answer: "GENERIC_MUST_NOT_RENDER", uncertainty: null, citations: [] }, teaching: simple,
    usage: { inputTokens: 4, outputTokens: 8 } }) };
  const result = await routeRiwiAnswer({ actor: { id: randomUUID(), role: "student" }, correlationId: randomUUID(), payload,
    instructionTask: "tutoring.simple-explanation" }, {
    readRollout: () => rollout, readConfig: async () => config, getProvider: () => provider, secretPresent: () => true,
    writeAudit: async () => {}, writeUsage: async () => {},
  });
  assert.equal(result.status, "external_success");
  if (result.status === "external_success") {
    assert.ok(result.answer.includes(simple.checkQuestion));
    assert.ok(!result.answer.includes("GENERIC_MUST_NOT_RENDER"));
    assert.deepEqual(result.teachingContract, instructionContractTrace("tutoring.simple-explanation"));
  }
});

for (const key of INSTRUCTION_RUNTIME_KEYS.filter(key => key !== "grammar.explanation")) for (const role of ["student", "teacher", "admin", "owner"] as Role[])
  test(key + " / " + role + ": authenticated gateway, real SQL conversation and restored history preserve exact server provenance", async () => {
  const database = await createTestDatabase();
  const userId = randomUUID();
  const fixture = providerFor(key === "tutoring.simple-explanation" ? simple : comparison);
  const message = key === "tutoring.simple-explanation" ? "Explain retrieval practice simply" : "Explain the difference between retrieval practice and rereading";
  try {
    await database.query("insert into users(id,name,role,account_status,last_active_at)values($1,'Teaching QA',$2,'active',now())", [userId, role]);
    const deps = createRiwiGatewayDependencies(database.db);
    const overrides = { ...deps,
      authenticate: async () => ({ id: userId, name: "Teaching QA", email: null, role, accountStatus: "active" as const, locale: "en" as const, onboarded: true, statusReason: null }),
      rollout: () => rollout, consumeAccountLimit: () => ({ ok: true as const, remaining: 10, retryAfterSeconds: 0 }), externalEnabled: async () => true,
      isRegisteredProvider: (id: string) => id === fixture.provider.id,
      routeProvider: (input: Parameters<typeof routeRiwiAnswer>[0]) => routeRiwiAnswer(input, { readRollout: () => rollout, readConfig: async () => config,
        getProvider: () => fixture.provider, secretPresent: () => true, writeAudit: deps.writeAudit, writeUsage: async () => {} }),
    };
    const request = () => new Request("https://teaching.test.invalid/api/riwi/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message }) });
    const result = await runRiwiGateway(request(), overrides);
    assert.equal(result.status, 200);
    const body = riwiChatResponseSchema.parse(result.body);
    assert.equal(body.ok, true);
    assert.deepEqual(body.teachingContract, instructionContractTrace(key));
    assert.equal(fixture.calls.length, 1);
    assert.ok(!fixture.calls[0]!.user.includes(userId));
    const history = await getRiwiConversationTranscript({ actor: { id: userId, role }, conversationId: body.conversationId! }, database.db);
    assert.equal(history.length, 2);
    assert.deepEqual(history[1]!.teachingContract, body.teachingContract);
    assert.equal(history[1]!.content, body.answer);
    if (role === "student") {
      const denied = await runRiwiGateway(request(), { ...overrides, hasOpenExam: async () => true });
      assert.equal(riwiChatResponseSchema.parse(denied.body).errorCode, "riwi_exam_help_locked");
    }
    assert.equal(fixture.calls.length, 1, "an active exam cannot make a teaching call");
    const anonymous = await runRiwiGateway(request(), { ...overrides, authenticate: async () => null });
    assert.equal(anonymous.status, 401);
    assert.equal(fixture.calls.length, 1);
  } finally { await database.close(); }
});
