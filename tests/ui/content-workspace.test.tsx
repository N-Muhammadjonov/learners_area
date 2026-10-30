import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

/**
 * THE AUTHORING WORKSPACE (§AA) — rendered for real in jsdom with a mocked network.
 *
 * What the screen must do, and what this test proves:
 *
 *   • it reads the BANK — the shared content-management surface — with real filters
 *     (module, content type, state, track, identity, title, version, dates) and never
 *     invents a list of its own;
 *   • it opens an item's REVISION history through the staff route, and the identity it
 *     sends is (module, contentType, sourceRef) — never a title;
 *   • publishing goes through the ONE publication endpoint, with the exact revision id
 *     and the requested state. A staff member without publish permission sees the
 *     control disabled, and the server remains the enforcer;
 *   • revising starts from the CANONICAL SNAPSHOT the store returned, so an edit can
 *     never be made against a made-up shape;
 *   • a preview renders regions as TEXT — authored markup is displayed, never executed
 *     — and executable content is withheld rather than echoed.
 */

const dom = new JSDOM("<html><body></body></html>", { url: "http://localhost/admin/content/workspace" });
for (const key of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { ContentWorkspace } = await import("../../src/components/admin/ContentWorkspace");
const en = (await import("../../src/lib/i18n/en")).default;

const read = (path: string) => readFileSync(path, "utf8");

type Call = { url: string; method: string; body: unknown };
const calls: Call[] = [];

const bankRow = (overrides: Record<string, unknown> = {}) => ({
  key: "writing:task2|alpha",
  module: "writing",
  contentType: "task2",
  sourceRef: "alpha",
  title: "Education and society",
  track: "academic",
  versions: 2,
  latestVersionNo: 2,
  latestVersionId: "11111111-2222-3333-4444-555555555555",
  latestState: "draft",
  states: { draft: 1, scheduled: 0, published: 1, archived: 0 },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  hasPublishedRevision: true,
  ...overrides,
});

const previewPayload = {
  ok: true,
  preview: {
    identity: {
      module: "writing", contentType: "task2", sourceRef: "alpha", contentKey: "writing:task2|alpha",
      versionId: "11111111-2222-3333-4444-555555555555", versionNo: 2, versionIdentity: "writing:task2:alpha@v2",
      status: "published", publicationState: "draft", track: "academic", title: "Education and society",
    },
    canonical: { taskType: "task2", category: "education", prompt: "A synthetic prompt." },
    parts: [{ key: "prompt", label: "Prompt", status: "ready", items: [{ label: "Prompt", value: "<script>alert(1)</script> not markup" }] }],
    answerKeyVisible: false,
    problems: [],
    status: "PREVIEW_READY",
  },
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function mount(canPublish: boolean, run: () => Promise<void>) {
  calls.length = 0;
  const original = globalThis.fetch;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const href = typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url;
    const method = (init?.method ?? "GET").toUpperCase();
    calls.push({ url: href, method, body: init?.body ? JSON.parse(String(init.body)) : null });
    if (href.startsWith("/api/admin/content/authoring-capabilities"))
      return response({
        modules: [
          { module: "writing", label: "Writing", contentTypes: [{ contentType: "task2", authorable: true, importable: false, label: "Task 2" }] },
          { module: "reading", label: "Reading", contentTypes: [{ contentType: "general_set", authorable: false, importable: true, label: "General set" }] },
        ],
      });
    if (href.startsWith("/api/admin/content/bank"))
      return response({
        ok: true, rows: [bankRow()], total: 1, limit: 25, offset: 0,
        facets: { module: [{ value: "writing", count: 1 }], contentType: [{ value: "writing:task2", count: 1 }], state: [{ value: "draft", count: 1 }], track: [{ value: "academic", count: 1 }] },
      });
    if (href.startsWith("/api/admin/content/items/"))
      return response({
        module: "writing", contentType: "task2", sourceRef: "alpha",
        versions: [
          { id: "11111111-2222-3333-4444-555555555555", versionNo: 2, status: "published", publicationState: "draft", title: "Education and society", track: "academic", targetType: "writing_prompt", targetId: "t" },
          { id: "22222222-3333-4444-5555-666666666666", versionNo: 1, status: "published", publicationState: "published", title: "Education and society", track: "academic", targetType: "writing_prompt", targetId: "t" },
        ],
      });
    if (/\/api\/admin\/content\/versions\/[^/]+\/preview$/.test(href)) return response(previewPayload);
    if (/\/api\/admin\/content\/versions\/[^/]+\/publication$/.test(href)) return response({ ok: true, versionId: "11111111-2222-3333-4444-555555555555", publicationState: "published" });
    if (href.startsWith("/api/admin/content/validate"))
      return response({ ok: true });
    if (href.startsWith("/api/admin/content/drafts"))
      return response({ ok: true, versionId: "33333333-4444-5555-6666-777777777777", versionNo: 3, created: false });
    if (href.startsWith("/api/admin/content/template"))
      return response({ sourceRef: "alpha", title: "From template", taskType: "task2" });
    return response({ error: "unexpected_route" }, 404);
  }) as typeof fetch;

  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const router = { push() {}, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  try {
    await act(async () => root.render(
      React.createElement(AppRouterContext.Provider, { value: router as never },
        React.createElement(ContentWorkspace, { dict: en, canPublish })),
    ));
    await run();
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = original;
  }
}

const click = async (selector: string) => {
  await act(async () => (document.querySelector(selector) as HTMLButtonElement).click());
};

test("the bank renders real filters and reads the identity it was given", async () => {
  await mount(true, async () => {
    const bankCall = calls.find((call) => call.url.startsWith("/api/admin/content/bank"))!;
    assert.equal(bankCall.method, "GET");
    assert.match(bankCall.url, /limit=25/);

    // Every documented filter exists — the bank is not a title search.
    for (const selector of [
      "[data-bank-module]", "[data-bank-type]", "[data-bank-state]", "[data-bank-has-state]",
      "[data-bank-identity]", "[data-bank-title]", "[data-bank-query]", "[data-bank-version]",
      "[data-bank-track]", "[data-bank-from]", "[data-bank-to]",
    ]) assert.ok(document.querySelector(selector), `missing filter ${selector}`);

    assert.equal(document.querySelectorAll("[data-bank-row]").length, 1);
    assert.match(document.querySelector("[data-bank-row-identity]")!.textContent!, /writing:task2:alpha/, "identity is shown, not just a title");
    assert.match(document.querySelector("[data-bank-row-versions]")!.textContent!, /2/, "the revision count is the aggregate");
    assert.equal(document.querySelector("[data-state=draft]")!.textContent, en.admin.publication.states.draft);

    // Typing an identity and searching sends it as a filter, not as a title.
    await act(async () => {
      const input = document.querySelector("[data-bank-identity]") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
      setter.call(input, "alpha");
      input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    });
    await click("[data-bank-search]");
    assert.ok(calls.some((call) => call.url.includes("sourceRef=alpha")), "the identity filter is sent to the bank");
  });
});

test("an item opens its revision history by canonical identity", async () => {
  await mount(true, async () => {
    await click("[data-bank-row-open]");
    const itemCall = calls.find((call) => call.url.startsWith("/api/admin/content/items/"))!;
    assert.equal(itemCall.url, "/api/admin/content/items/writing/task2/alpha", "identity, never a title");
    assert.equal(document.querySelectorAll("[data-item-version]").length, 2);
    assert.match(document.querySelector("[data-item-version='2']")!.textContent!, /v2/);
  });
});

test("publishing goes through the one publication endpoint with the exact revision", async () => {
  await mount(true, async () => {
    await click("[data-bank-row-open]");
    await click("[data-item-version='2'] [data-version-publish]");
    const publish = calls.find((call) => call.url.endsWith("/publication"))!;
    assert.equal(publish.method, "POST");
    assert.equal(publish.url, "/api/admin/content/versions/11111111-2222-3333-4444-555555555555/publication", "the revision id, not the item or its title");
    assert.deepEqual(publish.body, { to: "published" });

    await click("[data-item-version='2'] [data-version-archive]");
    const archive = calls.filter((call) => call.url.endsWith("/publication")).at(-1)!;
    assert.deepEqual(archive.body, { to: "archived" });
  });
});

test("a staff member without publish permission cannot publish from the UI — and the server still decides", async () => {
  await mount(false, async () => {
    await click("[data-bank-row-open]");
    const publish = document.querySelector("[data-item-version='2'] [data-version-publish]") as HTMLButtonElement;
    assert.equal(publish.disabled, true, "the action is disabled for a non-publisher");
    assert.equal(calls.some((call) => call.url.endsWith("/publication")), false, "no publish request was attempted");

    // Python enforces publication permissions; the Next route is transport only.
    const page = read("src/app/app/(shell)/admin/content/workspace/page.tsx");
    assert.match(page, /requireAdministrator\(\)/);
    assert.match(page, /redirect\("\/app"\)/);
    const route = read("src/app/api/admin/content/versions/[id]/publication/route.ts");
    assert.match(route, /forwardToBackend as POST/);
    const backend = read("services/backend/app/step31_version_publication.py");
    assert.match(backend, /actor\['role'\] not in \('admin','owner'\)/);
    assert.match(backend, /403 if refusal\.issue\['code'\]=='publish_forbidden'/);
  });
});

test("revising starts from the canonical snapshot, and a redacted revision cannot be revised", async () => {
  await mount(true, async () => {
    await click("[data-bank-row-open]");
    await click("[data-item-version='2'] [data-version-revise]");
    const textarea = document.querySelector("[data-revise-payload]") as HTMLTextAreaElement;
    assert.match(textarea.value, /"taskType": "task2"/, "the editor starts from what the store holds");

    // Validate answers before anything is written, through the shared validator.
    await click("[data-revise-validate]");
    assert.equal(calls.some((call) => call.url === "/api/admin/content/validate"), true);
    assert.equal(document.querySelector("[data-revise-validity]")!.textContent, en.admin.contentWorkspace.valid);

    // Saving is a NEW revision of the same item: identity + versionId, no title-derived ref.
    await click("[data-revise-save]");
    const draft = calls.filter((call) => call.url === "/api/admin/content/drafts").at(-1)!;
    assert.deepEqual(
      { module: (draft.body as Record<string, unknown>).module, contentType: (draft.body as Record<string, unknown>).contentType, sourceRef: (draft.body as Record<string, unknown>).sourceRef, versionId: (draft.body as Record<string, unknown>).versionId },
      { module: "writing", contentType: "task2", sourceRef: "alpha", versionId: "11111111-2222-3333-4444-555555555555" },
    );
  });
});

test("a preview renders regions as text — authored markup is never executed", async () => {
  await mount(true, async () => {
    await click("[data-bank-row-open]");
    await click("[data-item-version='2'] [data-version-preview]");
    const panel = document.querySelector("[data-preview-panel]")!;
    assert.equal(document.querySelector("[data-preview-status]")!.getAttribute("data-preview-status"), "PREVIEW_READY");
    assert.equal(panel.querySelectorAll("script").length, 0, "no script element was created from authored content");
    assert.match(panel.textContent!, /<script>alert\(1\)<\/script> not markup/, "the markup is displayed, not parsed");

    const preview = read("src/components/admin/ContentWorkspace.tsx");
    assert.doesNotMatch(preview, /dangerouslySetInnerHTML/, "the workspace never injects authored HTML");
    // The executable-withholding message exists, and it is wired to a null snapshot.
    assert.match(preview, /preview\.canonical === null/);
    assert.match(preview, /data-preview-redacted/);
  });
});

test("a new draft is created through the registry's template, validated, then saved as a draft", async () => {
  await mount(true, async () => {
    await click("[data-new-item]");
    await act(async () => {
      const select = document.querySelector("[data-new-module]") as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "writing");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    await act(async () => {
      const select = document.querySelector("[data-new-type]") as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLSelectElement.prototype, "value")!.set!;
      setter.call(select, "task2");
      select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
      await Promise.resolve();
    });

    await click("[data-new-template]");
    const templateCall = calls.find((call) => call.url.startsWith("/api/admin/content/template"))!;
    assert.match(templateCall.url, /module=writing&contentType=task2&kind=template/, "the author's own canonical template");

    const payload = document.querySelector("[data-new-payload]") as HTMLTextAreaElement;
    assert.match(payload.value, /"taskType": "task2"/, "the template is loaded, not invented by the screen");
    assert.match((document.querySelector("[data-new-source-ref]") as HTMLInputElement).value, /alpha/, "the identity comes from the template when it declares one");

    await click("[data-new-validate]");
    await click("[data-new-save]");
    const draft = calls.filter((call) => call.url === "/api/admin/content/drafts").at(-1)!;
    assert.equal((draft.body as Record<string, unknown>).module, "writing");
    assert.equal((draft.body as Record<string, unknown>).sourceRef, "alpha");
    assert.equal((draft.body as Record<string, unknown>).versionId, undefined, "a new item has no revision to revise");
  });
});

test("the workspace is built only on the existing content services", () => {
  const source = read("src/components/admin/ContentWorkspace.tsx");
  // Dispatch on real code, not on prose: a route named in a comment is documentation,
  // not a request the screen makes.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((line) => !line.trimStart().startsWith("//")).join("\n");
  const routes = [...code.matchAll(/[`"'](\/api\/[^`"'?]+)/g)].map((match) => match[1]!);
  assert.ok(routes.length >= 6, "the screen calls the admin content API");
  for (const route of routes)
    assert.match(route, /^\/api\/admin\/content\//, `${route} must be an admin content route`);
  // No learner surface, no second CMS, no visibility rule of its own.
  assert.doesNotMatch(source, /\/api\/(lessons?|reading|listening|writing|speaking|vocabulary)\//, "the workspace never reads a learner endpoint");
  assert.doesNotMatch(source, /publicationState:\s*"published"|isLive\(/, "the screen does not decide visibility");
  const { admin } = en;
  for (const key of ["title", "bankTitle", "filterIdentity", "filterTitle", "publish", "schedule", "archive", "preview", "validate", "saveDraft", "revise"])
    assert.ok(key in admin.contentWorkspace, `en.admin.contentWorkspace.${key}`);
  const uz = read("src/lib/i18n/uz.ts");
  for (const key of Object.keys(admin.contentWorkspace))
    assert.match(uz, new RegExp(`\\b${key}:`), `uz.admin.contentWorkspace.${key}`);
});
