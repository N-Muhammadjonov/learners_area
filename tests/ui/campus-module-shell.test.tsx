import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import en from "../../src/lib/i18n/en";
import config from "../../tailwind.config";

const dom = new JSDOM('<!doctype html><html data-theme="day" data-focus="off"><head></head><body><div id="root"></div></body></html>', { url: "http://localhost/app" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { BackToCampus } = await import("../../src/components/campus/BackToCampus");
const { Breadcrumbs } = await import("../../src/components/shell/Breadcrumbs");
const { MobileNav } = await import("../../src/components/shell/MobileNav");

const content = readFileSync("tests/ui/campus-module-shell.test.tsx", "utf8") + readFileSync("src/components/campus/BackToCampus.tsx", "utf8");
const compiled = await postcss([tailwindcss({ ...config, content: [{ raw: content, extension: "tsx" }], corePlugins: { preflight: false } })]).process(readFileSync("src/app/globals.css", "utf8"), { from: "src/app/globals.css" });
const style = document.createElement("style");
style.textContent = compiled.css;
document.head.append(style);

const q = (selector: string) => {
  const el = document.querySelector<HTMLElement>(selector);
  assert.ok(el, selector);
  return el;
};

test("every campus destination immediately hides both menus in either theme; Main links to the map without changing Focus", async () => {
  const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch: async () => {} };
  const root = createRoot(q("#root"));
  const render = async (pathname: string) => {
    window.history.replaceState(null, "", pathname);
    await act(async () => root.render(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value={pathname}>
          <div data-shell>
            <aside data-shell-sidebar>Modules</aside>
            <header data-shell-topbar>
              <MobileNav dict={en} role="student" />
              <Breadcrumbs dict={en} />
              <BackToCampus />
            </header>
            <main data-shell-main className="bg-paper"><section className="card">Lesson content</section></main>
          </div>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>
    ));
  };
  const moduleRoutes = ["dashboard", "reading/lessons", "listening/lessons", "writing", "speaking", "grammar/lessons", "vocabulary", "progress", "mocks", "assignments", "live-classes", "video-lessons"];
  try {
    for (const theme of ["day", "night"]) {
      document.documentElement.dataset.theme = theme;
      for (const focus of ["off", "on"]) {
        document.documentElement.dataset.focus = focus;
        assert.equal(dom.window.getComputedStyle(document.documentElement).getPropertyValue("--paper-raised").trim(), theme === "day" ? "255 255 255" : "17 20 33");
        for (const route of moduleRoutes) {
          await render(`/app/${route}`);
          assert.equal(dom.window.getComputedStyle(q("[data-shell-sidebar]")).display, "none", route);
          assert.equal(dom.window.getComputedStyle(q("[data-mobile-nav-toggle]")).display, "none", route);
          const crumbs = document.querySelector<HTMLElement>("[data-breadcrumbs]");
          if (crumbs) assert.equal(dom.window.getComputedStyle(crumbs).display, "none", route);
          const main = q("[data-back-to-campus]");
          assert.equal(main.textContent, "←Main");
          assert.equal(main.getAttribute("href"), "/app");
          assert.notEqual(dom.window.getComputedStyle(main).display, "none");
          assert.equal(dom.window.getComputedStyle(q("[data-shell]")).backgroundImage, "none");
          assert.equal(document.documentElement.dataset.focus, focus, "module navigation preserves the Focus preference");
        }
      }
    }
    document.documentElement.dataset.focus = "off";
    for (const pathname of ["/app", "/app/", "/app/admin/people", "/app/teacher/students", "/app/management", "/app/owner/settings"]) {
      await render(pathname);
      assert.equal(document.querySelector("[data-back-to-campus]"), null, pathname);
      assert.notEqual(dom.window.getComputedStyle(q("[data-shell-sidebar]")).display, "none", pathname);
    }
  } finally {
    await act(async () => root.unmount());
  }
});
