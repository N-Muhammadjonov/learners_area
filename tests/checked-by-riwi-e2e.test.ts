// Phase 4 proofs through the REAL resolver (the provider HTTP boundary is injected/mocked):
// whichever registered engine produced an accepted result, learners see RIWI while staff
// provenance retains the actual provider, model, versions, fallback, and correlation.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";
import { providerRegistry } from "../src/lib/services/coach/registry";
import type { EvaluationProvider } from "../src/lib/services/coach/types";
import { PUBLIC_CHECKED_BY, internalProvenance, staffProvenanceLabel } from "../src/lib/services/coach/attribution";
import { createOpenAiProvider } from "../src/lib/services/coach/providers/openai";
import { createAnthropicProvider } from "../src/lib/services/coach/providers/anthropic";
import { createCompatibleProvider, parseCompatibleProviders } from "../src/lib/services/coach/providers/compatible";
import { getDictionary } from "../src/lib/i18n";

const output = {
  overallEstimate: null, confidence: 0.7, verdict: "mostly_correct",
  criteria: [{ key: "grammar", label: "Grammar", band: null, limited: false, note: null }],
  strengths: ["clear"], weaknesses: [], nextActions: [], issues: [], recommendedExercises: [],
};
const request = { evaluationType: "grammar", input: { promptText: "Fix it", studentAnswer: "She go home", targetStructure: null, sampleAnswer: null } } as Parameters<typeof resolveEvaluation>[0];
const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
const REQUEST_CORRELATION = "ea4f2f25-92a7-43f2-b22b-29eaf4f9e7a0";
const VENDORS = /openai|anthropic|claude|gemini|grok|deepseek|mistral|gpt-|test-model/i;

type TestEnvironment = Record<string, string | undefined>;
async function withEnv(vars: TestEnvironment, run: () => Promise<void>) {
  const saved = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { await run(); } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function withRegisteredProvider(provider: EvaluationProvider, run: () => Promise<void>) {
  const originals = providerRegistry.ids().flatMap((id) => {
    const registered = providerRegistry.get(id);
    return registered ? [registered.provider] : [];
  });
  providerRegistry.register(provider);
  try { await run(); } finally {
    providerRegistry.clear();
    for (const original of originals) providerRegistry.register(original);
  }
}

function openAiReply(value: unknown, status = 200) {
  return {
    status, contentType: "application/json",
    text: status >= 200 && status < 300
      ? JSON.stringify({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(value) }] }] })
      : "fixed mocked upstream failure body",
  };
}
function anthropicReply(value: unknown, status = 200) {
  return {
    status, contentType: "application/json",
    text: status >= 200 && status < 300
      ? JSON.stringify({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(value) }] })
      : "fixed mocked upstream failure body",
  };
}
function compatibleReply(value: unknown, status = 200) {
  return {
    status, contentType: "application/json",
    text: status >= 200 && status < 300
      ? JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }] })
      : "fixed mocked upstream failure body",
  };
}

/** The learner-facing projection is deliberately not provider metadata. */
function learnerView(_result: { checkedBy: unknown }) {
  return { checkedBy: PUBLIC_CHECKED_BY };
}

test("E1 OpenAI-backed result: resolver validates the adapter output, learner sees RIWI, provenance keeps OpenAI + model", async () => {
  await withEnv({ OPENAI_API_KEY: "test-key", OPENAI_EVALUATION_MODEL: "gpt-test-model" }, async () => {
    const provider = createOpenAiProvider({
      request: async (url, _headers, _body, options) => {
        assert.equal(String(url), "https://api.openai.com/v1/responses");
        assert.deepEqual(options?.allowHosts, ["api.openai.com"]);
        return openAiReply(output);
      },
    });
    await withRegisteredProvider(provider, async () => {
      const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai", maxAttempts: 1 });
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.result.evaluationType, "grammar");
      assert.match(out.result.evaluationId, /^[0-9a-f-]{36}$/i);
      assert.equal(out.result.providerId, "openai");
      assert.equal(out.result.providerDisplayName, "OpenAI");
      assert.equal(out.result.providerType, "external");
      assert.equal(out.result.providerVersion, "1");
      assert.equal(out.result.model, "gpt-test-model");
      assert.equal(out.result.fallbackUsed, false);
      assert.equal(out.attempts[0]?.outcome, "succeeded", "a validated provider output is accepted through the real resolver");
      assert.equal(learnerView(out.result).checkedBy, "RIWI");
      assert.doesNotMatch(JSON.stringify(learnerView(out.result)), VENDORS);
      assert.match(staffProvenanceLabel(out.result), /OpenAI \(openai, external\).*model gpt-test-model/);
    });
  });
});

test("E2 Anthropic/Claude-backed result uses the Messages adapter but the same RIWI identity and truthful provenance", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_EVALUATION_MODEL: "claude-test-model" }, async () => {
    const provider = createAnthropicProvider({
      request: async (url, headers, body, options) => {
        assert.equal(String(url), "https://api.anthropic.com/v1/messages");
        assert.equal(headers["anthropic-version"], "2023-06-01");
        assert.equal(options?.allowHosts?.[0], "api.anthropic.com");
        assert.equal(typeof JSON.parse(body).system, "string", "Anthropic's native system field is used");
        return anthropicReply(output);
      },
    });
    await withRegisteredProvider(provider, async () => {
      const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "anthropic", maxAttempts: 1 });
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.result.providerId, "anthropic");
      assert.equal(out.result.providerType, "external");
      assert.equal(out.result.providerVersion, "1");
      assert.equal(out.result.model, "claude-test-model");
      assert.equal(out.result.fallbackUsed, false);
      assert.equal(learnerView(out.result).checkedBy, "RIWI");
      assert.doesNotMatch(JSON.stringify(learnerView(out.result)), VENDORS);
      assert.match(staffProvenanceLabel(out.result), /Anthropic \(anthropic, external\).*claude-test-model/);
    });
  });
});

test("E3 external failure falls back to the real RIWI evaluator; public identity stays RIWI and internal metadata says RIWI, no model", async () => {
  await withEnv({ OPENAI_API_KEY: "test-key", OPENAI_EVALUATION_MODEL: "gpt-primary-model" }, async () => {
    let requests = 0;
    const provider = createOpenAiProvider({ request: async () => {
      requests += 1;
      return openAiReply({}, 503);
    } });
    await withRegisteredProvider(provider, async () => {
      const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai", maxAttempts: 1 }, { fallback: "riwi" });
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(requests, 1, "the configured primary was attempted once");
      assert.equal(out.result.providerId, "riwi");
      assert.equal(out.result.providerDisplayName, "RIWI");
      assert.equal(out.result.providerType, "internal");
      assert.equal(out.result.model, null, "the deterministic RIWI fallback has no model");
      assert.equal(out.result.fallbackUsed, true);
      assert.equal(out.result.fallbackFrom, "openai");
      assert.equal(out.attempts[0]?.outcome, "failed");
      assert.equal(out.attempts[1]?.providerId, "riwi");
      assert.equal(out.attempts[1]?.outcome, "succeeded");
      assert.equal(learnerView(out.result).checkedBy, "RIWI");
      assert.match(staffProvenanceLabel(out.result), /RIWI \(riwi, internal\).*fallback from openai/);
    });
  });
});

test("E4 internal trace preserves evaluation identity, truthful provider metadata, validation and request correlation without secrets", async () => {
  await withEnv({ OPENAI_API_KEY: "TEST-SECRET-KEY-XYZ", OPENAI_EVALUATION_MODEL: "gpt-test-model" }, async () => {
    const provider = createOpenAiProvider({ request: async () => openAiReply(output) });
    await withRegisteredProvider(provider, async () => {
      const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai", maxAttempts: 1 });
      assert.ok(out.ok);
      if (!out.ok) return;
      const prov = internalProvenance({ ...out.result, createdAt: new Date(out.result.createdAt),
        correlationId: REQUEST_CORRELATION, validationStatus: "validated" });
      assert.deepEqual(Object.keys(prov).sort(), [
        "assessmentContractKey", "correlationId", "createdAt", "evaluationId", "evaluationType", "fallbackFrom", "fallbackUsed", "model",
        "ownerPolicyVersion", "promptVersion", "providerDisplayName", "providerId", "providerType", "providerVersion", "rubricVersion", "validationStatus",
      ]);
      assert.equal(prov.evaluationId, out.result.evaluationId);
      assert.equal(prov.evaluationType, "grammar");
      assert.equal(prov.assessmentContractKey, "grammar.activate-it");
      assert.equal(prov.ownerPolicyVersion, null);
      assert.equal(prov.correlationId, REQUEST_CORRELATION);
      assert.equal(prov.validationStatus, "validated");
      assert.equal(prov.providerId, "openai");
      assert.equal(prov.model, "gpt-test-model");
      assert.equal(prov.fallbackUsed, false);
      assert.ok(!JSON.stringify(prov).includes("TEST-SECRET-KEY-XYZ"), "no secret in the internal projection");
      assert.ok(!JSON.stringify(out).includes("TEST-SECRET-KEY-XYZ"), "no secret in resolver output");
    });
  });
});

test("E5 compatible-protocol result goes through the same resolver validation and RIWI attribution (not a native-vendor claim)", async () => {
  await withEnv({ AI_COMPATIBLE_E2E_KEY: "test-compatible-key" }, async () => {
    const host = "api.compatible.example";
    const config = parseCompatibleProviders(JSON.stringify([{
      id: "compat-e2e", displayName: "Compatible fixture", baseURL: `https://${host}/v1`,
      model: "compatible-test-model", secretRef: "AI_COMPATIBLE_E2E_KEY",
    }]), host);
    assert.equal(config.issues.length, 0);
    const entry = config.entries[0];
    assert.ok(entry);
    const provider = createCompatibleProvider(entry, {
      allowHosts: [host],
      request: async (url, headers, body, options) => {
        assert.equal(String(url), `https://${host}/v1/chat/completions`);
        assert.equal(headers.Authorization, "Bearer test-compatible-key");
        assert.deepEqual(options?.allowHosts, [host]);
        assert.equal(JSON.parse(body).model, "compatible-test-model");
        return compatibleReply(output);
      },
    });
    await withRegisteredProvider(provider, async () => {
      const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "compat-e2e", maxAttempts: 1 });
      assert.ok(out.ok);
      if (!out.ok) return;
      assert.equal(out.result.providerId, "compat-e2e");
      assert.equal(out.result.providerDisplayName, "Compatible fixture");
      assert.equal(out.result.providerType, "external");
      assert.equal(out.result.providerVersion, "compat-1");
      assert.equal(out.result.model, "compatible-test-model");
      assert.equal(out.result.fallbackUsed, false);
      assert.equal(learnerView(out.result).checkedBy, "RIWI");
      assert.doesNotMatch(JSON.stringify(learnerView(out.result)), VENDORS);
    });
  });
});

test("E6 public label is localized around the fixed RIWI brand", () => {
  const en = getDictionary("en");
  const uz = getDictionary("uz");
  assert.equal(`${en.coach.checkedBy} ${PUBLIC_CHECKED_BY}`, "Checked by RIWI");
  assert.match(`${uz.coach.checkedBy} ${PUBLIC_CHECKED_BY}`, /^Tekshir(di|gan) RIWI$/);
  assert.doesNotMatch(JSON.stringify([en.coach.checkedBy, uz.coach.checkedBy]), VENDORS);
});
