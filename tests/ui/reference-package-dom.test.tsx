import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/app" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLTextAreaElement", "HTMLSelectElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "FocusEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { renderToStaticMarkup } = await import("react-dom/server");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { InstantLink } = await import("../../src/components/interaction/InstantLink");
const { RetentionMeasurementEditor } = await import("../../src/components/admin/RetentionMeasurementEditor");
const { ProgressTrends } = await import("../../src/components/progress/ProgressTrends");

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));
async function mount(element: React.ReactNode, prefetched: string[], run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch(href: string) { prefetched.push(href); } };
  try {
    await act(async () => root.render(React.createElement(AppRouterContext.Provider, { value: router as never }, element)));
    await run();
  } finally { await act(async () => root.unmount()); }
}
const hover = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("mouseover", { bubbles: true })); });
const leave = (el: Element) => act(async () => { el.dispatchEvent(new dom.window.MouseEvent("mouseout", { bubbles: true })); });

test("intent prefetch: opted-in landing after 90ms hover, cancelled on early leave, never for private/explicitly disabled links", async () => {
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  const prefetched: string[] = [];
  await mount(React.createElement("div", null,
    React.createElement(InstantLink, { href: "/app/reading", intentPrefetch: true, id: "a" }, "Reading"),
    React.createElement(InstantLink, { href: "/app/writing", intentPrefetch: true, id: "b" }, "Writing"),
    React.createElement(InstantLink, { href: "/app/admin/reading/retention", intentPrefetch: true, id: "c" }, "Admin"),
    React.createElement(InstantLink, { href: "/app/listening", intentPrefetch: true, prefetch: false, id: "d" }, "Off"),
    React.createElement(InstantLink, { href: "/app/grammar", id: "e" }, "Not opted in"),
  ), prefetched, async () => {
    const a = document.querySelector("#a")!;
    assert.ok(a.hasAttribute("data-instant-navigation"));
    await hover(a); await wait(120);
    assert.deepEqual(prefetched, ["/app/reading"]);
    await wait(800);
    const b = document.querySelector("#b")!;
    await hover(b); await wait(20); await leave(b); await wait(120);
    assert.deepEqual(prefetched, ["/app/reading"], "early leave cancels");
    for (const id of ["#c", "#d", "#e"]) { await hover(document.querySelector(id)!); await wait(120); }
    assert.deepEqual(prefetched, ["/app/reading"]);
  });
});

test("measurement builder: edits structure via form, raw-mode keeps invalid JSON untouched", async () => {
  let value = JSON.stringify({ schemaVersion: 1, maxScore: 100, claims: [] });
  const prefetched: string[] = [];
  function Host() {
    const [v, setV] = React.useState(value);
    value = v;
    return React.createElement(RetentionMeasurementEditor, { value: v, onChange: setV, dict: en });
  }
  await mount(React.createElement(Host), prefetched, async () => {
    assert.ok(document.querySelector("[data-retention-measurement-builder]"));
    const add = [...document.querySelectorAll("button")].find((b) => b.textContent === en.retentionMemory.admin.builder.addClaim)!;
    await act(async () => add.click());
    const parsed = JSON.parse(value);
    assert.equal(parsed.claims.length, 1);
    assert.match(parsed.claims[0].id, /^c_[0-9a-f]{32}$/);
    assert.equal(parsed.claims[0].groups.length, 1);
    assert.match(document.querySelector('[role="status"]')!.textContent ?? "", /1 \/ 100/);
  });
  value = '{"schemaVersion":2,"claims":[]}';
  await mount(React.createElement(Host), prefetched, async () => {
    assert.equal(document.querySelector('[role="alert"]')!.textContent, en.retentionMemory.admin.builder.rawWarning);
    assert.equal(document.querySelector<HTMLTextAreaElement>("[data-retention-editor-structure]")!.value, '{"schemaVersion":2,"claims":[]}');
  });
});

test("fonts and welcome: owner font roles, no VocaType assets, single authoritative CTA without prefetch", async () => {
  const fonts = readFileSync("src/lib/ui/fonts.ts", "utf8");
  // Self-hosted OFL files (no build-time network); every referenced file exists and is in the provenance ledger.
  const files = [...fonts.matchAll(/fonts\/([a-z0-9-]+\.woff2)/g)].map((m) => m[1]!);
  // Owner master prompt §8 replaced Quicksand (UI) / Be Vietnam Pro (academic) with Geist Sans + Sora.
  for (const family of ["geist", "sora", "kanit", "roboto-mono", "itim"]) assert.ok(files.some((f) => f.startsWith(family)), family);
  assert.ok(!files.some((f) => /quicksand|be-vietnam/.test(f)), "superseded faces are gone");
  const provenance = readFileSync("src/fonts/PROVENANCE.md", "utf8");
  const { createHash } = await import("node:crypto");
  for (const file of files) {
    const sha = createHash("sha256").update(readFileSync(`src/fonts/${file}`)).digest("hex");
    assert.ok(provenance.includes(`| ${file} | @fontsource`) && provenance.includes(sha), file);
  }
  assert.equal((fonts.match(/preload: true/g) ?? []).length, 1, "only the UI face is preloaded");
  assert.match(fonts, /const ui = localFont\(\{[^\n]*preload: true/);
  assert.ok(!/vocatype/i.test(fonts.replace("VocaType's font assets", "")));
  assert.ok(!fonts.includes("next/font/google"));
  assert.match(readFileSync("src/app/layout.tsx", "utf8"), /<html className=\{fontVariables\}/);
  const css = readFileSync("src/app/globals.css", "utf8");
  // §8: long reading text uses the readable UI family, not a display face.
  assert.match(css, /\.academic-text \{ font-family: var\(--font-ui\)/);
  assert.match(css, /--font-display: var\(--font-heading\)/);
  assert.match(css, /prefers-reduced-motion: reduce\) \{ \.la-welcome-chip, \.la-welcome-heading, \.la-welcome-cta \{ animation: none; \}/);
  const page = readFileSync("src/app/page.tsx", "utf8");
  assert.equal((page.match(/<Link\s/g) ?? []).length, 1);
  assert.match(page, /prefetch=\{false\}\s+data-landing-cta/);
  assert.match(page, /!user\s*\? "\/login"\s*:\s*hasPrivateAccess\(user\.accountStatus\)\s*\? "\/app"\s*:\s*"\/pending"/);
});

test("academic-text applied to Reading, Listening, Writing and Grammar reading surfaces", () => {
  for (const file of ["src/components/reading/ReadingExam.tsx", "src/components/listening/SpeedTrainer.tsx", "src/app/app/(shell)/grammar/[topicId]/page.tsx", "src/components/grammar/ProductionAnswer.tsx", "src/components/reading/RetentionSession.tsx"]) {
    assert.match(readFileSync(file, "utf8"), /academic-text/, file);
  }
});

test("progress trends render real values with accessible tables and honest empty/unavailable states", () => {
  const week = (v: number | null) => ({ weekStart: "2026-09-28", value: v, count: v === null ? 0 : 1 });
  const html = renderToStaticMarkup(React.createElement(ProgressTrends, { dict: en, trends: {
    reading: [week(null), week(75)], listening: [week(null)], writing: null, speaking: [week(6.5)],
    heatmap: [[{ day: "2026-09-28", count: 2 }, ...Array.from({ length: 6 }, (_, i) => ({ day: `2026-09-${29 + i}`, count: 0 }))]],
    retention: [{ level: "B1", attempts: 2, textsCompleted: 2, best: 60, recent: [40, 60], average: 50, change: 20 }],
  } as never }));
  assert.match(html, /data-trend-table="reading"/);
  assert.match(html, /<td>75%<\/td>/);
  assert.match(html, /data-trend="listening"[^]*data-trend-empty/);
  assert.match(html, /data-trend="writing" data-trend-unavailable/);
  assert.match(html, /<th scope="row" class="font-normal">2026-09-28<\/th><td>2<\/td>/);
  assert.match(html, /40 → 60/);
  assert.match(html, /\+20/);
  assert.match(html, /data-trend-table="speaking"[^]*<td>6.5<\/td>/);
  assert.match(html, /<td>2<\/td><td>60<\/td>/);
});
