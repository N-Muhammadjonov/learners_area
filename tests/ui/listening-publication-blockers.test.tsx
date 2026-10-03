// Listening publish gate must reach staff as localized, actionable sentences —
// never the English log strings, never a reason-less generic error (master §18, §47, §59).
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/admin/listening" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLSelectElement", "Element", "Node", "Event", "MouseEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: (dom.window as unknown as Record<string, unknown>)[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: globalThis });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { PublicationControl } = await import("../../src/components/admin/PublicationControl");
const { publicationBlockers, publicationIssues } = await import("../../src/lib/listening/package");

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function clickSave(dict: typeof en) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector("#root")!);
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  const original = globalThis.fetch;
  globalThis.fetch = (async () =>
    json(
      {
        error: "incomplete_listening_package",
        issues: ["Section 2: full transcript missing", "Section 3: transcript requires audio review"],
        blockers: [
          { kind: "transcript_missing", section: 2 },
          { kind: "transcript_review", section: 3 },
        ],
      },
      409,
    )) as typeof fetch;
  try {
    await act(async () =>
      root.render(
        React.createElement(
          AppRouterContext.Provider,
          { value: router as never },
          React.createElement(PublicationControl, { type: "listening", id: "t1", state: "draft", publishAt: null, dict }),
        ),
      ),
    );
    const button = document.querySelector<HTMLButtonElement>("[data-publication-control] button")!;
    await act(async () => {
      button.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    return [...document.querySelectorAll("[data-publication-issues] li")].map((li) => li.textContent);
  } finally {
    globalThis.fetch = original;
    await act(async () => root.unmount());
  }
}

test("LB1 blocked Listening publish lists each blocker in English, not log text", async () => {
  const items = await clickSave(en);
  assert.deepEqual(items, ["Section 2: transcript missing.", "Section 3: transcript needs review."]);
  assert.ok(!items.some((t) => /full transcript missing|requires audio review/.test(t ?? "")));
});

test("LB2 same blockers in Uzbek (Latin only)", async () => {
  const items = await clickSave(uz);
  assert.deepEqual(items, ["2-bo'lim: transcript yo'q.", "3-bo'lim: transcriptni tekshirish kerak."]);
  assert.ok(!items.some((t) => /[\u0400-\u04FF]/.test(t ?? "")));
});

test("LB3 structured blockers and log issues come from one gate", () => {
  const sections = [1, 2, 3, 4].map((number) => ({
    number,
    transcript: number === 1 ? "Real text" : number === 2 ? "Text" : "   ",
    reviewRequired: number === 2,
  }));
  const p = { sections } as unknown as Parameters<typeof publicationBlockers>[0];
  assert.deepEqual(publicationBlockers(p), [
    { kind: "transcript_review", section: 2 },
    { kind: "transcript_missing", section: 3 },
    { kind: "transcript_missing", section: 4 },
  ]);
  assert.equal(publicationIssues(p).length, 3);
});

test("LB4 Full Listening hub copy exists in both dictionaries with five activities", () => {
  for (const d of [en, uz]) {
    assert.equal(d.fullListeningHub.activities.length, 5);
    for (const v of Object.values(d.fullListeningHub)) assert.ok((Array.isArray(v) ? v : [v]).every((s) => s.trim().length > 0));
  }
  assert.ok(!JSON.stringify(uz.fullListeningHub).match(/[\u0400-\u04FF]/));
});
