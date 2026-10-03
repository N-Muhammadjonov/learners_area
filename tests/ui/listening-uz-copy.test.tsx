// Learner Listening surfaces render Uzbek copy from the dictionary (master §47).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import uz from "../../src/lib/i18n/uz";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/listening" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLMediaElement", "HTMLAudioElement", "Element", "Node", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { FullListeningLibrary } = await import("../../src/components/listening/FullListeningLibrary");
const { NativeListeningExam } = await import("../../src/components/listening/NativeListeningExam");
const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };

async function text(el: React.ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, el)));
  const out = document.body.textContent ?? "";
  const labels = [...document.querySelectorAll("[aria-label],[alt]")].map((e) => e.getAttribute("aria-label") ?? e.getAttribute("alt")).join(" ");
  await act(async () => root.unmount());
  return `${out} ${labels}`;
}

test("LU1 Listening library renders Uzbek, no English UI copy", async () => {
  const t = await text(React.createElement(FullListeningLibrary, { dict: uz, cards: [{ id: "a", title: "Test 1", duration: 1800, completed: 0, started: false }] }));
  assert.doesNotMatch(t, /Bu sahifadagi nashr qilingan testlar/);
  assert.match(t, /4 bo'lim · 30 daqiqa/);
  for (const en of ["Published tests", "activities completed", "Search listening tests", "Start", "completed activities"]) assert.ok(!t.includes(en), en);
});

test("LU2 Listening exam renders Uzbek controls; map alt is not test-specific", async () => {
  const t = await text(React.createElement(NativeListeningExam, {
    dict: uz, attemptId: "x", testId: "y", title: "T", audioUrl: "/a.mp3", imageUrl: null, duration: 60, initial: {}, audioPosition: 0, audioStartedAt: null,
    questions: [{ id: "q1", number: 1, section: 1, text: "Name", instruction: "One word", options: [] }],
  }));
  for (const uzText of ["Imtihonni yuborish", "Ovoz balandligi", "1-bo'lim", "Bo'limlar"]) assert.ok(t.includes(uzText), uzText);
  for (const en of ["Submit exam", "Volume", "Fullscreen", "Spring Down"]) assert.ok(!t.includes(en), en);
});
