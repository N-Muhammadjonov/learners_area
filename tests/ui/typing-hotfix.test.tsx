import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import en from "../../src/lib/i18n/en";
const dom = new JSDOM('<div id="root"></div>', {url: "http://localhost/writing"});
for (const name of ["window", "document", "navigator", "HTMLElement", "HTMLInputElement", "Element", "Node", "Event", "KeyboardEvent"] as const) Object.defineProperty(globalThis, name, {value: dom.window[name], configurable: true});
Object.assign(globalThis, {IS_REACT_ACT_ENVIRONMENT: true, requestAnimationFrame: (fn: FrameRequestCallback) => {fn(0);return 0;}, cancelAnimationFrame() {}, ResizeObserver: class {observe() {} disconnect() {}}});
Object.defineProperty(dom.window.HTMLElement.prototype, "offsetTop", {get() {return Math.floor(Array.from(this.parentElement?.children ?? []).indexOf(this) / 2) * 48;}});
const React = await import("react");Object.assign(globalThis, {React});
const {act} = React;const {createRoot} = await import("react-dom/client");
const {TypingTrainer} = await import("../../src/components/writing/TypingTrainer");
async function mount(run: (input: HTMLInputElement) => Promise<void>, finishes: unknown[] = []) {
  document.body.innerHTML = '<div id="root"></div>';
  const root = createRoot(document.querySelector('#root')!);const original = fetch;
  globalThis.fetch = async (url, options) => {
    if (String(url).endsWith('/finish')) {
      finishes.push(JSON.parse(String(options?.body)));
      return new Response(JSON.stringify({error: 'conflict'}), {status: 409});
    }
    return new Response(JSON.stringify(String(url).endsWith('/prepare') ? {token: "prepared", text: {id: "text", title: "QA", words: ["one", "two", "three", "four", "five", "six", "seven", "eight"], wordCount: 8, difficulty: null, topic: null}} : {runToken: "signed"}), {status: 200});
  };
  try {
    await act(async () => root.render(<TypingTrainer dict={en} initialHistory={[]} initialSummary={{count: 0, bestWpm: null, bestAccuracy: null}}/>));
    await run(document.querySelector('[data-typing-input]')!);
  } finally {await act(async () => root.unmount());globalThis.fetch = original;}
}
async function type(input: HTMLInputElement, value: string) {
  await act(async () => {Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value')!.set!.call(input, value);input.dispatchEvent(new Event('input', {bubbles: true}));});
}
test('Backspace at an incorrect committed word reopens it without deleting its last letter', async () => mount(async input => {
  await type(input, 'onx ');assert.equal(input.value, '');
  const key = new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true, cancelable: true});
  await act(async () => {input.dispatchEvent(key);});
  assert.equal(key.defaultPrevented, true);assert.equal(input.value, 'onx');
  await type(input, 'on');assert.equal(input.value, 'on');
}));
test('Stable text rows keep active line in the middle and advance one row at a time', async () => mount(async input => {
  const stack = document.querySelector<HTMLElement>('.typing-stack')!;
  const rows = Array.from(stack.children);
  await type(input, 'one two ');
  assert.match(stack.style.transform, /\* -0/);
  assert.equal(stack.children[0], rows[0]);
  await type(input, 'three four ');
  assert.match(stack.style.transform, /\* -1/);
  assert.equal(stack.children[1], rows[1]);
  await type(input, 'five six ');
  assert.match(stack.style.transform, /\* -2/);
  assert.equal(stack.children[2], rows[2]);
}));

test('The finish request preserves corrected mistakes and consumes Backspace exactly once', async () => {
  const finishes: unknown[] = [];
  await mount(async input => {
    await type(input, 'onx');
    const key = new KeyboardEvent('keydown', {key: 'Backspace', bubbles: true, cancelable: true});
    await act(async () => {input.dispatchEvent(key);});
    assert.equal(key.defaultPrevented, true);
    assert.equal(input.value, 'on');
    await type(input, 'one two three four five six seven eight');
    const payload = finishes[0] as {typedWords: string[]; keystrokes: string[]};
    assert.deepEqual(payload.typedWords, ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']);
    assert.deepEqual(payload.keystrokes.slice(0, 5), ['o', 'n', 'x', '\b', 'e']);
    assert.equal(finishes.length, 1);
  }, finishes);
});
