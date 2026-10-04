import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body><div id=\"root\"></div></body></html>", { url: "http://localhost/riwi" });
for (const key of ["window", "self", "document", "navigator", "HTMLElement", "HTMLTextAreaElement", "HTMLButtonElement", "Element", "Event"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(dom.window.HTMLElement.prototype as HTMLElement & { scrollIntoView?: () => void }).scrollIntoView = () => {};
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { RiwiChat } = await import("../../src/components/riwi/RiwiChat");
type Role = "student" | "teacher" | "admin" | "owner";
type ScopeSurface = import("../../src/lib/services/riwi/contracts").RiwiRoleSurface;
const correlationId = "bbbbbbbb-0000-4000-8000-000000000001";
const conversationId = "cccccccc-0000-4000-8000-000000000001";
const query = <T extends Element>(selector: string) => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, selector);
  return found;
};
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });

async function renderChat(fetcher: (url: string, options: RequestInit) => Promise<Response>, run: () => Promise<void>, role: Role = "student", scopeSurface?: ScopeSurface) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, options?: RequestInit) => fetcher(String(url), options ?? {})) as typeof fetch;
  window.localStorage.clear();
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<RiwiChat role={role} locale="en" scopeSurface={scopeSurface} />));
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

async function chooseTarget(id: string) {
  await act(async () => {
    const select = query<HTMLSelectElement>("#riwi-target-user");
    Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!.call(select, id);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
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

test("student RIWI surface declares self-only scope and renders no learner selector", async () => {
  const scope: ScopeSurface = { status: "ready", role: "student", scope: "self", targetOptions: [], targetOptionsCapped: false };
  await renderChat(async () => { throw new Error("student self scope does not fetch a client-controlled target list"); }, async () => {
    assert.equal(query<HTMLElement>("[data-riwi-role-scope='self']").textContent?.includes("another learner cannot be selected"), true);
    assert.equal(document.querySelector("#riwi-target-user"), null);
  }, "student", scope);
});

test("teacher can target only the server-provided assigned learner and only for report/progress", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000002";
  const scope: ScopeSurface = { status: "ready", role: "teacher", scope: "assigned_roster", targetOptions: [{ id: learnerId, name: "Assigned Learner" }], targetOptionsCapped: false };
  const requests: Array<{ url: string; options: RequestInit }> = [];
  let responseIndex = 0;
  await renderChat(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId: responseIndex++ === 0 ? correlationId : "bbbbbbbb-0000-4000-8000-000000000002", conversationId, intent: "report_self", answer: "Assigned report.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "deterministic_report", provider: null, errorCode: null,
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    assert.equal(query<HTMLSelectElement>("#riwi-target-user").options.length, 2);
    assert.ok(document.body.textContent?.includes("Only active learners on your current explicit roster are listed"));
    assert.ok(document.querySelector('a[href="/teacher/students"]'));
    await chooseTarget(learnerId);
    await sendMessage("Show the selected learner's report");
    const body = JSON.parse(String(requests.find((item) => item.url === "/api/riwi/chat")?.options.body));
    assert.deepEqual(body, { message: "Show the selected learner's report", targetUserId: learnerId });
    await sendMessage("What does resilient mean?");
    const chatBodies = requests.filter((item) => item.url === "/api/riwi/chat").map((item) => JSON.parse(String(item.options.body)));
    assert.equal(chatBodies[1]?.targetUserId, undefined, "a learner id is not sent for dictionary questions");
    assert.ok(document.body.textContent?.includes("The selected learner applies only to report/progress requests"));
  }, "teacher", scope);
});

test("admin surface is cohort-only without owner controls and a selected report target is explicit", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000003";
  const scope: ScopeSurface = { status: "ready", role: "admin", scope: "admin_cohort", targetOptions: [{ id: learnerId, name: "Operational Learner" }], targetOptionsCapped: false };
  const requests: Array<{ url: string; options: RequestInit }> = [];
  await renderChat(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId, conversationId, intent: "report_self", answer: "Operational report.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "deterministic_report", provider: null, errorCode: null,
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    assert.ok(document.body.textContent?.includes("Owner-only centre, provider, and audit controls are excluded"));
    assert.equal(document.querySelector('a[href="/owner/riwi"]'), null);
    await chooseTarget(learnerId);
    await sendMessage("Show the selected student's report");
    const body = JSON.parse(String(requests.find((item) => item.url === "/api/riwi/chat")?.options.body));
    assert.equal(body.targetUserId, learnerId);
    assert.equal(body.role, undefined);
  }, "admin", scope);
});

test("owner scope distinguishes centre-wide reports from an explicitly selected student", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000004";
  const scope: ScopeSurface = { status: "ready", role: "owner", scope: "owner_centre", targetOptions: [{ id: learnerId, name: "Selected Learner" }], targetOptionsCapped: false };
  const requests: Array<{ url: string; options: RequestInit }> = [];
  await renderChat(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId, conversationId, intent: "report_self", answer: "Student report.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "deterministic_report", provider: null, errorCode: null,
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    assert.ok(document.querySelector('a[href="/owner/riwi"]'));
    assert.equal(query<HTMLSelectElement>("#riwi-target-user").value, "", "no target means owner centre scope");
    await chooseTarget(learnerId);
    await sendMessage("Show the selected student's report");
    const body = JSON.parse(String(requests.find((item) => item.url === "/api/riwi/chat")?.options.body));
    assert.equal(body.targetUserId, learnerId);
  }, "owner", scope);
});
