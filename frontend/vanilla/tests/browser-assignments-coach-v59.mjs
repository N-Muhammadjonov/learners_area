/**
 * V59 Assignments + V60 AI Coach browser checks against the BUILT app (npm run build; npm run preview).
 * The API is answered by SYNTHETIC stateful fixtures (createFakeServer). Fixture PASS is not live COMPLETE.
 * Screenshots are written to the temp directory, never to the repository.
 */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fixtureSession, publicPolicy} from './fixtures.mjs';
import * as F from './assignments-coach-fixtures.mjs';

const deps = path.resolve(import.meta.dirname, '../node_modules');
if (process.platform === 'linux') {
  const tar = path.join(deps, 'al2023.tar');
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(deps, '@sparticuz/chromium/bin/al2023.tar.br'))));
  execFileSync('tar', ['xf', tar, '-C', deps]);
  process.env.LD_LIBRARY_PATH = path.join(deps, 'lib') + ':' + (process.env.LD_LIBRARY_PATH ?? '');
}
const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter((a) => !a.includes('single-process') && !a.includes('disable-web-security') && !a.includes('allow-running-insecure-content')),
  headless: true,
});
const base = process.env.PREVIEW_URL ?? 'http://127.0.0.1:4173';
const shots = path.join(process.env.SHOT_DIR ?? os.tmpdir(), 'v59-shots');
fs.mkdirSync(shots, {recursive: true});
const results = [];
async function check(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  try { await fn(); results.push({name, status: 'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name, status: 'FAIL', error: String(e.message).slice(0, 600)}); console.error('FAIL', name, String(e.message).slice(0, 600)); }
}

const LONG = 'Learning English has changed my life because I can now read, write and speak with confidence every day.';

/** Opens a page against the built app. `override` injects one response for matching requests (e.g. 409, 401). */
async function open({locale = 'en', theme = 'day', width = 1440, role = 'student', server = F.createFakeServer(), override = null, postDelayMs = 0} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'la_locale', value: locale, url: base}, {name: 'la_theme', value: theme, url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message)));
  const api = [];
  await context.route('**/api/**', async (route) => {
    const r = route.request();
    const u = new URL(r.url());
    const p = u.pathname + u.search;
    const method = r.method();
    api.push({method, path: p});
    if (p === '/api/frontend/public') return route.fulfill({status: 200, json: publicPolicy});
    if (p === '/api/frontend/session') return route.fulfill({status: 200, json: fixtureSession(role)});
    if (u.pathname === '/api/notifications') return route.fulfill({status: 200, json: {notifications: [], unread: 0}});
    if (override && override.match(p, method)) {
      if (override.delay) await new Promise((res) => setTimeout(res, override.delay));
      return route.fulfill({status: override.status, contentType: 'application/json', body: JSON.stringify(override.body)});
    }
    if (method === 'POST' && postDelayMs) await new Promise((res) => setTimeout(res, postDelayMs));
    const body = method !== 'GET' && r.postData() ? JSON.parse(r.postData()) : undefined;
    const out = await server.handler(p, {method, body});
    return route.fulfill({status: out.status, contentType: 'application/json', body: await out.text()});
  });
  return {context, page, api, errors, server, close: () => context.close()};
}

const noOverflow = async (page, width) => {
  const sw = await page.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(sw <= width + 1, `horizontal overflow at ${width}px: scrollWidth ${sw}`);
};

await check('EN assignments: list, status and editor are the server state; keyboard-only submit records one evaluation', async () => {
  const s = await open({width: 1440});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-assignment-card]').first().waitFor();
    assert.equal(await s.page.locator('h1').textContent(), F.en.assignments.title);
    assert.equal(await s.page.locator('[data-assignment-status-label="not_started"]').textContent(), F.en.assignments.status.not_started);
    await s.page.locator('[data-assignment-response]').focus();
    await s.page.keyboard.type(LONG);
    await s.page.locator('[data-assignment-submit]').focus();
    await s.page.keyboard.press('Enter');
    await s.page.locator('[data-assignment-notice]').waitFor();
    assert.equal(s.server.state.submitCount, 1, 'one evaluation recorded by the server');
    assert.equal(s.api.filter((c) => c.method === 'POST').length, 1);
    await s.page.locator(`[data-assignment-id="${F.A1}"] [data-assignment-evaluation]`).waitFor();
    assert.equal(await s.page.locator('[data-assignment-response]').count(), 0, 'no editor after evaluation');
    await s.page.screenshot({path: path.join(shots, 'assignments-en-1440.png'), fullPage: true});
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

await check('EN coach: server weakness, evaluation history and recommendation link to the server destination', async () => {
  const server = F.createFakeServer();
  const s = await open({width: 1440, server});
  try {
    // Create the server-side history through the real Assignments page first.
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-assignment-response]').fill(LONG);
    await s.page.locator('[data-assignment-submit]').click();
    await s.page.locator('[data-assignment-notice]').waitFor();
    await s.page.goto(base + '/app/coach');
    await s.page.locator('[data-coach-weakness]').first().waitFor();
    assert.equal(await s.page.locator('[data-coach-stat="repeated"] span:nth-child(2)').textContent(), '1');
    assert.equal(await s.page.locator('[data-coach-stat="review"] span:nth-child(2)').textContent(), '1');
    assert.equal(await s.page.locator('[data-coach-weakness]').first().getAttribute('data-coach-weakness'), 'GRAMMAR_TENSE');
    assert.ok(await s.page.locator('[data-evaluation-id]').count() >= 1, 'evaluation history');
    assert.equal(await s.page.locator('[data-study-recommendation] a').first().getAttribute('href'), '/app/grammar');
    await s.page.locator('[data-study-recommendation] a').first().click();
    await s.page.waitForURL(/\/app\/grammar/);
    assert.ok(s.page.url().includes('/app/grammar'), 'recommended action opens the Grammar destination');
    await s.page.goto(base + '/app/coach');
    await s.page.locator('[data-coach-weakness]').first().waitFor();
    await s.page.screenshot({path: path.join(shots, 'coach-en-1440.png'), fullPage: true});
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

await check('live-like coach: the proposed analytics region unavailable shows an honest error, due queue still loads', async () => {
  const server = F.createFakeServer();
  server.state.failures['/api/frontend/view?route=%2Fapp%2Fcoach'] = {status: 404, error: 'not_found'};
  const s = await open({width: 1440, server});
  try {
    await s.page.goto(base + '/app/coach');
    await s.page.locator('[data-region-failure="coach"]').waitFor();
    assert.equal(await s.page.locator('[data-coach-stats]').count(), 0, 'no invented statistics');
    assert.equal(await s.page.locator('[data-region-failure="coach"]').count(), 1);
    assert.ok(await s.page.locator('[data-coach-due]').count() === 1 || await s.page.locator('[data-coach-due-empty]').count() === 1, 'due queue independent');
    assert.equal(await s.page.locator('[data-region-retry="coach"]').count(), 1, 'retry offered');
  } finally { await s.close(); }
});

await check('UZ coach on a 390px phone: Uzbek copy, no horizontal overflow', async () => {
  const s = await open({locale: 'uz', width: 390, theme: 'night'});
  try {
    await s.page.goto(base + '/app/coach');
    await s.page.locator('h1').waitFor();
    assert.equal(await s.page.locator('h1').textContent(), F.uz.coach.dashboardTitle);
    await s.page.locator('[data-coach-empty], [data-coach-stats], [data-region-failure="coach"]').first().waitFor();
    await noOverflow(s.page, 390);
    await s.page.screenshot({path: path.join(shots, 'coach-uz-390-night.png'), fullPage: true});
    assert.deepEqual(s.errors, []);
  } finally { await s.close(); }
});

await check('UZ assignments on a 768px tablet, day and night: same server state, no overflow, readable', async () => {
  for (const theme of ['day', 'night']) {
    const s = await open({locale: 'uz', width: 768, theme});
    try {
      await s.page.goto(base + '/app/assignments');
      await s.page.locator('[data-assignment-card]').first().waitFor();
      assert.equal(await s.page.locator('h1').textContent(), F.uz.assignments.title);
      await noOverflow(s.page, 768);
      await s.page.screenshot({path: path.join(shots, `assignments-uz-768-${theme}.png`), fullPage: true});
      assert.deepEqual(s.errors, []);
    } finally { await s.close(); }
  }
});

await check('a teacher opening Assignments or Coach never requests learner data', async () => {
  const s = await open({role: 'teacher', width: 1440});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-assignments-empty]').waitFor();
    await s.page.goto(base + '/app/coach');
    await s.page.locator('[data-coach-empty]').waitFor();
    const learnerCalls = s.api.filter((c) => c.path.startsWith('/api/assignments') || c.path.startsWith('/api/vocabulary/due') || c.path.includes('region=coach') || c.path.includes('region=assignmentDetails'));
    assert.deepEqual(learnerCalls, [], 'no learner endpoint called by a teacher');
  } finally { await s.close(); }
});

await check('double click on Submit reaches the server once', async () => {
  const s = await open({width: 1440, postDelayMs: 400});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-assignment-response]').fill(LONG);
    await s.page.locator('[data-assignment-submit]').dblclick();
    await s.page.locator('[data-assignment-notice]').waitFor();
    await s.page.waitForTimeout(300);
    assert.equal(s.api.filter((c) => c.method === 'POST').length, 1, 'one POST');
    assert.equal(s.server.state.submitCount, 1);
  } finally { await s.close(); }
});

await check('409 no_submission shows the stable learner message, never the raw code, and keeps the draft', async () => {
  const s = await open({width: 1440, override: {match: (p, m) => m === 'POST' && p.endsWith('/evaluate'), status: 409, body: {ok: false, error: 'no_submission'}}});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-assignment-response]').fill(LONG);
    await s.page.locator('[data-assignment-submit]').click();
    await s.page.locator('[data-assignment-error]').waitFor();
    assert.equal(await s.page.locator('[data-assignment-error]').textContent(), F.en.assignments.noSubmission);
    assert.equal((await s.page.content()).includes('no_submission'), false, 'raw code not in the page');
    assert.equal(await s.page.locator('[data-assignment-response]').inputValue(), LONG);
  } finally { await s.close(); }
});

await check('a list outage shows its own region error; retry recovers without losing the page', async () => {
  const server = F.createFakeServer();
  server.state.failures['/api/assignments'] = {status: 500, error: 'request_failed'};
  const s = await open({width: 1440, server});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.locator('[data-region-failure="assignments-list"]').waitFor();
    delete server.state.failures['/api/assignments'];
    await s.page.locator('[data-region-retry="assignments-list"]').click();
    await s.page.locator('[data-assignment-card]').first().waitFor();
    assert.equal(await s.page.locator('[data-assignment-card]').count(), 2);
  } finally { await s.close(); }
});

await check('an expired session (401) shows the unauthenticated message and no learner data', async () => {
  // A 401 ends the session through the shell (auth-failure -> logout -> /login). No learner card may remain.
  const s = await open({width: 1440, override: {match: (p, m) => m === 'GET' && p.startsWith('/api/assignments'), status: 401, body: {ok: false, error: 'unauthenticated'}}});
  try {
    await s.page.goto(base + '/app/assignments');
    await s.page.waitForURL(/\/login/, {timeout: 8000}).catch(() => {});
    await s.page.waitForTimeout(300);
    assert.equal(await s.page.locator('[data-assignment-card]').count(), 0, 'no learner assignment after 401');
    const signedOut = s.page.url().includes('/login');
    const regionError = (await s.page.locator('[data-region-failure="assignments-list"]').count()) === 1;
    assert.ok(signedOut || regionError, 'signed out or region error shown');
  } finally { await s.close(); }
});

await check('EN/UZ parity: every key used by the two pages exists in both dictionaries', async () => {
  const keys = (o, prefix = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, prefix + k + '.') : [prefix + k]));
  const en = keys(F.en.assignments).concat(keys(F.en.coach));
  const uz = keys(F.uz.assignments).concat(keys(F.uz.coach));
  assert.deepEqual(en.filter((k) => !uz.includes(k)), []);
  assert.deepEqual(uz.filter((k) => !en.includes(k)), []);
});

await browser.close();
const failed = results.filter((r) => r.status === 'FAIL');
console.log(JSON.stringify({suite: 'browser-assignments-coach-v59', fixtureOnly: true, total: results.length, failed: failed.length}));
process.exitCode = failed.length ? 1 : 0;
