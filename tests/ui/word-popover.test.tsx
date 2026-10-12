import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/reading" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLSelectElement", "Element", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, ResizeObserver: class { observe() {} disconnect() {} } });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
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
async function page(fetcher: Fetcher, run: () => Promise<void>, props: Partial<Parameters<typeof ClickableText>[0]> = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, options: RequestInit) => fetcher(String(url), options)) as typeof fetch;
  const root = createRoot(query("#root"));
  try {
    // Default source keeps the library-search path (attached material). Reading and
    // Listening never search by spelling (no occurrence → unresolved); they are tested
    // with explicit props below. The robustness invariants of the search path
    // (abort, races, retry, malformed bodies, deadline) are unchanged.
    await act(async () => root.render(<ClickableText dict={en} text="decades growing" sourceType="material" sourceId="qa-material" {...props} />));
    await run();
  } finally {
    window.getSelection()?.removeAllRanges();
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

test("Escape closes and restores the text region focus; outside click closes", async () => {
  await page(normal, async () => {
    await click('[data-word="decades"]');
    assert.equal(document.activeElement, query("[data-word-popover]"));
    await act(async () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    assert.equal(document.querySelector('[data-word-popover]'), null);
    assert.equal(document.activeElement, query('[data-clickable-text]'));
    await click('[data-word="growing"]');
    await act(async () => document.body.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true })));
    assert.equal(document.querySelector('[data-word-popover]'), null);
  });
});


test("plain text is preserved and native selection never opens lookup", async () => {
  await page(normal, async () => {
    const region = query('[data-clickable-text]');
    assert.equal(region.textContent, "decades growing");
    assert.equal(region.querySelectorAll('button, [tabindex]').length, 0);
    const range = document.createRange();
    range.selectNodeContents(region);
    window.getSelection()!.addRange(range);
    await click('[data-word="growing"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    assert.equal(window.getSelection()!.toString(), "decades growing");
    window.getSelection()!.removeAllRanges();
    await click('[data-word="growing"]');
    assert.ok(document.querySelector('[role="dialog"]'));
  });
});

test("drag, long press and cancelled touch do not open a lookup", async (t) => {
  await page(normal, async () => {
    const word = query('[data-word="decades"]');
    const pointer = async (name: string, x: number) => act(async () => word.dispatchEvent(new MouseEvent(name, { bubbles: true, clientX: x, clientY: 0 })));
    await pointer('pointerdown', 0);
    await pointer('pointermove', 12);
    await click('[data-word="decades"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    const now = t.mock.method(Date, 'now', () => 1000);
    await pointer('pointerdown', 0);
    now.mock.mockImplementation(() => 1600);
    await click('[data-word="decades"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    await pointer('pointerdown', 0);
    await pointer('pointercancel', 0);
    await click('[data-word="decades"]');
    assert.equal(document.querySelector('[role="dialog"]'), null);
    now.mock.restore();
  });
});

test("one keyboard stop navigates words and opens the selected word with Enter", async () => {
  const original = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = () => {};
  try {
    await page(normal, async () => {
      const region = query<HTMLElement>('[data-clickable-text]');
      region.focus();
      for (const key of ['ArrowRight', 'ArrowRight', 'Enter']) await act(async () => region.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
      assert.equal(query('[role="dialog"]').getAttribute('aria-label'), 'growing');
      assert.equal(document.activeElement, query('[role="dialog"]'));
      await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
      assert.equal(document.activeElement, region);
    });
  } finally { HTMLElement.prototype.scrollIntoView = original; }
});


test("contextual same-spelling words fetch and save their own occurrence identity", async () => {
  const posted: { occurrenceId: string }[] = [];
  await page(async (url, options) => {
    if (options.method === 'POST') { posted.push(JSON.parse(String(options.body))); return json({ ok: true }); }
    if (url.includes('folders')) return folderReply();
    assert.ok(url.includes('/lookup?'), 'known source must not use spelling search');
    const river = url.includes('occurrenceId=river');
    return json({ contextual: { definitionEn: river ? 'The edge of a river' : 'A financial institution', translationUz: river ? "qirg'oq" : 'bank', verificationStatus: 'unverified' }, known: null });
  }, async () => {
    await click('[data-token="0"]');
    assert.ok(popupText().includes('A financial institution'));
    await click('[data-token="2"]');
    assert.ok(popupText().includes('The edge of a river'));
    assert.equal(popupText().includes('A financial institution'), false);
    assert.ok(popupText().includes(en.vocabulary.contextUnverified));
    assert.equal(document.querySelectorAll('[data-word-popover] input').length, 0);
    await fill('[data-word-popover] select', 'own-folder');
    await click('[data-word-save]');
    assert.equal(posted[0]?.occurrenceId, 'river');
  }, { text: 'bank bank', occurrences: [{ id: 'money', startChar: 0, endChar: 4, surfaceForm: 'bank' }, { id: 'river', startChar: 5, endChar: 9, surfaceForm: 'bank' }] });
});


test("double-click does not focus a popup before native word selection", async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  try {
    await page(normal, async () => {
      const word = query('[data-word="decades"]');
      await act(async () => word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await act(async () => word.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      await act(async () => word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 })));
      await act(async () => t.mock.timers.tick(300));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      await act(async () => word.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })));
      await act(async () => word.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
      await act(async () => t.mock.timers.tick(300));
      assert.ok(document.querySelector('[role="dialog"]'), 'single click still opens after the selection window');
    });
  } finally { t.mock.timers.reset(); }
});

test('Listening spelling-only lookup shows "Meaning not checked yet" and saves only the learner\'s own meaning', async () => {
 // Contract (mode separation): a Listening word with no server-proven occurrence has
 // no knowable sense, so the client makes NO meaning/spelling request at all — it
 // shows the unresolved state directly. Only folders are loaded for an own-meaning save.
 let saved: Record<string, unknown> | undefined;
 const lookups: string[] = [];
 await page(async (url, options) => {
  if (options.method === 'POST') { saved = JSON.parse(String(options.body)); return json({ok:true}); }
  if (url.includes('folders')) return folderReply();
  lookups.push(url);
  return json({status:'unresolved',contextual:null});
 }, async () => {
  await click('[data-word="decades"]');
  assert.ok(document.querySelector('[data-word-unresolved]'));
  assert.ok(popupText().includes(en.vocabulary.meaningUnchecked));
  await fill('[data-word-popover] input', 'Periods of ten years');
  await click('[data-word-save]');
  assert.equal(saved?.sourceType,'listening'); assert.equal(saved?.sourceId,'qa-listening');
  assert.equal(saved?.occurrenceId,undefined);
  assert.deepEqual((saved?.items as {definitionEn?: string}[])[0]?.definitionEn,'Periods of ten years');
  assert.deepEqual(lookups, [], 'no spelling-based meaning or library request');
 }, {sourceType:'listening',sourceId:'qa-listening',catalogueLookup:true});
});
test('Listening unknown meaning remains editable rather than inventing a translation', async () => {
 await page(async (url) => url.includes('folders') ? folderReply() : json({contextual:null}), async () => {
  await click('[data-word="decades"]');
  assert.deepEqual(values(),['','']);
  assert.equal(document.querySelector('[data-word-saved]'),null);
 }, {sourceType:'listening',sourceId:'qa-listening',catalogueLookup:true});
});

// ---------------------------------------------------------------------------
// 0029 — Listening occurrences, unresolved state, lexical detail, races, a11y.
// ---------------------------------------------------------------------------
const listeningSpans = { text: 'shed pounds bank', occurrences: [{ id: 'occ-shed', startChar: 0, endChar: 11, surfaceForm: 'shed pounds' }, { id: 'occ-bank', startChar: 12, endChar: 16, surfaceForm: 'bank' }], sourceType: 'listening', sourceId: 'qa-listening', catalogueLookup: true };

test('Listening click resolves by occurrence, shows only the linked sense with POS/type, and saves the occurrence', async () => {
  const posted: Record<string, unknown>[] = [];
  const urls: string[] = [];
  await page(async (url, options) => {
    if (options.method === 'POST') { posted.push(JSON.parse(String(options.body))); return json({ ok: true }); }
    if (url.includes('folders')) return folderReply();
    urls.push(url);
    return json({ status: 'resolved', senseId: 'sense-shed', contextual: { term: 'shed pounds', definitionEn: 'To lose body weight', translationUz: 'vazn tashlamoq', partOfSpeech: 'phrase', lexicalType: 'phrase', ipa: null, verificationStatus: 'unverified' }, known: null });
  }, async () => {
    await click('[data-token="0"]');
    assert.ok(urls[0]!.includes('/lookup?sourceType=listening&sourceId=qa-listening&occurrenceId=occ-shed'), urls[0]);
    assert.equal(urls.some((url) => url.includes('/meaning?')), false, 'an occurrence never falls back to spelling');
    assert.ok(popupText().includes('To lose body weight'));
    assert.ok(query('[data-word-lexical]').textContent!.includes(en.vocabulary.lexicalTypeLabel.phrase));
    assert.equal(document.querySelector('[data-word-ipa]'), null, 'missing pronunciation renders no IPA, never an invented one');
    await click('[data-word-save]');
    assert.equal(posted[0]?.occurrenceId, 'occ-shed');
    assert.equal(posted[0]?.sourceType, 'listening');
    assert.ok(document.querySelector('[data-word-saved]'));
  }, listeningSpans);
});

test('An occurrence the server marks unresolved shows the unchecked state, no meaning, and never posts its occurrence', async () => {
  const posted: Record<string, unknown>[] = [];
  await page(async (url, options) => {
    if (options.method === 'POST') { posted.push(JSON.parse(String(options.body))); return json({ ok: true }); }
    if (url.includes('folders')) return folderReply();
    return json({ status: 'unresolved', occurrenceId: 'occ-bank', surfaceForm: 'bank', contextual: null, known: null });
  }, async () => {
    await click('[data-token="4"]');
    const status = query('[data-word-unresolved]');
    assert.equal(status.getAttribute('role'), 'status', 'screen readers hear the unchecked state');
    assert.ok(status.textContent!.includes(en.vocabulary.meaningUnchecked));
    assert.equal(popupText().includes('financial'), false);
    await fill('[data-word-popover] input', 'Land beside a river');
    await click('[data-word-save]');
    assert.equal(posted[0]?.occurrenceId, undefined);
  }, listeningSpans);
});

test('A stored pronunciation is shown; an already-saved sense shows its mastery instead of the save form', async () => {
  await page(async (url) => url.includes('folders') ? folderReply() : json({ status: 'resolved', contextual: { term: 'bank', definitionEn: 'A financial institution', translationUz: 'bank', partOfSpeech: 'noun', lexicalType: 'word', ipa: 'baenk', verificationStatus: 'verified' }, known: { id: 'uv-1', mastery: 'learning' } }), async () => {
    await click('[data-token="4"]');
    assert.ok(popupText().includes(en.vocabulary.mastery.learning));
    assert.equal(document.querySelector('[data-word-save]'), null);
  }, listeningSpans);
  await page(async (url) => url.includes('folders') ? folderReply() : json({ status: 'resolved', contextual: { term: 'bank', definitionEn: 'A financial institution', translationUz: 'bank', partOfSpeech: 'noun', lexicalType: 'word', ipa: 'baenk', verificationStatus: 'verified' }, known: null }), async () => {
    await click('[data-token="4"]');
    assert.equal(query('[data-word-ipa]').textContent, '/baenk/');
    assert.ok(document.querySelector('[data-word-save]'));
  }, listeningSpans);
});

test('Rapid clicks between two occurrences: the late first answer never fills the second popup', async () => {
  let releaseFirst!: (response: Response) => void;
  await page(async (url, options) => {
    if (url.includes('folders')) return folderReply();
    if (url.includes('occurrenceId=occ-shed')) return new Promise((resolve) => { releaseFirst = resolve; });
    void options;
    return json({ status: 'unresolved', contextual: null, known: null });
  }, async () => {
    await click('[data-token="0"]');
    await click('[data-token="4"]');
    await act(async () => releaseFirst(json({ status: 'resolved', contextual: { term: 'shed pounds', definitionEn: 'STALE SHED', translationUz: null, partOfSpeech: null, lexicalType: null, ipa: null, verificationStatus: 'unverified' }, known: null })));
    assert.equal(query('[role="dialog"]').getAttribute('aria-label'), 'bank');
    assert.equal(popupText().includes('STALE SHED'), false);
    assert.ok(document.querySelector('[data-word-unresolved]'));
  }, listeningSpans);
});

test('Listening popup is a labelled dialog that takes focus, closes on Escape and returns focus; buttons are labelled', async () => {
  await page(async (url) => url.includes('folders') ? folderReply() : json({ status: 'unresolved', contextual: null, known: null }), async () => {
    await click('[data-token="0"]');
    const dialog = query('[data-word-popover]');
    assert.equal(dialog.getAttribute('role'), 'dialog');
    assert.equal(dialog.getAttribute('aria-label'), 'shed pounds', 'the whole multi-word unit is announced');
    assert.equal(document.activeElement, dialog);
    assert.ok(query(`[data-word-popover] button[aria-label="${en.vocabulary.games.pronounce}"]`));
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    assert.equal(document.querySelector('[data-word-popover]'), null);
    assert.equal(document.activeElement, query('[data-clickable-text]'));
  }, listeningSpans);
});

test('Reading word without an occurrence: no spelling search, "Meaning not checked yet", own meaning only', async () => {
  const lookups: string[] = [];
  let saved: Record<string, unknown> | undefined;
  await page(async (url, options) => {
    if (options.method === 'POST') { saved = JSON.parse(String(options.body)); return json({ ok: true }); }
    if (url.includes('folders')) return folderReply();
    lookups.push(url);
    return json({ results: [{ id: 'x', term: 'decades', definitionEn: 'SPELLING GUESS', translationUz: 'X', mastery: 'new' }] });
  }, async () => {
    await click('[data-word="decades"]');
    assert.ok(document.querySelector('[data-word-unresolved]'));
    assert.equal(popupText().includes('SPELLING GUESS'), false);
    await fill('[data-word-popover] input', 'Periods of ten years');
    await click('[data-word-save]');
    assert.equal(saved?.occurrenceId, undefined);
    assert.deepEqual(lookups, [], 'no /search or /meaning request for a Reading spelling');
  }, { sourceType: 'reading', sourceId: 'qa-attempt' });
});
