import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import { readFileSync } from "node:fs";

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
const { SidebarNav } = await import("../../src/components/shell/SidebarNav");
const { ModuleContextHeading } = await import("../../src/components/shell/ModuleContextHeading");
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

test("Management navigation uses the same framed links as learning and has no learner module links", async () => {
  const root = createRoot(required("#root"));
  try {
    await act(async () => root.render(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value="/app/management">
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <InstantInteractionProvider>
              <div data-shell><SidebarNav dict={en} role="owner" /></div>
            </InstantInteractionProvider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    ));
    const groups = document.querySelectorAll('[data-sidebar-group="management"]');
    assert.equal(groups.length, 2, "both Management link groups use the theme card class");
    const links = document.querySelectorAll('[data-sidebar-group="management"] .sidebar-link');
    assert.ok(links.length >= 3, "management links remain available to owner");
    assert.equal(document.querySelector('[data-sidebar-group="modules"]'), null, "no learning modules in management mode");
    assert.ok(required('[data-sidebar-link="/app/admin/people"]'));
    const css = readFileSync(new URL("../../src/app/globals.css", import.meta.url), "utf8");
    assert.match(css, /\[data-sidebar-group="support"\], \[data-sidebar-group="management"\]\) \.sidebar-link/);
    for (const theme of ["day", "night"]) {
      assert.match(css, new RegExp(`\\[data-theme="${theme}"\\][\\s\\S]*?#mobile-nav-drawer \\{\\s*\\/\\*[^]*?\\*\\/\\s*background: var\\(--la-${theme}-wave-paper\\)`));
    }
  } finally {
    await act(async () => root.unmount());
  }
});

test("Learner menu lands on Lessons for Reading/Listening/Grammar and keeps other module routes", async () => {
  const root = createRoot(required("#root"));
  try {
    await act(async () => root.render(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value="/app/reading/lessons">
          <SearchParamsContext.Provider value={new URLSearchParams()}>
            <InstantInteractionProvider>
              <div data-shell>
                <SidebarNav dict={en} role="owner" />
                <ModuleContextHeading dict={en} />
              </div>
            </InstantInteractionProvider>
          </SearchParamsContext.Provider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    ));
    for (const moduleKey of ["reading", "listening", "grammar"]) {
      const link = required<HTMLAnchorElement>(`[data-sidebar-link="/app/${moduleKey}/lessons"]`);
      assert.equal(new URL(link.href).pathname, `/app/${moduleKey}/lessons`);
    }
    const active = required<HTMLAnchorElement>('[data-sidebar-link="/app/reading/lessons"]');
    assert.equal(active.getAttribute("aria-current"), "page", "lesson route highlights its parent module");
    assert.equal(required('[data-module-context-heading="reading"]').textContent?.trim(), en.nav.reading);
    assert.ok(required('[data-sidebar-link="/app/writing"]'), "Writing root already defaults to Lessons tab");
    assert.ok(required('[data-sidebar-link="/app/speaking"]'));
    assert.ok(required('[data-sidebar-link="/app/vocabulary"]'));
    assert.ok(required('[data-sidebar-link="/app/video-lessons"]'));
  } finally {
    await act(async () => root.unmount());
  }
});

test("Module root routes redirect to Lessons while query-specific Grammar and legacy Reading links survive", async () => {
  const reading = readFileSync(new URL("../../src/app/app/(shell)/reading/page.tsx", import.meta.url), "utf8");
  const listening = readFileSync(new URL("../../src/app/app/(shell)/listening/page.tsx", import.meta.url), "utf8");
  const grammar = readFileSync(new URL("../../src/app/app/(shell)/grammar/page.tsx", import.meta.url), "utf8");
  const grammarTabs = readFileSync(new URL("../../src/lib/nav/module-sections.ts", import.meta.url), "utf8");
  assert.match(reading, /redirect\(target \?\? "\/app\/reading\/lessons"\)/);
  assert.match(reading, /readingLegacyDestination/);
  assert.match(listening, /redirect\("\/app\/listening\/lessons"\)/);
  assert.match(grammar, /if \(!query\.tab\) redirect\("\/app\/grammar\/lessons"\)/);
  assert.match(grammarTabs, /href: "\/app\/grammar\?tab=writing", queryValue: "writing", label:/);
  assert.match(grammarTabs, /href: "\/app\/grammar\?tab=speaking", queryValue: "speaking"/);
});
