import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/admin/reading/retention" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent", "PointerEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key] ?? dom.window.MouseEvent, configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { RetentionBankPanel, formatValidationIssues } = await import("../../src/components/admin/RetentionBankPanel");
const { countWords } = await import("../../src/lib/retention/word-count");

const query = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, `expected ${selector}`);
  return found;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const wait = (ms: number) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

function row(id: string, active = true) {
  return { textId: id, internalLabel: `A2-${id}`, level: "A2", active, preview: `Preview of ${id}`, wordCount: 110, versionNumber: 1, currentVersionUses: 0, lifetimeUses: 0, updatedAt: "2026-09-01T00:00:00.000Z" };
}

async function render(props: Partial<Parameters<typeof RetentionBankPanel>[0]> = {}, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div><button id="outside">outside</button>';
  const root = createRoot(query<HTMLDivElement>("#root"));
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never },
      React.createElement(RetentionBankPanel, { dict: en, level: "A2", rows: [row("t1"), row("t2", false)], isOwner: true, filter: "all", sort: "label", page: 2, pageCount: 3, total: 105, ...props }))));
    await run();
  } catch (error) {
    if (error instanceof AggregateError) console.error("AGG", error.errors);
    throw error;
  } finally {
    await act(async () => root.unmount());
  }
}

function type(element: HTMLTextAreaElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!;
  setter.call(element, value);
  element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

const key = (target: Element, name: string) =>
  act(async () => { target.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: name, bubbles: true })); });

test("rows show preview and visible Active/Archived status; pagination is real links", async () => {
  await render({}, async () => {
    assert.equal(query('[data-retention-row="t1"] [data-retention-row-status]').textContent, "Active");
    assert.equal(query('[data-retention-row="t2"] [data-retention-row-status]').textContent, "Archived");
    assert.match(query('[data-retention-row="t1"] [data-retention-row-preview]').textContent ?? "", /Preview of t1/);
    assert.match(query("[data-retention-page-prev]").getAttribute("href") ?? "", /level=A2&filter=all&sort=label$/);
    assert.match(query("[data-retention-page-next]").getAttribute("href") ?? "", /page=3/);
    assert.match(query("[data-retention-page-status]").textContent ?? "", /Page 2 of 3 · 105 texts/);
  });
});

test("three-dot menu: labelled, keyboard navigable, Escape/outside close, focus returns", async () => {
  await render({}, async () => {
    const trigger = query<HTMLButtonElement>('[data-retention-row="t1"] [data-retention-row-menu-trigger]');
    assert.equal(trigger.getAttribute("aria-label"), "Actions for A2-t1");
    assert.equal(trigger.getAttribute("aria-haspopup"), "menu");
    await act(async () => trigger.click());
    assert.equal(trigger.getAttribute("aria-expanded"), "true");
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    assert.deepEqual(items.map((item) => item.textContent), ["Change", "Archive", "Delete"]);
    assert.equal(document.activeElement, items[0]);
    await key(items[0]!, "ArrowDown");
    assert.equal(document.activeElement, items[1]);
    await key(items[1]!, "ArrowDown");
    assert.equal(document.activeElement, items[2]);
    await key(items[2]!, "ArrowDown");
    assert.equal(document.activeElement, items[0]);
    await key(items[0]!, "Escape");
    assert.equal(document.querySelector('[role="menu"]'), null);
    assert.equal(document.activeElement, trigger);
    await act(async () => trigger.click());
    await act(async () => { query("#outside").dispatchEvent(new dom.window.MouseEvent("pointerdown", { bubbles: true }) as unknown as Event); });
    assert.equal(document.querySelector('[role="menu"]'), null);
    // Archived row offers Restore and permanent Delete.
    await act(async () => query<HTMLButtonElement>('[data-retention-row="t2"] [data-retention-row-menu-trigger]').click());
    assert.ok(query("[data-retention-restore]"));
    assert.ok(query("[data-retention-delete]"));
  });
});

test("administrator may archive but cannot see permanent delete", async () => {
  await render({ isOwner: false }, async () => {
    await act(async () => query<HTMLButtonElement>('[data-retention-row="t1"] [data-retention-row-menu-trigger]').click());
    assert.ok(query("[data-retention-archive]"));
    assert.equal(document.querySelector("[data-retention-delete]"), null);
  });
});

test("hard-delete failure is honest; a pending request cannot be repeated", async () => {
  const originalFetch = globalThis.fetch;
  const originalConfirm = dom.window.confirm;
  const originalPrompt = dom.window.prompt;
  let patches = 0;
  let release: (value: Response) => void = () => undefined;
  globalThis.fetch = (async () => { patches += 1; return new Promise<Response>((resolve) => { release = resolve; }); }) as typeof fetch;
  (globalThis.window as unknown as { confirm: () => boolean }).confirm = () => true;
  (globalThis.window as unknown as { prompt: () => string }).prompt = () => "A2-t1";
  try {
    await render({}, async () => {
      await act(async () => query<HTMLButtonElement>('[data-retention-row="t1"] [data-retention-row-menu-trigger]').click());
      await act(async () => query<HTMLButtonElement>("[data-retention-delete]").click());
      assert.equal(query<HTMLButtonElement>('[data-retention-row="t1"] [data-retention-row-menu-trigger]').disabled, true);
      assert.equal(patches, 1);
      await act(async () => release(json({ ok: false }, 500)));
      await wait(0);
      assert.equal(query("[data-retention-bank-notice]").textContent, en.retentionMemory.admin.deleteFailed);
    });
  } finally {
    globalThis.fetch = originalFetch;
    (globalThis.window as unknown as { confirm: typeof originalConfirm }).confirm = originalConfirm;
    (globalThis.window as unknown as { prompt: typeof originalPrompt }).prompt = originalPrompt;
  }
});

test("Change load failure (non-OK or offline) shows a Retry, never an empty editable form", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/api/admin/retention/texts/t1")) {
      calls += 1;
      if (calls === 1) return json({ ok: false }, 404);
      if (calls === 2) throw new TypeError("offline");
      return json({ ok: true, text: { bodyText: "Loaded body", scoringStructure: { schemaVersion: 1 }, currentVersionId: "v1" } });
    }
    return json({ ok: true, valid: false, error: "retention_invalid_structure", details: { issues: [] } });
  }) as typeof fetch;
  try {
    await render({}, async () => {
      await act(async () => query<HTMLButtonElement>('[data-retention-row="t1"] [data-retention-row-menu-trigger]').click());
      await act(async () => query<HTMLButtonElement>("[data-retention-change]").click());
      await wait(0);
      assert.ok(query("[data-retention-editor-load-failed]"));
      assert.equal(document.querySelector("[data-retention-editor-text]"), null);
      await act(async () => query<HTMLButtonElement>("[data-retention-editor-load-retry]").click());
      await wait(0);
      assert.ok(query("[data-retention-editor-load-failed]"));
      await act(async () => query<HTMLButtonElement>("[data-retention-editor-load-retry]").click());
      await wait(0);
      assert.equal(query<HTMLTextAreaElement>("[data-retention-editor-text]").value, "Loaded body");
      assert.equal(calls, 3);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("live word count uses the shared counter even with an empty structure; stale validation is ignored; issues are shown", async () => {
  const originalFetch = globalThis.fetch;
  const pending: Array<(value: Response) => void> = [];
  globalThis.fetch = (async () => new Promise<Response>((resolve) => pending.push(resolve))) as typeof fetch;
  try {
    await render({}, async () => {
      await act(async () => query<HTMLButtonElement>("[data-retention-add]").click());
      const text = query<HTMLTextAreaElement>("[data-retention-editor-text]");
      const sample = "one—two, 50 000 people; don't stop … state-of-the-art";
      await act(async () => type(text, sample));
      assert.equal(query("[data-retention-editor-live-count]").getAttribute("data-retention-editor-live-count"), String(countWords(sample)));
      assert.equal(pending.length, 0, "no validation request without a structure");

      await act(async () => type(query<HTMLTextAreaElement>("[data-retention-editor-structure]"), "{ not json"));
      await wait(450);
      assert.equal(pending.length, 0);
      assert.match(query("[data-retention-editor-issues]").textContent ?? "", /not valid JSON/);

      await act(async () => type(query<HTMLTextAreaElement>("[data-retention-editor-structure]"), '{"a":1}'));
      await wait(450);
      assert.equal(pending.length, 1);
      await act(async () => type(query<HTMLTextAreaElement>("[data-retention-editor-structure]"), '{"a":2}'));
      await wait(450);
      assert.equal(pending.length, 2);
      // Newest answer first, then the stale one: the stale one must not win.
      await act(async () => pending[1]!(json({ ok: true, valid: false, error: "retention_invalid_structure", details: { issues: [{ path: "claims.0.points", code: "points_total" }] } })));
      await wait(0);
      await act(async () => pending[0]!(json({ ok: true, valid: true, wordCount: 110, claims: 1 })));
      await wait(0);
      assert.equal(query("[data-retention-editor-status]").getAttribute("data-retention-editor-status"), "invalid");
      assert.match(query("[data-retention-editor-issues]").textContent ?? "", /claims\.0\.points: points_total/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("save network failure keeps the text, locks against double click and never auto-retries", async () => {
  const originalFetch = globalThis.fetch;
  let posts = 0;
  let releaseSave: (value: Response) => void = () => undefined;
  let failSave: (error: Error) => void = () => undefined;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/validate")) return json({ ok: true, valid: true, wordCount: 110, claims: 1 });
    posts += 1;
    return new Promise<Response>((resolve, reject) => { releaseSave = resolve; failSave = reject; });
  }) as typeof fetch;
  try {
    await render({}, async () => {
      await act(async () => query<HTMLButtonElement>("[data-retention-add]").click());
      await act(async () => type(query<HTMLTextAreaElement>("[data-retention-editor-text]"), "Kept learner text"));
      await act(async () => type(query<HTMLTextAreaElement>("[data-retention-editor-structure]"), '{"schemaVersion":1}'));
      await wait(450);
      await wait(0);
      const save = query<HTMLButtonElement>("[data-retention-editor-save]");
      assert.equal(save.disabled, false);
      await act(async () => { save.click(); save.click(); });
      assert.equal(posts, 1);
      await act(async () => failSave(new TypeError("offline")));
      await wait(0);
      assert.equal(query("[data-retention-editor-save-error]").textContent, en.retentionMemory.admin.saveFailed);
      assert.equal(query<HTMLTextAreaElement>("[data-retention-editor-text]").value, "Kept learner text");
      await wait(50);
      assert.equal(posts, 1, "no automatic retry");
      void releaseSave;
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("validator issue details in the real { issues } shape are formatted", () => {
  assert.deepEqual(formatValidationIssues({ issues: [{ path: "", code: "json_syntax" }, { path: "claims.1", code: "too_small" }] }), ["(root): json_syntax", "claims.1: too_small"]);
  assert.deepEqual(formatValidationIssues(null), []);
  assert.deepEqual(formatValidationIssues([{ path: "x" }]), []);
});
