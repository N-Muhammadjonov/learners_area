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
const { ModuleHeaderNavigation, ModuleHeaderTitle } = await import("../../src/components/shell/ModuleHeaderSections");
const { ModuleContextHeading } = await import("../../src/components/shell/ModuleContextHeading");
const dict = (await import("../../src/lib/i18n/en")).default;

function element(path: string, query: string, push: (url: string) => void) {
  const router = { pathname: path, asPath: path, back() {}, forward() {}, refresh() {}, push, replace() {}, prefetch() {} };
  return React.createElement(RouterContext.Provider, { value: router as never }, React.createElement(AppRouterContext.Provider, { value: router as never },
    React.createElement(PathnameContext.Provider, { value: path },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams(query) },
        React.createElement("header", { "data-shell-topbar": true },
          React.createElement("div", {"data-module-header-controls":true}, React.createElement(ModuleContextHeading, { dict })),
          React.createElement(ModuleHeaderTitle, { dict }),
          React.createElement(ModuleHeaderNavigation, { dict }))))));
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
    assert.equal(document.querySelectorAll("nav a").length, 6);
    assert.equal(document.querySelectorAll('nav button,[role="tab"]').length, 0);
    assert.equal(document.querySelectorAll("nav a[data-instant-navigation]").length, 6,
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
    assert.equal(document.querySelector("h1")?.textContent, dict.vocabulary.tab.dictionary);
    assert.ok(document.querySelector('[data-shell-topbar] [data-vocabulary-section-heading="dictionary"]'), "section identity belongs to the fixed blue header");
    assert.ok(document.querySelector('[data-shell-topbar] [data-vocabulary-header-navigation] nav'), "section links belong to the same blue header");
    await act(async () => root.render(element("/app/vocabulary", "", () => {})));
    assert.equal(anchor("words").getAttribute("aria-current"), "page");
    assert.equal(anchor("dictionary").getAttribute("aria-current"), null);
    assert.equal(document.querySelector("h1")?.textContent, dict.vocabulary.tab.words);
    await act(async () => root.render(element("/app/vocabulary/games", "set=due", () => {})));
    assert.equal(document.querySelector("h1")?.textContent, dict.vocabulary.tab.games);
    await act(async () => root.render(element("/app/vocabulary/games/cards", "set=due", () => {})));
    assert.equal(anchor("games").getAttribute("aria-current"), "page");
    assert.equal(anchor("words").getAttribute("aria-current"), null);
    assert.equal(document.querySelector("h1"), null, "a nested game keeps its own page heading");
  } finally { await act(async () => root.unmount()); }
});


test("Reading, Listening, Grammar and all Writing tools keep section identity and controls inside the blue header", async () => {
  const root = createRoot(document.getElementById("root")!);
  try {
    for (const [path,query,title] of [
      ["/app/reading/lessons","",dict.readingV4.products.lessons.title],
      ["/app/reading/academic","",dict.readingV4.products.academic.title],
      ["/app/reading/general","",dict.generalReading.title],
      ["/app/reading/retention","",dict.readingV4.products.retention.title],
      ["/app/video-lessons","",dict.videoLessons.standaloneHeading],
      ["/app/listening/tests","",dict.listening.academic.title],
      ["/app/grammar/lessons","",dict.grammar.lessonsTitle],
      ["/app/grammar","tab=writing",dict.grammar.forWriting],
      ["/app/grammar","tab=speaking",dict.grammar.forSpeaking],
      ...Object.entries(dict.writingWorkspace.tabs).map(([tab,title])=>["/app/writing",`tab=${tab}`,title]),
    ]) {
      await act(async()=>root.render(element(path!,query!,()=>{})));
      assert.equal(document.querySelector('[data-shell-topbar] h1')?.textContent,title,path+"?"+query);
      assert.ok(document.querySelector('[data-shell-topbar] h1')?.classList.contains('text-2xl'), "section title uses the large Listening scale");
      assert.equal(document.querySelector("[data-module-header-controls] h1"),null,"large title has its own row below the menu/module controls");
      if(path!=="/app/video-lessons") assert.ok(document.querySelector('[data-shell-topbar] [data-module-header-navigation]'));
      if(path!.startsWith("/app/reading/")) {
        assert.equal(document.querySelectorAll('[data-module-header-navigation="reading"] a').length,4);
        assert.equal(document.querySelector('a[href="/app/reading/question-types"]'),null);
      }
      if(path==="/app/writing") assert.equal(document.querySelector('[role="tab"][aria-selected="true"]')?.textContent,title);
    }
  } finally {await act(async()=>root.unmount());}
});
