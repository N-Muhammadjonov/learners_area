import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/reading/retention" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { RetentionSession, ResultView, toSourceFree } = await import("../../src/components/reading/RetentionSession");

const query = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, `expected ${selector}`);
  return found;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
const SOURCE = "SECRET-SOURCE-BODY the company was founded in 1998";

function meta(readEndsInMs: number) {
  const now = Date.now();
  return {
    attemptId: "11111111-1111-4111-8111-111111111111",
    level: "B1" as const,
    label: "B1-001",
    readStartedAt: new Date(now - 120_000 + readEndsInMs).toISOString(),
    readEndsAt: new Date(now + readEndsInMs).toISOString(),
    writeStartedAt: new Date(now + readEndsInMs).toISOString(),
    writeEndsAt: new Date(now + readEndsInMs + 180_000).toISOString(),
    serverNow: new Date(now).toISOString(),
  };
}

async function render(element: React.ReactNode, run: (refreshes: { count: number }) => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(query<HTMLDivElement>("#root"));
  const refreshes = { count: 0 };
  const router = { back() {}, forward() {}, refresh() { refreshes.count += 1; }, push() {}, replace() {}, prefetch() {} };
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element)));
    await run(refreshes);
  } finally {
    await act(async () => root.unmount());
  }
}

test("toSourceFree keeps attempt id and persisted deadlines but never the source", () => {
  const reading = { ...meta(0), phase: "reading" as const, wordCount: 9, bodyText: SOURCE };
  const free = toSourceFree(reading);
  assert.equal(free.phase, "awaiting_recall");
  assert.equal(free.attemptId, reading.attemptId);
  assert.equal(free.readEndsAt, reading.readEndsAt);
  assert.equal(free.writeEndsAt, reading.writeEndsAt);
  assert.ok(!("bodyText" in free));
  assert.ok(!JSON.stringify(free).includes("SECRET-SOURCE"));
});

test("reading deadline with a failed phase refresh: source gone, honest retry, recall arrives on retry", async () => {
  const originalFetch = globalThis.fetch;
  let mode: "fail" | "stale-reading" | "recall" = "fail";
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    if (mode === "fail") throw new TypeError("offline");
    if (mode === "stale-reading") return json({ ...meta(-100), phase: "reading", wordCount: 9, bodyText: SOURCE });
    return json({ ...meta(-100), phase: "recall", recallDraft: "" });
  }) as typeof fetch;
  try {
    const initial = { ...meta(700), phase: "reading" as const, wordCount: 9, bodyText: SOURCE };
    await render(React.createElement(RetentionSession, { dict: en, initial }), async () => {
      assert.ok(query("[data-retention-source]"));
      await wait(1_100);
      assert.equal(document.querySelector("[data-retention-source]"), null);
      assert.ok(!(document.body.innerHTML.includes("SECRET-SOURCE")), "no source anywhere in the DOM");
      assert.ok(query('[data-retention-phase="awaiting_recall"]'));
      assert.ok(query("[data-retention-phase-refresh-failed]"));
      assert.ok(calls >= 1);
      // A late reading payload (clock skew) cannot re-admit the source.
      mode = "stale-reading";
      await act(async () => query<HTMLButtonElement>("[data-retention-phase-retry]").click());
      await wait(0);
      assert.ok(!(document.body.innerHTML.includes("SECRET-SOURCE")));
      assert.ok(query('[data-retention-phase="awaiting_recall"]'));
      // The bounded poll picks up the server's recall phase.
      mode = "recall";
      await wait(2_200);
      assert.ok(query('[data-retention-phase="recall"]'));
      assert.ok(!(document.body.innerHTML.includes("SECRET-SOURCE")));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("terminal result shows level, label, finish time, allocated/used time, recall words and navigation", async () => {
  const base = meta(-200_000);
  const submittedAt = new Date(Date.parse(base.writeStartedAt) + 95_000).toISOString();
  const payload = {
    ...base,
    phase: "completed" as const,
    score: 60,
    evaluatorVersion: "retention-deterministic-v3",
    recallWordCount: 42,
    submittedAt,
    completedAt: submittedAt,
    breakdown: { schemaVersion: 1 as const, evaluatorVersion: "v3", maxScore: 100 as const, score: 60, totals: { captured: 1, partial: 0, missed: 1, contradicted: 0, matchedGroups: 2, totalGroups: 3, mainIdeasRemembered: 1, mainIdeasPossible: 2 }, claims: [] },
  };
  await render(React.createElement(ResultView, { dict: en, payload: payload as never, onAnother: () => undefined }), async () => {
    assert.equal(query("[data-retention-result-level]").textContent, "B1");
    assert.equal(query("[data-retention-result-label]").textContent, "B1-001");
    assert.equal(query("[data-retention-result-write-used]").getAttribute("data-retention-result-write-used"), "95");
    assert.equal(query("[data-retention-result-words]").getAttribute("data-retention-result-words"), "42");
    assert.match(query("[data-retention-result-finished]").textContent ?? "", /\d{1,2}:\d{2}/);
    assert.equal(query("[data-retention-result-reading]").getAttribute("href"), "/reading");
    assert.match(query("[data-retention-result-history]").getAttribute("href") ?? "", /retention-history/);
    assert.equal(query("[data-retention-result-permalink]").getAttribute("href"), `/reading/retention/results/${base.attemptId}`);
    assert.ok(query("[data-retention-another]"));
  });
});
