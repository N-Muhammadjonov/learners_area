import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/** Live Partner client in JSDOM: request discipline, transport gate, dialog keyboard handling. */
const dom = new JSDOM('<!doctype html><html><body><button id="before">before</button><div id="root"></div></body></html>', { url: "http://localhost/speaking/live-partner" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "HTMLAudioElement"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
Object.defineProperty(dom.window.HTMLMediaElement.prototype, "play", { value: () => Promise.resolve(), configurable: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { LivePartnerClient } = await import("../../src/components/speaking/LivePartnerClient");

type Call = { method: string; body: unknown; signal?: AbortSignal };
const calls: Call[] = [];
let realtimeReady = false;
let hangGets = false;
const base = () => ({ state: "offline", rulesAccepted: false, sessionId: null, partner: null, incoming: null, outgoing: null, online: [], realtime: realtimeReady ? { ready: true } : { ready: false, reason: "not_configured" }, serverNow: new Date().toISOString() });
globalThis.fetch = (async (_url: string, init?: RequestInit) => {
  const method = init?.method ?? "GET";
  calls.push({ method, body: init?.body ? JSON.parse(String(init.body)) : null, signal: init?.signal ?? undefined });
  if (method === "GET" && hangGets) return new Promise<Response>(() => {});
  return new Response(JSON.stringify(base()), { status: 200 });
}) as typeof fetch;

const container = document.getElementById("root")!;
const root = createRoot(container);
const props = { dict: en, me: { name: "Ali", avatar: "a" as const, hasGender: true, speakingScore: null }, questions: [
  { id: "1", part: "part1", topic: "Home", promptText: "Where do you live?", cueCard: null },
  { id: "2", part: "part2", topic: "Café", promptText: "Describe a café", cueCard: "You should say" },
] };
const flush = async () => { await act(async () => { await new Promise((r) => setTimeout(r, 0)); }); };

test("transport not ready: notice shown, Go Online disabled, nobody can enter a call; S — shown", async () => {
  await act(async () => { root.render(React.createElement(LivePartnerClient, props)); });
  await flush();
  assert.ok(container.querySelector("[data-realtime-unavailable]"));
  const go = [...container.querySelectorAll("button")].find((b) => b.textContent === en.livePartner.goOnline)!;
  assert.equal(go.disabled, true);
  assert.ok(container.textContent!.includes("S —"));
});

test("polls never stack: while a GET hangs, the 4 s interval sends no new GET; unmount aborts it", async () => {
  await act(async () => { root.unmount(); });
  calls.length = 0; hangGets = true;
  const c1 = document.createElement("div"); document.body.appendChild(c1);
  const r1 = createRoot(c1);
  await act(async () => { r1.render(React.createElement(LivePartnerClient, props)); });
  await act(async () => { await new Promise((r) => setTimeout(r, 4_300)); });
  const gets = calls.filter((c) => c.method === "GET");
  assert.equal(gets.length, 1, "the interval skipped while the first GET was in flight");
  await act(async () => { r1.unmount(); });
  assert.equal(gets[0]!.signal?.aborted, true, "in-flight GET aborted on unmount");
  hangGets = false;
});

test("rules dialog: focus moves in, Escape closes and restores focus; double click sends one POST", async () => {
  realtimeReady = true; calls.length = 0;
  const c2 = document.createElement("div"); document.body.appendChild(c2);
  const r2 = createRoot(c2);
  await act(async () => { r2.render(React.createElement(LivePartnerClient, props)); });
  await flush();
  const go = [...c2.querySelectorAll("button")].find((b) => b.textContent === en.livePartner.goOnline)!;
  assert.equal(go.disabled, false);
  go.focus();
  await act(async () => { go.click(); });
  const dialog = c2.querySelector('[role="dialog"]')!;
  assert.ok(dialog, "rules dialog opens");
  assert.ok(dialog.contains(document.activeElement), "focus is inside the dialog");
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(c2.querySelector('[role="dialog"]'), null);
  assert.equal(document.activeElement, go, "focus returns to the trigger");
  await act(async () => { go.click(); });
  const agree = [...c2.querySelectorAll("button")].find((b) => b.textContent === en.livePartner.agree)!;
  const posts = () => calls.filter((c) => c.method === "POST").length;
  const p0 = posts();
  await act(async () => { agree.click(); agree.click(); });
  assert.equal(posts() - p0, 1, "synchronous single-flight");
  await act(async () => { r2.unmount(); });
});
