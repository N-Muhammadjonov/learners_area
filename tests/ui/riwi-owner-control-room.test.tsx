import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerRiwiControlRoom } from "../../src/components/riwi/OwnerRiwiControlRoom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

const provider = {
  id: "openai", displayName: "OpenAI", model: "gpt-test", capabilities: ["riwi-assistant"],
  secretsPresent: false, missingSecretNames: ["OPENAI_API_KEY"],
};
const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/owner/riwi" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "Element", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const query = <T extends Element>(selector: string) => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, selector);
  return found;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function experiment(id: string, createdAt: string) {
  return {
    id, taskProfile: "riwi_chat", fixtureId: "safe-grammar-explanation-v1", providers: ["openai"], state: "completed" as const,
    createdAt, completedAt: createdAt,
    comparison: null,
    results: [],
  };
}

test("owner provider UI offers only built-in fixtures and exposes readiness without secret values", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiControlRoom, {
    providers: [provider],
    enabled: { owner: true, providerLab: false, externalAi: false },
    initialExperiments: [],
    initialNextCursor: null,
    initialExperimentCount: 0,
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
    initialNextCursor: null,
    initialExperimentCount: 1,
    text: en.riwiLab,
  }));
  assert.ok(html.includes("Normalized answer text differs; review both outputs."));
  assert.ok(html.includes("Text comparison only—not semantic equivalence, factual accuracy, or model quality."));
  assert.ok(html.includes("input/output tokens 40/12"));
  assert.ok(html.includes("cost unknown"));
});

test("owner provider history clears cached experiments after role authorization is revoked", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => json({ error: { code: "owner_required" } }, 403)) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiControlRoom
      providers={[provider]}
      enabled={{ owner: true, providerLab: true, externalAi: false }}
      initialExperiments={[experiment("11111111-2222-4333-8444-555555555555", "2026-10-04T00:00:00.000Z")]}
      initialNextCursor="revoked-cursor"
      initialExperimentCount={2}
      text={en.riwiLab}
    />));
    const button = [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((item) => item.textContent?.trim() === "Load more experiments");
    assert.ok(button);
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(document.querySelectorAll("[data-experiment]").length, 0, "history loaded under the old owner role is discarded");
    assert.ok(!document.body.textContent?.includes("2 of 1 experiments loaded."));
    assert.ok(document.body.textContent?.includes("The experiment could not be completed safely."));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("owner provider history count and load-more label are localized in Uzbek", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiControlRoom, {
    providers: [provider],
    enabled: { owner: true, providerLab: true, externalAi: false },
    initialExperiments: [experiment("11111111-2222-4333-8444-555555555555", "2026-10-04T00:00:00.000Z")],
    initialNextCursor: "owner-history-cursor",
    initialExperimentCount: 2,
    text: uz.riwiLab,
  }));
  assert.ok(html.includes("2 tajribadan 1 tasi yuklandi."));
  assert.ok(html.includes("Yana tajriba yuklash"));
});

test("owner provider history load-more preserves the page on failure, deduplicates retry results, and rejects reentry", async () => {
  const originalFetch = globalThis.fetch;
  const first = experiment("11111111-2222-4333-8444-555555555555", "2026-10-04T00:00:00.000Z");
  const next = experiment("22222222-3333-4444-8555-666666666666", "2026-10-04T00:00:01.000Z");
  const requests: string[] = [];
  let releaseFirst: ((response: Response) => void) | undefined;
  globalThis.fetch = (async (url: string | URL | Request) => {
    requests.push(String(url));
    if (requests.length === 1) return new Promise<Response>((resolve) => { releaseFirst = resolve; });
    return json({ ok: true, experiments: [first, next], nextCursor: null, experimentCount: 2 });
  }) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiControlRoom
      providers={[provider]}
      enabled={{ owner: true, providerLab: true, externalAi: false }}
      initialExperiments={[first]}
      initialNextCursor="cursor-one"
      initialExperimentCount={2}
      text={en.riwiLab}
    />));
    const loadButton = () => [...document.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.trim() === "Load more experiments" || button.textContent?.trim() === "Retry history page");
    const button = loadButton();
    assert.ok(button);
    await act(async () => {
      button.click();
      button.click();
      await Promise.resolve();
    });
    assert.equal(requests.length, 1, "same-event double clicks cannot reenter the owner history request");
    assert.equal(button.disabled, true);
    assert.ok(releaseFirst);
    await act(async () => { releaseFirst!(json({ error: { code: "riwi_provider_lab_unavailable" } }, 503)); });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(document.querySelectorAll("[data-experiment]").length, 1, "a failed page does not replace the existing experiment");
    assert.ok(document.body.textContent?.includes("Could not load the next history page."));

    const retry = loadButton();
    assert.ok(retry);
    await act(async () => { retry.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(requests.length, 2);
    assert.equal(requests[0], requests[1], "retry uses the same navigation cursor");
    assert.equal(document.querySelectorAll("[data-experiment]").length, 2, "overlapping ids are deduplicated when a page succeeds");
    assert.ok(document.body.textContent?.includes("2 of 2 experiments loaded."));
    assert.equal(loadButton(), undefined, "the terminal page removes the load-more control");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});
