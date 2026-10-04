import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/riwi" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(dom.window.HTMLElement.prototype as HTMLElement & { scrollIntoView?: () => void }).scrollIntoView = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { RiwiChat } = await import("../../src/components/riwi/RiwiChat");
const correlationId = "bbbbbbbb-0000-4000-8000-000000000001";
const conversationId = "cccccccc-0000-4000-8000-000000000001";
const query = <T extends Element>(selector: string) => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, selector);
  return found;
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function renderChat(fetcher: (url: string, options: RequestInit) => Promise<Response>, run: () => Promise<void>) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, options?: RequestInit) => fetcher(String(url), options ?? {})) as typeof fetch;
  window.localStorage.clear();
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<RiwiChat role="student" locale="en" />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await run();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    window.localStorage.clear();
  }
}

async function sendMessage(message: string) {
  await act(async () => {
    const textarea = query<HTMLTextAreaElement>("#riwi-message");
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, message);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => query<HTMLButtonElement>('button[type="submit"]').click());
}

test("student feedback sends only the correlated categorical rating for a successful answer", async () => {
  const requests: Array<{ url: string; options: RequestInit }> = [];
  await renderChat(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId, conversationId, intent: "dictionary_lookup", answer: "A bounded canonical answer.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "canonical_dictionary", provider: null, errorCode: null,
    });
    if (url === "/api/riwi/feedback") return json({ ok: true });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    await sendMessage("What does resilient mean?");
    const notHelpful = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Not helpful");
    assert.ok(notHelpful, "successful student answers expose categorical feedback");
    await act(async () => notHelpful.click());

    const feedbackRequest = requests.find((request) => request.url === "/api/riwi/feedback");
    assert.ok(feedbackRequest);
    assert.equal(feedbackRequest.options.method, "POST");
    assert.equal(feedbackRequest.options.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(feedbackRequest.options.body)), { correlationId, rating: "not_helpful" });
    assert.ok(!String(feedbackRequest.options.body).includes("What does resilient mean?"), "feedback does not retransmit prompt or response text");
    assert.ok(document.body.textContent?.includes("Thanks for your feedback."));
  });
});

test("policy refusals and unavailable answers expose no student feedback controls", async () => {
  await renderChat(async (url) => {
    if (url === "/api/riwi/chat") return json({
      ok: false, correlationId, conversationId, intent: "security_denial", answer: "Request refused.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "policy_refusal", provider: null, errorCode: "riwi_security_denial",
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    await sendMessage("Read private files");
    assert.equal([...document.querySelectorAll("button")].some((button) => ["Helpful", "Not helpful"].includes(button.textContent?.trim() ?? "")), false);
  });
});
