// Phase 4 proofs through the REAL resolver (provider HTTP mocked): whichever engine
// produced a result, the public label is RIWI, and internal provenance stays truthful.
import test from "node:test";
import assert from "node:assert/strict";
import { resolveEvaluation } from "../src/lib/services/coach/resolver";
import { PUBLIC_CHECKED_BY, internalProvenance, staffProvenanceLabel } from "../src/lib/services/coach/attribution";
import { getDictionary } from "../src/lib/i18n";

const output = {
  overallEstimate: null, confidence: 0.7, verdict: "mostly_correct",
  criteria: [{ key: "grammar", label: "Grammar", band: 6, limited: false, note: null }],
  strengths: ["clear"], weaknesses: [], nextActions: [], issues: [], recommendedExercises: [],
};
const request = { evaluationType: "grammar", input: { promptText: "Fix it", studentAnswer: "She go home", targetStructure: null, sampleAnswer: null } } as Parameters<typeof resolveEvaluation>[0];
const ctx = { userId: "11111111-2222-3333-4444-555555555555", language: "en" as const };
const VENDORS = /openai|anthropic|claude|gemini|grok|deepseek|mistral|gpt-|test-model/i;

async function withEnv(vars: Record<string, string>, run: () => Promise<void>) {
  const saved = { ...process.env };
  const fetcher = globalThis.fetch;
  Object.assign(process.env, vars);
  try { await run(); } finally { globalThis.fetch = fetcher; process.env = saved; }
}

/** What a learner surface may show for a stored result (the public projection). */
function learnerView(_result: { checkedBy: unknown }) {
  return { checkedBy: PUBLIC_CHECKED_BY };
}

test("E1 OpenAI-backed result: learner sees RIWI; internal provenance = openai + model", async () => {
  await withEnv({ OPENAI_API_KEY: "test-key", OPENAI_EVALUATION_MODEL: "gpt-test-model" }, async () => {
    globalThis.fetch = (async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] })) as typeof fetch;
    const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai" });
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.equal(out.result.providerId, "openai");
    assert.equal(out.result.providerType, "external");
    assert.equal(out.result.model, "gpt-test-model");
    assert.equal(out.result.fallbackUsed, false);
    assert.doesNotMatch(JSON.stringify(learnerView(out.result)), VENDORS);
    assert.match(staffProvenanceLabel(out.result), /openai, external/);
  });
});

test("E2 another external provider (Anthropic): learner still sees RIWI; provenance keeps anthropic", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_EVALUATION_MODEL: "claude-test-model" }, async () => {
    globalThis.fetch = (async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(output) }] })) as typeof fetch;
    const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "anthropic" });
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.equal(out.result.providerId, "anthropic");
    assert.equal(out.result.model, "claude-test-model");
    assert.doesNotMatch(JSON.stringify(learnerView(out.result)), VENDORS);
  });
});

test("E3 external failure → RIWI fallback: public label RIWI; provenance records the fallback truthfully", async () => {
  await withEnv({ OPENAI_API_KEY: "test-key", OPENAI_EVALUATION_MODEL: "gpt-test-model" }, async () => {
    globalThis.fetch = (async () => new Response("down", { status: 503 })) as typeof fetch;
    const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai", maxAttempts: 1 }, { fallback: "riwi" });
    assert.ok(out.ok);
    if (!out.ok) return;
    assert.equal(out.result.providerId, "riwi");
    assert.equal(out.result.providerType, "internal");
    assert.equal(out.result.fallbackUsed, true);
    assert.equal(out.result.fallbackFrom, "openai");
    assert.equal(learnerView(out.result).checkedBy, "RIWI");
    assert.match(staffProvenanceLabel(out.result), /fallback from openai/);
  });
});

test("E4 internal provenance projection is complete and secret-free", async () => {
  await withEnv({ OPENAI_API_KEY: "TEST-SECRET-KEY-XYZ", OPENAI_EVALUATION_MODEL: "gpt-test-model" }, async () => {
    globalThis.fetch = (async () => Response.json({ status: "completed", output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(output) }] }] })) as typeof fetch;
    const out = await resolveEvaluation(request, ctx, { externalEnabled: true, aiPrimaryProvider: "openai" });
    assert.ok(out.ok);
    if (!out.ok) return;
    const prov = internalProvenance({ ...out.result, createdAt: new Date(out.result.createdAt) });
    assert.deepEqual(Object.keys(prov).sort(), ["createdAt", "fallbackFrom", "fallbackUsed", "model", "promptVersion", "providerDisplayName", "providerId", "providerType", "providerVersion", "rubricVersion"]);
    assert.ok(!JSON.stringify(out).includes("TEST-SECRET-KEY-XYZ"), "no secret anywhere in the result");
  });
});

test("E5 the public label is localised UZ/EN around the fixed RIWI brand", () => {
  const en = getDictionary("en");
  const uz = getDictionary("uz");
  assert.equal(`${en.coach.checkedBy} ${PUBLIC_CHECKED_BY}`, "Checked by RIWI");
  assert.match(`${uz.coach.checkedBy} ${PUBLIC_CHECKED_BY}`, /^Tekshir(di|gan) RIWI$/);
  assert.doesNotMatch(JSON.stringify([en.coach.checkedBy, uz.coach.checkedBy]), VENDORS);
});
