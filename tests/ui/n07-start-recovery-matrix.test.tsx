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
const { RetentionSession } = await import("../../src/components/reading/RetentionSession");

const q = <T extends Element>(s: string) => document.querySelector<T>(s);
const must = <T extends Element>(s: string) => { const f = q<T>(s); assert.ok(f, `expected ${s}`); return f; };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
const SOURCE = "SECRET-SOURCE-BODY the company was founded in 1998";
const ID = "11111111-1111-4111-8111-111111111111";
const meta = (readEndsInMs: number) => { const now = Date.now(); return { attemptId: ID, level: "B1" as const, label: "B1-001",
  readStartedAt: new Date(now - 120_000 + readEndsInMs).toISOString(), readEndsAt: new Date(now + readEndsInMs).toISOString(),
  writeStartedAt: new Date(now + readEndsInMs).toISOString(), writeEndsAt: new Date(now + readEndsInMs + 180_000).toISOString(), serverNow: new Date(now).toISOString() }; };

type Call = { method: string; url: string; body?: string };
/** Route-aware fetch mock: the start POST never answers (deadline abort), GET behaviour is per test. */
function install(get: (url: string, signal?: AbortSignal | null) => Promise<Response>) {
  const calls: Call[] = [];
  const old = globalThis.fetch; const oldTimeout = window.setTimeout;
  // Compress the 12 s start deadline and the 8 s recheck deadline.
  window.setTimeout = ((h: TimerHandler, ms?: number, ...a: unknown[]) => oldTimeout(h, ms === 12_000 || ms === 8_000 ? 15 : ms, ...a)) as typeof window.setTimeout;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ method, url: String(url), body: typeof init?.body === "string" ? init.body : undefined });
    const signal = init?.signal;
    if (method !== "GET") return await new Promise<Response>((_r, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));
    return get(String(url), signal);
  }) as typeof fetch;
  return { calls, writes: () => calls.filter((c) => c.method !== "GET"), restore() { globalThis.fetch = old; window.setTimeout = oldTimeout; } };
}
const hang = (signal?: AbortSignal | null) => new Promise<Response>((_r, reject) => signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true }));

async function mount(initial: unknown, run: (root: ReturnType<typeof createRoot>) => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(must<HTMLDivElement>("#root"));
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  let unmounted = false;
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, React.createElement(RetentionSession, { dict: en, initial: initial as never }))));
    const realUnmount = root.unmount.bind(root);
    await run(Object.assign(root, { unmount: () => { unmounted = true; return realUnmount(); } }));
  } finally { if (!unmounted) await act(async () => root.unmount()); }
}
const startTimeout = async () => { await act(async () => must<HTMLButtonElement>("[data-retention-start]").click()); await wait(60); };
const pageshow = async () => { const ev = new dom.window.Event("pageshow") as Event & { persisted?: boolean }; Object.defineProperty(ev, "persisted", { value: true }); await act(async () => { window.dispatchEvent(ev); }); await wait(40); };

test("N07 matrix: the only write is exactly one start POST to /api/retention/attempts with the chosen level", async () => {
  const m = install(async () => json({ active: null }));
  try { await mount(null, async () => {
    await act(async () => must<HTMLButtonElement>('[data-retention-level="C1"]').click());
    await startTimeout();
    assert.equal(m.writes().length, 1);
    assert.deepEqual(m.writes()[0], { method: "POST", url: "/api/retention/attempts", body: JSON.stringify({ level: "C1" }) });
  }); } finally { m.restore(); }
});

test("N07 matrix: recheck GET times out -> no write, start stays locked, recover button issues GET only", async () => {
  const m = install(async (_u, signal) => hang(signal));
  try { await mount(null, async () => {
    await startTimeout(); await wait(60);
    assert.equal(m.writes().length, 1, "no second write after the GET timed out");
    assert.equal(must<HTMLButtonElement>("[data-retention-start]").disabled, true);
    await act(async () => must<HTMLButtonElement>("[data-retention-recover-start]").click()); await wait(60);
    assert.equal(m.writes().length, 1);
    assert.deepEqual(m.calls.filter((c) => c.method === "GET").map((c) => c.url), ["/api/retention/attempts", "/api/retention/attempts"]);
  }); } finally { m.restore(); }
});

test("N07 matrix: recheck GET fails (500) -> no write, start locked, error stays visible", async () => {
  const m = install(async () => json({ error: "retention_internal" }, 500));
  try { await mount(null, async () => {
    await startTimeout(); await wait(40);
    assert.equal(m.writes().length, 1);
    assert.equal(must<HTMLButtonElement>("[data-retention-start]").disabled, true);
    assert.ok(must("[data-retention-error]").textContent);
    assert.ok(must("[data-retention-recover-start]"));
  }); } finally { m.restore(); }
});

test("N07 matrix: GET returns the server's attempt -> it is resumed and nothing is written; bfcache restore re-reads it by id (GET)", async () => {
  const m = install(async (url) => url === "/api/retention/attempts" ? json({ active: { ...meta(60_000), phase: "reading", wordCount: 9, bodyText: SOURCE } }) : json({ ...meta(60_000), phase: "reading", wordCount: 9, bodyText: SOURCE }));
  try { await mount(null, async () => {
    await startTimeout(); await wait(40);
    assert.ok(must("[data-retention-source]"));
    await pageshow();
    assert.equal(m.writes().length, 1, "resume and restore never write");
    assert.equal(m.calls.at(-1)!.url, `/api/retention/attempts/${ID}`);
  }); } finally { m.restore(); }
});

test("N07 matrix: GET returns no attempt -> start is re-enabled but NOT re-sent automatically", async () => {
  const m = install(async () => json({ active: null }));
  try { await mount(null, async () => {
    await startTimeout(); await wait(150);
    assert.equal(must<HTMLButtonElement>("[data-retention-start]").disabled, false);
    assert.equal(m.writes().length, 1, "the user must press Start again");
    await pageshow();
    assert.equal(m.writes().length, 1, "bfcache restore rechecks with GET only");
  }); } finally { m.restore(); }
});

test("N07 matrix: reload (fresh mount) with or without a server attempt performs no write", async () => {
  const m = install(async () => json({ active: null }));
  try {
    await mount(null, async () => { await wait(40); });
    await mount({ ...meta(60_000), phase: "reading", wordCount: 9, bodyText: SOURCE }, async () => { await wait(40); assert.ok(must("[data-retention-source]")); });
    assert.equal(m.writes().length, 0);
  } finally { m.restore(); }
});

test("N07 matrix: leaving during the recheck aborts it and nothing is written afterwards", async () => {
  let recheckSignal: AbortSignal | null | undefined;
  let started!: () => void;
  const recheckStarted = new Promise<void>((resolve) => { started = resolve; });
  const m = install(async (_u, signal) => { recheckSignal = signal; started(); return await new Promise<Response>(() => {}); });
  try { await mount(null, async (root) => {
    await act(async () => must<HTMLButtonElement>("[data-retention-start]").click());
    await act(async () => { await recheckStarted; });
    assert.ok(recheckSignal, "recheck started");
    await act(async () => root.unmount());
    assert.equal(recheckSignal.aborted, true, "leave cancels the in-flight authoritative read");
    await wait(60);
    assert.equal(m.writes().length, 1);
  }); } finally { m.restore(); }
});

test("N07 matrix privacy: a recall-phase attempt from the recheck renders no source text", async () => {
  const m = install(async () => json({ active: { ...meta(-1_000), phase: "recall", recallDraft: "" } }));
  try { await mount(null, async () => {
    await startTimeout(); await wait(40);
    assert.equal(q("[data-retention-source]"), null);
    assert.ok(!document.body.textContent!.includes("SECRET-SOURCE-BODY"));
  }); } finally { m.restore(); }
});
