import assert from "node:assert/strict";
import test from "node:test";
import type { CoachConfig } from "../src/lib/services/coach/config";
import type { EvaluationProvider, RiwiProviderInput, RiwiProviderResult } from "../src/lib/services/coach/types";
import {
  RIWI_ROUTER_TIMEOUT_MS,
  RIWI_TASK_PROFILES,
  routeRiwiAnswer,
  type RiwiProviderRouterDependencies,
} from "../src/lib/services/riwi/provider-router";
import type { RiwiGatewayAuditInput } from "../src/lib/services/riwi/gateway";
import type { RiwiRollout } from "../src/lib/services/riwi/rollout";
import type { Role } from "../src/lib/auth/roles";

const ACTOR_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const CORRELATION_ID = "bbbbbbbb-0000-4000-8000-000000000001";
const roles: Record<Role, boolean> = { student: true, teacher: true, admin: true, owner: true };
const enabledRollout: RiwiRollout = {
  enabled: true, roles, externalAi: true, knowledgeLearning: true, providerLab: true,
};
const enabledConfig: CoachConfig = {
  aiPrimaryProvider: "openai", externalEnabled: true, timeoutMs: 20_000, maxAttempts: 2,
  retryBackoffMs: 200, sttPrimaryProvider: "none", modelOverride: "owner-selected-model", ownerFallback: "none",
};
const payload: RiwiProviderInput = {
  language: "en", message: "Explain an approved grammar point for learner@example.test.", history: [],
  knowledge: [{ ref: "K1", text: "Approved grammar excerpt.", authority: 65, version: 2 }],
};

type RiwiHandler = NonNullable<EvaluationProvider["respondToRiwi"]>;

type RouterState = {
  calls: Array<{ userId: string; model: string | undefined; payload: RiwiProviderInput; signal: AbortSignal | undefined }>;
  audits: RiwiGatewayAuditInput[];
  usage: Array<{ state: string; providerId: string | null; model: string | null; durationMs: number }>;
};

function makeFixture(input: {
  respond?: RiwiHandler;
  provider?: EvaluationProvider | null;
  requiredSecrets?: string[];
  overrides?: Partial<RiwiProviderRouterDependencies>;
} = {}) {
  const state: RouterState = { calls: [], audits: [], usage: [] };
  const provider: EvaluationProvider = input.provider ?? {
    id: "openai", displayName: "OpenAI test adapter", type: "external", version: "test/1", model: "registered-model",
    capabilities: ["riwi-assistant"], requiredSecrets: input.requiredSecrets ?? [], promptVersion: "test/1", rubricVersion: "test/1",
    respondToRiwi: async (context, request) => {
      state.calls.push({ userId: context.userId, model: context.model, payload: request, signal: context.signal });
      return input.respond ? input.respond(context, request) : {
        ok: true,
        answer: { answer: "Contact learner@example.test for this grammar point.", uncertainty: "Call +1 415 555 0199 if you need help.", citations: ["K1"] },
      };
    },
  };
  const defaults: RiwiProviderRouterDependencies = {
    readRollout: () => enabledRollout,
    readConfig: async () => enabledConfig,
    getProvider: (providerId) => providerId === "openai" ? provider : null,
    secretPresent: () => true,
    writeAudit: async (event) => { state.audits.push(event); },
    writeUsage: async (event) => { state.usage.push({ state: event.state, providerId: event.providerId, model: event.model, durationMs: event.durationMs }); },
    now: () => Date.now(),
    timeoutMs: RIWI_ROUTER_TIMEOUT_MS,
  };
  return { dependencies: { ...defaults, ...input.overrides }, state };
}

const request = (overrides: Partial<Parameters<typeof routeRiwiAnswer>[0]> = {}) => ({
  actor: { id: ACTOR_ID, role: "student" as const }, correlationId: CORRELATION_ID, payload, ...overrides,
});

test("router sends one minimized request to the configured registered assistant and validates the normalized answer", async () => {
  const fixture = makeFixture();
  const result = await routeRiwiAnswer(request(), fixture.dependencies);
  assert.equal(result.status, "external_success");
  if (result.status !== "external_success") return;
  assert.equal(result.providerId, "openai");
  assert.equal(result.model, "owner-selected-model", "only the owner-selected model for this registered provider is forwarded");
  assert.ok(!result.answer.includes("learner@example.test"));
  assert.ok(!result.answer.includes("415 555 0199"));
  assert.ok(result.answer.includes("[redacted]"));
  assert.ok(result.uncertainty?.includes("[redacted]"));
  assert.deepEqual(result.citations, ["K1"]);
  assert.equal(fixture.state.calls.length, 1, "the router never retries or performs a second call");
  assert.equal(fixture.state.calls[0]?.userId, "external-anonymous");
  assert.equal(fixture.state.calls[0]?.model, "owner-selected-model");
  assert.ok(!JSON.stringify(fixture.state.calls[0]?.payload).includes(ACTOR_ID));
  assert.ok(!JSON.stringify(fixture.state.calls[0]?.payload).includes("learner@example.test"));
  assert.ok(fixture.state.audits.some((event) => event.action === "riwi.external.requested"));
  assert.ok(fixture.state.audits.some((event) => event.action === "riwi.external.succeeded"));
  assert.deepEqual(fixture.state.usage.map((event) => event.state), ["succeeded"]);
});

test("rollout, owner policy, registry, capability, secret and task-profile gates all fail before provider execution", async () => {
  const cases: Array<{
    name: string;
    profile?: string;
    overrides?: Partial<RiwiProviderRouterDependencies>;
    provider?: EvaluationProvider | null;
    requiredSecrets?: string[];
    reason: string;
  }> = [
    { name: "global rollout", overrides: { readRollout: () => ({ ...enabledRollout, enabled: false }) }, reason: "disabled" },
    { name: "role rollout", overrides: { readRollout: () => ({ ...enabledRollout, roles: { ...roles, student: false } }) }, reason: "disabled" },
    { name: "external rollout", overrides: { readRollout: () => ({ ...enabledRollout, externalAi: false }) }, reason: "disabled" },
    { name: "owner switch", overrides: { readConfig: async () => ({ ...enabledConfig, externalEnabled: false }) }, reason: "disabled" },
    { name: "unregistered provider", overrides: { getProvider: () => null }, reason: "not_configured" },
    {
      name: "internal provider cannot be used for an external request",
      provider: { ...makeFixture().dependencies.getProvider("openai")!, type: "internal" }, reason: "not_configured",
    },
    {
      name: "missing assistant capability",
      provider: { ...makeFixture().dependencies.getProvider("openai")!, capabilities: ["text-evaluation"] }, reason: "capability_missing",
    },
    { name: "missing provider secret", requiredSecrets: ["OPENAI_API_KEY"], overrides: { secretPresent: () => false }, reason: "not_configured" },
    { name: "reserved evaluation profile", profile: "writing_high_stakes", reason: "capability_missing" },
    { name: "unknown profile", profile: "arbitrary-profile", reason: "invalid_request" },
    { name: "malformed outbound DTO", overrides: {}, reason: "invalid_request" },
  ];

  for (const item of cases) {
    const fixture = makeFixture({ provider: item.provider, requiredSecrets: item.requiredSecrets, overrides: item.overrides });
    const body = item.name === "malformed outbound DTO"
      ? { ...request(), payload: { ...payload, provider: "attacker-choice" } as unknown as RiwiProviderInput }
      : request(item.profile ? { profile: item.profile as Parameters<typeof routeRiwiAnswer>[0]["profile"] } : {});
    const result = await routeRiwiAnswer(body, fixture.dependencies);
    assert.equal(result.status, "external_unavailable", item.name);
    if (result.status === "external_unavailable") assert.equal(result.reason, item.reason, item.name);
    assert.equal(fixture.state.calls.length, 0, `${item.name} must not call a provider`);
  }
  assert.ok(RIWI_TASK_PROFILES.includes("riwi_chat"));
});

test("disabled rollout is evaluated before provider or owner configuration is read", async () => {
  let configReads = 0;
  const fixture = makeFixture({ overrides: {
    readRollout: () => ({ ...enabledRollout, externalAi: false }),
    readConfig: async () => { configReads += 1; throw new Error("provider configuration should not be consulted"); },
  } });
  const result = await routeRiwiAnswer(request(), fixture.dependencies);
  assert.equal(result.status, "external_unavailable");
  if (result.status === "external_unavailable") assert.equal(result.reason, "disabled");
  assert.equal(configReads, 0);
  assert.equal(fixture.state.calls.length, 0);
});

test("request-audit failure blocks the external call, while usage/audit failure stays bounded and safe", async () => {
  const fixture = makeFixture({ overrides: {
    writeAudit: async (event) => {
      if (event.action === "riwi.external.requested") throw new Error("audit unavailable");
      fixture.state.audits.push(event);
    },
  } });
  const result = await routeRiwiAnswer(request(), fixture.dependencies);
  assert.deepEqual(result.status === "external_unavailable" ? [result.reason, result.providerId] : null, ["provider_error", "openai"]);
  assert.equal(fixture.state.calls.length, 0);
  assert.ok(fixture.state.audits.some((event) => event.action === "riwi.external.failed"));
  assert.deepEqual(fixture.state.usage.map((event) => event.state), ["provider_error"]);

  const completedAuditFailure = makeFixture({ overrides: {
    writeAudit: async (event) => {
      if (event.action === "riwi.external.succeeded") throw new Error("completion audit unavailable");
      completedAuditFailure.state.audits.push(event);
    },
  } });
  const withheld = await routeRiwiAnswer(request(), completedAuditFailure.dependencies);
  assert.equal(withheld.status, "external_unavailable");
  if (withheld.status === "external_unavailable") assert.equal(withheld.reason, "provider_error");
  assert.equal(completedAuditFailure.state.calls.length, 1, "one call may finish, but an unaudited answer is withheld");
});

test("runtime adapter outputs are schema-checked and citations must belong to the exact guarded context", async () => {
  for (const bad of [
    { ok: false } as unknown as RiwiProviderResult,
    { ok: true, answer: { answer: "No citation", uncertainty: null, citations: ["K2"] } } as RiwiProviderResult,
    { ok: true, answer: { answer: "Call tool", uncertainty: null, citations: [], toolCall: "riwi.owner.promote" } } as unknown as RiwiProviderResult,
  ]) {
    const fixture = makeFixture({ respond: async () => bad });
    const result = await routeRiwiAnswer(request(), fixture.dependencies);
    assert.equal(result.status, "external_unavailable");
    if (result.status === "external_unavailable") assert.equal(result.reason, "invalid_response");
  }
});

test("router bounds timeouts, aborts transport, propagates caller cancellation, and fails closed on policy errors", async () => {
  let timeoutAborted = false;
  const timed = makeFixture({
    respond: async (context) => new Promise<RiwiProviderResult>((resolve) => {
      context.signal?.addEventListener("abort", () => { timeoutAborted = true; resolve({
        ok: false, failure: { reason: "cancelled", detail: "aborted", retryable: false },
      }); }, { once: true });
    }),
    overrides: { timeoutMs: 5 },
  });
  const timeoutResult = await routeRiwiAnswer(request(), timed.dependencies);
  assert.equal(timeoutResult.status, "external_unavailable");
  if (timeoutResult.status === "external_unavailable") assert.equal(timeoutResult.reason, "timeout");
  assert.equal(timeoutAborted, true);

  let callerAbortSeen = false;
  const cancelled = makeFixture({
    respond: async (context) => new Promise<RiwiProviderResult>((resolve) => {
      context.signal?.addEventListener("abort", () => { callerAbortSeen = true; resolve({
        ok: false, failure: { reason: "cancelled", detail: "aborted", retryable: false },
      }); }, { once: true });
    }),
    overrides: { timeoutMs: 1000 },
  });
  const controller = new AbortController();
  const pending = routeRiwiAnswer(request({ signal: controller.signal }), cancelled.dependencies);
  setTimeout(() => controller.abort(), 5);
  const cancelResult = await pending;
  assert.equal(cancelResult.status, "external_unavailable");
  if (cancelResult.status === "external_unavailable") assert.equal(cancelResult.reason, "cancelled");
  assert.equal(callerAbortSeen, true);

  const policyFailure = makeFixture({ overrides: { readConfig: async () => { throw new Error("owner control unreadable"); } } });
  const refused = await routeRiwiAnswer(request(), policyFailure.dependencies);
  assert.equal(refused.status, "external_unavailable");
  if (refused.status === "external_unavailable") assert.equal(refused.reason, "policy_unavailable");
  assert.equal(policyFailure.state.calls.length, 0);
});

test("a request cancelled while its outbound audit is committed never calls the provider", async () => {
  const controller = new AbortController();
  const fixture = makeFixture({ overrides: {
    writeAudit: async (event) => {
      fixture.state.audits.push(event);
      if (event.action === "riwi.external.requested") {
        // The request can end during the awaited audit, before the transport
        // cancellation listener is attached. Reproduce without a timer race.
        await Promise.resolve();
        controller.abort();
      }
    },
  } });
  const result = await routeRiwiAnswer(request({ signal: controller.signal }), fixture.dependencies);
  assert.equal(result.status, "external_unavailable");
  if (result.status === "external_unavailable") assert.equal(result.reason, "cancelled");
  assert.equal(fixture.state.calls.length, 0);
  assert.deepEqual(fixture.state.usage.map((event) => event.state), ["cancelled"]);
  assert.ok(!fixture.state.audits.some((event) => event.action === "riwi.external.succeeded"));
});

test("a rejected provider call is a provider error, distinct from a malformed returned DTO", async () => {
  const fixture = makeFixture({ respond: async () => {
    throw new Error("private provider transport diagnostic must not escape");
  } });
  const result = await routeRiwiAnswer(request(), fixture.dependencies);
  assert.equal(result.status, "external_unavailable");
  if (result.status === "external_unavailable") assert.equal(result.reason, "provider_error");
  assert.equal(fixture.state.calls.length, 1);
  assert.deepEqual(fixture.state.usage.map((event) => event.state), ["provider_error"]);
  assert.ok(!JSON.stringify([result, fixture.state.audits, fixture.state.usage]).includes("private provider transport diagnostic"));
});
