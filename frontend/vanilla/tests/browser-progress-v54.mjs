/** V54 My Progress browser checks against SYNTHETIC per-region projections (the live backend is not
 * contacted). Covers: new learner, Reading/Listening zero vs no score, Writing with/without evaluation,
 * Speaking without a score, full mocks and a removed historical mock, empty and mixed vocabulary,
 * retention, heatmap levels, single and total failures with retry, partial unavailable regions,
 * EN/UZ, light/dark, desktop/tablet/mobile overflow, routing, back, reload, stale-response isolation,
 * keyboard/accessibility semantics and cleanup. */
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
const out = new URL('../docs/evidence/v54/', import.meta.url);
fs.mkdirSync(out, {recursive: true});
const results = [];
async function check(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  try { await fn(); results.push({name, status: 'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name, status: 'FAIL', error: String(e.message).slice(0, 700)}); console.error('FAIL', name, String(e.message).slice(0, 700)); }
}

// ---------- synthetic projections (shapes mirror js/adapters/progress-v54.js) ----------
const dayStr = n => new Date(Date.UTC(2026, 6, 6) + n * 864e5).toISOString().slice(0, 10);
const weekStarts = n => Array.from({length: n}, (_, i) => new Date(Date.UTC(2026, 7, 31) + i * 7 * 864e5).toISOString().slice(0, 10));
const series = (values) => weekStarts(values.length).map((weekStart, i) => ({weekStart, value: values[i], count: values[i] === null ? 0 : 2}));
const heatmap = () => Array.from({length: 12}, (_, w) => Array.from({length: 7}, (_, d) => ({day: dayStr(w * 7 + d), count: (w * 7 + d) % 8})));
const emptyHeatmap = () => Array.from({length: 12}, (_, w) => Array.from({length: 7}, (_, d) => ({day: dayStr(w * 7 + d), count: 0})));
const LEVELS = ['A2', 'B1', 'B2', 'C1', 'C2'];
const retentionEmpty = () => LEVELS.map(level => ({level, attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null}));
const byStateFull = {new: 3, learning: 2, review: 1, known: 1, mastered: 2, activated: 1};
const byStateZero = {new: 0, learning: 0, review: 0, known: 0, mastered: 0, activated: 0};

const summaryFull = {
  reading: {attempts: 5, submitted: 4, score: 30, total: 40, accuracy: 75},
  listening: {attempts: 3, submitted: 3, score: 0, total: 15, accuracy: 0},
  speaking: {attempts: 2, submitted: 2, transcribed: 1},
  writing: {submissions: 3, latestBand: 6.5, latestEvaluationAt: '2026-10-01T09:00:00Z', lastSubmittedAt: '2026-10-02T09:00:00Z', evaluationUnavailable: false},
  vocabulary: {total: 14, due: 2, byState: byStateFull},
  lessons: {total: 12, open: 4, inProgress: 1, completed: 5},
  assignments: {total: 3, open: 1, completed: 2},
  mocks: {attempts: 6, finished: 5, bestBand: 7.5},
  unavailableRegions: [],
};
const summaryNew = {
  reading: {attempts: 0, submitted: 0, score: 0, total: 0, accuracy: null},
  listening: {attempts: 0, submitted: 0, score: 0, total: 0, accuracy: null},
  speaking: {attempts: 0, submitted: 0, transcribed: 0},
  writing: {submissions: 0, latestBand: null, latestEvaluationAt: null, lastSubmittedAt: null, evaluationUnavailable: false},
  vocabulary: {total: 0, due: 0, byState: byStateZero},
  lessons: {total: 0, open: 0, inProgress: 0, completed: 0},
  assignments: {total: 0, open: 0, completed: 0},
  mocks: {attempts: 0, finished: 0, bestBand: null},
  unavailableRegions: [],
};
const trendsFull = {
  reading: series([50, null, 70, 80, null, 75, 90, 85]),
  listening: series([null, null, null, null, null, null, null, 0]),
  writing: series([null, null, 6, null, 6.5, null, null, null]),
  speaking: series([null, null, null, null, null, null, null, null]),
  heatmap: heatmap(),
  retention: [
    {level: 'A2', attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null},
    {level: 'B1', attempts: 4, textsCompleted: 2, best: 80, recent: [60, 70, 75, 80], average: 71, change: 20},
    {level: 'B2', attempts: 1, textsCompleted: 1, best: 50, recent: [50], average: 50, change: null},
    {level: 'C1', attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null},
    {level: 'C2', attempts: 0, textsCompleted: 0, best: null, recent: [], average: null, change: null},
  ],
};
const trendsNew = {
  reading: series([null, null, null, null, null, null, null, null]),
  listening: series([null, null, null, null, null, null, null, null]),
  writing: series([null, null, null, null, null, null, null, null]),
  speaking: series([null, null, null, null, null, null, null, null]),
  heatmap: emptyHeatmap(),
  retention: retentionEmpty(),
};
const mocksFull = {
  tests: [
    {id: 'm1', title: 'Full Mock 1', skill: 'full'},
    {id: 'm2', title: 'Full Mock 2', skill: 'full'},
    {id: 'm3', title: 'Full Mock 3', skill: 'full'},
    {id: 'l1', title: 'Listening only', skill: 'listening'},
  ],
  attempts: [
    {id: 'a1', mockTestId: 'm1', title: 'Full Mock 1', skill: 'full', finishedAt: '2026-09-01T10:00:00Z', estimatedBand: 5.5},
    {id: 'a2', mockTestId: 'm1', title: 'Full Mock 1', skill: 'full', finishedAt: '2026-09-08T10:00:00Z', estimatedBand: 6},
    {id: 'a3', mockTestId: 'retired-mock', title: 'Retired full mock', skill: 'full', finishedAt: '2026-09-15T10:00:00Z', estimatedBand: 6.5},
    {id: 'a4', mockTestId: 'm2', title: 'Full Mock 2', skill: 'full', finishedAt: '2026-09-22T10:00:00Z', estimatedBand: 7.5},
    {id: 'a5', mockTestId: 'l1', title: 'Listening only', skill: 'listening', finishedAt: '2026-09-23T10:00:00Z', estimatedBand: 9},
    {id: 'a6', mockTestId: 'm3', title: 'Full Mock 3', skill: 'full', finishedAt: null, estimatedBand: null},
  ],
  catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false,
};
const mocksNew = {tests: mocksFull.tests, attempts: [], catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false};
const DEFAULTS = {progressSummary: summaryFull, progressStreak: {streak: 4}, progressTrends: trendsFull, progressMocks: mocksFull};

async function fixture({locale = 'en', theme = 'day', width = 1440, regions = {}, navigate = true} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'la_locale', value: locale, url: base}, {name: 'la_theme', value: theme, url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  const state = {views: [], writes: []};
  await context.route('**/api/**', async route => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    if (r.method() !== 'GET' && !p.startsWith('/api/frontend/')) state.writes.push({method: r.method(), path: p});
    const reply = (status, json) => route.fulfill({status, json});
    if (p === '/api/frontend/public') return reply(200, publicPolicy);
    if (p === '/api/frontend/session') return reply(200, fixtureSession('student'));
    if (p === '/api/notifications') return reply(200, {notifications: [], unread: 0});
    if (p === '/api/frontend/view') {
      const rt = u.searchParams.get('route'), region = u.searchParams.get('region');
      state.views.push({route: rt, region, method: r.method()});
      const spec = regions[region] ?? DEFAULTS[region];
      const data = typeof spec === 'function' ? await spec(state, region) : spec;
      if (data === undefined || data?.status) return reply(data?.status ?? 503, {error: 'unavailable'});
      return reply(200, {version: 1, route: rt, region, data: {[region]: data}});
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
const open = async (f, path = '/app/progress') => {
  await f.page.goto(base + path);
  await f.page.locator('[data-route-usable="progress"]').waitFor();
  await until(async () => (await f.page.locator('[data-async-loading]').count()) === 0, 'still loading');
  // The router focuses the page heading when the route commits; wait for that so later focus is ours.
  await until(async () => f.page.evaluate(() => document.activeElement?.tagName === 'H1'), 'route did not settle on heading focus');
};
const text = (f, sel) => f.page.locator(sel).first().textContent();
const attr = (f, sel, name) => f.page.locator(sel).first().getAttribute(name);

// ---------- routing, shell and states ----------
await check('route resolves to native My Progress with heading, subtitle and Reports link', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await text(f, 'h1'), en.nav.progress);
    assert.equal(await attr(f, '[data-progress-reports-link]', 'href'), '/app/reports');
    assert.equal(await text(f, '[data-progress-reports-link]'), en.reporter.openFromProgress);
    assert.ok(f.state.views.some(v => v.region === 'progressSummary' && v.route === '/app/progress'));
    assert.ok(f.state.views.every(v => v.method === 'GET'));
    assert.deepEqual(f.state.writes, []);
    noErrors(f);
  } finally { await f.close(); }
});

await check('skill cards: attempts, accuracy, zero vs no score, submitted counts and links', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await attr(f, '[data-progress-module="reading"]', 'data-progress-attempts'), '5');
    assert.equal(await attr(f, '[data-progress-module="reading"] [data-progress-value]', 'data-progress-value'), '75%');
    assert.equal(await attr(f, '[data-progress-module="listening"] [data-progress-value]', 'data-progress-value'), '0%');
    assert.match(await text(f, '[data-progress-module="listening"]'), /3 attempts|3 /);
    assert.equal(await attr(f, '[data-progress-module="reading"]', 'href'), '/app/reading');
    assert.equal(await attr(f, '[data-progress-module="writing"]', 'href'), '/app/writing');
    assert.equal(await attr(f, '[data-progress-module="speaking"]', 'href'), '/app/speaking');
  } finally { await f.close(); }
});

await check('new learner: no attempts, no score, zero vocabulary and empty trend states', async () => {
  const f = await fixture({regions: {progressSummary: summaryNew, progressStreak: {streak: 0}, progressTrends: trendsNew, progressMocks: mocksNew}});
  try {
    await open(f);
    assert.equal(await attr(f, '[data-progress-module="reading"]', 'data-progress-attempts'), '0');
    assert.equal(await attr(f, '[data-progress-module="reading"] [data-progress-value]', 'data-progress-value'), 'none');
    assert.equal(await text(f, '[data-progress-module="reading"] [data-progress-value]'), en.progress.noScore);
    assert.equal(await f.page.locator('[data-trend-empty]').count(), 4);
    assert.equal(await f.page.locator('[data-trend-unavailable]').count(), 0);
    assert.equal(await f.page.locator('[data-heat="0"]').count(), 84);
    assert.equal(await f.page.locator('[data-retention-trend-level]').count(), 5);
    assert.equal(await f.page.locator('[data-vocab-state]').count(), 6);
    assert.match(await text(f, '[data-mock-band-panel]'), /0 \/ 3|No graded full mock results yet\./);
    assert.equal(await attr(f, '[data-mock-band-panel]', 'data-latest-band'), 'none');
    noErrors(f);
  } finally { await f.close(); }
});

await check('Writing: latest estimate shown, and "no estimate yet" without evaluation', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await attr(f, '[data-progress-module="writing"] [data-progress-value]', 'data-progress-value'), '6.5');
    assert.equal(await attr(f, '[data-progress-module="writing"]', 'data-progress-attempts'), '3');
  } finally { await f.close(); }
  const g = await fixture({regions: {progressSummary: {...summaryFull, writing: {...summaryFull.writing, latestBand: null}}}});
  try {
    await open(g);
    assert.equal(await attr(g, '[data-progress-module="writing"] [data-progress-value]', 'data-progress-value'), 'none');
    assert.match(await text(g, '[data-progress-module="writing"]'), new RegExp(en.progress.noEstimateYet));
  } finally { await g.close(); }
});

await check('Writing with evaluation unavailable shows an unknown state, never a band', async () => {
  const f = await fixture({regions: {progressSummary: {...summaryFull, writing: {...summaryFull.writing, latestBand: 6.5, evaluationUnavailable: true}}}});
  try {
    await open(f);
    assert.equal(await attr(f, '[data-progress-module="writing"] [data-progress-value]', 'data-progress-value'), 'unavailable');
    assert.equal(await text(f, '[data-progress-module="writing"] [data-progress-value]'), '—');
    assert.match(await text(f, '[data-progress-module="writing"]'), new RegExp(en.errors.unknown));
  } finally { await f.close(); }
});

await check('Speaking never shows a score: with and without transcript', async () => {
  for (const transcribed of [1, 0]) {
    const f = await fixture({regions: {progressSummary: {...summaryFull, speaking: {attempts: 2, submitted: 2, transcribed}}}});
    try {
      await open(f);
      const card = f.page.locator('[data-progress-module="speaking"]');
      assert.equal(await attr(f, '[data-progress-module="speaking"] [data-progress-value]', 'data-progress-value'), 'none');
      assert.equal(await text(f, '[data-progress-module="speaking"] [data-progress-value]'), en.progress.noScore);
      assert.match(await card.textContent(), new RegExp(`${transcribed} ${en.progress.transcribed}`));
      assert.doesNotMatch(await card.textContent(), /\d%|band/i);
    } finally { await f.close(); }
  }
});

await check('mock overview: completed full mocks, trend, removed mock kept as history, table', async () => {
  const f = await fixture();
  try {
    await open(f);
    const panel = f.page.locator('[data-mock-band-panel]');
    assert.equal(await panel.getAttribute('data-latest-band'), '7.5');
    assert.equal(await panel.getAttribute('data-completed-mocks'), '2');
    assert.equal(await panel.getAttribute('data-total-mocks'), '3');
    assert.equal(await f.page.locator('[data-mock-point]').count(), 4);
    assert.equal(await f.page.locator('[data-mock-table] tbody tr').count(), 4);
    assert.match(await panel.textContent(), /Retired full mock/);
    assert.doesNotMatch(await panel.textContent(), /Listening only/);
    assert.equal(await f.page.locator('[data-mock-stat]').nth(0).textContent(), '4');
    assert.equal(await f.page.locator('[data-mock-stat]').nth(1).textContent(), '7.5');
    assert.equal(await f.page.locator('[data-mock-stat]').nth(4).textContent(), '+2.0');
    assert.equal(await f.page.locator('svg[role="img"]').count(), 1);
    assert.equal(await panel.locator('progress').count(), 2);
    assert.equal(await f.page.locator('[data-mock-band-panel] label progress').first().getAttribute('max'), '3');
  } finally { await f.close(); }
});

await check('mock overview with no finished mocks: empty note, zero of catalogue, no fake band', async () => {
  const f = await fixture({regions: {progressMocks: mocksNew}});
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-mock-point]').count(), 0);
    assert.equal(await f.page.locator('[data-mock-table]').count(), 0);
    assert.equal(await f.page.locator('[data-mock-stat]').nth(1).textContent(), '—');
    assert.equal(await f.page.locator('[data-mock-stat]').nth(4).textContent(), '—');
    assert.match(await f.page.locator('[data-mock-band-panel]').textContent(), /No graded full mock results yet\./);
  } finally { await f.close(); }
});

await check('mock attempts unavailable shows a notice with retry, not a stale chart', async () => {
  const f = await fixture({regions: {progressMocks: {...mocksFull, attemptsUnavailable: true}}});
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-mock-band-panel]').count(), 0);
    assert.equal(await f.page.locator('[data-region-failure="mock-overview"]').count(), 1);
    assert.equal(await f.page.locator('[data-region-retry="mock-overview"]').textContent(), 'Retry');
  } finally { await f.close(); }
});

await check('vocabulary: mixed distribution shows counts; empty library shows real zeros', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-vocab-state="new"]').textContent(), `${en.progress.states.new}: 3`);
    assert.equal(await f.page.locator('[data-vocab-state="mastered"]').textContent(), `${en.progress.states.mastered}: 2`);
    assert.equal(await f.page.locator('[data-vocab-distribution] span[style]').count(), 6);
  } finally { await f.close(); }
  const g = await fixture({regions: {progressSummary: summaryNew}});
  try {
    await open(g);
    assert.equal(await g.page.locator('[data-vocab-distribution] span[style]').count(), 0);
    assert.equal(await g.page.locator('[data-vocab-state="known"]').textContent(), `${en.progress.states.known}: 0`);
    assert.equal(await g.page.locator('[data-vocabulary-states-unavailable]').count(), 0);
  } finally { await g.close(); }
});

await check('course: lesson, task and mock figures, roadmap link and unavailable dashes', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await attr(f, '[data-lessons-completed]', 'data-lessons-completed'), '5');
    assert.equal(await attr(f, '[data-assignments-open]', 'data-assignments-open'), '1');
    // Original source (app/(shell)/progress/page.tsx): the course card button links to /app, labelled courseRoadmap.open.
    const roadmap = f.page.locator('[data-progress-course] a[href="/app"]');
    assert.equal(await roadmap.count(), 1);
    assert.equal((await roadmap.textContent()).trim(), `${en.courseRoadmap.open} →`);
    assert.equal(await f.page.locator('[data-progress-course] a[href="/app/courses/ielts"]').count(), 0);
  } finally { await f.close(); }
  const g = await fixture({regions: {progressSummary: {...summaryFull, lessons: {total: null, open: null, inProgress: null, completed: null}, assignments: null, mocks: null}}});
  try {
    await open(g);
    assert.equal(await g.page.locator('[data-lessons-completed]').count(), 0);
    assert.equal(await g.page.locator('[data-assignments-open]').count(), 0);
    assert.match(await g.page.locator('[data-progress-course]').textContent(), /—/);
  } finally { await g.close(); }
});

await check('trends: weekly charts keep empty weeks as no value and render tables', async () => {
  const f = await fixture();
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-trend="reading"]').count(), 1);
    assert.equal(await f.page.locator('[data-trend-table="reading"] tbody tr').count(), 8);
    assert.match(await f.page.locator('[data-trend-table="reading"] tbody tr').nth(1).textContent(), /—/);
    assert.equal(await f.page.locator('[data-trend-table="speaking"] tbody tr td').first().textContent(), '—');
    assert.equal(await f.page.locator('[data-trend="listening"] [data-trend-empty]').count(), 0);
    assert.equal(await f.page.locator('[data-trend="speaking"] [data-trend-empty]').count(), 1);
  } finally { await f.close(); }
});

await check('retention table shows levels, last five scores, average and change', async () => {
  const f = await fixture();
  try {
    await open(f);
    const row = f.page.locator('[data-retention-trend-level="B1"]');
    assert.match(await row.textContent(), /60 → 70 → 75 → 80/);
    assert.match(await row.textContent(), /\+20/);
    assert.equal(await f.page.locator('[data-retention-trend-level="A2"] td').nth(3).textContent(), '—');
  } finally { await f.close(); }
});

await check('heatmap maps counts to all five levels and offers a table of active days', async () => {
  const f = await fixture();
  try {
    await open(f);
    for (const level of ['0', '1', '2', '3', '4']) assert.ok(await f.page.locator(`[data-heat="${level}"]`).count() > 0, 'missing level ' + level);
    assert.equal(await f.page.locator('[data-heatmap-table] tbody tr').count(), 73);
  } finally { await f.close(); }
});

await check('single failed widget: streak fails alone; others still render; retry recovers', async () => {
  let calls = 0;
  const f = await fixture({regions: {progressStreak: async () => (++calls === 1 ? {status: 503} : {streak: 9})}});
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-region-failure="progress-streak"]').count(), 1);
    assert.equal(await f.page.locator('[data-progress-module="reading"]').count(), 1);
    assert.equal(await f.page.locator('[data-trend="reading"]').count(), 1);
    assert.equal(await f.page.locator('[data-mock-band-panel]').count(), 1);
    await f.page.locator('[data-region-retry="progress-streak"]').click();
    await until(async () => (await f.page.locator('[data-region-failure="progress-streak"]').count()) === 0, 'streak notice remains');
    assert.match(await f.page.locator('[data-progress-stats]').textContent(), /9/);
    assert.equal(calls, 2);
    noErrors(f);
  } finally { await f.close(); }
});

await check('partial summary: an unavailable section is a dash, the other sections render', async () => {
  const f = await fixture({regions: {progressSummary: {...summaryFull, reading: null, unavailableRegions: ['progress-reading']}}});
  try {
    await open(f);
    assert.equal(await attr(f, '[data-progress-module="reading"] [data-progress-value]', 'data-progress-value'), 'unavailable');
    assert.equal(await text(f, '[data-progress-module="reading"] [data-progress-value]'), '—');
    assert.equal(await f.page.locator('[data-region-failure="progress-reading"]').count(), 1);
    assert.equal(await attr(f, '[data-progress-module="listening"]', 'data-progress-attempts'), '3');
  } finally { await f.close(); }
});

await check('all requests failing: four independent notices, no fabricated numbers', async () => {
  const f = await fixture({regions: {progressSummary: {status: 503}, progressStreak: {status: 503}, progressTrends: {status: 503}, progressMocks: {status: 503}}});
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-region-failure]').count(), 4);
    assert.equal(await f.page.locator('[data-progress-module]').count(), 0);
    assert.equal(await f.page.locator('[data-trend]').count(), 0);
    const stats = await f.page.locator('[data-progress-stats]').textContent();
    assert.doesNotMatch(stats, /\d/);
    assert.equal(await f.page.locator('[data-region-failure] [data-region-retry]').count(), 4);
    noErrors(f);
  } finally { await f.close(); }
});

await check('loading placeholders announce status and clear when data arrives', async () => {
  const f = await fixture({regions: {progressSummary: async () => { await new Promise(r => setTimeout(r, 900)); return summaryFull; }}});
  try {
    await f.page.goto(base + '/app/progress');
    await f.page.locator('[role="status"][aria-busy="true"]').first().waitFor();
    await until(async () => (await f.page.locator('[data-progress-module]').count()) === 4, 'summary never rendered');
    assert.equal(await f.page.locator('[aria-busy="true"][role="status"]').count(), 0);
  } finally { await f.close(); }
});

await check('stale response from a navigated-away mount never paints into the new page', async () => {
  let calls = 0;
  const f = await fixture({regions: {progressSummary: async () => (++calls === 1
    ? (await new Promise(r => setTimeout(r, 1500)), {...summaryFull, vocabulary: {...summaryFull.vocabulary, total: 999}})
    : {...summaryFull, vocabulary: {...summaryFull.vocabulary, total: 7}})}});
  try {
    await f.page.goto(base + '/app/progress');
    await f.page.locator('[data-route-usable="progress"]').waitFor();
    await f.page.locator('[data-progress-reports-link]').click();
    await until(async () => new URL(f.page.url()).pathname === '/app/reports', 'no navigation to reports');
    await f.page.goBack();
    await until(async () => (await f.page.locator('[data-progress-module]').count()) === 4, 'back did not repaint progress');
    await f.page.waitForTimeout(1800);
    assert.doesNotMatch(await f.page.locator('[data-progress-stats]').textContent(), /999/);
    assert.equal(await f.page.locator('[data-progress-stats] .font-display').nth(2).textContent(), '7');
    noErrors(f);
  } finally { await f.close(); }
});

await check('reload re-requests every region and repaints from scratch', async () => {
  const f = await fixture();
  try {
    await open(f);
    const before = f.state.views.length;
    await f.page.reload();
    await f.page.locator('[data-route-usable="progress"]').waitFor();
    await until(async () => (await f.page.locator('[data-progress-module]').count()) === 4, 'reload did not repaint');
    assert.ok(f.state.views.length >= before + 4);
    assert.equal(await f.page.locator('[data-progress-module]').count(), 4);
  } finally { await f.close(); }
});

await check('EN and UZ labels come from the dictionary (heading, Reports, module labels)', async () => {
  for (const locale of ['en', 'uz']) {
    const d = locale === 'en' ? en : uz;
    const f = await fixture({locale});
    try {
      await open(f);
      assert.equal(await text(f, 'h1'), d.nav.progress);
      assert.equal(await text(f, '[data-progress-reports-link]'), d.reporter.openFromProgress);
      assert.equal(await text(f, '[data-progress-module="reading"] p'), d.nav.reading);
    } finally { await f.close(); }
  }
});

await check('dark theme changes the surface and keeps every region visible without overflow', async () => {
  const day = await fixture({theme: 'day'});
  let dayBg;
  try { await open(day); dayBg = await day.page.evaluate(() => getComputedStyle(document.body).backgroundColor); } finally { await day.close(); }
  const f = await fixture({theme: 'night'});
  try {
    await open(f);
    const nightBg = await f.page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.notEqual(nightBg, dayBg, 'night theme did not change the surface');
    await noOverflow(f);
    assert.equal(await f.page.locator('[data-mock-band-panel]').isVisible(), true);
    assert.equal(await f.page.locator('[data-progress-heatmap]').isVisible(), true);
    noErrors(f);
  } finally { await f.close(); }
});

for (const width of [390, 768, 1440]) {
  await check(`responsive: no horizontal overflow at ${width}px with full data`, async () => {
    const f = await fixture({width});
    try {
      await open(f);
      await noOverflow(f);
      assert.equal(await f.page.locator('[data-progress-heatmap]').isVisible(), true);
    } finally { await f.close(); }
  });
}

await check('keyboard: Reports and module links are reachable, tables have captions, details toggles work', async () => {
  const f = await fixture();
  try {
    await open(f);
    await f.page.locator('[data-progress-reports-link]').focus();
    assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('data-progress-reports-link')), '');
    await f.page.keyboard.press('Tab');
    assert.notEqual(await f.page.evaluate(() => document.activeElement?.getAttribute('data-progress-reports-link')), '');
    await f.page.locator('[data-progress-module="reading"]').focus();
    assert.equal(await f.page.evaluate(() => document.activeElement?.getAttribute('data-progress-module')), 'reading');
    await f.page.keyboard.press('Enter');
    await until(async () => new URL(f.page.url()).pathname.startsWith('/app/reading'), 'module link did not navigate by keyboard');
    await f.page.goBack();
    await until(async () => new URL(f.page.url()).pathname === '/app/progress', 'no back from module link');
    // Back navigation also commits a route, and the router focuses the page heading on commit; wait for it.
    await until(async () => f.page.evaluate(() => document.activeElement?.tagName === 'H1'), 'back did not settle on heading focus');
    const details = f.page.locator('[data-trend="reading"] details summary').first();
    await details.focus();
    await f.page.keyboard.press('Enter');
    assert.equal(await f.page.locator('[data-trend="reading"] details').first().getAttribute('open'), '');
    assert.ok(await f.page.locator('[data-trend-table] caption').count() >= 4);
    assert.ok(await f.page.locator('[data-retention-trend-table] caption').count() === 1);
  } finally { await f.close(); }
});

await check('back and forward restore the progress page after navigating away', async () => {
  const f = await fixture();
  try {
    await open(f);
    await f.page.locator('[data-progress-reports-link]').click();
    await until(async () => new URL(f.page.url()).pathname === '/app/reports', 'no reports navigation');
    await f.page.goBack();
    await until(async () => new URL(f.page.url()).pathname === '/app/progress', 'no back to progress');
    await f.page.locator('[data-progress-module]').first().waitFor();
    await f.page.goForward();
    await until(async () => new URL(f.page.url()).pathname === '/app/reports', 'no forward');
  } finally { await f.close(); }
});

await check('catalogue unavailable keeps the learner band panel and shows one notice', async () => {
  const f = await fixture({regions: {progressMocks: {...mocksFull, catalogueUnavailable: true}}});
  try {
    await open(f);
    assert.equal(await f.page.locator('[data-region-failure="mock-overview"]').count(), 1);
    assert.equal(await f.page.locator('[data-mock-band-panel]').count(), 1);
    assert.equal(await f.page.locator('[data-mock-band-panel]').getAttribute('data-completed-mocks'), '2');
    noErrors(f);
  } finally { await f.close(); }
});

await check('UZ mock panel labels follow the locale', async () => {
  const f = await fixture({locale: 'uz'});
  try {
    await open(f);
    assert.match(await f.page.locator('[data-mock-band-panel] h2').textContent(), /Mock natijalari/);
    assert.match(await f.page.locator('[data-mock-band-panel] label').first().textContent(), /Katalogdagi tugallangan mocklar/);
    assert.equal(await f.page.locator('[data-mock-band-panel] svg').getAttribute('aria-label'), 'Haqiqiy tugallangan full mock bandlari');
  } finally { await f.close(); }
});

const fails = results.filter(r => r.status === 'FAIL').length;
fs.writeFileSync(new URL('browser-progress-v54-results.json', out), JSON.stringify({suite: 'V54 My Progress (synthetic projections)', date: new Date().toISOString(), results, counts: {PASS: results.length - fails, FAIL: fails}}, null, 2));
await browser.close();
console.log(`V54 browser: ${results.length - fails} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
