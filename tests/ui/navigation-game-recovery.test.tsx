import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost/vocabulary/games/gap" });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "HTMLAnchorElement", "Element", "Node", "Event", "MouseEvent", "KeyboardEvent"] as const) Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react"); Object.assign(globalThis, { React });
const { act, useEffect, useState } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { PathnameContext, SearchParamsContext } = await import("next/dist/shared/lib/hooks-client-context.shared-runtime.js");
const { InstantInteractionProvider, useInstantInteraction } = await import("../../src/components/interaction/InstantInteractionProvider");
const { InstantWorkspaceOutlet } = await import("../../src/components/interaction/InstantWorkspaceOutlet");
const { VocabGameView } = await import("../../src/components/vocabulary/VocabGamesPanel");
const { RetentionHistory } = await import("../../src/components/reading/RetentionHistory");
const { RetentionSession } = await import("../../src/components/reading/RetentionSession");
const { safeErrorLabel } = await import("../../src/lib/observability/errors");
const q = <T extends Element = HTMLElement>(selector: string): T => { const node = document.querySelector<T>(selector); assert.ok(node, selector); return node; };
const click = (selector: string) => act(async () => q<HTMLElement>(selector).click());
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch() {} };
async function mounted(element: React.ReactNode, run: () => Promise<void>) {
  document.body.innerHTML = '<div id="root"></div>'; const root = createRoot(q('#root'));
  try { await act(async () => root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>)); await run(); }
  finally { await act(async () => root.unmount()); }
}
function clock() {
  let now = 0, sequence = 0;
  const jobs = new Map<number, { at: number; interval: number; fn: () => void }>();
  const original = { setTimeout: window.setTimeout, clearTimeout: window.clearTimeout, setInterval: window.setInterval, clearInterval: window.clearInterval };
  const schedule = (fn: () => void, delay = 0, interval = false) => { const id = ++sequence; jobs.set(id, { at: now + delay, interval: interval ? delay : 0, fn }); return id; };
  window.setTimeout = ((fn: () => void, delay?: number) => schedule(fn, delay)) as typeof window.setTimeout;
  window.setInterval = ((fn: () => void, delay?: number) => schedule(fn, delay, true)) as typeof window.setInterval;
  window.clearTimeout = window.clearInterval = (id?: unknown) => { if (typeof id === "number") jobs.delete(id); };
  return { async advance(ms: number) {
    const end = now + ms;
    for (;;) {
      const next = [...jobs].filter(([, job]) => job.at <= end).sort((a, b) => a[1].at - b[1].at)[0]; if (!next) break;
      const [id, job] = next; now = job.at;
      if (job.interval) job.at += job.interval; else jobs.delete(id);
      await act(async () => job.fn());
    } now = end;
  }, restore() { Object.assign(window, original); jobs.clear(); } };
}
async function input(value: string) { await act(async () => {
  const field = q<HTMLInputElement>('input'); Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(field, value); field.dispatchEvent(new Event('input', { bubbles: true }));
}); }
const attemptMeta = {
  attemptId: 'own', level: 'A2' as const, label: '',
  readStartedAt: new Date().toISOString(), readEndsAt: new Date(Date.now() + 120000).toISOString(),
  writeStartedAt: new Date(Date.now() + 120000).toISOString(), writeEndsAt: new Date(Date.now() + 300000).toISOString(),
  serverNow: new Date().toISOString(),
};
const words = ['alpha', 'bravo'].map((term, index) => ({ id: `entry-${index}`, term, definitionEn: `meaning-${term}`, translationUz: `uz-${term}`, exampleSentence: `${term} is useful.`, partOfSpeech: null, collocations: null }));
const games = (gameId: "gap" | "builder" | "race" | "translation") => <VocabGameView dict={en} gameId={gameId} setKey="all" folders={[]} packs={[]} />;

test("pending link and history transitions keep current client state mounted", async () => {
  let mounts = 0, unmounts = 0;
  function Probe() { const [count, setCount] = useState(0); useEffect(() => { mounts++; return () => { unmounts++; }; }, []); return <button data-probe onClick={() => setCount((value) => value + 1)}>{count}</button>; }
  function Control() { const runtime = useInstantInteraction(); return <button data-start onClick={() => runtime.beginNavigation('/reading')}>Navigate</button>; }
  await mounted(<PathnameContext.Provider value="/vocabulary"><SearchParamsContext.Provider value={new URLSearchParams()}><InstantInteractionProvider entryFrames={{ reading: { title: "Reading", shape: "reading" } }}><Control /><a href="/vocabulary" data-current-url onClick={(event) => event.preventDefault()}>Current</a><InstantWorkspaceOutlet><Probe /></InstantWorkspaceOutlet></InstantInteractionProvider></SearchParamsContext.Provider></PathnameContext.Provider>, async () => {
    await click('[data-probe]'); const node = q('[data-probe]'); await click('[data-start]');
    assert.equal(q('[data-probe]'), node); assert.equal(node.textContent, '1'); assert.equal(mounts, 1); assert.equal(unmounts, 0);
    assert.equal(q('[data-workspace-content]').hasAttribute('inert'), true);
    await act(async () => { window.history.pushState(null, '', '/listening'); window.dispatchEvent(new dom.window.PopStateEvent('popstate')); });
    assert.equal(q('[data-probe]'), node); assert.equal(unmounts, 0);
    await click('[data-current-url]');
    assert.equal(q('[data-workspace-content]').hasAttribute('inert'), false);
    assert.equal(q('[data-probe]'), node);
  }); assert.equal(unmounts, 1);
});
for (const gameId of ['gap', 'translation'] as const) test(`${gameId}: empty Enter never reveals or submits; checked answer advances once`, async () => {
  const original = globalThis.fetch; const timers = clock(); let writes = 0;
  globalThis.fetch = async (_url, init) => { if (init?.method === 'POST') { writes++; return Response.json({ ok: true, verified: true, correct: false, awarded: 0 }); } return Response.json({ ok: true, words, total: 2, due: 2 }); };
  try { await mounted(games(gameId), async () => {
    await act(async () => q<HTMLInputElement>('input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    assert.equal(writes, 0); assert.equal(document.querySelector('[data-translation-example]'), null);
    assert.equal(q<HTMLButtonElement>('[data-game-frame] button.btn-primary').disabled, true);
    await input('wrong'); await click('[data-game-frame] button.btn-primary'); assert.equal(writes, 1);
    await timers.advance(1700); assert.equal(q<HTMLInputElement>('input').value, ''); assert.ok(q('[data-game-frame]').textContent?.includes('2 / 2'));
    await timers.advance(3000); assert.ok(q('[data-game-frame]').textContent?.includes('2 / 2'));
  }); } finally { globalThis.fetch = original; timers.restore(); }
});
test("builder advances after checking and final score counts only correct items", async () => {
  const original = globalThis.fetch; const timers = clock();
  globalThis.fetch = async (_url, init) => Response.json(init?.method === 'POST' ? { ok: true, correct: false, verified: true } : { ok: true, words, total: 2, due: 2 });
  try { await mounted(games('builder'), async () => {
    for (let item = 0; item < 2; item++) {
      assert.equal(q<HTMLButtonElement>('[data-game-frame] button.btn-primary').disabled, true);
      const tiles = [...q('[data-builder-answer]').nextElementSibling!.querySelectorAll('button')]; tiles.sort((a, b) => b.textContent!.localeCompare(a.textContent!));
      for (const tile of tiles) await act(async () => tile.click());
      await click('[data-game-frame] button.btn-primary'); await timers.advance(1700);
    } assert.ok(q('[data-game-frame]').textContent?.includes(`0 ${en.vocabulary.games.resultLine} 2`));
  }); } finally { globalThis.fetch = original; timers.restore(); }
});
test("race lights boxes in order, waits for sweep, then auto-advances", async () => {
  const original = globalThis.fetch; const timers = clock();
  globalThis.fetch = async (_url, init) => Response.json(init?.method === 'POST' ? { ok: true, correct: true, verified: true, awarded: 1 } : { ok: true, words, total: 2, due: 2 });
  try { await mounted(games('race'), async () => {
    await input('alpha'); await click('[data-race-submit]'); assert.equal(document.querySelectorAll('[data-race-lit="true"]').length, 0);
    await timers.advance(65); assert.equal(document.querySelectorAll('[data-race-lit="true"]').length, 1);
    await timers.advance(260); assert.equal(document.querySelectorAll('[data-race-lit="true"]').length, 5);
    assert.ok(q('[data-game-frame]').textContent?.includes('1 / 2')); await timers.advance(750); assert.ok(q('[data-game-frame]').textContent?.includes('2 / 2'));
  }); } finally { globalThis.fetch = original; timers.restore(); }
});
test("race write deadline becomes unverified with no automatic POST retry", async () => {
  const original = globalThis.fetch; const timers = clock(); let writes = 0;
  globalThis.fetch = async (_url, init) => { if (init?.method !== 'POST') return Response.json({ ok: true, words, total: 2, due: 2 }); writes++; return new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); };
  try { await mounted(games('race'), async () => { await input('alpha'); await click('[data-race-submit]'); await timers.advance(12000); assert.equal(q('[data-race-feedback]').getAttribute('data-race-outcome'), 'unverified'); assert.equal(writes, 1); }); } finally { globalThis.fetch = original; timers.restore(); }
});
test("history errors retain existing rows and offer retry", async () => {
  const original = globalThis.fetch; globalThis.fetch = async () => { throw new Error('offline'); };
  try { await mounted(<RetentionHistory dict={en} initial={{ rows: [{ attemptId: 'own', level: 'A2', score: null, status: 'completed', completedAt: null, createdAt: '2026-09-30' }], page: 1, pageCount: 2, total: 2 }} />, async () => { await click('[data-retention-history-more]'); assert.ok(q('[data-retention-history-row="own"]').textContent?.includes('— / 100')); assert.ok(q('[role="alert"]')); assert.equal(q<HTMLButtonElement>('[data-retention-history-more]').disabled, false); }); } finally { globalThis.fetch = original; }
});
test("expired reading hides source even when the phase endpoint fails", async () => {
  const original = globalThis.fetch; const timers = clock(); globalThis.fetch = async () => Response.json({ error: 'retention_unavailable' }, { status: 503 });
  try { await mounted(<RetentionSession dict={en} initial={{ ...attemptMeta, phase: 'reading', serverNow: new Date().toISOString(), readEndsAt: new Date(Date.now() - 10000).toISOString(), bodyText: 'PRIVATE SOURCE', wordCount: 110 }} />, async () => { assert.equal(document.querySelector('[data-retention-source]'), null); await timers.advance(4000); assert.equal(document.body.textContent?.includes('PRIVATE SOURCE'), false); assert.ok(q('[data-retention-phase-pending]')); }); } finally { globalThis.fetch = original; timers.restore(); }
});
test("database labels include nested SQLSTATE and exclude query content", () => {
  const failure = new Error('private SQL and answer', { cause: Object.assign(new Error('secret'), { code: '42P01' }) }); assert.equal(safeErrorLabel(failure), 'Error/42P01'); assert.equal(safeErrorLabel(Object.assign(new Error('secret'), { code: 'postgres://credentials' })), 'Error');
});

test("Retention autosaves the current draft and displays the server result directly", async () => {
  const original = globalThis.fetch; const timers = clock(); let drafts = 0, submits = 0;
  const now = Date.now();
  globalThis.fetch = async (_url, init) => {
    if (init?.method === 'PATCH') { drafts++; return Response.json({ ok: true }); }
    submits++;
    return Response.json({ phase: 'completed', attemptId: 'own', level: 'A2', serverNow: new Date().toISOString(), score: 78,
      breakdown: { totals: { mainIdeasRemembered: 1, mainIdeasPossible: 1, matchedGroups: 1, totalGroups: 1, contradicted: 0 }, claims: [] } });
  };
  try {
    await mounted(<RetentionSession dict={en} initial={{ ...attemptMeta, phase: 'recall', serverNow: new Date(now).toISOString(), writeEndsAt: new Date(now + 180000).toISOString(), recallDraft: '' }} />, async () => {
      await act(async () => { const field = q<HTMLTextAreaElement>('[data-retention-answer]'); Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value')!.set!.call(field, 'I remember this idea.'); field.dispatchEvent(new Event('input', { bubbles: true })); });
      await timers.advance(1500); assert.equal(drafts, 1);
      await click('[data-retention-submit]'); assert.equal(submits, 1);
      assert.ok(q('[data-retention-result]')); assert.equal(q('[data-retention-score]').getAttribute('data-retention-score'), '78');
      assert.equal(document.querySelector('[data-retention-source]'), null);
    });
  } finally { globalThis.fetch = original; timers.restore(); }
});
