import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";

const ROOT = new URL("../..", import.meta.url).pathname;
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { url: "http://localhost/vocabulary" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLButtonElement", "HTMLInputElement", "HTMLSelectElement", "HTMLAnchorElement", "HTMLFormElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const React = await import("react");
Object.assign(globalThis, { React });
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime");
const { InstantInteractionProvider } = await import("../../src/components/interaction/InstantInteractionProvider");
const { VocabStudio } = await import("../../src/components/vocabulary/VocabStudio");
const { VocabWordsPanel } = await import("../../src/components/vocabulary/VocabWordsPanel");
  const { VocabUsePanel } = await import("../../src/components/vocabulary/VocabUsePanel");
  const { VocabBoardPanel } = await import("../../src/components/vocabulary/VocabBoardPanel");

const query = <T extends Element>(selector: string): T => {
  const found = document.querySelector<T>(selector);
  assert.ok(found, `expected ${selector}`);
  return found;
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function word(index: number) {
  return {
    id: `word-${index}`,
    term: `word ${index}`,
    partOfSpeech: null,
    definitionEn: `meaning ${index}`,
    translationUz: null,
    exampleSentence: null,
    collocations: null,
    mastery: "new" as const,
    srsStage: -1,
    intervalDays: 0,
    nextReviewAt: "2026-09-29T00:00:00.000Z",
    correctCount: 0,
    incorrectCount: 0,
    activeUseCount: 0,
    folderId: null,
    topicPack: null,
    sourceType: null,
    sourceSnapshot: null,
    createdAt: "2026-09-29T00:00:00.000Z",
  };
}

function summary(total: number): {
  total: number;
  due: number;
  byMastery: Record<string, number>;
  bySource: Record<string, number>;
  nextDueAt: null;
} {
  return {
    total,
    due: 0,
    byMastery: { new: total, learning: 0, known: 0, active: 0, mastered: 0 },
    bySource: total ? { manual: total } : {},
    nextDueAt: null,
  };
}

function wordsPanelProps(overrides: Partial<Parameters<typeof VocabWordsPanel>[0]> = {}) {
  const rows = [word(1)];
  return {
    dict: en,
    words: rows,
    folders: [],
    foldersStatus: "ready" as const,
    onRetryFolders: () => undefined,
    packs: [],
    summary: summary(rows.length),
    summaryStatus: "ready" as const,
    onRetrySummary: () => undefined,
    hasMore: false,
    loadingMore: false,
    loadMoreError: false,
    onLoadMore: () => undefined,
    onRefresh: async () => undefined,
    ...overrides,
  };
}

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

function withRouter(child: React.ReactNode, refresh: () => void = () => undefined) {
  const router = { back() {}, forward() {}, refresh, push() {}, replace() {}, prefetch() {} };
  return React.createElement(AppRouterContext.Provider, { value: router as never }, child);
}

function withInteractionRuntime(child: React.ReactNode) {
  const router = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {} };
  return React.createElement(
    AppRouterContext.Provider,
    { value: router as never },
    React.createElement(
      PathnameContext.Provider,
      { value: "/app/vocabulary" },
      React.createElement(
        SearchParamsContext.Provider,
        { value: new URLSearchParams() },
        React.createElement(InstantInteractionProvider, null, child),
      ),
    ),
  );
}

test("Vocabulary My Words renders the empty library and zero-folder state without treating it as an error", async () => {
  await withRoot(React.createElement(VocabWordsPanel, wordsPanelProps({ words: [], folders: [], summary: summary(0) })), () => {
    assert.match(document.body.textContent ?? "", /Your library is empty/);
    assert.ok(query('[data-folder="all"]'));
    assert.ok(query('[data-folder="none"]'));
    assert.equal(document.querySelector('[data-folder="own-folder"]'), null);
    assert.equal(query<HTMLElement>('[data-word-map-count="0"]').getAttribute("data-word-map-count"), "0");
    assert.equal(document.querySelector('[role="alert"]'), null);
  });
});

test("normal words, nullable lexical fields, and present folders render together", async () => {
  await withRoot(React.createElement(VocabWordsPanel, wordsPanelProps({
    words: [word(1), { ...word(2), sourceType: "reading", sourceSnapshot: null }],
    folders: [{ id: "folder-a", name: "Reading", count: 2 }],
    summary: { ...summary(2), bySource: { manual: 1, reading: 1 } },
  })), () => {
    assert.equal(document.querySelectorAll("[data-vocab-entry]").length, 2);
    assert.equal(query('[data-folder="folder-a"]').textContent, "Reading · 2");
    assert.equal(query('[data-word-map-source="reading"]').getAttribute("data-word-map-count"), "1");
    assert.ok(document.body.textContent?.includes("meaning 2"));
    assert.equal(document.querySelector('[role="alert"]'), null);
  });
});

test("many words stay page-bounded while the complete aggregate remains accurate and load-more is available", async () => {
  let retries = 0;
  const rows = Array.from({ length: 50 }, (_, index) => word(index));
  await withRoot(React.createElement(VocabWordsPanel, wordsPanelProps({
    words: rows,
    summary: summary(137),
    hasMore: true,
    onLoadMore: () => { retries += 1; },
  })), async () => {
    assert.equal(document.querySelectorAll("[data-vocab-entry]").length, 50);
    assert.equal(query('[data-word-map-source="manual"]').getAttribute("data-word-map-count"), "137");
    assert.ok(query("[data-library-load-more]"));
    await act(async () => query<HTMLButtonElement>("[data-library-load-more]").click());
    assert.equal(retries, 1);
  });
});

test("summary and folder failures leave the core library usable and each retry targets its own region", async () => {
  let summaryRetries = 0;
  let folderRetries = 0;
  await withRoot(React.createElement(VocabWordsPanel, wordsPanelProps({
    words: [word(1)],
    foldersStatus: "error",
    onRetryFolders: () => { folderRetries += 1; },
    summary: null,
    summaryStatus: "error",
    onRetrySummary: () => { summaryRetries += 1; },
  })), async () => {
    assert.equal(document.querySelectorAll("[data-vocab-entry]").length, 1);
    assert.ok(query('[data-vocabulary-region-error="summary"]'));
    assert.ok(query('[data-vocabulary-region-error="folders"]'));
    await act(async () => query<HTMLButtonElement>('[data-region-retry="summary"]').click());
    await act(async () => query<HTMLButtonElement>('[data-region-retry="folders"]').click());
    assert.equal(summaryRetries, 1);
    assert.equal(folderRetries, 1);
  });
});

test("successful empty word-picker and sentence-history responses have intentional empty states", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => String(input).includes("view=history")
    ? json({ ok: true, sentences: [] })
    : json({ ok: true, words: [] })) as typeof fetch;
  try {
    await withRoot(withRouter(React.createElement(VocabUsePanel, { dict: en, onSaved: () => undefined })), async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.match(document.body.textContent ?? "", /Add words before writing sentences/);
      assert.match(document.body.textContent ?? "", /No sentences yet/);
      assert.equal(document.querySelector('[role="alert"]'), null);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Use It supports empty words/history, nullable historical evaluation ids, and isolated history retry", async () => {
  const originalFetch = globalThis.fetch;
  let historyCalls = 0;
  let failHistory = true;
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("view=history")) {
      historyCalls += 1;
      return failHistory ? json({ ok: false }, 503) : json({ ok: true, sentences: [{
        id: "sentence-old",
        sentence: "This is an older saved sentence.",
        origin: "manual",
        accepted: false,
        pointsAwarded: 0,
        term: "older",
        evaluationId: null,
        createdAt: "2025-01-01T00:00:00.000Z",
      }] });
    }
    return json({ ok: true, words: [] });
  }) as typeof fetch;
  try {
    await withRoot(withRouter(React.createElement(VocabUsePanel, { dict: en, onSaved: () => undefined })), async () => {
      assert.ok(query('[data-vocabulary-region-error="sentence-history"]'));
      assert.match(document.body.textContent ?? "", /Add words before writing sentences/);
      assert.equal(historyCalls, 1);
      failHistory = false;
      await act(async () => query<HTMLButtonElement>('[data-region-retry="sentence-history"]').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.equal(historyCalls, 2);
      assert.equal(document.querySelector('[data-vocabulary-region-error="sentence-history"]'), null);
      assert.ok(query('[data-sentence-bank]'));
      assert.ok(document.body.textContent?.includes("This is an older saved sentence."));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a core Vocabulary library failure preserves the workspace and retries only the library request", async () => {
  const originalFetch = globalThis.fetch;
  const calls = { library: 0, summary: 0, folders: 0, board: 0 };
  globalThis.fetch = (async (input) => {
    const url = String(input);
    if (url.includes("/api/vocabulary?")) {
      calls.library += 1;
      return json({ ok: false }, 503);
    }
    if (url.includes("/api/vocabulary/summary")) {
      calls.summary += 1;
      return json({ ok: true, summary: summary(0) });
    }
    if (url.includes("/api/vocabulary/folders")) {
      calls.folders += 1;
      return json({ ok: true, folders: [] });
    }
    if (url.includes("/api/vocabulary/leaderboard")) {
      calls.board += 1;
      return json({ ok: true, points: 0, rank: 0, streak: 0, top: [], awards: [] });
    }
    return json({ ok: false }, 503);
  }) as typeof fetch;
  try {
    await withRoot(withInteractionRuntime(React.createElement(VocabStudio, { dict: en, initialTab: "words", packs: [] })), async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.ok(query("[data-vocabulary-workspace]"));
      assert.ok(query("[data-vocabulary-panel]"));
      assert.ok(query('[data-vocabulary-region-error="library"]'));
      assert.deepEqual(calls, { library: 1, summary: 1, folders: 1, board: 1 });
      await act(async () => query<HTMLButtonElement>('[data-region-retry="library"]').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.deepEqual(calls, { library: 2, summary: 1, folders: 1, board: 1 });
      assert.ok(query('[data-vocabulary-region-error="library"]'));
      assert.ok(query("[data-vocabulary-panel]"));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vocabulary API auth failures refresh the server gate instead of exposing private data", async () => {
  const originalFetch = globalThis.fetch;
  let refreshes = 0;
  globalThis.fetch = (async () => json({ error: "unauthenticated" }, 401)) as typeof fetch;
  try {
    await withRoot(
      withRouter(React.createElement(VocabUsePanel, { dict: en, onSaved: () => undefined }), () => { refreshes += 1; }),
      async () => {
        await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
        assert.equal(refreshes, 2, "picker and history each request the authoritative server gate");
        assert.ok(query('[data-vocabulary-region-error="sentence-history"]'));
        assert.ok(query('[data-vocabulary-region-error="use-words"]'));
        assert.equal(document.querySelector("[data-sentence-bank]"), null);
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("an empty standing is healthy; a failed standing retries without repeating optional award history", async () => {
  const originalFetch = globalThis.fetch;
  let fail = false;
  let calls = 0;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    calls += 1;
    if (url.includes("view=standing")) return json({ ok: true, points: 0, rank: 0, streak: 0, top: [] });
    return fail ? json({ ok: false }, 503) : json({ ok: true, points: 0, rank: 0, streak: 0, top: [], awards: [] });
  }) as typeof fetch;
  try {
    await withRoot(withRouter(React.createElement(VocabBoardPanel, { dict: en })), async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.ok(query("[data-board-empty]"));
      assert.ok(query<HTMLElement>("[data-leaderboard]"));
      fail = true;
      await act(async () => window.dispatchEvent(new Event("vocab:ledger-changed")));
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.ok(query('[data-vocabulary-region-error="leaderboard"]'));
      const beforeRetry = calls;
      await act(async () => query<HTMLButtonElement>('[data-region-retry="leaderboard"]').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.equal(calls, beforeRetry + 1);
      assert.match(requests.at(-1)!, /view=standing/);
      assert.equal(document.querySelector('[data-vocabulary-region-error="leaderboard"]'), null);
      assert.ok(query("[data-board-empty]"));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("recent point history failure leaves the standing panel usable and retries only its API scope", async () => {
  const originalFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input) => {
    const url = String(input);
    requests.push(url);
    if (url.includes("view=awards")) return json({ ok: true, awards: [{ id: "award-1", kind: "new_word", points: 2, createdAt: "2026-09-29T00:00:00.000Z" }] });
    return json({ ok: true, points: 0, rank: 0, streak: 0, top: [], awards: [], awardsUnavailable: true });
  }) as typeof fetch;
  try {
    await withRoot(withRouter(React.createElement(VocabBoardPanel, { dict: en })), async () => {
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.ok(query("[data-board-empty]"));
      assert.ok(query('[data-vocabulary-region-error="award-history"]'));
      assert.equal(requests.length, 1);
      await act(async () => query<HTMLButtonElement>('[data-region-retry="award-history"]').click());
      await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
      assert.equal(requests.length, 2);
      assert.match(requests[1]!, /view=awards/);
      assert.equal(document.querySelector('[data-vocabulary-region-error="award-history"]'), null);
      assert.match(document.body.textContent ?? "", /Legacy word-save award/);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Vocabulary route has no pre-frame DB data fanout; core library failures are local, authenticated, and paginated", () => {
  const page = read("src/app/app/(shell)/vocabulary/page.tsx");
  const studio = read("src/components/vocabulary/VocabStudio.tsx");
  assert.match(read("src/app/api/vocabulary/route.ts"), /forwardToBackend as GET/);
  const libraryApi = read("services/backend/app/step16_vocab_library_port.py");
  assert.match(page, /Promise\.all\(\[requireActiveUser\(\), getLocale\(\), searchParams\]\)/);
  assert.doesNotMatch(page, /listLibrary|listDue|listFolders|getStanding|listSentenceBank/);
  assert.match(studio, /if \(tab === "words"\)[\s\S]*?void loadLibrary\(\)[\s\S]*?void loadSummary\(\)[\s\S]*?void loadFolders\(\)/);
  assert.match(studio, /else if \(tab === "revision"\)[\s\S]*?void loadDue\(\)/);
  assert.match(studio, /libraryStatus === "error"[\s\S]*?loadLibrary\(true\)/);
  assert.match(libraryApi, /core\.current_user\(req,active=True\)/);
  assert.match(libraryApi, /user\['id'\],limit\+1,offset/);
  assert.match(libraryApi, /503,PRIVATE/);
  assert.match(libraryApi, /Cache-Control.*private, no-store/);
  assert.match(studio, /LIBRARY_PAGE_SIZE = 50/);
});

test("Vocabulary APIs re-authorize, no-store, and isolate secondary query failures; legacy points remain contract-derived", () => {
  for (const path of [
    "src/app/api/vocabulary/summary/route.ts",
    "src/app/api/vocabulary/folders/route.ts",
    "src/app/api/vocabulary/due/route.ts",
    "src/app/api/vocabulary/sentences/route.ts",
    "src/app/api/vocabulary/leaderboard/route.ts",
  ]) {
    const route = read(path);
    assert.match(route, /forwardToBackend as GET/, `${path} must delegate to Python`);
  }
  // Runtime authorization, 503 isolation and pagination are covered by
  // test_preview_integration.py against the actual ASGI application.
  const engine = read("src/lib/services/vocabulary/engine.ts");
  assert.match(engine, /groupBy\(userVocabulary\.mastery, userVocabulary\.sourceType\)/);
  assert.match(engine, /function buildEffectivePointRows\(\)/);
  assert.match(engine, /row_number\(\) OVER/);
  assert.match(read("src/components/vocabulary/types.ts"), /evaluationId: string \| null/);
});
