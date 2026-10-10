import assert from "node:assert/strict";
import test from "node:test";
import React, { act } from "react";
import { JSDOM } from "jsdom";
import { createRoot } from "react-dom/client";
import { OwnerAssessmentPolicyPanel } from "../../src/components/riwi/OwnerAssessmentPolicyPanel";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/owner/riwi" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const id = (n: number) => `aaaaaaaa-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = "b".repeat(64);
const version = (n: number, state: "candidate" | "approved" | "superseded", evidence: string | null = null) => ({
  id: id(n), policyId: id(10), scope: "writing.task2.*", version: n, state,
  overlay: { feedbackStyle: "concise" }, sourceMessageHash: "a".repeat(64),
  regressionFixtureId: evidence ? "fixture" : null, regressionEvidenceHash: evidence,
  regressionPassedAt: evidence ? "2026-10-09T00:00:00.000Z" : null,
  createdByUserId: id(11), reviewedByUserId: state === "candidate" ? null : id(11),
  createdAt: "2026-10-09T00:00:00.000Z", approvedAt: state === "candidate" ? null : "2026-10-09T00:00:00.000Z",
  active: state === "approved",
});
function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === label);
  assert.ok(result, label); return result;
}
async function click(b: HTMLButtonElement) { await act(async () => { b.click(); await new Promise(r => setTimeout(r, 0)); }); }

for (const locale of ["en", "uz"] as const) {
  test(`${locale}: rollback needs fresh preview, binds the exact hash, denies duplicate dispatch and keeps history intact`, async () => {
    const labels = locale === "en" ? { rollback: "Create rollback candidate", preview: "Preview and run regression", approve: "Approve and activate" }
      : { rollback: "Oldingi sozlamalardan nomzod yaratish", preview: "Xavfsiz preview va regressiya", approve: "Tasdiqlash va faollashtirish" };
    const requests: { url: string; body: unknown }[] = [];
    let release!: (response: Response) => void;
    const oldFetch = globalThis.fetch;
    globalThis.fetch = (async (url, init) => {
      const path = String(url); const body = init?.body ? JSON.parse(String(init.body)) : null;
      requests.push({ url: path, body });
      if (!init?.body) return Response.json({ ok: true, versions: [version(2, "approved", hash), version(1, "superseded", hash)], nextCursor: null, versionCount: 2 });
      if (path.endsWith("/rollback")) return new Promise<Response>(r => { release = r; });
      if (path.endsWith("/preview")) return Response.json({ ok: true, candidate: version(3, "candidate", hash), regression: { fixtureId: "fixture", passed: true, evidenceHash: hash, checks: { immutableCorePreserved: true }, affectedTaskKeys: ["writing.task2.opinion"] } });
      assert.ok(path.endsWith("/approve"));
      assert.deepEqual(body, { confirmRegression: true, evidenceHash: hash });
      return Response.json({ ok: true, replay: false, candidate: version(3, "approved", hash) });
    }) as typeof fetch;
    const root = createRoot(document.getElementById("root")!);
    try {
      await act(async () => { root.render(<OwnerAssessmentPolicyPanel locale={locale} />); await new Promise(r => setTimeout(r, 0)); });
      await click(document.querySelectorAll<HTMLButtonElement>("li button")[1]!);
      const rollback = button(labels.rollback);
      await act(async () => { rollback.click(); rollback.click(); });
      assert.equal(requests.filter(r => r.url.endsWith("/rollback")).length, 1);
      assert.deepEqual(requests[1]!.body, { confirmRollback: true });
      assert.ok([...document.querySelectorAll<HTMLButtonElement>("li button")].every(b => b.disabled), "selection cannot drift during a mutation");
      await act(async () => release(Response.json({ ok: true, replay: false, candidate: version(3, "candidate") })));
      assert.equal(button(labels.approve).disabled, true);
      assert.equal(document.querySelectorAll("li button").length, 3);
      assert.ok(document.body.textContent?.includes(locale === "en" ? "fresh preview" : "Yangi preview"));
      await click(button(labels.preview));
      assert.equal(button(labels.approve).disabled, false);
      await click(button(labels.approve));
      assert.equal(requests.filter(r => r.url.endsWith("/approve")).length, 1);
      assert.equal(document.querySelectorAll("li button").length, 3);
      assert.ok(document.querySelectorAll("li button")[2]!.textContent?.includes("superseded"));
      assert.equal(document.querySelector("script"), null);
    } finally { await act(async () => root.unmount()); globalThis.fetch = oldFetch; }
  });
}

test("mismatched regression hash cannot enable approval; failed rollback preserves history for an explicit retry", async () => {
  const oldFetch = globalThis.fetch;
  let rollbacks = 0;
  globalThis.fetch = (async (url, init) => {
    if (!init?.body) return Response.json({ ok: true, versions: [version(1, "superseded", hash)], nextCursor: null, versionCount: 1 });
    if (String(url).endsWith("/rollback")) {
      if (++rollbacks === 1) return Response.json({ error: "unavailable" }, { status: 503 });
      return Response.json({ ok: true, replay: true, candidate: version(3, "candidate") });
    }
    assert.ok(String(url).endsWith("/preview"), "no approval request is permitted");
    return Response.json({ ok: true, candidate: version(3, "candidate", hash), regression: { fixtureId: "fixture", passed: true, evidenceHash: "c".repeat(64), checks: {}, affectedTaskKeys: [] } });
  }) as typeof fetch;
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => { root.render(<OwnerAssessmentPolicyPanel locale="en" />); await new Promise(r => setTimeout(r, 0)); });
    await click(document.querySelector<HTMLButtonElement>("li button")!);
    await click(button("Create rollback candidate"));
    assert.equal(rollbacks, 1); assert.equal(document.querySelectorAll("li button").length, 1);
    await click(button("Create rollback candidate"));
    await click(button("Preview and run regression"));
    assert.equal(button("Approve and activate").disabled, true);
    await click(button("Approve and activate"));
    assert.equal(rollbacks, 2);
  } finally { await act(async () => root.unmount()); globalThis.fetch = oldFetch; }
});

for (const locale of ["en", "uz"] as const) {
  test(`${locale}: authority revoked during rollback discards cached owner history and never activates a policy`, async () => {
    const oldFetch = globalThis.fetch;
    let mutations = 0;
    globalThis.fetch = (async (_url, init) => {
      if (!init?.body) return Response.json({ ok: true, versions: [version(1, "superseded", hash)], nextCursor: null, versionCount: 1 });
      mutations++; return Response.json({ error: "forbidden" }, { status: 403 });
    }) as typeof fetch;
    const root = createRoot(document.getElementById("root")!);
    try {
      await act(async () => { root.render(<OwnerAssessmentPolicyPanel locale={locale} />); await new Promise(r => setTimeout(r, 0)); });
      await click(document.querySelector<HTMLButtonElement>("li button")!);
      await click(button(locale === "en" ? "Create rollback candidate" : "Oldingi sozlamalardan nomzod yaratish"));
      assert.equal(mutations, 1);
      assert.equal(document.querySelectorAll("li button").length, 0);
      assert.ok(!document.body.textContent?.includes(hash));
      assert.ok(document.querySelector('[role="status"]')?.textContent?.includes(locale === "en" ? "could not be completed safely" : "xavfsiz yakunlanmadi"));
    } finally { await act(async () => root.unmount()); globalThis.fetch = oldFetch; }
  });
}
