import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * The autosave pipeline: truthful, serialized, coalesced — and durable on exit.
 *
 * These tests drive the real component in jsdom with only `fetch` stubbed, so the
 * debounce, the coalescing, the one-writer latch and the exit flush are the shipping
 * ones. Every assertion is about what the SERVER was asked to store, in order, and
 * about what the indicator claims.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/app" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "AbortController", "DOMException"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
Object.defineProperty(dom.window, "fetch", { value: globalThis.fetch, configurable: true, writable: true });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { LessonNotesPanel } = await import("../../src/components/notes/LessonNotesPanel");

const LESSON_ID = "11111111-1111-4111-8111-111111111111";
const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

type Call = { url: string; method: string; body: Record<string, unknown>; keepalive: boolean };

/**
 * A fetch stub that records every call and resolves each one when the test says so.
 * `deferred` mode hands back the resolver, which is how the ordering tests control
 * exactly when a response lands.
 */
function installFetch(plan: { mode: "auto"; statuses?: number[] } | { mode: "deferred" }) {
  const calls: Call[] = [];
  const resolvers: ((status: number) => void)[] = [];
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    writable: true,
    value: async (url: string, init: RequestInit = {}) => {
      calls.push({
        url: String(url),
        method: init.method ?? "GET",
        body: init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {},
        keepalive: init.keepalive === true,
      });
      const status = await new Promise<number>((resolve) => {
        if (plan.mode === "auto") resolve(plan.statuses?.[Math.min(calls.length - 1, (plan.statuses?.length ?? 1) - 1)] ?? 200);
        else resolvers.push(resolve);
      });
      return new Response(status < 400 ? JSON.stringify({ ok: true, notes: "x" }) : JSON.stringify({ error: "boom" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  Object.defineProperty(dom.window, "fetch", { value: globalThis.fetch, configurable: true, writable: true });
  return { calls, resolvers, settle: (index: number, status = 200) => resolvers[index]!(status) };
}

async function type(value: string) {
  const textarea = document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, value);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const bodies = (calls: Call[]) => calls.map((call) => call.body.notes as string);
const state = () => document.querySelector("[data-lesson-notes-state]")!.getAttribute("data-lesson-notes-state");
const label = () => document.querySelector("[data-lesson-notes-state]")!.textContent;

/** Mount the panel for one test and hand the caller a root it can unmount on demand. */
async function mount(initialNotes = "") {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => root.render(React.createElement(LessonNotesPanel, { dict: en, lessonId: LESSON_ID, initialNotes })));
  return root;
}
const unmount = (root: Awaited<ReturnType<typeof mount>>) => act(async () => root.unmount());

test("C1 unmounting before the debounce flushes the LATEST text, not initialNotes", async () => {
  // The original defect: a cleanup registered with an empty dependency list closed over
  // the first render's `text` (""), so the exit flush could send nothing at all.
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  await type("My latest conclusion");
  await wait(120); // still inside the debounce window
  assert.equal(calls.length, 0, "nothing is sent before the debounce elapses");

  const unmounting = unmount(root);
  await wait(10);
  assert.equal(calls.length, 1, "the exit mechanism sends exactly one request");
  assert.equal(calls[0]!.body.notes, "My latest conclusion", "and it carries the LATEST text, not the initial value");
  assert.equal(calls[0]!.keepalive, true, "the exit write must outlive the document");
  settle(0, 200);
  await unmounting;
});

test("C2 an edit during an in-flight save is coalesced and sent after it", async () => {
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  try {
    await type("A");
    await wait(1000);
    assert.equal(calls.length, 1, "A is in flight");
    assert.deepEqual(bodies(calls), ["A"]);

    await type("B");
    await wait(1200);
    assert.equal(calls.length, 1, "B must NOT start a second write while A is running — one writer only");
    assert.equal(state(), "saving");

    settle(0, 200); // A lands, then the pipeline immediately drains the coalesced B
    await wait(60);
    assert.equal(calls.length, 2, "B is sent after A settles");
    assert.deepEqual(bodies(calls), ["A", "B"]);
    settle(1, 200);
    await wait(60);
    assert.equal(state(), "saved");
  } finally {
    const unmounting = unmount(root);
    await wait(10);
    for (let i = 0; i < resolvers.length; i++) resolvers[i]!(200);
    await unmounting;
  }
});

test("C3 an older write can never land after a newer one: the newest edit is the last request sent", async () => {
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  try {
    await type("old text");
    await wait(1000);
    await type("NEW TEXT");
    await wait(1500);
    assert.deepEqual(bodies(calls), ["old text"], "no second write is in flight, so the DB cannot be reordered by this panel");

    settle(0, 200);
    await wait(60);
    assert.deepEqual(bodies(calls), ["old text", "NEW TEXT"], "the final request is the newest text");
    settle(1, 200);
    await wait(60);
    assert.equal(state(), "saved");

    // And the pipeline is empty afterwards: nothing queued behind the last write.
    await wait(1200);
    assert.equal(calls.length, 2);
  } finally {
    const unmounting = unmount(root);
    await wait(10);
    resolvers.forEach((r) => r(200));
    await unmounting;
  }
});

test("C4 A → B → C while one request runs sends the active value then ONLY the latest", async () => {
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  try {
    await type("A");
    await wait(1000);
    assert.equal(calls.length, 1, "A is the active write");

    await type("B");
    await type("C");
    await wait(1400);
    assert.equal(calls.length, 1, "B and C coalesce into one pending value; no per-keystroke queue exists");

    settle(0, 200);
    await wait(60);
    assert.deepEqual(bodies(calls), ["A", "C"], "B is skipped on purpose: C supersedes it, and only the latest is sent");
    settle(1, 200);
    await wait(60);
    assert.equal(calls.length, 2, "two requests total for three edits");
    assert.equal(state(), "saved");
  } finally {
    const unmounting = unmount(root);
    await wait(10);
    resolvers.forEach((r) => r(200));
    await unmounting;
  }
});

test("C5 a failed save keeps the newest text pending, retries it, and never says Saved for unacknowledged text", async () => {
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  try {
    await type("first version");
    await wait(1000);
    await type("better version");
    await wait(1200);
    settle(0, 500); // the first write fails while a newer value is pending
    await wait(80);

    assert.equal(state(), "saving", "a newer value exists, so recovery is already running — not a failure stop");
    assert.deepEqual(bodies(calls), ["first version", "better version"]);

    settle(1, 200);
    await wait(60);
    assert.equal(state(), "saved");
    assert.equal(label(), en.courseRoadmap.notesSaved);
    assert.notEqual(label(), en.courseRoadmap.notesSaveFailed);

    // A failure with NOTHING newer stops and keeps the text for an explicit retry.
    const second = installFetch({ mode: "deferred" });
    const root2 = await mount("");
    await type("only version");
    await wait(1000);
    second.settle(0, 500);
    await wait(60);
    assert.equal(state(), "failed");
    assert.equal(label(), en.courseRoadmap.notesSaveFailed, "a failure is never dressed up as Saved");
    assert.equal((document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement).value, "only version", "the text stays on screen");

    const retry = document.querySelector("[data-lesson-notes-retry]") as HTMLButtonElement;
    assert.ok(retry, "a failed save offers a retry");
    await act(async () => retry.click());
    await wait(30);
    assert.deepEqual(bodies(second.calls), ["only version", "only version"], "the retry re-sends exactly the text that failed");
    second.settle(1, 200);
    await wait(30);
    assert.equal(state(), "saved");
    const unmounting = unmount(root2);
    await wait(10);
    second.resolvers.forEach((r) => r(200));
    await unmounting;
  } finally {
    const unmounting = unmount(root);
    await wait(10);
    resolvers.forEach((r) => r(200));
    await unmounting;
  }
});

test("C6 unmounting an already-saved note performs no duplicate write", async () => {
  const { calls } = installFetch({ mode: "auto", statuses: [200] });
  const root = await mount("Already saved text");
  await wait(1200);
  assert.equal(calls.length, 0, "an untouched note is never re-saved on mount");
  await unmount(root);
  await wait(30);
  assert.equal(calls.length, 0, "the exit flush recognises the server already holds this text");

  // And after a real save, a second exit flush is still a no-op.
  const second = installFetch({ mode: "auto", statuses: [200] });
  const root2 = await mount("");
  await type("saved once");
  await wait(1000);
  assert.deepEqual(bodies(second.calls), ["saved once"]);
  await unmount(root2);
  await wait(30);
  assert.deepEqual(bodies(second.calls), ["saved once"], "no duplicate write on exit");
});

test("C7 an over-long note is never sent, not even on exit", async () => {
  const { calls } = installFetch({ mode: "auto", statuses: [200] });
  const root = await mount("");
  await type("x".repeat(4001));
  await wait(1200);
  assert.equal(calls.length, 0, "over the bound: never posted to be silently truncated server-side");
  assert.equal(state(), "too_long");
  assert.equal(label(), en.courseRoadmap.notesTooLong);
  await unmount(root);
  await wait(30);
  assert.equal(calls.length, 0, "the exit flush respects the same bound");
});

test("C8 the page going away flushes the latest text with keepalive, and a route change does not double-write", async () => {
  const { calls, resolvers, settle } = installFetch({ mode: "deferred" });
  const root = await mount("");
  try {
    await type("text typed just before leaving");
    await wait(120);
    await act(async () => {
      window.dispatchEvent(new dom.window.Event("pagehide"));
    });
    assert.equal(calls.length, 1, "pagehide flushes immediately, without waiting for the debounce");
    assert.equal(calls[0]!.body.notes, "text typed just before leaving");
    assert.equal(calls[0]!.keepalive, true, "the write survives the document going away");
    settle(0, 200);
    await wait(40);

    // Unmount afterwards finds the server already holds that text: no second write.
    const unmounting = unmount(root);
    await wait(20);
    assert.equal(calls.length, 1, "no duplicate write after a pagehide flush");
    resolvers.forEach((r) => r(200));
    await unmounting;
  } finally {
    const unmounting = unmount(root);
    await wait(10);
    resolvers.forEach((r) => r(200));
    await unmounting;
  }
});

test("C9 the ordering guarantee is the pipeline itself, never abort-based cancellation", async () => {
  const source = readFileSync("src/components/notes/LessonNotesPanel.tsx", "utf8");
  const request = readFileSync("src/lib/http/client-request.ts", "utf8");

  // The write ordering must not come from useScopedRequest, whose whole job is to abort
  // the previous request: aborting proves the client stopped waiting, not that the server
  // stopped writing.
  // The doc comment names the hook on purpose (to say why it is NOT used), so the
  // assertion is about use: no import, no call.
  assert.ok(!/import .*useScopedRequest|=\s*useScopedRequest\(/.test(source), "note writes must not use the abort-previous-request hook");
  assert.match(source, /inFlightRef/, "a one-writer latch must gate every write");
  assert.match(source, /while \(pendingRef\.current !== null\)/, "the pipeline drains one coalesced value at a time");
  assert.match(source, /if \(inFlightRef\.current\) return;/, "a second write can never start while one is running");
  assert.match(source, /latestTextRef\.current = event\.target\.value;/, "the latest text ref is updated synchronously with the keystroke");
  assert.match(source, /latestTextRef\.current === value \? "saved" : "unsaved"/, "\"Saved\" is only claimed for the text the server acknowledged");
  assert.match(source, /flushLatest\(true\)/, "the exit path requests a keepalive write");

  // No browser storage, and the note text never reaches the URL.
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(source));
  assert.ok(!/history\.(pushState|replaceState)|router\.(push|replace)/.test(source), "the note is never encoded into the URL");

  // requestJson still owns the transport contract: same-origin credentials, JSON body,
  // a deadline, and now an opt-in keepalive that changes nothing else.
  assert.match(request, /keepalive\?: boolean/);
  assert.match(request, /\.\.\.\(keepalive \? \{ keepalive: true \} : \{\}\)/);
  assert.match(request, /timeoutMs = 25_000/);
});
