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
  configIssues: [], governance: {
    openConflicts: 0, knowledgeSources: 0, pendingKnowledgeCandidates: 0, approvedKnowledgeSources: 0,
    learningSignals: 0, pendingLearningReviews: 0, auditEntries: 0, providerExperiments: 0,
  },
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

test("owner governance clears cached histories when page authorization is revoked", async () => {
  const originalFetch = globalThis.fetch;
  const sourceId = "11111111-2222-4333-8444-555555555555";
  const source = {
    id: sourceId, sourceType: "grammar_material", title: "Owner-only source", provenance: "Owner authored", rightsClass: "owner_authored",
    authority: 65, scope: "global", scopeRole: null, scopeUserId: null, supersedesSourceId: null, version: 1, state: "candidate",
    unitCount: 0, checksum: "a".repeat(64), sourceChecksum: null, parserVersion: "riwi-text-parser/1",
    regressionFixtureId: null, regressionEvidenceHash: null, regressionPassedAt: null, createdAt: "2026-10-04T00:00:00.000Z", approvedAt: null, activatedAt: null,
  };
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url);
    if (path === "/api/riwi/owner/knowledge?limit=25") return json({ ok: true, sources: [source], nextCursor: "revoked-cursor", openConflicts: 0 });
    if (path === "/api/riwi/learning-signals?limit=25") return json({ signals: [], nextCursor: null });
    if (path === "/api/riwi/owner/audit?limit=25") return json({ ok: true, entries: [], nextCursor: null });
    if (path === "/api/riwi/owner/diagnostics") return json(diagnostics);
    if (path === "/api/riwi/owner/knowledge?limit=25&cursor=revoked-cursor") return json({ error: { code: "owner_required" } }, 403);
    throw new Error(`unexpected request: ${path}`);
  }) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiGovernance locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(document.querySelectorAll('[data-knowledge-state="candidate"]').length, 1);
    await act(async () => { query<HTMLButtonElement>('[data-history-kind="sources"]').click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(document.querySelectorAll('[data-knowledge-state="candidate"]').length, 0, "revocation clears data cached under the former owner role");
    assert.equal(document.querySelector('[data-history-kind="sources"]'), null, "a revoked cursor is no longer offered");
    assert.ok(document.body.textContent?.includes("The action could not be completed safely."));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.localStorage.clear();
  }
});

test("owner governance history load/retry actions are localized in Uzbek", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url);
    if (path === "/api/riwi/owner/knowledge?limit=25") return json({ ok: true, sources: [], nextCursor: "uz-source-cursor", openConflicts: 0 });
    if (path === "/api/riwi/learning-signals?limit=25") return json({ signals: [], nextCursor: null });
    if (path === "/api/riwi/owner/audit?limit=25") return json({ ok: true, entries: [], nextCursor: null });
    if (path === "/api/riwi/owner/diagnostics") return json(diagnostics);
    if (path === "/api/riwi/owner/knowledge?limit=25&cursor=uz-source-cursor") return json({ error: { code: "riwi_knowledge_unavailable" } }, 503);
    throw new Error(`unexpected request: ${path}`);
  }) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiGovernance locale="uz" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    const button = query<HTMLButtonElement>('[data-history-kind="sources"]');
    assert.equal(button.textContent?.trim(), "Yana yuklash");
    await act(async () => { button.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(query<HTMLButtonElement>('[data-history-kind="sources"]').textContent?.trim(), "Qayta urinish");
    assert.ok(document.body.textContent?.includes("Keyingi tarix sahifasi yuklanmadi."));
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.localStorage.clear();
  }
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
    if (path === "/api/riwi/owner/knowledge?limit=25") return json({ ok: true, sources: [], nextCursor: null, openConflicts: 0 });
    if (path === "/api/riwi/learning-signals?limit=25") return json({ signals: [], nextCursor: null });
    if (path === "/api/riwi/owner/audit?limit=25") return json({ ok: true, entries: [], nextCursor: null });
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

test("owner governance paginates sources, learning signals, and audit with failure-safe retry and preserved selection", async () => {
  const originalFetch = globalThis.fetch;
  const sourceId = "11111111-2222-4333-8444-555555555555";
  const source2Id = "22222222-3333-4444-8555-666666666666";
  const signalId = "33333333-4444-4555-8666-777777777777";
  const signal2Id = "44444444-5555-4666-8777-888888888888";
  const auditId = "55555555-6666-4777-8888-999999999999";
  const audit2Id = "66666666-7777-4888-8999-aaaaaaaaaaaa";
  const timestamp = "2026-10-04T00:00:00.000Z";
  const source = (id: string, title: string) => ({
    id, sourceType: "grammar_material", title, provenance: "Owner-authored pagination fixture", rightsClass: "owner_authored",
    authority: 65, scope: "global", scopeRole: null, scopeUserId: null, supersedesSourceId: null, version: 1, state: "candidate",
    unitCount: 0, checksum: "a".repeat(64), sourceChecksum: null, parserVersion: "riwi-text-parser/1",
    regressionFixtureId: null, regressionEvidenceHash: null, regressionPassedAt: null, createdAt: timestamp, approvedAt: null, activatedAt: null,
  });
  const sourceOne = source(sourceId, "Owner source one");
  const sourceTwo = source(source2Id, "Owner source two");
  const signal = (id: string) => ({
    id, type: "manual_qa_finding", state: "candidate", actorRole: "owner", sourceId: "77777777-8888-4999-8aaa-bbbbbbbbbbbb",
    providerId: null, model: null, promptVersion: null, rubricVersion: null, evidenceHash: "b".repeat(64), scope: "global", createdAt: timestamp,
  });
  const signalOne = signal(signalId);
  const signalTwo = signal(signal2Id);
  const audit = (id: string) => ({
    id, actorUserId: "88888888-9999-4aaa-8bbb-cccccccccccc", action: "riwi.learning.signal.created",
    targetType: "riwi_learning_signal", targetId: signalId, metadata: null, createdAt: timestamp,
  });
  const auditOne = audit(auditId);
  const auditTwo = audit(audit2Id);
  const requests: string[] = [];
  let sourcePageRequests = 0;
  globalThis.fetch = (async (url: string | URL | Request) => {
    const path = String(url);
    requests.push(path);
    if (path === "/api/riwi/owner/knowledge?limit=25") return json({ ok: true, sources: [sourceOne], nextCursor: "source-cursor", openConflicts: 0 });
    if (path === "/api/riwi/learning-signals?limit=25") return json({ signals: [signalOne], nextCursor: "signal-cursor" });
    if (path === "/api/riwi/owner/audit?limit=25") return json({ ok: true, entries: [auditOne], nextCursor: "audit-cursor" });
    if (path === "/api/riwi/owner/diagnostics") return json({
      ...diagnostics,
      governance: { ...diagnostics.governance, knowledgeSources: 2, learningSignals: 2, auditEntries: 2 },
    });
    if (path === `/api/riwi/owner/knowledge/${sourceId}`) return json({ ok: true, source: {
      ...sourceOne, createdByUserId: null, reviewedByUserId: null, updatedAt: timestamp, units: [], conflicts: [],
    } });
    if (path === "/api/riwi/owner/knowledge?limit=25&cursor=source-cursor") {
      sourcePageRequests += 1;
      return sourcePageRequests === 1 ? json({ error: { code: "riwi_knowledge_unavailable" } }, 503)
        : json({ ok: true, sources: [sourceOne, sourceTwo], nextCursor: null, openConflicts: 0 });
    }
    if (path === "/api/riwi/learning-signals?limit=25&cursor=signal-cursor") return json({ signals: [signalOne, signalTwo], nextCursor: null });
    if (path === "/api/riwi/owner/audit?limit=25&cursor=audit-cursor") return json({ ok: true, entries: [auditOne, auditTwo], nextCursor: null });
    throw new Error(`unexpected request: ${path}`);
  }) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<OwnerRiwiGovernance locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(document.querySelector(`[data-knowledge-state="candidate"]`));
    assert.ok(document.body.textContent?.includes("1/2"), "diagnostics count is independent of the first displayed page");
    const inspect = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Inspect details");
    assert.ok(inspect);
    await act(async () => { inspect.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.ok(document.querySelector(`[data-source-detail="${sourceId}"]`));

    const sourceLoadMore = query<HTMLButtonElement>('[data-history-kind="sources"]');
    await act(async () => { sourceLoadMore.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(document.querySelectorAll('[data-knowledge-state="candidate"]').length, 1, "failure preserves the prior source page");
    assert.ok(document.querySelector(`[data-source-detail="${sourceId}"]`), "failure preserves the selected source detail");
    assert.ok(document.body.textContent?.includes("The next history page could not be loaded."));

    const retry = query<HTMLButtonElement>('[data-history-kind="sources"]');
    await act(async () => { retry.click(); await new Promise((resolve) => setTimeout(resolve, 0)); });
    assert.equal(sourcePageRequests, 2);
    assert.equal(requests.filter((path) => path.includes("cursor=source-cursor")).length, 2, "retry reuses the prior cursor");
    assert.equal(document.querySelectorAll('[data-knowledge-state="candidate"]').length, 2, "source ids are appended without duplicates");
    assert.ok(document.querySelector(`[data-source-detail="${sourceId}"]`));

    await act(async () => {
      query<HTMLButtonElement>('[data-history-kind="signals"]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      query<HTMLButtonElement>('[data-history-kind="audit"]').click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(document.querySelectorAll('[data-learning-state="candidate"]').length, 2);
    assert.equal(document.querySelectorAll("[aria-labelledby=riwi-audit-title] li").length, 2);
    assert.equal(document.querySelector('[data-history-kind="sources"]'), null);
    assert.equal(document.querySelector('[data-history-kind="signals"]'), null);
    assert.equal(document.querySelector('[data-history-kind="audit"]'), null);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    dom.window.localStorage.clear();
  }
});
