import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<html><body></body></html>", { url: "http://localhost/vocabulary?tab=dictionary" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { DictionaryRecentSearches } = await import("../../src/components/vocabulary/DictionaryRecentSearches");
const history = Array.from({ length: 8 }, (_, n) => ({
  lexeme_id: `word-${n}`, query_display: `qidiruv-${n}`, direction: "UZ" as const,
  display_lemma: `English-${n}`, translation_uz: `Tarjima ${n}`, cefr: n === 0 ? "B2" : null,
}));
async function mount(height: number, run: () => Promise<void>) {
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
  const original = dom.window.HTMLElement.prototype.getBoundingClientRect;
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { top: 180, height: 88, bottom: 268, left: 0, right: 500, width: 500, x: 0, y: 180, toJSON() {} };
  };
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  try {
    await act(async () => root.render(React.createElement(DictionaryRecentSearches, {
      recent: history, title: "So‘nggi qidiruvlar", clearLabel: "Tozalash",
      onOpen: entry => { opened = entry.lexeme_id; }, onClear: () => { cleared += 1; },
    })));
    await run();
  } finally {
    await act(async () => root.unmount());
    dom.window.HTMLElement.prototype.getBoundingClientRect = original;
  }
}
let opened = "", cleared = 0;
const rows = () => Array.from(document.querySelectorAll<HTMLButtonElement>("[data-dictionary-recent-row]"));

test("history shows at most the newest five, with real CEFR only, and opens the selected canonical entry", async () => {
  await mount(1000, async () => {
    assert.equal(rows().length, 5);
    assert.ok(document.body.textContent?.includes("So‘nggi qidiruvlar"));
    assert.ok(!document.body.textContent?.includes("English-5"));
    assert.equal(rows()[0]!.querySelectorAll("strong").length, 2);
    assert.ok(rows()[0]!.textContent?.includes("B2"));
    assert.ok(!rows()[1]!.textContent?.includes("B2"));
    assert.ok(rows()[0]!.querySelector(".truncate")?.textContent?.includes("Tarjima 0"));
    await act(async () => rows()[2]!.click());
    assert.equal(opened, "word-2");
    await act(async () => (document.querySelector("button.btn-ghost") as HTMLButtonElement).click());
    assert.equal(cleared, 1);
  });
});

test("short viewport reduces visible history and resizing restores up to five", async () => {
  await mount(430, async () => {
    assert.equal(rows().length, 2);
    Object.defineProperty(window, "innerHeight", { value: 1000, configurable: true });
    await act(async () => window.dispatchEvent(new dom.window.Event("resize")));
    assert.equal(rows().length, 5);
  });
});

test("zoomed visual viewport takes precedence over the layout viewport", async () => {
  const viewport = new dom.window.EventTarget();
  Object.defineProperty(viewport, "height", { value: 330, configurable: true });
  Object.defineProperty(window, "visualViewport", { value: viewport, configurable: true });
  try {
    await mount(1000, async () => {
      assert.equal(rows().length, 1);
      Object.defineProperty(viewport, "height", { value: 700, configurable: true });
      await act(async () => viewport.dispatchEvent(new dom.window.Event("resize")));
      assert.equal(rows().length, 5);
    });
  } finally { Object.defineProperty(window, "visualViewport", { value: undefined, configurable: true }); }
});
