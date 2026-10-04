import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerRiwiControlRoom } from "../../src/components/riwi/OwnerRiwiControlRoom";
import en from "../../src/lib/i18n/en";

const provider = {
  id: "openai", displayName: "OpenAI", model: "gpt-test", capabilities: ["riwi-assistant"],
  secretsPresent: false, missingSecretNames: ["OPENAI_API_KEY"],
};

test("owner provider UI offers only built-in fixtures and exposes readiness without secret values", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiControlRoom, {
    providers: [provider],
    enabled: { owner: true, providerLab: false, externalAi: false },
    initialExperiments: [],
    text: en.riwiLab,
  }));
  assert.ok(html.includes("Fixed-fixture provider lab"));
  assert.ok(html.includes("safe-grammar-explanation-v1"));
  assert.ok(html.includes("knowledge-untrusted-data-v1"));
  assert.ok(html.includes("OPENAI_API_KEY"), "owner gets the missing environment-variable name, not its value");
  assert.ok(!html.includes("sk-live-example-secret"));
  assert.ok(html.includes("No provider experiments have been recorded."));
  assert.ok(html.includes("RIWI_PROVIDER_LAB_ENABLED is off"));
  assert.ok(/<button[^>]*disabled/.test(html), "the run action is disabled until the owner rollout enables the lab");
  assert.ok(!html.includes("<textarea"), "no learner prompt or arbitrary payload field is offered");
});

test("owner provider UI labels literal answer comparisons without implying semantic quality", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiControlRoom, {
    providers: [provider],
    enabled: { owner: true, providerLab: true, externalAi: true },
    initialExperiments: [{
      id: "11111111-2222-4333-8444-555555555555",
      taskProfile: "riwi_chat",
      fixtureId: "safe-grammar-explanation-v1",
      providers: ["openai", "anthropic"],
      state: "completed",
      createdAt: "2026-10-04T00:00:00.000Z",
      completedAt: "2026-10-04T00:00:01.000Z",
      comparison: { method: "normalized_exact_answer_text", status: "compared", providerIds: ["openai", "anthropic"], exactAnswerMatch: false },
      results: ["openai", "anthropic"].map((providerId) => ({
        providerId,
        model: "fixed-model",
        state: "succeeded",
        normalizedResult: { answer: "Safe fixture answer.", uncertainty: null, citations: [] },
        durationMs: 120,
        inputTokens: 40,
        outputTokens: 12,
        estimatedCostMicros: null,
        safeErrorCode: null,
      })),
    }],
    text: en.riwiLab,
  }));
  assert.ok(html.includes("Normalized answer text differs; review both outputs."));
  assert.ok(html.includes("Text comparison only—not semantic equivalence, factual accuracy, or model quality."));
  assert.ok(html.includes("input/output tokens 40/12"));
  assert.ok(html.includes("cost unknown"));
});
