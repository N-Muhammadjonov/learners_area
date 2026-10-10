import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/grammar" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { PracticeActivities } = await import("../../src/components/grammar/PracticeActivities");
const id = "11111111-2222-4333-8444-555555555555";
const exercise = { id, order: 1, promptText: "Correction item", translatePromptUz: "Tirbandlik katta muammo.", targetStructures: ["traffic", "problem"], activationPrompt: null };
const q = <T extends Element>(selector: string) => { const element = document.querySelector<T>(selector); assert.ok(element, selector); return element; };
const answer = "Congestion is a serious issue.";

async function run(dict: typeof en, response: Response, check: (requests: Array<{ url: string; body: unknown }>) => Promise<void>) {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ url: string; body: unknown }> = [];
  globalThis.fetch = (async (url: string | URL | Request, options?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(options?.body)) });
    return response;
  }) as typeof fetch;
  const root = createRoot(q("#root"));
  try {
    await act(async () => root.render(<PracticeActivities dict={dict} exercises={[exercise]} />));
    await act(async () => {
      const field = q<HTMLTextAreaElement>("textarea");
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, answer);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => q<HTMLButtonElement>("[data-translate-check]").click());
    await check(requests);
  } finally { await act(async () => root.unmount()); globalThis.fetch = originalFetch; }
}

for (const [locale, dict] of [["en", en], ["uz", uz]] as const) {
  test(`Grammar translation ${locale}: displays the RIWI verdict and semantic feedback, with no unrelated correction sample`, async () => {
    const response = new Response(JSON.stringify({ ok: true, verdict: "needs_correction", checkedBy: "RIWI", structures: { used: [], missing: ["traffic", "problem"] }, sampleAnswer: null, explanation: "Authored explanation", issues: ["Preserve the source meaning."] }), { headers: { "Content-Type": "application/json" } });
    await run(dict, response, async requests => {
      assert.deepEqual(requests, [{ url: `/api/grammar/exercises/${id}/practice`, body: { activity: "translate_it", answer } }]);
      assert.equal(q("[data-translate-verdict]").getAttribute("data-translate-verdict"), "needs_correction");
      assert.ok(q("[data-practice-checked-by]").textContent?.includes("RIWI"));
      assert.ok(document.body.textContent?.includes("Preserve the source meaning."));
      assert.ok(!document.body.textContent?.includes(dict.grammar.sampleAnswer));
      assert.equal(q<HTMLButtonElement>("[data-translate-check]").disabled, false);
    });
  });
}

test("Grammar translation unavailable: retains the answer without an invented verdict or automatic retry", async () => {
  const response = new Response(JSON.stringify({ error: "evaluation_unavailable" }), { status: 502, headers: { "Content-Type": "application/json" } });
  await run(en, response, async requests => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
    assert.equal(requests.length, 1);
    assert.equal(document.querySelector("[data-translate-verdict]"), null);
    assert.equal(q<HTMLTextAreaElement>("textarea").value, answer);
    assert.equal(q<HTMLButtonElement>("[data-translate-check]").disabled, false);
    assert.ok(document.body.textContent?.includes(en.apiErrors.generic));
  });
});
