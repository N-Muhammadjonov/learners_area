import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {bookIndex} from '../modules/grammar/book-index.js';
import {mountBookCatalog, mountBookDetail} from '../modules/grammar/book.js';
import {renderInteractiveBook} from '../modules/grammar/book-runtime.js';

function setup(path = '/app/grammar/lessons') {
  const dom = new JSDOM('<!doctype html><html data-theme="night"><head></head><body><main></main></body></html>', {
    url: 'https://example.test' + path,
  });
  for (const name of ['window', 'document', 'Node', 'navigator', 'localStorage', 'Option']) {
    globalThis[name] = dom.window[name];
  }
  dom.window.scrollTo = () => {};
  dom.window.HTMLMediaElement.prototype.pause = () => {};
  dom.window.HTMLMediaElement.prototype.load = () => {};
  const controller = new dom.window.AbortController();
  const context = {
    root: document.querySelector('main'),
    url: new URL(window.location.href),
    locale: 'uz',
    session: {user: {id: 'grammar-book-test'}},
    signal: controller.signal,
  };
  return {dom, controller, context};
}
test('the book has prominent search, four individually styled level buttons, and intact content filters', () => {
  const {dom, controller, context} = setup();
  try {
    mountBookCatalog(context, context.root);
    const input = context.root.querySelector('[data-grammar-book-search]');
    assert.equal(input.getAttribute('aria-label'), 'Qidiruv');
    assert.ok(context.root.querySelector('.grammar-book-search-box'));
    assert.equal(context.root.querySelectorAll('[data-grammar-book-level]').length, 4);
    const b1 = context.root.querySelector('[data-grammar-book-level="B1"]');
    const b2 = context.root.querySelector('[data-grammar-book-level="B2"]');
    assert.ok(b1.classList.contains('btn-primary'));
    b2.click();
    assert.ok(b2.classList.contains('btn-primary'));
    assert.ok(b1.classList.contains('btn-secondary'));
    assert.equal(context.root.querySelectorAll('[data-grammar-book-unit]:not([hidden])').length, 13);
    input.value = 'not-a-grammar-unit';
    input.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    assert.equal(context.root.querySelectorAll('[data-grammar-book-unit]:not([hidden])').length, 0);
    assert.equal(context.root.querySelector('.grammar-book-empty').hidden, false);
    assert.equal(bookIndex.length, 80);
  } finally {
    controller.abort();
    dom.window.close();
  }
});
test('the book detail uses the same BackLink component as the other modules', async () => {
  const {dom, controller, context} = setup('?book=a0-1');
  try {
    await mountBookDetail(context, context.root, 'a0-1');
    const back = context.root.querySelector('[data-grammar-book-back]');
    assert.ok(back);
    assert.equal(back.getAttribute('href'), '/app/grammar/lessons');
    assert.equal(back.textContent.replace(/\s+/g, ''), '←Back');
    assert.ok(context.root.querySelector('[data-grammar-book-detail]'));
  } finally {
    controller.abort();
    dom.window.close();
  }
});
test('voice capture can be removed and re-recorded without leaving dangling audio URLs', async () => {
  const {dom, controller} = setup('?book=a0-1');
  const originalCreate = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  let serial = 0;
  let stoppedTracks = 0;
  URL.createObjectURL = () => 'blob:grammar-test-' + ++serial;
  URL.revokeObjectURL = url => revoked.push(url);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {getUserMedia: async () => ({getTracks: () => [{stop: () => {stoppedTracks++;}}]})},
  });
  class MockRecorder {
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'audio/webm';
    }
    start() { this.state = 'recording'; }
    stop() {
      this.state = 'inactive';
      this.ondataavailable?.({data: new Blob(['voice'], {type: this.mimeType})});
      this.onstop?.();
    }
  }
  globalThis.MediaRecorder = MockRecorder;
  window.MediaRecorder = MockRecorder;
  try {
    const {default: units} = await import('../modules/grammar/book-content-b1.js');
    const unit = units.find(item => item.id === 'a0-1');
    assert.ok(unit);
    const shadow = document.createElement('div').attachShadow({mode: 'open'});
    const nav = document.createElement('nav');
    nav.id = 'nav';
    const body = document.createElement('div');
    body.id = 'units';
    shadow.append(nav, body);
    renderInteractiveBook(shadow, [unit], controller.signal, 'grammar-recording-test');
    shadow.getElementById('u-a0-1')._sel(3);
    const item = shadow.querySelector('.aud').closest('.item');
    const record = item.querySelector('.btn:not(.ghost)');
    const remove = item.querySelector('.aud-delete');
    assert.equal(remove.hidden, true);
    record.click();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(record.textContent, /To‘xtatish/);
    record.click();
    assert.equal(remove.hidden, false);
    assert.ok(item.querySelector('audio'));
    assert.equal(serial, 1);
    remove.click();
    assert.equal(remove.hidden, true);
    assert.equal(item.querySelector('audio'), null);
    assert.deepEqual(revoked, ['blob:grammar-test-1']);
    record.click();
    await new Promise(resolve => setImmediate(resolve));
    record.click();
    assert.equal(serial, 2);
    assert.equal(remove.hidden, false);
    controller.abort();
    assert.ok(revoked.includes('blob:grammar-test-2'));
    assert.ok(stoppedTracks >= 2);
  } finally {
    controller.abort();
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    dom.window.close();
  }
});
