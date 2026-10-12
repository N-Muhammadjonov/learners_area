import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * GENERAL LISTENING — the highlight layer on the ONE canonical text surface.
 *
 * The owner's rules for highlight are narrow: it appears only on text the learner can
 * already see, it belongs to that learner, it reuses the approved text surface rather than
 * adding a second one, it never corrupts an answer and it never leaks a key. This test
 * proves the mechanics on the real component:
 *
 *   H1  highlight ranges are stored as CHARACTER OFFSETS of the visible string, so what is
 *       painted does not depend on the DOM that happens to be rendered;
 *   H2  a stored range paints the exact characters, including one that starts or ends in
 *       the middle of a word — and the word stays one word (its lookup still works);
 *   H3  a highlight spanning a boundary does not shift any other character;
 *   H4  the surface offers NO highlight control unless the caller asked for one, so every
 *       existing surface (Reading, lessons, the graded exam) renders exactly as before;
 *   H5  nothing about a highlight touches an answer: the text is rendered from the visible
 *       string alone.
 */

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/listening" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Event", "MouseEvent", "KeyboardEvent", "Node", "NodeFilter", "Range"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { ClickableText } = await import("../../src/components/vocabulary/ClickableText");
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const originalFetch = globalThis.fetch;

async function render(element: React.ReactElement) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  await act(async () => root.render(element));
  return root;
}
const marks = () => [...document.querySelectorAll<HTMLElement>("[data-highlight-id]")];

test("H1–H3 a stored highlight paints exactly those characters and nothing else", async () => {
  globalThis.fetch = (async () => json({ results: [] })) as typeof fetch;
  const text = "The tour lasts forty minutes today.";
  const spans = [{ id: "h1", start: 4, end: 8 }, { id: "h2", start: 22, end: 26 }];
  const root = await render(<ClickableText dict={en} text={text} sourceType="listening" sourceId="attempt-1" highlights={spans} />);
  try {
    const painted = marks();
    assert.equal(painted.length, 2, "both ranges are painted");
    assert.equal(painted[0]!.textContent, "tour", "the first range covers exactly its characters");
    assert.equal(painted[1]!.textContent, "inut", "a range may start INSIDE a word and must not drag the word with it");
    // The whole string is still rendered, in order, once.
    const region = document.querySelector("[data-clickable-text]")!;
    assert.equal(region.textContent, text, "no character is added, dropped or reordered");
    // …and the word is still ONE word: highlights must not break the canonical lookup.
    const word = document.querySelector<HTMLElement>('[data-word="minutes"]')!;
    assert.ok(word, "the word that carries a partial highlight is still a word");
    assert.equal(word.textContent, "minutes");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("H4 without a caller asking for it, there is no highlight control at all", async () => {
  globalThis.fetch = (async () => json({ results: [] })) as typeof fetch;
  const root = await render(<ClickableText dict={en} text="Reading passage text" sourceType="reading" sourceId="p1" />);
  try {
    const region = document.querySelector("[data-clickable-text]")!;
    assert.equal(region.getAttribute("data-highlight-surface"), null, "a read-only surface offers no highlight");
    assert.equal(marks().length, 0);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("H2b a selection inside the text offers the small control, and choosing it reports the range", async () => {
  globalThis.fetch = (async () => json({ results: [] })) as typeof fetch;
  const text = "The museum opens at nine.";
  const reported: { start: number; end: number }[] = [];
  const root = await render(
    <ClickableText dict={en} text={text} sourceType="listening" sourceId="attempt-2" onHighlightRange={(range) => reported.push(range)} />,
  );
  try {
    const region = document.querySelector<HTMLElement>("[data-clickable-text]")!;
    assert.equal(region.getAttribute("data-highlight-surface"), "true", "the surface says it can highlight");
    // Select "museum": offsets 4–10 of the visible text.
    const wordNode = document.querySelector('[data-word="museum"]')!.firstChild!;
    const range = document.createRange();
    range.setStart(wordNode, 0);
    range.setEnd(wordNode, 6);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    await act(async () => {
      region.dispatchEvent(new dom.window.MouseEvent("mouseup", { bubbles: true }));
    });
    const control = document.querySelector("[data-highlight-control]");
    assert.ok(control, "the small highlight control appears for a real selection");
    const button = control!.querySelector("button")!;
    assert.equal(button.textContent, en.listening.general.highlight);
    await act(async () => button.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true })));
    assert.deepEqual(reported, [{ start: 4, end: 10 }], "the exact visible characters are reported");
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
  }
});

test("H5 nothing about highlight reads an answer or a key", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync("src/components/vocabulary/ClickableText.tsx", "utf8");
  const component = source.slice(source.indexOf("export function ClickableText"));
  assert.ok(!/correctAnswer|answerKey|correct_answer|answer_key/.test(component), "the text surface must not know about answers");
  // The stored range is exactly three numbers/strings about the VISIBLE text.
  assert.ok(component.includes("onHighlightRange?: (range: { start: number; end: number }) => void"));
});
