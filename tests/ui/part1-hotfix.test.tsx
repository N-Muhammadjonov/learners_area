import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
import uz from "../../src/lib/i18n/uz";

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/register' });
for (const key of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Event", "MouseEvent", "KeyboardEvent"] as const) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true, self: dom.window });
const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime.js");
const { RegisterForm } = await import("../../src/components/auth/RegisterForm");
const { VocabGameView } = await import("../../src/components/vocabulary/VocabGamesPanel");
const q = <T extends Element = HTMLElement>(selector: string) => { const e = document.querySelector<T>(selector); assert.ok(e, selector); return e; };
const click = async (selector: string) => { await act(async () => q<HTMLElement>(selector).click()); };
const router = { push() {}, refresh() {}, back() {}, forward() {}, replace() {}, prefetch: async () => {} };
async function mounted(element: React.ReactNode, run: () => Promise<void>) {
  const root = createRoot(q('#root'));
  try { await act(async () => root.render(<AppRouterContext.Provider value={router}>{element}</AppRouterContext.Provider>)); await run(); }
  finally { await act(async () => root.unmount()); }
}
for (const dict of [en, uz]) {
  test(`${dict.auth.chooseGender}: empty, exclusive selection, client error and submitted value`, async () => {
    const requests: Record<string, unknown>[] = [];
    const savedFetch = globalThis.fetch;
    globalThis.fetch = async (_url, options) => { requests.push(JSON.parse(String(options?.body))); return Response.json({ accountStatus: 'PENDING' }); };
    try {
      await mounted(<RegisterForm dict={dict} telegramConfigured={false} />, async () => {
        assert.equal(document.querySelector('select'), null);
        assert.equal(document.querySelectorAll('input[name="gender"]:checked').length, 0);
        assert.equal(q('legend').textContent, dict.auth.chooseGender);
        await act(async () => q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
        assert.equal(requests.length, 0);
        assert.equal(q('#gender-error').textContent, dict.auth.errorGenderRequired);
        assert.equal(q('[role="radiogroup"]').getAttribute('aria-describedby'), 'gender-error');
        assert.equal(document.activeElement, q('[value="male"]'));
        for (const gender of ['male', 'female', 'male', 'female']) {
          await click(`[value="${gender}"]`);
          assert.equal(document.querySelectorAll('input[name="gender"]:checked').length, 1);
          assert.equal(q<HTMLInputElement>('input:checked').value, gender);
          assert.equal(document.querySelector('#gender-error'), null);
          await act(async () => q('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
          assert.equal(requests.at(-1)?.gender, gender);
        }
      });
    } finally { globalThis.fetch = savedFetch; }
  });
}
test('native required validation exposes a local gender error without a network request', async () => {
  await mounted(<RegisterForm dict={en} telegramConfigured={false} />, async () => {
    await act(async () => { q<HTMLInputElement>('[value="male"]').checkValidity(); });
    assert.equal(q('#gender-error').textContent, en.auth.errorGenderRequired);
  });
});
test('flashcard retains both physical faces across body/button/keyboard flips; audio only speaks', async () => {
  const savedFetch = globalThis.fetch;
  let writes = 0;
  let spoken = '';
  const words = [{ id: 'hotfix-word', term: 'career', definitionEn: 'A working life', translationUz: 'kasbiy faoliyat', partOfSpeech: 'noun', example: 'A long career', collocations: null }];
  globalThis.fetch = async (_url, options) => { if (options?.method === 'POST') writes++; return Response.json({ ok: true, words, total: 1, due: 1 }); };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: { cancel() {}, speak(utterance: { text: string }) { spoken = utterance.text; } } });
  Object.assign(globalThis, { SpeechSynthesisUtterance: class { constructor(public text: string) {} } });
  try {
    await mounted(<VocabGameView dict={en} gameId="cards" setKey="all" folders={[]} packs={[]} />, async () => {
      const front = q('[data-flashcard-face="definition"]');
      const back = q('[data-flashcard-face="answer"]');
      const card = q('[data-flashcard]');
      assert.ok(q('[data-flashcard-queue]'), 'responsive hiding must retain the desktop queue');
      assert.ok(q('[data-flashcard-progress]').textContent?.includes('1'));
      assert.equal(card.getAttribute('data-flipped'), 'false');
      await click('[data-flashcard-face="definition"]');
      assert.equal(card.getAttribute('data-flipped'), 'true');
      await click('[data-flashcard-pronounce]');
      assert.equal(spoken, 'career');
      assert.equal(card.getAttribute('data-flipped'), 'true');
      assert.equal(writes, 0);
      await click('[data-flashcard-flip]');
      assert.equal(card.getAttribute('data-flipped'), 'false');
      for (const key of ['Enter', ' ']) {
        await act(async () => card.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
      }
      assert.equal(card.getAttribute('data-flipped'), 'false');
      assert.equal(front, q('[data-flashcard-face="definition"]'));
      assert.equal(back, q('[data-flashcard-face="answer"]'));
      assert.equal(writes, 0);
      // Advance the existing settle/flip timers without making this DOM test
      // depend on wall-clock animation timing (measured separately in browser).
      const savedTimeout = window.setTimeout;
      const callbacks: (() => void)[] = [];
      window.setTimeout = ((callback: () => void) => { callbacks.push(callback); return callbacks.length; }) as typeof window.setTimeout;
      try {
        await click('[data-flashcard-flip]');
        await click('[data-mark="notYet"]');
        assert.equal(writes, 1);
        await act(async () => callbacks.shift()!());
        assert.equal(card.getAttribute('data-flipped'), 'false');
        assert.equal(front, q('[data-flashcard-face="definition"]'));
        await act(async () => callbacks.shift()!());
        const complete = q('[data-flashcard-complete]');
        assert.ok(complete.textContent?.includes(en.vocabulary.games.passDone));
        const review = [...complete.querySelectorAll('button')].find((button) => button.textContent === en.vocabulary.games.reviewAll);
        assert.ok(review);
        await act(async () => review.click());
        assert.equal(q('[data-flashcard]').getAttribute('data-flipped'), 'false');
        assert.ok(q('[data-flashcard-progress]').textContent?.includes('2'));
      } finally { window.setTimeout = savedTimeout; }
    });
  } finally { globalThis.fetch = savedFetch; }
});
