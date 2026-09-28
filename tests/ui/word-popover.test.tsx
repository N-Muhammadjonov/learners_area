import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/reading" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { ClickableText } = await import("../../src/components/vocabulary/ClickableText");
const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
const folderReply = () => json({ folders: [{ id: "own-folder", name: "Reading notes" }] });
type Fetcher = (url: string, options: RequestInit) => Promise<Response>;
const normal: Fetcher = async (url) => url.includes("folders") ? folderReply() : json({ results: [] });
const query = <T extends Element>(selector: string) => {
  const found = document.querySelector<T>(selector); assert.ok(found, selector); return found;
};
async function click(selector: string) { await act(async () => query<HTMLElement>(selector).click()); }
async function fill(selector: string, value: string) {
  await act(async () => {
    const element = query<HTMLInputElement | HTMLSelectElement>(selector);
    const prototype = element.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element.tagName === "SELECT" ? "change" : "input", { bubbles: true }));
  });
}
async function page(fetcher: Fetcher, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, options: RequestInit) => fetcher(String(url), options)) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    await act(async () => root.render(<ClickableText dict={en} text="decades growing" sourceType="reading" sourceId="qa-attempt" />));
    await run();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
}
const popupText = () => query('[data-word-popover]').textContent ?? "";
const values = () => [...document.querySelectorAll<HTMLInputElement>('[data-word-popover] input')].map((e) => e.value);

test("changing words resets text, translation, folder and validation state", async () => {
  await page(async (url, options) => options.method === "POST" ? new Response('{"error":"needs_definition"}', { status: 422 }) : normal(url, options), async () => {
    await click('[data-word="decades"]');
    await fill('[data-word-popover] input', "Only decades");
    await fill('[data-word-popover] label:nth-of-type(2) input', "Only old Uzbek");
    await fill('[data-word-popover] select', "own-folder");
    await click('[data-word-save]');
    assert.ok(document.querySelector('[data-word-needs-meaning]'));
    await click('[data-word="growing"]');
    assert.deepEqual(values(), ["", ""]);
    assert.equal(query<HTMLSelectElement>('[data-word-popover] select').value, "");
    assert.equal(document.querySelector('[data-word-needs-meaning]'), null);
    assert.equal(document.querySelector('[data-word-saved]'), null);
  });
});

test("late old lookup cannot populate the new word, even when transport ignores abort", async () => {
  let release!: (response: Response) => void;
  let oldSignal: AbortSignal | undefined;
  await page(async (url, options) => {
    if (url.includes("q=decades")) {
      oldSignal = options.signal!;
      return new Promise((resolve) => { release = resolve; });
    }
    return normal(url, options);
  }, async () => {
    await click('[data-word="decades"]');
    assert.ok(popupText().includes(en.common.loading));
    await click('[data-word="growing"]');
    assert.equal(oldSignal?.aborted, true);
    await act(async () => release(json({ results: [{ id: "old", term: "decades", definitionEn: "OLD RESULT", translationUz: "OLD UZ", mastery: "new" }] })));
    assert.equal(query('[role="dialog"]').getAttribute("aria-label"), "growing");
    assert.equal(popupText().includes("OLD RESULT"), false);
    assert.deepEqual(values(), ["", ""]);
  });
});

test("network failure ends loading and a retry recovers without writing anything", async () => {
  let fail = true; let posts = 0;
  await page(async (url, options) => {
    if (options.method === "POST") posts++;
    if (fail && url.includes("search")) throw new TypeError("offline");
    return normal(url, options);
  }, async () => {
    await click('[data-word="decades"]');
    assert.ok(popupText().includes(en.auth.errorNetwork));
    assert.equal(popupText().includes(en.common.loading), false);
    fail = false;
    const retry = [...document.querySelectorAll<HTMLButtonElement>('[data-word-popover] button')].find((b) => b.textContent === en.errorPage.retry)!;
    await act(async () => retry.click());
    assert.equal(document.querySelector('[role="alert"]'), null);
    assert.deepEqual(values(), ["", ""]);
    assert.equal(posts, 0);
  });
});

for (const [name, response] of [
  ["invalid JSON", () => new Response("<html>bad</html>")],
  ["wrong JSON shape", () => json({ unexpected: true })],
  ["server failure", () => new Response("failure", { status: 500 })],
  ["interrupted body", () => new Response(new ReadableStream({ start(controller) { controller.error(new Error("disconnected")); } }))],
] as const) {
  test(`${name} leaves popup recoverable and cannot spill errors into another word`, async () => {
    await page(async (url, options) => url.includes("q=decades") ? response() : normal(url, options), async () => {
      await click('[data-word="decades"]');
      assert.ok(document.querySelector('[role="alert"]'));
      assert.equal(popupText().includes(en.common.loading), false);
      assert.equal(query<HTMLButtonElement>('[data-word-save]').disabled, false);
      await click('[data-word="growing"]');
      assert.equal(document.querySelector('[role="alert"]'), null);
    });
  });
}

test("lookup deadline ends loading with feedback", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    await page(async (url, options) => {
      if (!url.includes("search")) return normal(url, options);
      return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true }));
    }, async () => {
      await click('[data-word="decades"]');
      await act(async () => t.mock.timers.tick(25_001));
      assert.ok(popupText().includes(en.auth.errorNetwork));
      assert.equal(popupText().includes(en.common.loading), false);
    });
  } finally { t.mock.timers.reset(); }
});

test("failed save retains input, retry sends selected folder, success never carries to another word", async () => {
  const bodies: { items: { definitionEn: string }[]; folderId: string }[] = [];
  await page(async (url, options) => {
    if (options.method !== "POST") return normal(url, options);
    bodies.push(JSON.parse(String(options.body)));
    if (bodies.length === 1) throw new TypeError("offline");
    return json({ ok: true });
  }, async () => {
    await click('[data-word="decades"]');
    await fill('[data-word-popover] input', "Periods of ten years");
    await fill('[data-word-popover] select', "own-folder");
    await click('[data-word-save]');
    assert.ok(popupText().includes(en.auth.errorNetwork));
    assert.equal(query<HTMLButtonElement>('[data-word-save]').disabled, false);
    assert.equal(values()[0], "Periods of ten years");
    await click('[data-word-save]');
    assert.equal(bodies.length, 2, "writes are retried only by the user");
    assert.equal(bodies[1]?.folderId, "own-folder");
    assert.ok(document.querySelector('[data-word-saved]'));
    await click('[data-word="growing"]');
    assert.equal(document.querySelector('[data-word-saved]'), null);
    assert.deepEqual(values(), ["", ""]);
  });
});

test("Escape closes and restores the clicked word's focus; outside click closes", async () => {
  await page(normal, async () => {
    await click('[data-word="decades"]');
    assert.equal(document.activeElement, query("[data-word-popover]"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[data-word-popover]'), null);
    assert.equal(document.activeElement, query('[data-word="decades"]'));
    await click('[data-word="growing"]');
    await act(async () => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    assert.equal(document.querySelector('[data-word-popover]'), null);
  });
});
