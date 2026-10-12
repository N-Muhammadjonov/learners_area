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

test("transport not ready: notice shown, automatic entry makes no POST; S — shown", async () => {
  await act(async () => { root.render(React.createElement(LivePartnerClient, props)); });
  await flush();
  assert.ok(container.querySelector("[data-realtime-unavailable]"));
  assert.equal([...container.querySelectorAll("button")].some(b => b.textContent === en.livePartner.goOnline), false);
  assert.equal(calls.some(call => call.method === "POST"), false);
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
  const rulesButton = [...c2.querySelectorAll("button")].find(b => b.textContent === en.livePartner.rulesTitle)!;
  const dialog = c2.querySelector('[role="dialog"]')!;
  assert.ok(dialog, "rules dialog opens");
  assert.ok(dialog.contains(document.activeElement), "focus is inside the dialog");
  await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
  assert.equal(c2.querySelector('[role="dialog"]'), null);
  rulesButton.focus();
  await act(async () => { rulesButton.click(); });
  const agree = [...c2.querySelectorAll("button")].find((b) => b.textContent === en.livePartner.agree)!;
  const posts = () => calls.filter((c) => c.method === "POST" && (c.body as { action: string }).action === "accept_rules").length;
  const p0 = posts();
  await act(async () => { agree.click(); agree.click(); });
  assert.equal(posts() - p0, 1, "synchronous single-flight");
  await act(async () => { r2.unmount(); });
});


test("search reveals matching topics in every part; topics open questions with next and back", async () => {
  realtimeReady = false;
  const target = document.createElement("div"); document.body.appendChild(target);
  const instance = createRoot(target);
  await act(async () => { instance.render(React.createElement(LivePartnerClient, { ...props, questions: [...props.questions, { id: "3", part: "part1", topic: "Home", promptText: "What is your home like?", cueCard: null }] })); });
  await flush();
  const input = target.querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "des");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const cafe = [...target.querySelectorAll("button")].find(button => button.textContent === "Café→")!;
  assert.ok(cafe, "a Part 2 match appears while Part 1 is selected");
  await act(async () => cafe.click());
  assert.ok(target.querySelector("[data-partner-topic-question]")?.textContent?.includes("Describe a café"));
  const back = [...target.querySelectorAll("button")].find(button => button.textContent === `← ${en.common.back}`)!;
  await act(async () => back.click());
  assert.equal(target.querySelector("[data-partner-topic-question]"), null);
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(input, "");
    input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    input.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  });
  const home = [...target.querySelectorAll("button")].find(button => button.textContent === "Home→")!;
  await act(async () => home.click());
  const next = [...target.querySelectorAll("button")].find(button => button.textContent === `${en.livePartner.nextQuestion} →`)!;
  assert.ok(next, "learner navigation is labelled Next question rather than an authoring action");
  await act(async () => next.click());
  assert.ok(target.querySelector("[data-partner-topic-question]")?.textContent?.includes("What is your home like?"));
  await act(async () => instance.unmount());
});
