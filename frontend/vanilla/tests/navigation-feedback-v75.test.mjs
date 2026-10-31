/** Instant-feedback and retention-budget contracts (navigation only, no authority). */
import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {workspaceTransition} from '../modules/shell/transition.js';
import {createRouteReuse, retentionProfile} from '../js/route-reuse.js';
import dict from '../js/i18n/en.js';

function domWithShell() {
  const dom = new JSDOM('<div id="root"></div>', {url: 'https://fixture.invalid/app/reading/lessons', pretendToBeVisual: true});
  return dom;
}

test('a slow flight shows the data-free destination frame after the grace and a commit clears it', async () => {
  const dom = domWithShell();
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  const signal = new dom.window.AbortController();
  const transition = workspaceTransition({dict, signal: signal.signal, refresh() {}});
  try {
    const root = document.querySelector('#root');
    root.append(transition.node);
    const outgoing = document.createElement('section');
    outgoing.textContent = 'settled outgoing view';
    transition.content.append(outgoing);
    const flight = new dom.window.AbortController();
    transition.begin(new URL('https://fixture.invalid/app/grammar/lessons'), flight.signal);
    // A settled outgoing view is kept while the flight is still short.
    assert.equal(transition.node.querySelector('[data-entry-frame]'), null);
    assert.equal(transition.node.querySelector('[data-outgoing-workspace]').hidden, false);
    assert.equal(transition.content.inert, true);
    assert.equal(transition.node.getAttribute('aria-busy'), 'true');
    await new Promise(resolve => setTimeout(resolve, 90));
    const frame = transition.node.querySelector('[data-entry-frame]');
    assert(frame, 'the destination identity frame appears once the flight outlives the grace');
    assert.equal(frame.getAttribute('data-private-loading-boundary'), 'true');
    assert.equal(frame.getAttribute('data-section-entry-frame'), 'grammar');
    assert.equal(frame.querySelector('[data-entry-region]').getAttribute('aria-hidden'), 'true');
    assert.equal(transition.node.querySelector('[data-outgoing-workspace]').hidden, true);
    assert(!frame.textContent.includes('settled outgoing view'), 'the frame carries no outgoing private content');
    // The real commit clears the frame and restores the outgoing wrapper.
    transition.end();
    assert.equal(transition.node.querySelector('[data-entry-frame]'), null);
    assert.equal(transition.node.querySelector('[data-outgoing-workspace]').hidden, false);
    assert.equal(transition.content.inert, false);
    assert.equal(transition.node.getAttribute('aria-busy'), 'false');
  } finally {
    signal.abort();
    dom.window.close();
  }
});

test('a fast flight is aborted before the grace and never flashes a skeleton', async () => {
  const dom = domWithShell();
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  const signal = new dom.window.AbortController();
  const transition = workspaceTransition({dict, signal: signal.signal, refresh() {}});
  try {
    document.querySelector('#root').append(transition.node);
    transition.content.append(document.createElement('section'));
    const flight = new dom.window.AbortController();
    transition.begin(new URL('https://fixture.invalid/app/writing'), flight.signal);
    flight.abort();
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(transition.node.querySelector('[data-entry-frame]'), null);
    assert.equal(transition.node.getAttribute('aria-busy'), 'false');
  } finally {
    signal.abort();
    dom.window.close();
  }
});

test('repeated superseded flights leave no frame, notice or busy state behind', async () => {
  const dom = domWithShell();
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  const signal = new dom.window.AbortController();
  const transition = workspaceTransition({dict, signal: signal.signal, refresh() {}});
  try {
    document.querySelector('#root').append(transition.node);
    transition.content.append(document.createElement('section'));
    for (let i = 0; i < 5; i += 1) {
      const flight = new dom.window.AbortController();
      transition.begin(new URL('https://fixture.invalid/app/progress'), flight.signal);
      await new Promise(resolve => setTimeout(resolve, i % 2 ? 60 : 0));
      flight.abort();
    }
    await new Promise(resolve => setTimeout(resolve, 90));
    assert.equal(transition.node.querySelectorAll('[data-entry-frame]').length, 0);
    assert.equal(transition.node.querySelectorAll('[data-navigation-pending],[data-workspace-loading]').length, 0);
    assert.equal(transition.node.getAttribute('aria-busy'), 'false');
    assert.equal(transition.node.querySelector('[data-outgoing-workspace]').hidden, false);
    assert.equal(transition.content.inert, false);
  } finally {
    signal.abort();
    dom.window.close();
  }
});

test('retention budgets follow device capability and stay inside their stated bounds', () => {
  const desktop = retentionProfile({navigator: {deviceMemory: 8}, innerWidth: 1440});
  const tablet = retentionProfile({navigator: {deviceMemory: 8}, innerWidth: 820});
  const mobile = retentionProfile({navigator: {deviceMemory: 6}, innerWidth: 390});
  const low = retentionProfile({navigator: {deviceMemory: 1}, innerWidth: 1440});
  const coarse = retentionProfile({navigator: {deviceMemory: 8}, innerWidth: 1440, matchMedia: () => ({matches: true})});
  assert.deepEqual([desktop.name, desktop.limit, desktop.maxNodes, desktop.ttl], ['desktop', 4, 8000, 60000]);
  assert.deepEqual([tablet.name, tablet.limit, tablet.maxNodes, tablet.ttl], ['tablet', 4, 7000, 30000]);
  assert.deepEqual([mobile.name, mobile.limit, mobile.maxNodes, mobile.ttl], ['mobile', 3, 6000, 25000]);
  assert.deepEqual([low.name, low.limit, low.maxNodes, low.ttl], ['low-memory', 2, 4000, 20000]);
  assert.equal(coarse.name, 'mobile');
  // Nothing may outgrow the measured desktop budget, and weaker devices never keep more than stronger ones.
  for (const profile of [desktop, tablet, mobile, low]) {
    assert(profile.limit >= 2 && profile.limit <= 4);
    assert(profile.ttl >= 20000 && profile.ttl <= 60000);
    assert(profile.maxNodes >= 4000 && profile.maxNodes <= 8000);
  }
  assert(desktop.limit >= tablet.limit && tablet.limit >= mobile.limit && mobile.limit >= low.limit);
  assert(desktop.maxNodes >= tablet.maxNodes && tablet.maxNodes >= mobile.maxNodes && mobile.maxNodes >= low.maxNodes);
  assert.deepEqual(retentionProfile(undefined), {name: 'desktop', limit: 4, maxNodes: 8000, ttl: 60000});
});

test('an explicit retention limit still wins over the device profile', () => {
  const reuse = createRouteReuse({window: {navigator: {deviceMemory: 8}, innerWidth: 1440, matchMedia: () => ({matches: false})}, limit: 2, maxNodes: 500, ttl: 1000});
  try {
    assert.deepEqual(reuse.profile, {name: 'desktop', limit: 2, maxNodes: 500, ttl: 1000});
    assert.equal(reuse.size, 0);
  } finally {
    reuse.destroy();
  }
});
