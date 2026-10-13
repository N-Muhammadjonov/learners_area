import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/app" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { InstantInteractionProvider } = await import("../../src/components/interaction/InstantInteractionProvider");
const { MobileNav } = await import("../../src/components/shell/MobileNav");
const { ShellUtilities } = await import("../../src/components/shell/ShellUtilities");
const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch: async () => {} };

function required<T extends Element = HTMLElement>(selector: string): T {
  const node = document.querySelector<T>(selector);
  assert.ok(node, `Missing ${selector}`);
  return node;
}

test("Safari mobile drawer escapes the blurred topbar, traps scrolling and restores it on close", async () => {
  const root = createRoot(required("#root"));
  try {
    await act(async () => root.render(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value="/app">
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <InstantInteractionProvider>
              <div data-shell>
                <header data-shell-topbar>
                  <MobileNav dict={en} role="owner" />
                </header>
                <main id="main-content" style={{ overflowY: "auto" }}>Dashboard</main>
                <ShellUtilities dict={en} />
              </div>
            </InstantInteractionProvider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    ));

    const shell = required("[data-shell]");
    const header = required("[data-shell-topbar]");
    const main = required<HTMLElement>("#main-content");
    assert.equal(required<HTMLButtonElement>("[data-mobile-nav-toggle]").getAttribute("aria-expanded"), "false");

    await act(async () => required<HTMLButtonElement>("[data-mobile-nav-toggle]").click());
    const overlay = required<HTMLElement>("[data-mobile-nav-overlay]");
    assert.equal(overlay.parentElement, shell, "portal must stay in themed shell, outside blurred header");
    assert.equal(header.contains(overlay), false, "Safari fixed overlay must not be header-relative");
    assert.equal(overlay.style.zIndex, "var(--z-modal)");
    assert.equal(overlay.getAttribute("aria-modal"), "true");
    assert.ok(required("#mobile-nav-drawer"));
    assert.equal(overlay.querySelector("[data-report-toggle]"), null, "mobile menu must not duplicate the floating report action");
    assert.equal(main.style.overflowY, "hidden", "the scrollable main is locked, not only the body");
    assert.equal(document.body.style.overflow, "hidden");
    assert.equal(document.activeElement?.getAttribute("aria-label"), en.common.cancel);

    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector("[data-mobile-nav-overlay]"), null);
    assert.equal(main.style.overflowY, "auto", "main scroll must be restored after close");
    assert.equal(document.body.style.overflow, "");

    await act(async () => required<HTMLButtonElement>("[data-mobile-nav-toggle]").click());
    await act(async () => required<HTMLButtonElement>("[data-mobile-nav-overlay] > button").click());
    assert.equal(document.querySelector("[data-mobile-nav-overlay]"), null, "backdrop closes the menu");
    assert.equal(main.style.overflowY, "auto");

    // The report action remains reachable from its intended floating utility stack.
    await act(async () => required<HTMLButtonElement>("[data-utilities-launcher]").click());
    assert.ok(required("[data-shell-utilities-panel] [data-report-toggle]"));
    assert.equal(document.querySelectorAll("[data-report-toggle]").length, 1, "only one report trigger when utilities are open");
  } finally {
    await act(async () => root.unmount());
  }
});
