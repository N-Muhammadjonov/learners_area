/** V55 Mock Tests browser checks against SYNTHETIC `mock` region projections (the live backend is not
 * contacted). Covers: list-only page with no runner controls, catalogue, attempts with finished and
 * unfinished rows, honest '—' for a missing raw score, empty states, per-part notices, request failure
 * with retry, loading, an invalid contract, EN/UZ, day/night, desktop/tablet/mobile overflow, keyboard
 * reachability, routing (back, reload, repeat navigation), stale-response cleanup and no writes. */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {publicPolicy, fixtureSession} from './fixtures.mjs';
import en from '../js/i18n/en.js';
import uz from '../js/i18n/uz.js';

const deps = path.resolve(import.meta.dirname, '../node_modules');
if (process.platform === 'linux') {
  const tar = path.join(deps, 'al2023.tar');
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(deps, '@sparticuz/chromium/bin/al2023.tar.br'))));
  execFileSync('tar', ['xf', tar, '-C', deps]);
  process.env.LD_LIBRARY_PATH = path.join(deps, 'lib') + ':' + (process.env.LD_LIBRARY_PATH ?? '');
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !a.includes('single-process') && !a.includes('disable-web-security') && !a.includes('allow-running-insecure-content')),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const out = new URL('../docs/evidence/v55/', import.meta.url);
const shots = '/tmp/shots-mocks';
fs.mkdirSync(out, {recursive: true});
fs.mkdirSync(shots, {recursive: true});
const results = [];
async function check(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  try { await fn(); results.push({name, status: 'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name, status: 'FAIL', error: String(e.message).slice(0, 700)}); console.error('FAIL', name, String(e.message).slice(0, 700)); }
}

// ---------- synthetic `mock` region (shape mirrors js/adapters/dashboard.js mockDTO) ----------
const tests = [
  {id: 'm1', title: 'Full Mock 1', skill: 'full'},
  {id: 'm2', title: 'Full Mock 2', skill: 'full'},
  {id: 'l1', title: 'Listening only', skill: 'listening'},
];
const attempts = [
  {id: 'a1', mockTestId: 'm1', title: 'Full Mock 1', skill: 'full', startedAt: '2026-09-01T09:00:00Z', finishedAt: '2026-09-01T10:00:00Z', rawScore: 22, estimatedBand: 5.5},
  {id: 'a2', mockTestId: 'm1', title: 'Full Mock 1', skill: 'full', startedAt: '2026-09-08T09:00:00Z', finishedAt: '2026-09-08T10:00:00Z', rawScore: null, estimatedBand: 6},
  {id: 'a3', mockTestId: 'retired', title: 'Retired full mock', skill: 'full', startedAt: '2026-09-15T09:00:00Z', finishedAt: '2026-09-15T10:00:00Z', rawScore: 25, estimatedBand: 6.5},
  {id: 'a4', mockTestId: 'l1', title: null, skill: 'listening', startedAt: '2026-09-22T09:00:00Z', finishedAt: '2026-09-22T10:00:00Z', rawScore: 30, estimatedBand: 9},
  {id: 'a5', mockTestId: 'm2', title: 'Full Mock 2', skill: 'full', startedAt: '2026-09-23T09:00:00Z', finishedAt: '2026-09-23T10:00:00Z', rawScore: 28, estimatedBand: 7.5},
  {id: 'a6', mockTestId: 'm2', title: 'Full Mock 2', skill: 'full', startedAt: '2026-10-01T09:00:00Z', finishedAt: null, rawScore: null, estimatedBand: null},
];
const mockFull = {tests, attempts, finishedCount: 5, catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false};
const mockNew = {tests: [], attempts: [], finishedCount: 0, catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false};

async function fixture({locale = 'en', theme = 'day', width = 1440, mock = mockFull, delayMs = 0} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'la_locale', value: locale, url: base}, {name: 'la_theme', value: theme, url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  const state = {views: [], writes: [], mock, delayMs};
  await context.route('**/api/**', async route => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (r.method() !== 'GET' && !p.startsWith('/api/frontend/')) state.writes.push({method: r.method(), path: p});
    const reply = (status, json) => route.fulfill({status, json});
    if (p === '/api/frontend/public') return reply(200, publicPolicy);
    if (p === '/api/frontend/session') return reply(200, fixtureSession('student'));
    if (p === '/api/notifications') return reply(200, {notifications: [], unread: 0});
    if (p === '/api/frontend/view') {
      const rt = u.searchParams.get('route'), region = u.searchParams.get('region');
      state.views.push({route: rt, region});
      if (region !== 'mock') return reply(503, {error: 'unavailable'});
      if (state.delayMs) await new Promise(res => setTimeout(res, state.delayMs));
      const data = typeof state.mock === 'function' ? await state.mock(state) : state.mock;
      if (data === undefined || data?.status) return reply(data?.status ?? 503, {error: 'unavailable'});
      return reply(200, {version: 1, route: rt, region, data: {mock: data}});
    }
    return reply(503, {error: 'unavailable'});
  });
  return {context, page, state, errors, close: () => context.close()};
}
const until = async (fn, message, timeout = 6000) => {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await Promise.resolve().then(fn).catch(e => e);
    if (last === true) return;
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(message + ' (last=' + String(last) + ')');
};
const noOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'horizontal overflow');
const noErrors = f => assert.deepEqual(f.errors, [], 'page errors: ' + f.errors.join(' | '));
const open = async (f, p = '/app/mocks', usable = 'mocks') => {
  await f.page.goto(base + p);
  await f.page.locator(`[data-route-usable="${usable}"]`).waitFor();
  await until(async () => (await f.page.locator('[data-async-loading]').count()) === 0, 'still loading');
  await until(async () => f.page.evaluate(() => document.activeElement?.tagName === 'H1'), 'route did not settle on heading focus');
};
const text = (f, sel) => f.page.locator(sel).first().textContent();
const attr = (f, sel, name) => f.page.locator(sel).first().getAttribute(name);
const count = (f, sel) => f.page.locator(sel).count();
const en_ = en.mocks, uz_ = uz.mocks;
const shot = (f, name) => f.page.screenshot({path: `${shots}/${name}.png`, fullPage: true});

// ---------- states ----------
await check('route resolves to native Mock Tests with heading and the original runner note', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await text(f, '[data-route-usable="mocks"] h1'), en.nav.mocks);
    assert.equal((await text(f, '[data-mocks-runner-note]')).trim(), en_.runnerNote);
    assert.equal(await count(f, '[data-async-content="mocks"]'), 1);
    noErrors(f);
  } finally { await f.close(); }
});

await check('page has NO runner controls: no buttons, inputs, forms, start, submit or timer', async () => {
  const f = await fixture();
  try {
    await open(f);
    const route = '[data-route-usable="mocks"]';
    assert.equal(await count(f, `${route} button, ${route} input, ${route} select, ${route} textarea, ${route} form`), 0);
    assert.equal(await count(f, `${route} a`), 0);
    assert.equal(await count(f, `${route} [data-timer], ${route} [data-mock-start], ${route} [data-mock-submit]`), 0);
    assert.equal(await f.page.locator(route).getByText(/start|submit|timer/i).count(), 0);
  } finally { await f.close(); }
});

await check('catalogue lists configured tests with the skill label, no band', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await count(f, '[data-mock-test]'), 3);
    assert.match(await text(f, '[data-mock-test="l1"]'), /Listening only.*listening/);
    assert.equal(await count(f, '[data-mocks-empty]'), 0);
  } finally { await f.close(); }
});

await check('attempts: finished band/raw, honest missing raw, unfinished row, untitled fallback', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await text(f, '[data-mocks-finished]'), `5 ${en_.finished}`);
    assert.equal(await count(f, '[data-mock-attempt]'), 6);
    assert.equal(await text(f, '[data-mock-attempt="a1"] [data-mock-state]'), `Band 5.5 · 22 ${en_.raw}`);
    assert.equal(await text(f, '[data-mock-attempt="a2"] [data-mock-state]'), `Band 6 · — ${en_.raw}`);
    assert.equal(await attr(f, '[data-mock-attempt="a6"] [data-mock-state]', 'data-mock-state'), 'unfinished');
    assert.equal(await text(f, '[data-mock-attempt="a6"] [data-mock-state]'), en_.unfinished);
    assert.equal(await text(f, '[data-mock-attempt="a4"] span'), en_.untitled);
    assert.equal((await text(f, '[data-mocks-attempts]')).includes(en_.unfinishedNote), true);
  } finally { await f.close(); }
});

await check('new learner: empty catalogue and empty attempts show their own empty states, finished 0', async () => {
  const f = await fixture({mock: mockNew});
  try {
    await open(f);
    assert.equal(await text(f, '[data-mocks-empty]'), en_.noTests);
    assert.equal(await text(f, '[data-mocks-attempts-empty]'), en_.noAttempts);
    assert.equal(await text(f, '[data-mocks-finished]'), `0 ${en_.finished}`);
    assert.equal(await count(f, '[data-mock-attempt], [data-mock-test]'), 0);
  } finally { await f.close(); }
});

await check('catalogue unavailable: one notice, attempts still render', async () => {
  const f = await fixture({mock: {...mockFull, catalogueUnavailable: true}});
  try {
    await open(f);
    assert.equal(await count(f, '[data-region-failure="mocks-catalogue"]'), 1);
    assert.equal(await count(f, '[data-mock-test]'), 0);
    assert.equal(await count(f, '[data-mock-attempt]'), 6);
    assert.equal(await count(f, '[data-region-failure]'), 1);
  } finally { await f.close(); }
});

await check('attempts unavailable: notice, no finished count, catalogue still renders', async () => {
  const f = await fixture({mock: {...mockFull, attemptsUnavailable: true}});
  try {
    await open(f);
    assert.equal(await count(f, '[data-region-failure="mocks-attempts"]'), 1);
    assert.equal(await count(f, '[data-mocks-finished]'), 0);
    assert.equal(await count(f, '[data-mock-attempt]'), 0);
    assert.equal(await count(f, '[data-mock-test]'), 3);
  } finally { await f.close(); }
});

await check('attempt titles unavailable: titles notice, rows still show', async () => {
  const f = await fixture({mock: {...mockFull, attemptTitlesUnavailable: true}});
  try {
    await open(f);
    assert.equal(await count(f, '[data-region-failure="mocks-attempt-titles"]'), 1);
    assert.equal(await count(f, '[data-mock-attempt]'), 6);
  } finally { await f.close(); }
});

await check('request failure shows a region notice with retry; retry recovers the content', async () => {
  let failing = true;
  const f = await fixture({mock: async () => (failing ? {status: 503} : mockFull)});
  try {
    await open(f);
    await f.page.locator('[data-region-failure="mocks"]').waitFor();
    assert.equal(await count(f, '[data-mock-attempt]'), 0);
    failing = false;
    await f.page.locator('[data-region-retry="mocks"]').click();
    await until(async () => (await count(f, '[data-mock-attempt]')) === 6, 'retry did not render content');
    assert.equal(await count(f, '[data-region-failure]'), 0);
    noErrors(f);
  } finally { await f.close(); }
});

await check('invalid contract (protected answers field) is a failure notice, not a crash', async () => {
  const f = await fixture({mock: {...mockFull, attempts: [{...attempts[0], answers: []}]}});
  try {
    await open(f);
    await f.page.locator('[data-region-failure="mocks"]').waitFor();
    assert.equal(await count(f, '[data-mock-attempt]'), 0);
    noErrors(f);
  } finally { await f.close(); }
});

await check('loading placeholder is announced while the mock region is pending', async () => {
  const f = await fixture({delayMs: 900});
  try {
    await f.page.goto(base + '/app/mocks');
    const status = f.page.locator('[data-async-loading="mocks"][role="status"]');
    await status.waitFor();
    assert.equal(await status.getAttribute('aria-busy'), 'true');
    await until(async () => (await count(f, '[data-async-loading]')) === 0, 'loading never cleared');
    assert.equal(await count(f, '[data-mock-attempt]'), 6);
  } finally { await f.close(); }
});

// ---------- locale and theme ----------
for (const locale of ['en', 'uz']) {
  for (const theme of ['day', 'night']) {
    for (const width of [1440, 390]) {
      const d = locale === 'en' ? en_ : uz_;
      const label = `${locale}/${theme}/${width === 1440 ? 'desktop' : 'mobile'}`;
      await check(`${label}: labels follow locale, no overflow, screenshot`, async () => {
        const f = await fixture({locale, theme, width});
        try {
          await open(f);
          assert.equal(await text(f, '[data-route-usable="mocks"] h1'), (locale === 'en' ? en : uz).nav.mocks);
          assert.equal((await text(f, '[data-mocks-runner-note]')).trim(), d.runnerNote);
          assert.equal(await text(f, '[data-mock-attempt="a6"] [data-mock-state]'), d.unfinished);
          assert.equal(await text(f, '[data-mocks-finished]'), `5 ${d.finished}`);
          await noOverflow(f);
          await shot(f, `${label.replace(/\//g, '-')}`);
          noErrors(f);
        } finally { await f.close(); }
      });
    }
  }
}

await check('night theme uses the dark background, not the day one', async () => {
  const day = await fixture({theme: 'day'});
  const night = await fixture({theme: 'night'});
  try {
    await open(day); await open(night);
    const bg = f => f.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(await bg(day), await bg(night));
  } finally { await day.close(); await night.close(); }
});

await check('tablet width (820px) keeps the layout without overflow', async () => {
  const f = await fixture({width: 820});
  try { await open(f); await noOverflow(f); assert.equal(await count(f, '[data-mock-attempt]'), 6); }
  finally { await f.close(); }
});

// ---------- keyboard and accessibility ----------
await check('keyboard: no focusable runner controls inside the page body in the success state', async () => {
  const f = await fixture();
  try {
    await open(f);
    const n = await f.page.evaluate(() => document.querySelectorAll('[data-route-usable="mocks"] :is(a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"]))').length);
    assert.equal(n, 0);
  } finally { await f.close(); }
});

await check('keyboard: a failure notice retry is reachable with Tab and activates with Enter', async () => {
  let failing = true;
  const f = await fixture({mock: async () => (failing ? {status: 503} : mockFull)});
  try {
    await open(f);
    await f.page.locator('[data-region-failure="mocks"]').waitFor();
    failing = false;
    const retry = f.page.locator('[data-region-retry="mocks"]');
    await retry.focus();
    assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('data-region-retry')), 'mocks');
    await f.page.keyboard.press('Enter');
    await until(async () => (await count(f, '[data-mock-attempt]')) === 6, 'keyboard retry did not render content');
  } finally { await f.close(); }
});

await check('failure notice uses role=alert and the list regions keep their heading semantics', async () => {
  const f = await fixture({mock: {...mockFull, catalogueUnavailable: true}});
  try {
    await open(f);
    assert.equal(await attr(f, '[data-region-failure="mocks-catalogue"]', 'role'), 'alert');
    assert.equal(await count(f, '[data-mocks-catalogue] h2'), 1);
    assert.equal(await count(f, '[data-mocks-attempts] h2'), 1);
  } finally { await f.close(); }
});

// ---------- routing, repeat, reload, cleanup ----------
await check('back navigation and repeat visits render one Mock Tests page each time', async () => {
  const f = await fixture();
  try {
    await open(f, '/app/progress', 'progress');
    await f.page.goto(base + '/app/mocks');
    await until(async () => (await count(f, '[data-route-usable="mocks"]')) === 1, 'mocks did not render');
    await f.page.goBack();
    await until(async () => (await count(f, '[data-route-usable="mocks"]')) === 0, 'back did not leave mocks', 8000);
    await f.page.goForward();
    await until(async () => (await count(f, '[data-route-usable="mocks"]')) === 1, 'forward did not render mocks');
    // Forward re-renders the page shell before its region data resolves: wait for the rows (bounded), do not assume.
    await until(async () => (await count(f, '[data-mock-attempt]')) === 6, 'forward did not restore attempt rows', 8000);
  } finally { await f.close(); }
});

await check('reload re-reads the mock region exactly once per load and keeps content', async () => {
  const f = await fixture();
  try {
    await open(f);
    const before = f.state.views.filter(v => v.region === 'mock').length;
    await f.page.reload();
    await f.page.locator('[data-route-usable="mocks"]').waitFor();
    await until(async () => (await count(f, '[data-mock-attempt]')) === 6, 'reload did not render content');
    assert.equal(f.state.views.filter(v => v.region === 'mock').length - before, 1);
  } finally { await f.close(); }
});

await check('leaving mocks while the mock region is pending drops the stale response (no errors, no ghost content)', async () => {
  const f = await fixture({delayMs: 1200});
  try {
    await open(f, '/app/progress', 'progress');
    await f.page.locator('a[href="/app/mocks"]').first().click();
    await until(async () => (await count(f, '[data-async-loading="mocks"]')) === 1, 'mocks loading never showed');
    await f.page.locator('a[href="/app/progress"]').first().click();
    await f.page.locator('[data-route-usable="progress"]').waitFor();
    await new Promise(r => setTimeout(r, 1600));
    assert.equal(await count(f, '[data-mock-attempt]'), 0);
    assert.equal(await count(f, '[data-route-usable="mocks"]'), 0);
    noErrors(f);
  } finally { await f.close(); }
});

await check('the page performs no writes (no POST/PUT/PATCH/DELETE)', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.deepEqual(f.state.writes, []);
  } finally { await f.close(); }
});

const fails = results.filter(r => r.status === 'FAIL').length;
const passed = results.length - fails;
fs.writeFileSync(new URL('browser-mocks-v55-results.json', out), JSON.stringify({suite: 'browser-mocks-v55', passed, failed: fails, results}, null, 2) + '\n');
console.log(`\nbrowser-mocks-v55: ${passed} pass, ${fails} fail`);
await browser.close();
process.exit(fails ? 1 : 0);
