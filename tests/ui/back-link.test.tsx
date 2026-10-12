import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

/*
 * Shared BackLink, rendered: cold deep link → the link's own client navigation
 * to fallbackHref; arrival from this site → router.back(); modified click →
 * untouched browser link behaviour. Never a hard reload (location unchanged).
 */
const dom = new JSDOM('<html><body><div id="root"></div></body></html>', { url: "http://localhost/writing/history" });
for (const k of ["window", "document", "navigator", "HTMLElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "location", "history"] as const)
  Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { BackLink } = await import("../../src/components/ui/BackLink");

const calls: string[] = [];
const router = {
  back() { calls.push("back"); }, forward() {}, refresh() {},
  push(href: string) { calls.push(`push:${href}`); }, replace(href: string) { calls.push(`replace:${href}`); }, prefetch() {},
};

function setReferrer(value: string) {
  Object.defineProperty(dom.window.document, "referrer", { value, configurable: true });
}
function setHistoryLength(n: number) {
  Object.defineProperty(dom.window.history, "length", { value: n, configurable: true });
}

async function clickBack(init: MouseEventInit = {}) {
  calls.length = 0;
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  let defaultPrevented = false;
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never },
      React.createElement(BackLink, { fallbackHref: "/app/writing", label: "Orqaga", "data-test-back": true }))));
    const a = document.querySelector("a[data-back-link]") as HTMLAnchorElement;
    assert.equal(a.getAttribute("href"), "/app/writing");
    assert.equal(a.getAttribute("data-test-back"), "true");
    assert.match(a.textContent ?? "", /←\s*Orqaga/);
    const event = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
    await act(async () => { a.dispatchEvent(event); });
    defaultPrevented = event.defaultPrevented;
  } finally { await act(async () => root.unmount()); }
  return { defaultPrevented, calls: [...calls], location: dom.window.location.href };
}

test("cold deep link: no history entry from this site → BackLink leaves the click to the fallback link", async () => {
  setReferrer(""); setHistoryLength(1);
  const r = await clickBack();
  assert.ok(!r.calls.includes("back"));
  // BackLink does not intercept: the click is left to next/link with
  // href="/app/writing" (in the app bundle that is the app-router Link's soft
  // navigation; under node, `next/link` resolves to the pages-router build,
  // so the soft-navigation half is a bundler fact, not asserted here).
  assert.deepEqual(r.calls, []);
});

test("internal arrival: history back is used", async () => {
  setReferrer("http://localhost/writing"); setHistoryLength(4);
  const r = await clickBack();
  assert.deepEqual(r.calls, ["back"]);
  assert.equal(r.defaultPrevented, true);
});

test("external referrer is never trusted for history back", async () => {
  setReferrer("https://other.example/x"); setHistoryLength(4);
  const r = await clickBack();
  assert.ok(!r.calls.includes("back"));
});

test("modified click (new tab) keeps normal link behaviour", async () => {
  setReferrer("http://localhost/writing"); setHistoryLength(4);
  for (const mod of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }]) {
    const r = await clickBack(mod);
    assert.deepEqual(r.calls, [], JSON.stringify(mod));
    assert.equal(r.defaultPrevented, false);
  }
});
