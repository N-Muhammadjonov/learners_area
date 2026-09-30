import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const ROOT = new URL("../..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/vocabulary/games/gap?set=all" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLAnchorElement", "HTMLFormElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { InstantInteractionProvider } = await import("../../src/components/interaction/InstantInteractionProvider");
const { InstantWorkspaceOutlet } = await import("../../src/components/interaction/InstantWorkspaceOutlet");
const { VocabGameView } = await import("../../src/components/vocabulary/VocabGamesPanel");

const query = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, `expected ${selector}`);
  return found;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const tick = (ms = 0) => act(async () => new Promise((resolve) => setTimeout(resolve, ms)));

function word(index: number) {
  return {
    id: `word-${index}`, term: `alpha${index}`, partOfSpeech: null, definitionEn: `meaning ${index}`,
    translationUz: `tarjima ${index}`, exampleSentence: `We use alpha${index} daily`, collocations: null,
    acceptedTranslations: [], sourceType: null,
  };
}
const gameSet = (count: number) => ({ ok: true, total: count, due: 0, words: Array.from({ length: count }, (_, i) => word(i)), selfAssessments: {} });

async function withRoot(element: React.ReactNode, run: () => Promise<void> | void) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(query<HTMLDivElement>("#root"));
  try {
    await act(async () => root.render(element));
    await run();
  } finally {
    await act(async () => root.unmount());
  }
}

function runtime(child: React.ReactNode) {
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  return React.createElement(AppRouterContext.Provider, { value: router as never },
    React.createElement(PathnameContext.Provider, { value: "/vocabulary/games/gap" },
      React.createElement(SearchParamsContext.Provider, { value: new URLSearchParams("set=all") },
        React.createElement(InstantInteractionProvider, null, child))));
}

const view = (gameId: "gap" | "translation" | "builder" | "cards") => runtime(React.createElement(VocabGameView, {
  dict: en, gameId, setKey: "all", folders: [], packs: [],
}));

async function withFetch(impl: typeof fetch, run: () => Promise<void>) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try { await run(); } finally { globalThis.fetch = original; }
}

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
}

test("workspace outlet keeps current children mounted with no pending notice at rest", async () => {
  await withRoot(runtime(React.createElement(InstantWorkspaceOutlet, null, React.createElement("p", { id: "kept" }, "current"))), () => {
    assert.equal(query("#kept").textContent, "current");
    assert.equal(query("[data-workspace-content]").hasAttribute("inert"), false);
    assert.equal(document.querySelector("[data-workspace-loading]"), null);
  });
});

test("outlet source never swaps children for a frame branch", () => {
  const source = read("src/components/interaction/InstantWorkspaceOutlet.tsx");
  assert.match(source, /data-workspace-content inert=\{pending \|\| undefined\}>\{children\}/);
  assert.doesNotMatch(source, /\{pending \?/);
});

test("game load failure is terminal with a retry that refetches", async () => {
  let calls = 0;
  await withFetch((async () => { calls += 1; return calls === 1 ? json({ ok: false }, 500) : json(gameSet(3)); }) as typeof fetch, async () => {
    await withRoot(view("gap"), async () => {
      await tick();
      assert.ok(query("[data-game-load-retry]"));
      await act(async () => query<HTMLButtonElement>("[data-game-load-retry]").click());
      await tick();
      assert.equal(calls, 2);
      assert.ok(query("[data-gap-sentence]"));
    });
  });
});

test("game set request is aborted on unmount", async () => {
  let signal: AbortSignal | undefined;
  await withFetch(((_input: RequestInfo | URL, init?: RequestInit) => { signal = init?.signal ?? undefined; return new Promise<Response>(() => undefined); }) as typeof fetch, async () => {
    await withRoot(view("gap"), () => undefined);
    assert.equal(signal?.aborted, true);
  });
});

test("empty set renders an intentional empty state", async () => {
  await withFetch((async () => json({ ok: true, total: 0, due: 0, words: [] })) as typeof fetch, async () => {
    await withRoot(view("gap"), async () => {
      await tick();
      assert.ok(query("[data-game-empty]"));
      assert.equal(document.querySelector('[role="alert"]'), null);
    });
  });
});

test("fill-the-gap cannot be checked with an empty answer", async () => {
  await withFetch((async () => json(gameSet(3))) as typeof fetch, async () => {
    await withRoot(view("gap"), async () => {
      await tick();
      const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === en.vocabulary.games.check)!;
      assert.equal(check.disabled, true);
    });
  });
});

test("fill-the-gap auto-advances after feedback", async () => {
  await withFetch((async (_i: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? json({ ok: true, awarded: 0, verified: true, correct: false }) : json(gameSet(3))) as typeof fetch, async () => {
    await withRoot(view("gap"), async () => {
      await tick();
      assert.match(document.body.textContent ?? "", /1 \/ 3/);
      const input = query<HTMLInputElement>(`input[aria-label="${en.vocabulary.games.gap}"]`);
      await act(async () => setInput(input, "wrong"));
      const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === en.vocabulary.games.check)!;
      await act(async () => check.click());
      assert.match(document.body.textContent ?? "", new RegExp(en.vocabulary.games.wrongAnswer));
      await tick(1800);
      assert.match(document.body.textContent ?? "", /2 \/ 3/);
    });
  });
});

test("translation next button advances once", async () => {
  await withFetch((async (_i: RequestInfo | URL, init?: RequestInit) => init?.method === "POST" ? json({ ok: true }) : json(gameSet(3))) as typeof fetch, async () => {
    await withRoot(view("translation"), async () => {
      await tick();
      const input = query<HTMLInputElement>(`input[aria-label="${en.vocabulary.games.translation}"]`);
      await act(async () => setInput(input, "x"));
      const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === en.vocabulary.games.check)!;
      await act(async () => check.click());
      const next = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === en.vocabulary.games.next)!;
      await act(async () => next.click());
      assert.match(document.body.textContent ?? "", /2 \/ 3/);
    });
  });
});

test("flashcard motion toggle defaults to system motion", async () => {
  await withFetch((async () => json(gameSet(2))) as typeof fetch, async () => {
    await withRoot(view("cards"), async () => {
      await tick();
      assert.equal(query("[data-flashcard]").getAttribute("data-card-motion"), "system");
      await act(async () => query<HTMLButtonElement>("[data-flashcard-motion]").click());
      assert.equal(query("[data-flashcard]").getAttribute("data-card-motion"), "full");
    });
  });
});

test("sentence builder check stays disabled until all tiles are placed", async () => {
  await withFetch((async () => json(gameSet(2))) as typeof fetch, async () => {
    await withRoot(view("builder"), async () => {
      await tick();
      const check = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === en.vocabulary.games.check)!;
      assert.equal(check.disabled, true);
    });
  });
});
