import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

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

async function renderChat(fetcher: (url: string, options: RequestInit) => Promise<Response>, run: (rerender: (nextRole?: Role, nextScope?: ScopeSurface) => Promise<void>) => Promise<void>, role: Role = "student", scopeSurface?: ScopeSurface, locale: "en" | "uz" = "en") {
  const labels = locale === "uz" ? uz.riwiLab : en.riwiLab;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = ((url: string | URL | Request, options?: RequestInit) => fetcher(String(url), options ?? {})) as typeof fetch;
  window.localStorage.clear();
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<RiwiChat role={role} locale={locale} scopeSurface={scopeSurface} labels={labels} />));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    await run(async (nextRole = role, nextScope = scopeSurface) => {
      await act(async () => root.render(<RiwiChat role={nextRole} locale={locale} scopeSurface={nextScope} labels={labels} />));
    });
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
  const scope: ScopeSurface = { status: "ready", role: "student", scope: "self", targetOptions: [], nextCursor: null };
  await renderChat(async () => { throw new Error("student self scope does not fetch a client-controlled target list"); }, async () => {
    assert.equal(query<HTMLElement>("[data-riwi-role-scope='self']").textContent?.includes("another learner cannot be selected"), true);
    assert.equal(document.querySelector("#riwi-target-user"), null);
    for (const workspace of ["/writing", "/speaking", "/grammar", "/vocabulary", "/reports"]) {
      assert.ok(document.querySelector(`a[href="${workspace}"]`), `RIWI hands off to the existing ${workspace} workspace`);
    }
  }, "student", scope);
});

test("teacher can target only the server-provided assigned learner and only for report/progress", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000002";
  const scope: ScopeSurface = { status: "ready", role: "teacher", scope: "assigned_roster", targetOptions: [{ id: learnerId, name: "Assigned Learner" }], nextCursor: null };
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

test("target continuation is user-driven, deduplicated, and preserves a selected learner", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000012";
  const addedLearnerId = "aaaaaaaa-0000-4000-8000-000000000013";
  const scope: ScopeSurface = { status: "ready", role: "teacher", scope: "assigned_roster", targetOptions: [{ id: learnerId, name: "First Learner" }], nextCursor: "first-page-cursor" };
  let pageCalls = 0;
  await renderChat(async (url) => {
    if (url.startsWith("/api/riwi/targets?")) {
      pageCalls += 1;
      return json({ ok: true, items: [
        { id: learnerId, name: "First Learner" },
        { id: addedLearnerId, name: "Second Learner" },
      ], nextCursor: null });
    }
    throw new Error(`unexpected request ${url}`);
  }, async (rerender) => {
    assert.equal(pageCalls, 0, "mounting does not refetch the server-rendered first page");
    await rerender("teacher", { ...scope, targetOptions: [...scope.targetOptions] });
    assert.equal(pageCalls, 0, "equivalent props rerender does not trigger a target request");

    await chooseTarget(learnerId);
    const loadMore = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Load more learners");
    assert.ok(loadMore);
    await act(async () => loadMore.click());
    assert.equal(pageCalls, 1);
    const select = query<HTMLSelectElement>("#riwi-target-user");
    assert.equal(select.value, learnerId, "the prior selection survives a continuation");
    assert.equal([...select.options].filter((option) => option.value === learnerId).length, 1, "duplicate IDs are removed");
    assert.equal([...select.options].filter((option) => option.value === addedLearnerId).length, 1);
    assert.equal(document.querySelector("[role=alert]"), null);
  }, "teacher", scope);
});

test("failed target continuation preserves page and selection and exposes a working retry", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000014";
  const addedLearnerId = "aaaaaaaa-0000-4000-8000-000000000015";
  const scope: ScopeSurface = { status: "ready", role: "teacher", scope: "assigned_roster", targetOptions: [{ id: learnerId, name: "Current Learner" }], nextCursor: "retry-cursor" };
  let pageCalls = 0;
  await renderChat(async (url) => {
    if (url.startsWith("/api/riwi/targets?")) {
      pageCalls += 1;
      if (pageCalls === 1) return new Response(JSON.stringify({ error: "unavailable" }), { status: 503, headers: { "Content-Type": "application/json" } });
      return json({ ok: true, items: [{ id: addedLearnerId, name: "Later Learner" }], nextCursor: null });
    }
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    await chooseTarget(learnerId);
    const firstButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Load more learners");
    assert.ok(firstButton);
    await act(async () => firstButton.click());
    assert.equal(pageCalls, 1);
    assert.ok(document.body.textContent?.includes("Your current list is unchanged; try again."));
    assert.equal(query<HTMLSelectElement>("#riwi-target-user").value, learnerId);
    assert.equal(query<HTMLSelectElement>("#riwi-target-user").options.length, 2, "failed page does not replace or append options");

    const retry = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Retry");
    assert.ok(retry, "the original cursor remains retryable");
    await act(async () => retry.click());
    assert.equal(pageCalls, 2);
    assert.equal(query<HTMLSelectElement>("#riwi-target-user").value, learnerId);
    assert.equal([...query<HTMLSelectElement>("#riwi-target-user").options].some((option) => option.value === addedLearnerId), true);
    assert.equal(document.querySelector("[role=alert]"), null);
  }, "teacher", scope);
});

test("duplicate target-page clicks issue one request and a stale-context response is discarded", async () => {
  const oldLearnerId = "aaaaaaaa-0000-4000-8000-000000000016";
  const currentLearnerId = "aaaaaaaa-0000-4000-8000-000000000017";
  const staleLearnerId = "aaaaaaaa-0000-4000-8000-000000000018";
  const teacherScope: ScopeSurface = { status: "ready", role: "teacher", scope: "assigned_roster", targetOptions: [{ id: oldLearnerId, name: "Old Roster Learner" }], nextCursor: "old-cursor" };
  const adminScope: ScopeSurface = { status: "ready", role: "admin", scope: "admin_cohort", targetOptions: [{ id: currentLearnerId, name: "Current Cohort Learner" }], nextCursor: null };
  let pageCalls = 0;
  let targetSignal: AbortSignal | null = null;
  let resolvePage!: (response: Response) => void;
  const pendingPage = new Promise<Response>((resolve) => { resolvePage = resolve; });
  await renderChat(async (url, options) => {
    if (url.startsWith("/api/riwi/targets?")) {
      pageCalls += 1;
      targetSignal = options.signal ?? null;
      return pendingPage;
    }
    throw new Error(`unexpected request ${url}`);
  }, async (rerender) => {
    const loadButton = [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.trim() === "Load more learners");
    assert.ok(loadButton);
    await act(async () => {
      loadButton.click();
      loadButton.click();
      await Promise.resolve();
    });
    assert.equal(pageCalls, 1, "the in-flight lock rejects a second click before state rerenders");

    await rerender("admin", adminScope);
    assert.equal(targetSignal?.aborted, true, "changing role/scope aborts the obsolete request");
    assert.deepEqual([...query<HTMLSelectElement>("#riwi-target-user").options].map((option) => option.value), ["", currentLearnerId]);
    await act(async () => {
      resolvePage(json({ ok: true, items: [{ id: staleLearnerId, name: "Stale Teacher Learner" }], nextCursor: null }));
      await pendingPage;
    });
    const currentOptions = [...query<HTMLSelectElement>("#riwi-target-user").options].map((option) => option.value);
    assert.deepEqual(currentOptions, ["", currentLearnerId], "a response for the previous role/scope cannot populate the current selector");
  }, "teacher", teacherScope);
});

test("admin surface is cohort-only without owner controls and a selected report target is explicit", async () => {
  const learnerId = "aaaaaaaa-0000-4000-8000-000000000003";
  const scope: ScopeSurface = { status: "ready", role: "admin", scope: "admin_cohort", targetOptions: [{ id: learnerId, name: "Operational Learner" }], nextCursor: null };
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
  const scope: ScopeSurface = { status: "ready", role: "owner", scope: "owner_centre", targetOptions: [{ id: learnerId, name: "Selected Learner" }], nextCursor: null };
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

test("Reporter response exposes the exact canonical snapshot and SQL provenance in the chat UI", async () => {
  assert.equal(en.riwiLab.riwi, "RIWI");
  assert.equal(uz.riwiLab.riwi, "RIWI");
  assert.equal(en.riwiLab.schema, "Schema");
  assert.equal(uz.riwiLab.schema, "Sxema");
  assert.equal(en.riwiLab.sqlProvenance, "SQL provenance");
  assert.equal(uz.riwiLab.sqlProvenance, "SQL kelib chiqishi");
  const snapshot = {
    schemaVersion: "riwi-report/1", reportId: "dddddddd-0000-4000-8000-000000000001",
    generatedAt: "2026-10-04T09:00:00.000Z", generatedBy: { userId: "aaaaaaaa-0000-4000-8000-000000000001", role: "student" },
    timezone: "Asia/Tashkent",
    period: { kind: "on_demand", timezone: "Asia/Tashkent", from: "2026-09-05T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z", fromDate: "2026-09-05", toDate: "2026-10-04" },
    scope: { kind: "student", subjectId: "aaaaaaaa-0000-4000-8000-000000000001", subjectName: "Chat learner" },
    metrics: [{
      key: "learners.active", section: "learning", label: { en: "Active learners", uz: "Faol o'quvchilar" },
      unit: "ratio", value: 0.333333333333,
      source: { queryId: "riwi.learners.active", sql: "select count(distinct user_id)::int as v from activity_events where user_id = :subject", parameters: { from: "2026-09-05T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z", subject: "aaaaaaaa-0000-4000-8000-000000000001" } },
      window: { from: "2026-09-05T00:00:00.000Z", to: "2026-10-05T00:00:00.000Z", basis: "window" },
      scope: "student:aaaaaaaa-0000-4000-8000-000000000001", generatedAt: "2026-10-04T09:00:00.000Z",
    }],
    narrative: { source: "deterministic", en: ["A canonical Reporter summary."], uz: ["Reporterning aniq xulosasi."] },
  };
  await renderChat(async (url) => {
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId, conversationId, intent: "report_self", answer: "A canonical Reporter summary.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "deterministic_report", provider: null,
      reportSnapshot: snapshot, errorCode: null,
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    await sendMessage("Show my personal report");
    assert.ok(document.body.textContent?.includes("RIWI · STUDENT"), "the localized RIWI brand label is present on the English surface");
    const details = query<HTMLDetailsElement>("details");
    assert.equal(details.querySelector("dt")?.textContent, "Schema");
    assert.ok([...details.querySelectorAll("summary")].some((summary) => summary.textContent === "SQL provenance"));
    assert.ok(details.textContent?.includes("riwi-report/1"));
    assert.ok(details.textContent?.includes("Asia/Tashkent"));
    assert.ok(details.textContent?.includes("0.333333333333"), "ratio precision is not rounded in the snapshot view");
    assert.ok(details.textContent?.includes("select count(distinct user_id)"), "the canonical SQL provenance remains available");
    assert.ok(details.textContent?.includes("Parameters:"));
    assert.equal(details.open, false, "provenance is available on demand without overwhelming the answer");
  });

  await renderChat(async (url) => {
    if (url === "/api/riwi/chat") return json({
      ok: true, correlationId, conversationId, intent: "report_self", answer: "A canonical Reporter summary.",
      uncertainty: null, citations: [], attribution: "RIWI", provenance: "deterministic_report", provider: null,
      reportSnapshot: snapshot, errorCode: null,
    });
    throw new Error(`unexpected request ${url}`);
  }, async () => {
    await sendMessage("Show my personal report");
    assert.ok(document.body.textContent?.includes("RIWI · STUDENT"), "the localized RIWI brand label is present on the Uzbek surface");
    const details = query<HTMLDetailsElement>("details");
    assert.equal(details.querySelector("dt")?.textContent, "Sxema");
    assert.ok([...details.querySelectorAll("summary")].some((summary) => summary.textContent === "SQL kelib chiqishi"));
    assert.ok(details.textContent?.includes("riwi-report/1"), "the schema value remains a canonical identifier");
    assert.ok(details.textContent?.includes("select count(distinct user_id)"), "SQL remains canonical and untranslated");
    assert.ok(details.textContent?.includes("Parametrlar:"));
  }, "student", undefined, "uz");
});
