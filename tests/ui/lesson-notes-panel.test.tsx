import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * The notes panel must never lie about saving.
 *
 * What is asserted here is the state machine a learner actually sees while typing:
 *   idle → (type) unsaved → Saving… → Saved, and on a failed request
 *   "Could not save" WITH the text still in the box and a working retry.
 *
 * The panel is a client component, so this runs in jsdom with `fetch` stubbed — the
 * only thing faked is the transport; the component, its debounce and its state
 * transitions are the real ones.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/app" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "Element", "Node", "Event", "MouseEvent", "AbortController", "DOMException"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { LessonNotesPanel } = await import("../../src/components/notes/LessonNotesPanel");

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

/** Type into the controlled textarea the way a browser does. */
async function type(text: string) {
  const textarea = document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(textarea, text);
    textarea.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
}

const state = () => document.querySelector("[data-lesson-notes-state]")!.getAttribute("data-lesson-notes-state");
const label = () => document.querySelector("[data-lesson-notes-state]")!.textContent;

/** A fetch stub that answers JSON with the given status for every call. */
function stubFetch(statuses: number[], calls: string[] = []) {
  let index = 0;
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url} ${init?.body ?? ""}`);
      const status = statuses[Math.min(index++, statuses.length - 1)]!;
      return new Response(status < 400 ? JSON.stringify({ ok: true, notes: "x" }) : JSON.stringify({ error: "boom" }), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  return calls;
}

async function mount(run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () => root.render(React.createElement(LessonNotesPanel, { dict: en, lessonId: "11111111-1111-4111-8111-111111111111", initialNotes: "" })));
    await run();
  } finally {
    await act(async () => root.unmount());
  }
}

test("autosave: debounced Saving… then Saved, and the written body is the learner's own text", async () => {
  const calls = stubFetch([200]);
  await mount(async () => {
    assert.equal(state(), "idle");
    await type("Birinchi xulosa");
    assert.equal(state(), "unsaved", "typing marks the note unsaved, it does not claim to have saved it");
    await wait(120);
    assert.equal(calls.length, 0, "nothing is sent before the debounce elapses");
    await wait(1000);
    assert.equal(state(), "saved");
    assert.equal(label(), en.courseRoadmap.notesSaved);
    assert.equal(calls.length, 1, "one debounced write for one burst of typing");
    assert.match(calls[0]!, /POST \/api\/lessons\/11111111-1111-4111-8111-111111111111\/notes/);
    assert.match(calls[0]!, /Birinchi xulosa/);
  });
});

test("a failed save says so, keeps the text, and a retry that succeeds turns it into Saved", async () => {
  const calls = stubFetch([500, 200]);
  await mount(async () => {
    await type("Saqlanmaydigan matn");
    await wait(1200);
    assert.equal(state(), "failed");
    assert.equal(label(), en.courseRoadmap.notesSaveFailed, "a failure is never dressed up as Saved");
    assert.equal((document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement).value, "Saqlanmaydigan matn", "the learner's text is still there");

    const retry = document.querySelector("[data-lesson-notes-retry]") as HTMLButtonElement;
    assert.ok(retry, "a failed save offers a retry");
    await act(async () => retry.click());
    await wait(50);
    assert.equal(state(), "saved");
    assert.equal((document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement).value, "Saqlanmaydigan matn");
    assert.equal(calls.length, 2);
  });
});

test("the length bound is visible and an over-long note is not sent at all", async () => {
  const calls = stubFetch([200]);
  await mount(async () => {
    await type("x".repeat(4001));
    await wait(1200);
    assert.equal(state(), "too_long");
    assert.equal(label(), en.courseRoadmap.notesTooLong);
    assert.equal(calls.length, 0, "an over-long note must not be posted and silently truncated server-side");
    await type("short again");
    await wait(1200);
    assert.equal(state(), "saved");
    assert.equal(calls.length, 1);
  });
});

test("the note is loaded from the server, not from browser storage", async () => {
  const panel = await import("node:fs").then((fs) => fs.readFileSync("src/components/notes/LessonNotesPanel.tsx", "utf8"));
  assert.ok(!/localStorage|sessionStorage|indexedDB/.test(panel), "the server is the only store");
  const calls = stubFetch([200]);
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () =>
      root.render(React.createElement(LessonNotesPanel, { dict: en, lessonId: "22222222-2222-4222-8222-222222222222", initialNotes: "Server text" })),
    );
    assert.equal((document.querySelector("[data-lesson-notes]") as HTMLTextAreaElement).value, "Server text");
    assert.equal(state(), "idle", "an untouched note is not re-saved on mount");
    await wait(1200);
    assert.equal(calls.length, 0);
  } finally {
    await act(async () => root.unmount());
  }
});
