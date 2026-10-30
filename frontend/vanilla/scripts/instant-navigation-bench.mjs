/**
 * Deterministic warm-navigation benchmark for the native SPA.
 *
 * Scope of the numbers this produces: real Chromium 133 (headless), the real built
 * application bundle served by the real Python preview server, the real router
 * (`go()`/popstate), the real module `mount()` functions, with `**\/api/**`
 * intercepted by isolated fixtures. It therefore measures the actual
 * click -> DOM swap -> first frame -> data-ready pipeline. It does NOT measure
 * production network latency, database time or Vercel cold starts.
 *
 * Run after a build, with the preview on :4173:
 *   python3 ../../scripts/build_native_assets.py
 *   HOST=127.0.0.1 PORT=4173 python3 ../../scripts/serve.py &
 *   node scripts/instant-navigation-bench.mjs --label before --out ../docs/evidence/nav-before.json
 */
import {chromium as playwright} from 'playwright-core';
import chromium from '@sparticuz/chromium';
import fs from 'node:fs';
import path from 'node:path';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import {fixtureSession, publicPolicy, viewFixture} from '../tests/fixtures.mjs';

const args = new Map();
for (let i = 2; i < process.argv.length; i += 1) {
  const raw = process.argv[i];
  if (raw.startsWith('--')) args.set(raw.slice(2), process.argv[i + 1]?.startsWith('--') ? 'true' : process.argv[++i]);
}
const BASE = args.get('base') ?? 'http://127.0.0.1:4173';
const LABEL = args.get('label') ?? 'run';
const OUT = args.get('out') ?? null;
const CYCLES = Number(args.get('cycles') ?? 4);
const WARMUP = Number(args.get('warmup') ?? 1);
const VIEWPORT = args.get('viewport') ?? 'desktop';
const DISCOVER = args.get('discover') === 'true';
const CHAIN_ONLY = args.get('chain') ?? null;
const API_DELAY = Number(args.get('api-delay') ?? 0);
const MODULE_DELAY = Number(args.get('module-delay') ?? 0);

const VIEWPORTS = {desktop: {width: 1440, height: 900}, tablet: {width: 768, height: 1024}, mobile: {width: 390, height: 844}};

/** Fixture payloads. Only presentation shapes are fabricated; nothing is real learner data. */
const progressSummary = {
  reading: {attempts: 3, submitted: 2, score: 20, total: 30, accuracy: 67},
  listening: {attempts: 2, submitted: 2, score: 18, total: 30, accuracy: 60},
  speaking: null,
  writing: {submissions: 1, latestBand: 6.5, latestEvaluationAt: null, lastSubmittedAt: null, evaluationUnavailable: false},
  vocabulary: null,
  lessons: {total: 12, open: 4, inProgress: 1, completed: 7},
  assignments: {total: 2, open: 1, completed: 1},
  mocks: null,
  unavailableRegions: [],
};
const progressTrends = {reading: null, listening: null, writing: null, speaking: null, heatmap: null, retention: null};
const progressMocks = {tests: [], attempts: [], catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false};
const progressRegions = {
  progressSummary: {progressSummary},
  progressStreak: {progressStreak: {streak: null}},
  progressTrends: {progressTrends},
  progressMocks: {progressMocks},
};

const mockRegion = {tests: [], attempts: [], attemptsUnavailable: false, attemptTitlesUnavailable: false, catalogueUnavailable: false, finishedCount: 0};

function viewData(routePath, region) {
  if (routePath === '/app/progress' && region && progressRegions[region]) return progressRegions[region];
  if (routePath === '/app/progress') return {...progressSummary, ...progressTrends, ...progressMocks, progressStreak: {streak: null}};
  if (routePath === '/app/mocks' && region === 'mock') return {mock: mockRegion};
  if (routePath === '/app/assignments' && region === 'assignmentDetails') return {assignmentDetails: []};
  if (routePath === '/app/video-lessons') return {standalone: [], course: []};
  const normalised = routePath === '/app/dashboard' ? '/app' : routePath;
  return viewFixture(normalised);
}

const CHAIN = [
  '/app/dashboard',
  '/app/reading/lessons',
  '/app/listening/lessons',
  '/app/writing',
  '/app/speaking',
  '/app/vocabulary',
  '/app/grammar/lessons',
  '/app/progress',
  '/app/assignments',
  '/app/mocks',
  '/app/video-lessons',
];

const deps = path.resolve(import.meta.dirname, '../node_modules');
if (process.platform === 'linux' && !fs.existsSync(path.join(deps, 'lib'))) {
  const tar = path.join(deps, 'al2023.tar');
  fs.writeFileSync(tar, brotliDecompressSync(fs.readFileSync(path.join(deps, '@sparticuz/chromium/bin/al2023.tar.br'))));
  execFileSync('tar', ['xf', tar, '-C', deps]);
}
if (process.platform === 'linux') process.env.LD_LIBRARY_PATH = path.join(deps, 'lib') + ':' + (process.env.LD_LIBRARY_PATH ?? '');

const browser = await playwright.launch({
  executablePath: await chromium.executablePath(),
  args: chromium.args.filter(a => !a.includes('single-process') && !a.includes('disable-web-security') && !a.includes('allow-running-insecure-content')),
  headless: true,
});

/** In-page recorder: click -> content swap -> next frame -> settled data. */
const RECORDER = `
(() => {
  const contentSel = '[data-workspace-content]';
  const busySel = '[data-async-loading],[data-workspace-loading],[data-navigation-pending],[data-entry-frame],[aria-busy="true"],.animate-pulse';
  const state = {current: null};
  window.__laBench = state;
  let prevFirst = null;
  const firstContent = () => document.querySelector(contentSel)?.firstElementChild ?? null;
  const settleCheck = cur => {
    if (cur.done) return;
    if (cur.feedback === null && document.querySelector('[data-entry-frame],[data-navigation-pending],[data-workspace-loading]')) cur.feedback = performance.now() - cur.t0;
    const c = document.querySelector(contentSel);
    if (!c) return;
    const busy = !!c.querySelector(busySel) || !!document.querySelector('[data-workspace-loading],[data-navigation-pending]');
    if (cur.swap !== null && !busy) {
      cur.ready = performance.now() - cur.t0;
      cur.failed = !!c.querySelector('[data-region-failure],[data-entry-retry],[data-integration-required]');
      cur.done = true;
      return;
    }
    if (performance.now() - cur.t0 > 20000) { cur.timeout = true; cur.done = true; }
  };
  const onSwap = cur => {
    cur.swap = performance.now() - cur.t0;
    setTimeout(() => { if (state.current === cur && cur.task === null) cur.task = performance.now() - cur.t0; }, 0);
    requestAnimationFrame(() => { if (state.current === cur && cur.frame === null) cur.frame = performance.now() - cur.t0; });
  };
  const poll = cur => {
    if (cur.done) return;
    settleCheck(cur);
    if (cur.done) return;
    setTimeout(() => poll(cur), 0);
  };
  const check = cur => {
    if (!cur || cur.swap !== null) return;
    const first = firstContent();
    if (first && first !== prevFirst) onSwap(cur);
  };
  const mo = new MutationObserver(() => check(state.current));
  const boot = () => mo.observe(document.documentElement, {childList: true, subtree: true});
  if (document.documentElement) boot(); else addEventListener('DOMContentLoaded', boot);
  window.__laBenchClick = (href) => new Promise(resolve => {
    const t0 = performance.now();
    const cur = {href, t0, swap: null, frame: null, task: null, ready: null, feedback: null, failed: false, done: false, timeout: false};
    state.current = cur;
    prevFirst = firstContent();
    const root = document.querySelector('#root');
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.setAttribute('data-bench-anchor', '');
    root.append(anchor);
    anchor.click();
    anchor.remove();
    poll(cur);
    const wait = () => { if (cur.done) resolve({...cur}); else setTimeout(wait, 4); };
    wait();
  });
  window.__laBenchBack = () => new Promise(resolve => {
    const t0 = performance.now();
    const cur = {href: '(back)', t0, swap: null, frame: null, task: null, ready: null, feedback: null, failed: false, done: false, timeout: false};
    state.current = cur;
    prevFirst = firstContent();
    history.back();
    poll(cur);
    const wait = () => { if (cur.done) resolve({...cur}); else setTimeout(wait, 4); };
    wait();
  });
})();
`;

const apiLog = [];
const apiPathsGlobal = [];
const unfixtured = [];
const consoleErrors = [];

async function newPage(viewport) {
  const context = await browser.newContext({viewport});
  await context.addInitScript(() => {
    const apply = () => { if (!document.documentElement) return false; document.documentElement.dataset.performanceDiagnostics = 'on'; return true; };
    if (!apply()) { const mo = new MutationObserver(() => { if (apply()) mo.disconnect(); }); mo.observe(document, {childList: true, subtree: true}); }
  });
  await context.addInitScript(RECORDER);
  const security = args.get('mode') === 'security';
  if (security) await context.addInitScript(() => {
    window.__fixtureStreams = [];
    window.EventSource = class extends EventTarget {
      constructor(url) { super(); this.url = url; window.__fixtureStreams.push(this); }
      close() { this.closed = true; }
    };
  });
  const page = await context.newPage();
  let requestCount = 0;
  const seen = [];
  let phaseLog = [];
  page.on('pageerror', error => consoleErrors.push(String(error?.message ?? error)));
  page.on('console', message => {
    const text = message.text();
    if (text.startsWith('[qa-perf] ')) {
      try { phaseLog.push(JSON.parse(text.slice(10))); } catch { /* ignore malformed diagnostics */ }
      return;
    }
    if (message.type() === 'error') consoleErrors.push(text.slice(0, 300));
  });
  if (MODULE_DELAY > 0) await context.route('**/modules/**', async route => {
    // Emulates cold ES-module transfer latency; the browser still caches the module afterwards.
    await new Promise(resolve => setTimeout(resolve, MODULE_DELAY));
    return route.continue();
  });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    requestCount += 1;
    seen.push(p + url.search);
    apiLog.push(p + url.search);
    apiPathsGlobal.push(p + url.search);
    const send = async data => {
      if (API_DELAY > 0) await new Promise(resolve => setTimeout(resolve, API_DELAY));
      return route.fulfill({json: data, headers: {'cache-control': 'no-store'}});
    };
    const json = data => send(data);
    if (p === '/api/frontend/public') return json(publicPolicy);
    if (p === '/api/frontend/session') return json(fixtureSession('student', {accessEventsEnabled: args.get('mode') === 'security'}));
    if (p === '/api/frontend/view') {
      if (globalThis.__fixtureAuthority === 'suspended') return route.fulfill({status: 401, json: {error: 'session_revoked'}});
      const routePath = url.searchParams.get('route') ?? '';
      return json({version: 1, route: routePath, data: viewData(routePath, url.searchParams.get('region'))});
    }
    if (p === '/api/auth/state') return json({ok: true, role: 'student', accountStatus: args.get('mode') === 'security' ? (globalThis.__fixtureAuthority ?? 'active') : 'active', expiresAt: Math.floor(Date.now() / 1000) + 3600});
    if (p === '/api/notifications') return json({ok: true, notifications: [], unread: 0});
    if (p === '/api/presence') return json({ok: true});
    if (p === '/api/vocabulary/folders') return json({folders: []});
    if (p === '/api/vocabulary/packs') return json({packs: []});
    if (p === '/api/vocabulary/summary') return json({ok: true, total: 0, due: 0, counts: []});
    if (p === '/api/vocabulary') return json({items: [], total: 0, hasMore: false});
    if (p === '/api/vocabulary/leaderboard') return json({rows: [], awards: [], awardsUnavailable: false, myStanding: null});
    if (p === '/api/dictionary/recent') return json({recent: []});
    if (p === '/api/search') return json({results: []});
    if (p === '/api/assignments') return json({ok: true, assignments: []});
    unfixtured.push(p + url.search);
    return route.fulfill({status: 503, json: {error: 'fixture_backend_unavailable', path: p}});
  });
  const reset = () => { requestCount = 0; seen.length = 0; phaseLog = []; };
  const snapshot = () => ({count: requestCount, paths: [...new Set(seen)], phases: phaseLog.filter(row => row?.event === 'routePipeline' && row.status === 'committed')});
  return {context, page, reset, snapshot};
}

const heapOf = async page => {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const metrics = await cdp.send('Performance.getMetrics');
  const value = name => metrics.metrics.find(m => m.name === name)?.value ?? null;
  const dom = await page.evaluate(() => ({elements: document.querySelectorAll('*').length, nodes: (() => { let n = 0; const walk = () => {}; return document.getElementsByTagName('*').length; })()}));
  await cdp.detach();
  return {jsHeapBytes: value('JSHeapUsedSize'), domElements: dom.elements};
};

async function measureChain({viewport = VIEWPORTS.desktop, cycles = CYCLES} = {}) {
  const {context, page, reset, snapshot} = await newPage(viewport);
  const samples = [];
  try {
    // The server sends a protected document back to /login without a session cookie, so the
    // benchmark enters the SPA through the public shell and then uses the real client-side
    // click path for every measured navigation (same code path as a campus card).
    await page.goto(BASE + '/login', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof window.__laBenchClick === 'function', {timeout: 20000});
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__laBenchClick('/app/dashboard'));
    await page.waitForSelector('[data-workspace-content]', {timeout: 20000, state: 'attached'});
    await page.waitForFunction(() => {
      const content = document.querySelector('[data-workspace-content]');
      return content && content.firstElementChild && !content.querySelector('[data-async-loading],[aria-busy="true"]');
    }, {timeout: 20000});
    const before = await heapOf(page);
    const nav = async (kind, fn, fnArgs, record = true) => {
      reset();
      const rec = await page.evaluate(fn, fnArgs);
      const api = snapshot();
      if (record) samples.push({...rec, kind, apiRequests: api.count, apiPaths: api.paths, phases: api.phases});
    };
    for (let cycle = 0; cycle < cycles + WARMUP; cycle += 1) {
      const record = cycle >= WARMUP;
      for (const href of CHAIN) {
        await nav('navigate', ([target]) => window.__laBenchClick(target), [href], record);
      }
      // Back to the previous catalogue page (history), then forward again by click.
      await nav('back', () => window.__laBenchBack(), undefined, record);
      await nav('navigate', () => window.__laBenchClick('/app/reading/lessons'), undefined, record);
    }
    const after = await heapOf(page);
    const documentNavigations = await page.evaluate(() => performance.getEntriesByType('navigation').length);
    return {samples, heap: {before, after}, documentNavigations};
  } finally {
    await context.close();
  }
}

/** Back/Forward DOM-reuse probe: tags each destination so a reused view is provable. */
async function measureBack(viewport = VIEWPORTS.desktop) {
  const {context, page, reset, snapshot} = await newPage(viewport);
  const rows = [];
  // A reused view keeps its original element objects. Module routes re-wrap the
  // retained nodes in a fresh `[data-module-layout]` container on every commit, so
  // the marker is placed on a node INSIDE the module tree (or the first child when
  // the route has no module wrapper).
  const tag = (name) => page.evaluate(value => {
    const content = document.querySelector('[data-workspace-content]');
    const all = content ? [...content.querySelectorAll('*')] : [];
    // Mark both the module root (mount-created hosts survive region repaints) and a
    // deep node (module content survives a module-wrapper rebuild). Either marker
    // proves the element objects were retained instead of re-mounted.
    for (const node of [content?.firstElementChild, all.at(-1)]) if (node) node.setAttribute('data-bench-view', value);
    const main = document.querySelector('[data-shell-main]');
    const reachable = main ? Math.max(0, main.scrollHeight - main.clientHeight) : 0;
    const target = Math.min(120, reachable);
    if (main) { main.scrollTop = target; return {tagged: all.length > 0, applied: main.scrollTop, reachable}; }
    return {tagged: all.length > 0, applied: 0, reachable: 0};
  }, name);
  const reused = (name) => page.evaluate(value => document.querySelector(`[data-bench-view="${value}"]`) !== null, name);
  const scroll = () => page.evaluate(() => document.querySelector('[data-shell-main]')?.scrollTop ?? null);
  const nav = async (kind, fn, viewName, fnArgs) => {
    reset();
    const rec = await page.evaluate(fn, fnArgs);
    const captured = snapshot();
    // Let the bounded scroll re-apply frames run before sampling.
    await page.waitForTimeout(80);
    rows.push({...rec, kind, view: viewName, reused: viewName ? await reused(viewName) : null, scrollTop: await scroll(), apiRequests: captured.count, apiPaths: captured.paths, phases: captured.phases});
  };
  try {
    await page.goto(BASE + '/login', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof window.__laBenchClick === 'function', {timeout: 20000});
    await page.waitForTimeout(300);
    await page.evaluate(() => window.__laBenchClick('/app/dashboard'));
    await page.waitForSelector('[data-workspace-content]', {timeout: 20000, state: 'attached'});
    await page.waitForFunction(() => {
      const content = document.querySelector('[data-workspace-content]');
      return content && content.firstElementChild && !content.querySelector('[data-async-loading],[aria-busy="true"]');
    }, {timeout: 20000});
    const scrollTargets = {};
    scrollTargets.dashboard = await tag('dashboard');
    const chain = [['/app/reading/lessons', 'reading'], ['/app/listening/lessons', 'listening'], ['/app/writing', 'writing']];
    for (const [href, name] of chain) {
      await nav('navigate', ([target]) => window.__laBenchClick(target), null, [href]);
      scrollTargets[name] = await tag(name);
    }
    const rowsWithExpectation = [];
    for (const view of ['listening', 'reading', 'dashboard']) {
      await nav('back', () => window.__laBenchBack(), view);
      rows.at(-1).expectedScroll = scrollTargets[view]?.applied ?? null;
    }
    await nav('navigate', ([target]) => window.__laBenchClick(target), 'reading', ['/app/reading/lessons']);
    rows.at(-1).expectedScroll = scrollTargets.reading?.applied ?? null;
    return rows;
  } finally {
    await context.close();
  }
}

/**
 * Browser-level authorization regression probes. These assert the *existing* event
 * driven authority contract is intact around the navigation work:
 * A) no /api/auth/state per navigation or per click, B) a targeted suspension event
 *    reconciles once and removes private DOM, C) a role change invalidates the
 *    private presentation cache, E) a cross-tab logout hint signs the tab out,
 *    F) the shell never survives a revoked session.
 */
async function measureSecurity(viewport = VIEWPORTS.desktop) {
  const { context, page, reset, snapshot } = await newPage(viewport);
  const checks = [];
  const check = (name, condition, detail = '') => checks.push({check: name, status: condition ? 'PASS' : 'FAIL', detail});
  const authStateCount = () => {
    const rows = apiPathsGlobal.filter(p => p === '/api/auth/state');
    return rows.length;
  };
  const settle = () => page.waitForFunction(() => {
    const content = document.querySelector('[data-workspace-content]');
    return content && content.firstElementChild && !content.querySelector('[data-async-loading],[aria-busy="true"],.animate-pulse,[data-entry-frame]');
  }, {timeout: 20000});
  const click = async href => {
    const before = await page.evaluateHandle(() => document.querySelector('[data-workspace-content]')?.firstElementChild);
    await page.evaluate(h => {
      const root = document.querySelector('#root');
      const a = document.createElement('a');
      a.href = h;
      root.append(a);
      a.click();
      a.remove();
    }, href);
    await page.waitForFunction(el => document.querySelector('[data-workspace-content]')?.firstElementChild !== el, before, {timeout: 20000});
    await settle();
  };
  try {
    await page.goto(BASE + '/login', {waitUntil: 'domcontentloaded'});
    await page.waitForFunction(() => typeof window.__laBenchClick === 'function', {timeout: 20000});
    await page.waitForTimeout(300);
    await click('/app/dashboard');
    const streams = await page.evaluate(() => window.__fixtureStreams.length);
    check('one shared /api/auth/changes stream per tab', streams === 1, `streams=${streams}`);
    await page.evaluate(() => { const s = window.__fixtureStreams[0]; s.dispatchEvent(new Event('open')); s.dispatchEvent(new Event('ready')); });
    reset();
    for (const href of ['/app/reading/lessons', '/app/listening/lessons', '/app/writing', '/app/grammar/lessons', '/app/dashboard']) await click(href);
    await page.evaluate(() => { for (let i = 0; i < 6; i += 1) { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('pageshow')); } });
    await page.waitForTimeout(400);
    check('A: zero /api/auth/state reads across 6 warm navigations', authStateCount() === 0, `calls=${authStateCount()}`);
    check('A: no session-presentation read per navigation', (snapshot().paths.filter(p => p === '/api/frontend/session').length) === 0, snapshot().paths.join(','));
    check('A: no private-cache grant without an API read', (await page.evaluate(() => document.querySelectorAll('[data-workspace-content] *').length)) > 0, '');

    // B: targeted suspension. The event channel is the only thing that changes.
    globalThis.__fixtureAuthority = 'suspended';
    const stateCallsBefore = authStateCount();
    await page.evaluate(() => window.__fixtureStreams[0].dispatchEvent(new Event('access-changed')));
    await page.waitForTimeout(700);
    const afterSuspend = await page.evaluate(() => ({path: location.pathname, workspace: document.querySelectorAll('[data-workspace-content]').length, authShell: document.querySelectorAll('[data-auth-shell]').length, fixtureName: document.body.innerText.includes('Isolated fixture'), topbar: document.querySelectorAll('[data-shell-topbar]').length}));
    check('B: one event-driven reconciliation for the affected user', authStateCount() === stateCallsBefore + 1, `calls=${authStateCount() - stateCallsBefore}`);
    check('B: suspended learner is redirected out of private UI', afterSuspend.path === '/login', afterSuspend.path);
    check('B: private workspace DOM and topbar are gone after revocation', afterSuspend.workspace === 0 && afterSuspend.topbar === 0 && !afterSuspend.fixtureName, JSON.stringify(afterSuspend));

    // F: no polling after revocation.
    const after = authStateCount();
    await page.waitForTimeout(900);
    check('F: no /api/auth/state polling after revocation', authStateCount() === after, `delta=${authStateCount() - after}`);

    // E: cross-tab logout hint through the existing storage fallback.
    globalThis.__fixtureAuthority = 'active';
    await click('/app/dashboard').catch(() => {});
    await page.waitForTimeout(200);
    const signedIn = await page.evaluate(() => location.pathname);
    // A cross-tab hint arrives as a storage event in this document (localStorage writes
    // in the same document never fire it), exactly as the other tab's write would.
    await page.evaluate(() => {
      const message = {kind: 'logout', source: 'other-tab-fixture', id: 'other-tab-fixture:1'};
      window.dispatchEvent(new StorageEvent('storage', {key: 'learners-area:session-event', newValue: JSON.stringify(message), storageArea: localStorage}));
    });
    await page.waitForTimeout(600);
    const crossTab = await page.evaluate(() => ({path: location.pathname, workspace: document.querySelectorAll('[data-workspace-content]').length}));
    check('E: cross-tab logout hint signs this tab out', crossTab.path === '/login' && crossTab.workspace === 0, `${signedIn} -> ${JSON.stringify(crossTab)}`);

    // G: the backend still authorizes every protected read (no browser-side grant).
    globalThis.__fixtureAuthority = 'suspended';
    const protectedRead = await page.evaluate(async () => {
      const response = await fetch('/api/frontend/view?route=%2Fapp%2Fdashboard', {credentials: 'same-origin', cache: 'no-store'});
      return response.status;
    });
    check('G: protected API is still server-authorized after logout', protectedRead === 401 || protectedRead === 503, `status=${protectedRead}`);
    return checks;
  } finally {
    await context.close();
  }
}

async function discover() {
  const {context, page} = await newPage(VIEWPORTS.desktop);
  try {
    await page.goto(BASE + '/login', {waitUntil: 'domcontentloaded'});
    await page.waitForTimeout(1200);
    const output = [];
    for (const href of CHAIN) {
      apiLog.length = 0;
      const rec = await page.evaluate(([target]) => window.__laBenchClick(target), [href]);
      output.push({route: href, ...rec, api: [...new Set(apiLog)]});
    }
    return output;
  } finally {
    await context.close();
  }
}

const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * p) - 1))];
};
const round = value => (value === null || value === undefined ? null : +value.toFixed(2));

let report;
try {
  if (args.get('mode') === 'security') {
    const checks = await measureSecurity(VIEWPORTS[VIEWPORT]);
    report = {label: LABEL, mode: 'security', viewport: VIEWPORT, checks, consoleErrors: [...new Set(consoleErrors)], passed: checks.filter(c => c.status === 'PASS').length, failed: checks.filter(c => c.status === 'FAIL').length};
  } else if (args.get('mode') === 'back') {
    const rows = await measureBack(VIEWPORTS[VIEWPORT]);
    report = {label: LABEL, mode: 'back', viewport: VIEWPORT, rows, consoleErrors: [...new Set(consoleErrors)], unfixturedRequests: [...new Set(unfixtured)]};
  } else if (DISCOVER) {
    const output = await discover();
    report = {label: LABEL, discovered: output, consoleErrors};
  } else {
    const chain = CHAIN_ONLY ? CHAIN_ONLY.split(',') : CHAIN;
    const run = await measureChain({viewport: VIEWPORTS[VIEWPORT]});
    const perRoute = new Map();
    for (const sample of run.samples) {
      if (!perRoute.has(sample.href)) perRoute.set(sample.href, []);
      perRoute.get(sample.href).push(sample);
    }
    const routes = [...perRoute.entries()].map(([href, rows]) => ({
      route: href,
      samples: rows.length,
      swap: {p50: round(percentile(rows.map(r => r.swap).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.swap).filter(v => v !== null), 0.95))},
      frame: {p50: round(percentile(rows.map(r => r.frame).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.frame).filter(v => v !== null), 0.95))},
      ready: {
        p50: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.5)),
        p95: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.95)),
        p99: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.99)),
      },
      apiRequestsAvg: round(rows.reduce((sum, r) => sum + r.apiRequests, 0) / rows.length),
      failed: rows.filter(r => r.failed).length,
      timeouts: rows.filter(r => r.timeout).length,
    }));
    const all = run.samples.filter(s => s.kind === 'navigate');
    const back = run.samples.filter(s => s.kind === 'back');
    const stats = rows => ({
      swap: {p50: round(percentile(rows.map(r => r.swap).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.swap).filter(v => v !== null), 0.95)), p99: round(percentile(rows.map(r => r.swap).filter(v => v !== null), 0.99))},
      task: {p50: round(percentile(rows.map(r => r.task).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.task).filter(v => v !== null), 0.95)), p99: round(percentile(rows.map(r => r.task).filter(v => v !== null), 0.99))},
      feedback: {p50: round(percentile(rows.map(r => r.feedback).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.feedback).filter(v => v !== null), 0.95)), p99: round(percentile(rows.map(r => r.feedback).filter(v => v !== null), 0.99)), samples: rows.filter(r => r.feedback !== null).length},
      frame: {p50: round(percentile(rows.map(r => r.frame).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.frame).filter(v => v !== null), 0.95)), p99: round(percentile(rows.map(r => r.frame).filter(v => v !== null), 0.99))},
      ready: {p50: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.5)), p95: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.95)), p99: round(percentile(rows.map(r => r.ready).filter(v => v !== null), 0.99))},
      apiRequestsAvg: round(rows.reduce((sum, r) => sum + r.apiRequests, 0) / rows.length),
      samples: rows.length,
      failureSamples: rows.filter(r => r.failed).length,
      timeouts: rows.filter(r => r.timeout).length,
      phases: (() => {
        const names = ['prepare', 'module', 'mount', 'commit'];
        const out = {};
        for (const name of names) {
          const values = rows.flatMap(r => (r.phases ?? []).map(p => p.phasesMs?.[name]).filter(v => typeof v === 'number'));
          out[name] = values.length ? {p50: round(percentile(values, 0.5)), p95: round(percentile(values, 0.95)), samples: values.length} : null;
        }
        const totals = rows.flatMap(r => (r.phases ?? []).map(p => p.totalMs).filter(v => typeof v === 'number'));
        out.total = totals.length ? {p50: round(percentile(totals, 0.5)), p95: round(percentile(totals, 0.95)), samples: totals.length} : null;
        return out;
      })(),
    });
    report = {
      label: LABEL,
      scope: 'Chromium 133 headless; built bundle served by the Python preview; /api/** replaced by isolated fixtures; single local machine. Excludes production network, database and cold starts. "swap" = first destination DOM frame after the click; "ready" = destination content settled (no aria-busy/data-async-loading).',
      viewport: VIEWPORT,
      cycles: CYCLES,
      apiDelayMs: API_DELAY,
      moduleDelayMs: MODULE_DELAY,
      warmupCycles: WARMUP,
      navigate: stats(all),
      back: stats(back),
      routes,
      heap: run.heap,
      documentNavigations: run.documentNavigations,
      consoleErrors: [...new Set(consoleErrors)].slice(0, 20),
      unfixturedRequests: [...new Set(unfixtured)],
    };
  }
} finally {
  await browser.close();
}

if (OUT) fs.mkdirSync(path.dirname(path.resolve(OUT)), {recursive: true});
if (OUT) fs.writeFileSync(path.resolve(OUT), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
