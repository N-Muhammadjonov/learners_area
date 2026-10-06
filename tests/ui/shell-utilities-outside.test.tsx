import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/** W14: the real ShellUtilities stack in JSDOM — outside press, inside press, Escape. */
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/dashboard" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLTextAreaElement", "HTMLInputElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "CustomEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { ShellUtilities } = await import("../../src/components/shell/ShellUtilities");

const q = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  assert.ok(element, selector);
  return element;
};
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch: async () => {} };
const press = (target: Element) => act(async () => { target.dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true })); });

test("utilities stack: inside presses keep it open, an outside press closes it, Escape closes it", async () => {
  document.body.innerHTML = '<div id="root"></div><main><button id="page-button">page</button><input id="page-input" /></main>';
  const root = createRoot(q("#root"));
  try {
    await act(async () => root.render(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value="/app/dashboard">
          <ShellUtilities dict={en} />
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    ));
    const launcher = q<HTMLButtonElement>("[data-utilities-launcher]");
    await act(async () => launcher.click());
    assert.ok(q("[data-shell-utilities-panel]"));
    // Inside press (the panel itself / coach link) keeps it open.
    await press(q("[data-shell-utilities-panel]"));
    assert.ok(document.querySelector("[data-shell-utilities-panel]"), "inside press keeps the stack open");
    // Focus inside, then an outside press: closes and returns focus to the launcher.
    q<HTMLElement>("[data-coach-fab]").focus();
    await press(q("#page-button"));
    assert.equal(document.querySelector("[data-shell-utilities-panel]"), null, "outside press closes");
    assert.equal(launcher.getAttribute("aria-expanded"), "false");
    assert.equal(document.activeElement, launcher, "focus returns to the launcher when it was inside");
    // Outside press while focus is elsewhere does not steal focus.
    await act(async () => launcher.click());
    q<HTMLInputElement>("#page-input").focus();
    await press(q("#page-input"));
    assert.equal(document.querySelector("[data-shell-utilities-panel]"), null);
    assert.equal(document.activeElement, q("#page-input"), "typing elsewhere is not interrupted");
    // Escape still closes.
    await act(async () => launcher.click());
    await act(async () => { document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    assert.equal(document.querySelector("[data-shell-utilities-panel]"), null);
  } finally {
    await act(async () => root.unmount());
  }
});
