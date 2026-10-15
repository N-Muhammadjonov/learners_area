import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/app/vocabulary" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { self: dom.window, IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { RouterContext } = await import("next/dist/shared/lib/router-context.shared-runtime");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { ModuleSectionNav } = await import("../../src/components/navigation/ModuleSectionNav");

const links = [
  { key: "words", label: "My Words", href: "/app/vocabulary", queryValue: "words", defaultQuery: true },
  { key: "revision", label: "Revision", href: "/app/vocabulary?tab=revision", queryValue: "revision" },
  { key: "games", label: "Games", href: "/app/vocabulary/games" },
  { key: "dictionary", label: "Dictionary", href: "/app/vocabulary?tab=dictionary", queryValue: "dictionary" },
];

function element(path: string, query: string, push: (url: string) => void) {
  const router = { pathname: path, asPath: path, back() {}, forward() {}, refresh() {}, push, replace() {}, prefetch() {} };
  return React.createElement(RouterContext.Provider, { value: router as never }, React.createElement(AppRouterContext.Provider, { value: router as never },
    React.createElement(PathnameContext.Provider, { value: path },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) },
        React.createElement(ModuleSectionNav, { module: "vocabulary", label: "Vocabulary", links })))));
}

function anchor(key: string) {
  const found = document.querySelector<HTMLAnchorElement>(`[data-module-section="${key}"]`);
  assert.ok(found);
  return found;
}

test("section links expose native destinations, current URL, preserved filters and horizontal scrolling", async () => {
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(element("/app/vocabulary", "tab=revision&q=keep", () => {})));
    assert.equal(document.querySelectorAll("nav a").length, 4);
    assert.equal(document.querySelectorAll('nav button,[role="tab"]').length, 0);
    assert.equal(document.querySelectorAll("nav a[data-instant-navigation]").length, 4,
      "section tabs must use the same real, intent-enabled links as fast module entry");
    assert.equal(anchor("games").getAttribute("href"), "/app/vocabulary/games",
      "deep module destination remains a real URL");
    assert.equal(anchor("revision").getAttribute("aria-current"), "page");
    assert.equal(anchor("dictionary").getAttribute("href"), "/app/vocabulary?tab=dictionary&q=keep");
    assert.equal(anchor("words").getAttribute("href"), "/app/vocabulary?q=keep");
    assert.equal(anchor("games").getAttribute("href"), "/app/vocabulary/games");
    assert.match(document.querySelector("nav")!.className, /overflow-x-auto/);
  } finally { await act(async () => root.unmount()); }
});

test("arrow keys move focus without opening Games, and link activation adds a history navigation", async () => {
  const calls: string[] = [];
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(element("/app/vocabulary", "tab=revision", url => calls.push(url))));
    anchor("revision").focus();
    await act(async () => anchor("revision").dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })));
    assert.equal(document.activeElement, anchor("games"));
    assert.deepEqual(calls, []);
    await act(async () => anchor("games").dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
    assert.deepEqual(calls, ["/app/vocabulary/games"]);
  } finally { await act(async () => root.unmount()); }
});

test("history query changes and direct nested game routes update the active section", async () => {
  const root = createRoot(document.getElementById("root")!);
  try {
    await act(async () => root.render(element("/app/vocabulary", "tab=dictionary", () => {})));
    assert.equal(anchor("dictionary").getAttribute("aria-current"), "page");
    await act(async () => root.render(element("/app/vocabulary", "", () => {})));
    assert.equal(anchor("words").getAttribute("aria-current"), "page");
    assert.equal(anchor("dictionary").getAttribute("aria-current"), null);
    await act(async () => root.render(element("/app/vocabulary/games/cards", "set=due", () => {})));
    assert.equal(anchor("games").getAttribute("aria-current"), "page");
    assert.equal(anchor("words").getAttribute("aria-current"), null);
  } finally { await act(async () => root.unmount()); }
});
