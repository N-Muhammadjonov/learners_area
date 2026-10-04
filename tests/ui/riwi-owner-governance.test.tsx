import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { renderToStaticMarkup } from "react-dom/server";
import { OwnerRiwiGovernance } from "../../src/components/riwi/OwnerRiwiGovernance";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/owner/riwi" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event", "File"] as const) {
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
const diagnostics = {
  ok: true,
  rollout: { roles: { student: false, teacher: false, admin: false, owner: false }, providerLab: false, externalAi: false },
  providerReadiness: [], effectiveProvider: { enabled: false, providerId: "riwi", external: false, ready: false },
  aiPolicy: { deploymentCeiling: false, ownerSwitch: false, configuredPrimaryProvider: null, configuredModel: null, effectivePrimaryProvider: "riwi", effectiveModel: null, fallback: "riwi", enabled: false, ready: false },
  configIssues: [], governance: { openConflicts: 0, pendingKnowledgeCandidates: 0, approvedKnowledgeSources: 0, pendingLearningReviews: 0 },
  safety: { arbitraryEndpointsAccepted: false, rawSecretsReturned: false, sourceTextShownOnlyToOwner: true, providerAgreementMeansTruth: false, automaticActivationOfUnverifiedKnowledge: false },
};


test("owner governance UI exposes bounded file ingestion and the candidate-only knowledge lifecycle", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiGovernance, { locale: "en" }));
  assert.ok(html.includes("Knowledge and learning governance"));
  assert.ok(html.includes("Uploaded material becomes candidate knowledge only"));
  assert.ok(html.includes('type="file"'));
  assert.ok(html.includes(".txt,.md,.html,.htm,.pdf,.docx"));
  assert.ok(html.includes("Parser-supported files: TXT, MD, HTML, PDF, and DOCX; maximum 20 MB."));
  assert.ok(html.includes("Other upload-policy types such as XML and additional Office formats are not knowledge-parser formats."));
  assert.ok(html.includes("cannot change RIWI system instructions, permissions, or security policy"));
  assert.ok(html.includes("Register a knowledge source"));
  assert.ok(html.includes("Rights class"));
  assert.ok(html.includes("Allowed scope"));
  assert.ok(html.includes("Knowledge sources and versions"));
  assert.ok(html.includes("Learning signals and corrections"));
  assert.ok(html.includes("Provider agreement is evidence only—not truth and not automatic training."));
  assert.ok(html.includes("Audit and evidence"));
  assert.ok(html.includes("Safe diagnostics"));
  assert.ok(!html.includes("sk-live-example-secret"));
  assert.ok(!html.includes("https://api.example.invalid"));
});

test("owner governance localization is structurally complete in Uzbek and uses the ASCII tutuq apostrophe", () => {
  const html = renderToStaticMarkup(React.createElement(OwnerRiwiGovernance, { locale: "uz" }));
  assert.ok(html.includes("Bilim va o&#x27;rganish boshqaruvi"));
  assert.ok(html.includes("nomzod bilim"));
  assert.ok(html.includes("O&#x27;qituvchi tuzatishlari"));
  assert.ok(!/[\u2018\u2019]/.test(readFileSync("src/components/riwi/OwnerRiwiGovernance.tsx", "utf8")));
});

test("failed owner correction request releases busy state and retries with the same idempotency key", async () => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; options: RequestInit }> = [];
  let postCount = 0;
  globalThis.fetch = (async (url: string | URL | Request, options: RequestInit = {}) => {
    const path = String(url);
    requests.push({ url: path, options });
    if (options.method === "POST" && path === "/api/riwi/learning-signals") {
      postCount += 1;
      return postCount === 1 ? json({ error: { code: "riwi_signal_unavailable" } }, 503)
        : json({ ok: true, signalId: "11111111-2222-4333-8444-555555555555", state: "candidate" }, 201);
    }
    if (path === "/api/riwi/owner/knowledge") return json({ ok: true, sources: [], openConflicts: 0 });
    if (path === "/api/riwi/learning-signals?limit=100") return json({ signals: [] });
    if (path === "/api/riwi/owner/audit?limit=30") return json({ ok: true, entries: [] });
    if (path === "/api/riwi/owner/diagnostics") return json(diagnostics);
    throw new Error(`unexpected request: ${options.method ?? "GET"} ${path}`);
  }) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiGovernance locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const correctionForm = document.querySelectorAll<HTMLFormElement>("form")[1]!;
    const claimInput = correctionForm.querySelector<HTMLInputElement>("input");
    const evidenceInput = correctionForm.querySelector<HTMLTextAreaElement>("textarea");
    assert.ok(claimInput && evidenceInput);
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(claimInput, "Use the article before a singular count noun.");
      claimInput.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(evidenceInput, "Owner-reviewed grammar correction; learner work omitted.");
      evidenceInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const submit = [...correctionForm.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("Submit for review"));
    assert.ok(submit);
    await act(async () => submit.click());
    assert.ok(document.body.textContent?.includes("The action could not be completed safely. Please retry."));
    assert.equal(submit.disabled, false, "failed transport releases the submit control in finally");

    await act(async () => submit.click());
    assert.equal(postCount, 2);
    const writeBodies = requests.filter((request) => request.url === "/api/riwi/learning-signals" && request.options.method === "POST")
      .map((request) => JSON.parse(String(request.options.body)) as Record<string, unknown>);
    assert.equal(writeBodies.length, 2);
    assert.equal(writeBodies[0]?.idempotencyKey, writeBodies[1]?.idempotencyKey, "retry reuses the original idempotency key");
    assert.equal(writeBodies[0]?.type, "owner_correction");
    assert.ok(!("role" in (writeBodies[0] ?? {})) && !("actorUserId" in (writeBodies[0] ?? {})), "client cannot select its actor role or user identity");
    assert.ok(document.body.textContent?.includes("Correction submitted for review; it is not active knowledge."));
    const refreshButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Refresh");
    assert.ok(refreshButton);
    assert.equal(refreshButton.disabled, false, "success refresh does not leave the owner page busy");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.localStorage.clear();
  }
});
