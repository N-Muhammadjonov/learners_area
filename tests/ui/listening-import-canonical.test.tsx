import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

/**
 * The canonical Listening import screen, rendered.
 *
 * What the operator must be able to see and control, in order:
 *   package selected → SERVER validation (no writes) → what the package needs
 *   → which binaries are still missing → dry run → only then Import.
 *
 * The file picker is driven through the real change event; the network is mocked
 * so a passing test proves the screen's own state machine, not a mock's opinion.
 */

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost/listening/import" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent"] as const)
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { ListeningImport } = await import("../../src/components/listening/ListeningImport");

const q = <T extends Element = HTMLElement>(selector: string) => {
  const element = document.querySelector<T>(selector);
  assert.ok(element, `missing element: ${selector}`);
  return element;
};

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
let validateResponse: unknown = null;
let importResponse: unknown = null;
let intentResponse: unknown = { uploadId: "up-qa-1", objectKey: "audio/qa-uuid.mp3", mode: "proxy", uploadUrl: null, contentType: "audio/mpeg" };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  calls.push({ url, body });
  const payload = url.includes("/validate")
    ? validateResponse
    : url.includes("/uploads/intent")
      ? intentResponse
      : url.includes("/uploads/finalize")
        ? { ok: true }
        : importResponse;
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}) as typeof fetch;

/**
 * The proxy byte path uses XMLHttpRequest (that is where real upload progress
 * comes from), so the fake keeps the same event contract: open → send → load 200.
 */
class FakeXhr extends dom.window.EventTarget {
  upload = new dom.window.EventTarget();
  status = 200;
  responseText = "";
  open() {}
  setRequestHeader() {}
  send() {
    setTimeout(() => this.dispatchEvent(new dom.window.Event("load")), 0);
  }
  abort() {
    this.dispatchEvent(new dom.window.Event("abort"));
  }
}
Object.defineProperty(globalThis, "XMLHttpRequest", { value: FakeXhr, configurable: true });

const canonicalPackage = { schemaVersion: 2, module: "listening", contentType: "full_test", sourceRef: "listening-screen-qa", title: "Screen QA", content: {} };

function validation(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    module: "listening",
    contentType: "full_test",
    schemaVersion: 2,
    title: "Screen QA",
    sourceRef: "listening-screen-qa",
    capabilities: { key: "listening:full_test:v2", label: "Listening full test" },
    requiredAssets: [
      {
        key: "audio.full",
        role: "audio",
        required: true,
        label: "Full test recording",
        mimeTypes: ["audio/mpeg"],
        maxBytes: 200 * 1024 * 1024,
        declared: true,
        path: "audio/full.mp3",
      },
    ],
    preview: { title: "Screen QA", lines: [{ label: "Questions", value: "40" }], warnings: [] },
    issues: [],
    warnings: [],
    ...overrides,
  };
}

async function mounted(run: () => Promise<void> | void) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(q("#root"));
  try {
    await act(async () => {
      root.render(
        <AppRouterContext.Provider value={{ push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch() {} }}>
          <ListeningImport dict={en} />
        </AppRouterContext.Provider>,
      );
    });
    await run();
  } finally {
    await act(async () => root.unmount());
  }
}

async function chooseFile(selector: string, file: File) {
  const input = q<HTMLInputElement>(selector);
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  await act(async () => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const packageFile = () => new File([JSON.stringify(canonicalPackage)], "listening-screen.json", { type: "application/json" });
const audioFile = () => new File([new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 0, 0])], "full.mp3", { type: "audio/mpeg" });

test("UI1 the screen offers the canonical template and example, and the legacy section stays collapsed", async () => {
  await mounted(() => {
    const links = [...document.querySelectorAll("a")].map((anchor) => anchor.getAttribute("href"));
    assert.ok(links.includes("/api/admin/content/template?module=listening&contentType=full_test&kind=template"));
    assert.ok(links.includes("/api/admin/content/template?module=listening&contentType=full_test&kind=example"));
    assert.ok(q("[data-canonical-package-input]"));
    const legacy = q<HTMLDetailsElement>("[data-legacy-import-section]");
    assert.equal(legacy.tagName.toLowerCase(), "details");
    assert.equal(legacy.hasAttribute("open"), false, "legacy HTML import is available but never the default path");
  });
});

test("UI2 a selected package is validated BY THE SERVER before anything is uploaded, and the summary shows what it needs", async () => {
  calls.length = 0;
  validateResponse = validation();
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, "/api/admin/content/validate");
    assert.deepEqual(calls[0]!.body.package, canonicalPackage, "the file's own JSON reaches the server unchanged");
    assert.equal("assets" in calls[0]!.body, false, "no binary is uploaded during validation");
    q("[data-canonical-import-summary]");
    assert.match(q("[data-canonical-import-summary]").textContent ?? "", /Listening full test/);
    assert.match(q("[data-canonical-import-summary]").textContent ?? "", /Screen QA/);
    q("[data-asset-key='audio.full']");
    assert.match(q("[data-asset-key='audio.full']").textContent ?? "", /audio\/mpeg/);
  });
});

test("UI3 nothing can be dry-run or imported while a declared binary is missing", async () => {
  validateResponse = validation();
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());
    assert.equal(q<HTMLButtonElement>("[data-canonical-dry-run]").disabled, true, "a test without its recording cannot be imported");
    assert.equal(q<HTMLButtonElement>("[data-canonical-import-button]").disabled, true);
  });
});

test("UI4 an asset the content uses but the package never declared is a blocker, not a silent guess", async () => {
  validateResponse = validation({
    requiredAssets: [{ key: "image.map", role: "image", required: true, label: null, mimeTypes: ["image/png"], maxBytes: 20 * 1024 * 1024, declared: false, path: null }],
  });
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());
    q("[data-canonical-undeclared-assets]");
    assert.match(q("[data-canonical-undeclared-assets]").textContent ?? "", /image\.map/);
    assert.equal(q<HTMLButtonElement>("[data-canonical-dry-run]").disabled, true);
  });
});

test("UI5 a refused package reports the server's code and issues, and offers no import controls", async () => {
  validateResponse = { error: "unsupported_schema_version", issues: [{ level: 1, code: "schema_invalid", path: "schemaVersion", message: "raw", blocking: true }] };
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());
    const problem = q("[data-canonical-import-problem]");
    assert.equal(problem.getAttribute("data-canonical-import-problem"), "unsupported_schema_version");
    q("[data-canonical-import-issues]");
    assert.equal(document.querySelector("[data-canonical-import-summary]"), null);
    assert.equal(document.querySelector("[data-canonical-dry-run]"), null);
  });
});

test("UI6 dry run comes first; the Import button only unlocks after it passed, and publish is an explicit choice", async () => {
  calls.length = 0;
  // A package whose binaries are all already in place: nothing to upload, so this
  // test is about the dry-run/import gate itself.
  validateResponse = validation({ requiredAssets: [] });
  importResponse = { ok: true, action: "created", targetId: "8f2d0f7e-1c2b-4b3a-9f4e-2f9a6d1b7c33", publicationState: "draft", warnings: [] };
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());

    assert.equal(q<HTMLButtonElement>("[data-canonical-dry-run]").disabled, false);
    assert.equal(q<HTMLButtonElement>("[data-canonical-import-button]").disabled, true, "import stays locked until a dry run passed");

    await act(async () => q<HTMLButtonElement>("[data-canonical-dry-run]").click());
    const dryCall = calls.find((call) => call.url.includes("/content/import") && call.body.dryRun === true);
    assert.ok(dryCall, "the dry run posts to the canonical import endpoint with dryRun: true");
    q("[data-canonical-dry-run-result]");
    assert.equal(q<HTMLButtonElement>("[data-canonical-import-button]").disabled, false);

    await act(async () => q<HTMLButtonElement>("[data-canonical-import-button]").click());
    const applyCall = calls.filter((call) => call.url.includes("/content/import") && call.body.dryRun === false).at(-1);
    assert.ok(applyCall, "the real import is a separate, deliberate call");
    assert.equal(applyCall!.body.publish, false, "publishing is opt-in, never implied by importing");
    const result = q("[data-canonical-import-result]");
    assert.equal(result.getAttribute("data-canonical-import-result"), "created");
    assert.match(result.textContent ?? "", new RegExp(en.contentImport.createdDraft));
    assert.equal(q("[data-canonical-import-result] a").getAttribute("href"), "/listening/tests/8f2d0f7e-1c2b-4b3a-9f4e-2f9a6d1b7c33");
  });
});

test("UI7 the recording travels through the upload intents, and the browser never invents an object key", async () => {
  calls.length = 0;
  validateResponse = validation();
  importResponse = { ok: true, action: "created", targetId: "1b6a0a3d-9c4e-4f8a-8b4b-5c0e2f7a9d11", publicationState: "published", warnings: [] };
  await mounted(async () => {
    await chooseFile("[data-canonical-package-input]", packageFile());
    const assetPanel = q("[data-asset-key='audio.full']");
    assert.match(assetPanel.textContent ?? "", new RegExp(en.contentImport.assetMissing), "the missing recording is named, not assumed");

    await chooseFile("[data-asset-key='audio.full'] input[type=file]", audioFile());
    assert.match(q("[data-asset-key='audio.full']").textContent ?? "", /full\.mp3/, "the chosen file is shown back");

    const publish = [...document.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].at(0);
    assert.ok(publish);
    // A real click: React derives a checkbox's change event from the click event.
    await act(async () => {
      publish.click();
    });
    assert.equal(publish.checked, true, "the publish choice is on");

    await act(async () => q<HTMLButtonElement>("[data-canonical-dry-run]").click());
    // The byte upload is XHR-based, so its completion arrives on a timer.
    for (let attempt = 0; attempt < 40 && !calls.some((call) => call.url === "/api/admin/content/import"); attempt++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    const intent = calls.find((call) => call.url === "/api/uploads/intent");
    assert.ok(intent, "the binary goes through the upload intent endpoint");
    assert.equal(intent!.body.purpose, "material_primary");
    assert.equal(intent!.body.filename, "full.mp3");
    assert.equal("objectKey" in intent!.body, false, "the client never proposes a key; the server issues it");
    const dryCall = calls.filter((call) => call.url === "/api/admin/content/import").at(-1);
    assert.equal(dryCall!.body.dryRun, true);
    assert.deepEqual(dryCall!.body.assetUploads, { "audio.full": "up-qa-1" });
    assert.equal(dryCall!.body.publish, false, "a dry run never publishes, whatever the checkbox says");
    assert.equal(
      JSON.stringify(dryCall!.body).includes("audio/qa-uuid.mp3"),
      false,
      "the issued object key stays server-side",
    );

    await act(async () => q<HTMLButtonElement>("[data-canonical-import-button]").click());
    for (let attempt = 0; attempt < 40 && !calls.some((call) => call.body.dryRun === false); attempt++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    const applyCall = calls.filter((call) => call.url === "/api/admin/content/import").at(-1);
    assert.equal(applyCall!.body.publish, true, "the explicit publish choice reaches the real import");
    assert.deepEqual(applyCall!.body.assetUploads, { "audio.full": "up-qa-1" }, "the verified upload is reused, not repeated");
    assert.equal(calls.filter((call) => call.url === "/api/uploads/intent").length, 1, "one recording, one upload");
    assert.equal(q("[data-canonical-import-result]").getAttribute("data-canonical-import-result"), "created");
  });
});

test("UI8 the imported package never rewrites the interface: no copied chrome, no Cyrillic preview text", () => {
  const source = readFileSync(new URL("../../src/components/listening/ListeningImport.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/, "imported data is never injected as markup");
  assert.doesNotMatch(source, /[\u0400-\u04FF]/, "preview text stays in the site's own languages");
  assert.doesNotMatch(source, /<style|<link|@import/, "a package cannot restyle the page");
});
