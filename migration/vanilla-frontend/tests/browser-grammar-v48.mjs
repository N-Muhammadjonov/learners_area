/** V48 Grammar browser checks: lessons catalogue and detail (tabs, body, progress, notes, not-found and
 * unavailable states), Writing and Speaking topic lists, topic detail (materials, mastery, Correct It,
 * Write Your Own, Translate With It, Activate It, error and retry paths, double-submit guard, input
 * preservation), EN/UZ labels and mobile overflow. Synthetic fixtures only; the live backend is not contacted. */
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
const out = new URL('../docs/evidence/v48/', import.meta.url);
fs.mkdirSync(out, {recursive: true});
const results = [];
async function check(name, fn) {
  if (process.env.TEST_FILTER && !name.includes(process.env.TEST_FILTER)) return;
  try { await fn(); results.push({name, status: 'PASS'}); console.log('PASS', name); }
  catch (e) { results.push({name, status: 'FAIL', error: String(e.message).slice(0, 700)}); console.error('FAIL', name, String(e.message).slice(0, 700)); }
}

const W1 = '00000000-0000-4000-8000-0000000000d1';
const S1 = '00000000-0000-4000-8000-0000000000d2';
const T1 = '00000000-0000-4000-8000-0000000000e1';
const E1 = '00000000-0000-4000-8000-0000000000f1';
const E2 = '00000000-0000-4000-8000-0000000000f2';
const L1 = '00000000-0000-4000-8000-0000000000c1';
const L2 = '00000000-0000-4000-8000-0000000000c2';

const topicRows = [
  {topic: {id: W1, title: 'Present Perfect', skillArea: 'writing'}, totalExercises: 2, masteryUnavailable: false,
    mastery: {scorePercent: 60, sessions: 1, mastered: false}},
  {topic: {id: S1, title: 'Speaking Conditionals', skillArea: 'speaking'}, totalExercises: 1, masteryUnavailable: true, mastery: null},
];
const lessonRows = [{id: L1, title: 'Articles lesson', summary: 'When to use a and the', estimatedMinutes: 5, hasTeacherNotes: true, hasMedia: false}];
const lessonDetail = {
  kind: 'lesson',
  detail: {
    lesson: {id: L1, title: 'Articles lesson', summary: 'Summary of articles', estimatedMinutes: 5, learningArea: 'grammar'},
    note: 'my note', teacherNotes: 'Teacher says hello', teacherNotesSource: 'lesson',
    blocks: [{blockId: '00000000-0000-4000-8000-0000000000b9', position: 1, type: 'text', text: 'Lesson body paragraph', objectKey: null, url: null, referenceProblem: null}],
    mediaUrl: null, media: null, progress: {state: 'available', completedAt: null},
  },
};
const topicDetail = (overrides = {}) => ({
  kind: 'topic',
  topic: {id: T1, title: 'Present Perfect', explanation: 'Use it for past actions with present relevance.', skillArea: 'writing'},
  exercises: [
    {id: E1, order: 1, promptText: 'She ___ gone home.', options: ['has', 'have'], fromEssay: true,
      translatePromptUz: 'U allaqachon ketgan.', targetStructures: ['has + V3'], activationPrompt: 'Write about your holiday.'},
    {id: E2, order: 2, promptText: 'They ___ there yesterday.', options: ['went', 'go'], fromEssay: false,
      translatePromptUz: null, targetStructures: [], activationPrompt: null},
  ],
  mastery: {scorePercent: 60, attempted: 4, correct: 3, sessions: 1, sessionsRemaining: 2, allActivitiesPractised: false, mastered: false,
    byActivity: [{activity: 'correct_it', attempted: 2, correct: 2, percent: 100}, {activity: 'translate_it', attempted: 2, correct: 1, percent: 50}, {activity: 'activate_it', attempted: 0, correct: 0, percent: 0}]},
  masteryUnavailable: false,
  materials: {ok: true, blocks: [{id: '00000000-0000-4000-8000-0000000000b8', type: 'text', textContent: 'Material text', originalName: null, objectKey: null, linkUrl: null}]},
  ...overrides,
});

async function fixture({locale = 'en', width = 1440, view, api} = {}) {
  const context = await browser.newContext({viewport: {width, height: 900}});
  await context.addCookies([{name: 'la_locale', value: locale, url: base}, {name: 'la_theme', value: 'day', url: base}]);
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  const state = {requests: []};
  await context.route('**/api/**', async route => {
    const r = route.request(), u = new URL(r.url()), p = u.pathname;
    let body = null;
    if (r.method() !== 'GET' && (r.headers()['content-type'] ?? '').includes('application/json')) {
      try { body = r.postDataJSON(); } catch { body = null; }
    }
    state.requests.push({path: p, method: r.method(), query: u.search, body});
    const reply = x => {
      if (x === undefined) return route.fulfill({status: 503, json: {error: 'unavailable'}});
      if (typeof x.status === 'number') return route.fulfill({status: x.status, json: x.json});
      return route.fulfill({status: 200, json: x});
    };
    if (p === '/api/frontend/public') return reply(publicPolicy);
    if (p === '/api/frontend/session') return reply(fixtureSession('student'));
    if (p === '/api/notifications') return reply({notifications: [], unread: 0});
    if (p === '/api/frontend/view') {
      const rt = u.searchParams.get('route');
      const data = view ? await view(rt, state) : undefined;
      return data === undefined ? reply(undefined) : reply({version: 1, route: rt, data});
    }
    if (api) {
      const answer = await api(p, {method: r.method(), body, u, state});
      if (answer !== undefined) return reply(answer);
    }
    return reply(undefined);
  });
  return {context, page, state, errors};
}
async function close(f) { await f.context.close(); }
const posts = (f, suffix) => f.state.requests.filter(r => r.method === 'POST' && r.path.endsWith(suffix));
async function until(fn, message, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await Promise.resolve().then(fn).catch(e => e);
    if (last === true) return;
    await new Promise(r => setTimeout(r, 80));
  }
  throw new Error(message + ' (last=' + String(last) + ')');
}
const noOverflow = async f => assert.equal(await f.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'horizontal overflow');
const noErrors = f => assert.deepEqual(f.errors, [], 'page errors: ' + f.errors.join(' | '));

// ---------- Lessons catalogue ----------
await check('lessons catalogue: cards, open link and pagination', async () => {
  const f = await fixture({view: async rt => rt.startsWith('/app/grammar/lessons') ? {library: {rows: lessonRows, hasMore: true}} : undefined});
  try {
    await f.page.goto(base + '/app/grammar/lessons');
    await f.page.locator(`[data-grammar-lesson="${L1}"]`).waitFor();
    assert.equal(await f.page.locator('[data-grammar-lesson]').count(), 1);
    assert.equal(await f.page.locator(`a[href="/app/grammar/lessons/${L1}"]`).count(), 1);
    assert.equal(await f.page.locator('nav[aria-label] a[href="/app/grammar/lessons?page=2"]').count(), 1);
    assert.equal(await f.page.locator('nav a[href="/app/grammar/lessons?page=0"]').count(), 0);
    noErrors(f);
  } finally { await close(f); }
});

await check('/app/grammar redirects to the Lessons section', async () => {
  const f = await fixture({view: async rt => rt.startsWith('/app/grammar/lessons') ? {library: {rows: [], hasMore: false}} : undefined});
  try {
    await f.page.goto(base + '/app/grammar');
    await until(async () => new URL(f.page.url()).pathname === '/app/grammar/lessons', 'no redirect to lessons');
    assert.equal(new URL(f.page.url()).search, '');
  } finally { await close(f); }
});

// ---------- Lesson detail ----------
await check('lesson detail: body, workspace, tabs and teacher notes', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/lessons/${L1}` ? lessonDetail : undefined,
    api: async (p, c) => p === `/api/lessons/${L1}/state` ? {ok: true, state: c.body.state} : undefined});
  try {
    await f.page.goto(base + `/app/grammar/lessons/${L1}`);
    await f.page.locator('[data-grammar-lesson-body-card]').waitFor();
    assert.match(await f.page.locator('[data-grammar-lesson-body-card]').textContent(), /Lesson body paragraph/);
    await f.page.locator('[data-lesson-workspace]').waitFor();
    assert.equal(await f.page.locator('[data-lesson-start]').isDisabled(), false);
    assert.equal(await f.page.locator('[data-grammar-lesson-tab="description"]').getAttribute('aria-selected'), 'true');
    await f.page.locator('[data-grammar-lesson-tab="teacher-notes"]').click();
    await until(async () => new URL(f.page.url()).searchParams.get('tab') === 'teacher-notes', 'tab not in url');
    await f.page.locator('[data-grammar-teacher-notes]').waitFor();
    assert.match(await f.page.locator('[data-grammar-teacher-notes]').textContent(), /Teacher says hello/);
    await f.page.goto(base + `/app/grammar/lessons/${L1}?tab=xulosangiz`);
    await f.page.locator('[data-grammar-lesson-panel="xulosangiz"] textarea').waitFor();
    assert.equal(await f.page.locator('[data-grammar-lesson-panel="xulosangiz"] textarea').inputValue(), 'my note');
    noErrors(f);
  } finally { await close(f); }
});

await check('lesson progress posts once and is not repeated on double press', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const f = await fixture({view: async rt => rt === `/app/grammar/lessons/${L1}` ? lessonDetail : undefined,
    api: async (p, c) => { if (p === `/api/lessons/${L1}/state`) { await gate; return {ok: true, state: c.body.state}; } return undefined; }});
  try {
    await f.page.goto(base + `/app/grammar/lessons/${L1}`);
    const start = f.page.locator('[data-lesson-start]');
    await start.waitFor();
    await start.click();
    await start.click({force: true}).catch(() => {});
    release();
    await until(async () => posts(f, `/api/lessons/${L1}/state`).length >= 1, 'progress not posted');
    await f.page.waitForTimeout(400);
    assert.equal(posts(f, `/api/lessons/${L1}/state`).length, 1, 'progress posted more than once');
    assert.deepEqual(posts(f, `/api/lessons/${L1}/state`)[0].body, {state: 'in_progress'});
  } finally { await close(f); }
});

await check('lesson not-found and invalid id show the original not-found page', async () => {
  const f = await fixture({view: async () => ({kind: 'not_found'})});
  try {
    await f.page.goto(base + `/app/grammar/lessons/${L2}`);
    await until(async () => (await f.page.locator('h1').first().textContent()).length > 0 && !(await f.page.locator('[data-grammar-lesson-body-card]').count()), 'lesson body shown for not-found');
    assert.equal(await f.page.locator('[data-grammar-lesson-body-card]').count(), 0);
    await f.page.goto(base + '/app/grammar/lessons/not-a-uuid');
    await f.page.waitForTimeout(300);
    assert.equal(f.state.requests.some(r => r.path === '/api/frontend/view' && r.query.includes('not-a-uuid')), false, 'view requested for invalid id');
  } finally { await close(f); }
});

await check('lesson unavailable (server error) shows retry and recovers', async () => {
  let calls = 0;
  const f = await fixture({view: async rt => { if (rt !== `/app/grammar/lessons/${L1}`) return undefined; calls++; return calls === 1 ? undefined : lessonDetail; }});
  try {
    await f.page.goto(base + `/app/grammar/lessons/${L1}`);
    await f.page.locator('[data-region-retry="grammar-lesson"]').waitFor();
    await f.page.locator('[data-region-retry="grammar-lesson"]').click();
    await f.page.locator('[data-grammar-lesson-body-card]').waitFor();
  } finally { await close(f); }
});

// ---------- Writing and Speaking topic lists ----------
await check('Writing and Speaking lists show only their own skill area', async () => {
  const f = await fixture({view: async rt => rt.startsWith('/app/grammar?tab=') ? {rows: topicRows} : undefined});
  try {
    await f.page.goto(base + '/app/grammar?tab=writing');
    await f.page.locator(`[data-topic-row="${W1}"]`).waitFor();
    assert.equal(await f.page.locator(`[data-topic-row="${S1}"]`).count(), 0);
    assert.match(await f.page.locator(`[data-topic-score="${W1}"]`).textContent(), /60%/);
    await f.page.goto(base + '/app/grammar?tab=speaking');
    await f.page.locator(`[data-topic-row="${S1}"]`).waitFor();
    assert.equal(await f.page.locator(`[data-topic-row="${W1}"]`).count(), 0);
    assert.equal(await f.page.locator(`[data-topic-mastery-unavailable="${S1}"]`).count(), 1);
    assert.equal(await f.page.locator('[data-region-retry="grammar-mastery"]').count(), 1);
    assert.equal(await f.page.locator('[data-module-section="speaking"][aria-current="page"]').count(), 1);
    noErrors(f);
  } finally { await close(f); }
});

// ---------- Topic detail ----------
await check('topic detail: materials, mastery and the three activities render from the server', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator(`[data-grammar-topic="${T1}"]`).waitFor();
    assert.match(await f.page.locator('[data-resource-blocks]').textContent(), /Material text/);
    assert.equal(await f.page.locator('[data-topic-mastery]').getAttribute('data-topic-mastery'), 'in-progress');
    assert.match(await f.page.locator('[data-mastery-score]').textContent(), /60%/);
    assert.match(await f.page.locator('[data-mastery-activity="translate_it"]').textContent(), /50%/);
    assert.match(await f.page.locator('[data-mastery-activity="activate_it"]').textContent(), /not practised/i);
    assert.equal(await f.page.locator('[data-mastery-remaining]').count(), 1);
    assert.equal(await f.page.locator(`input[type=radio][name="${E1}"]`).count(), 2);
    assert.equal(await f.page.locator(`[data-translate="${E1}"]`).count(), 1);
    assert.equal(await f.page.locator(`[data-activate="${E1}"]`).count(), 1);
    assert.equal(await f.page.locator(`[data-translate="${E2}"]`).count(), 0);
    assert.equal(await f.page.locator('[data-practice-empty]').count(), 0);
    assert.equal(await f.page.locator('.badge', {hasText: 'From your own essay'}).count(), 1);
    noErrors(f);
  } finally { await close(f); }
});

await check('Correct It: submit is gated, server result is the only grader, and the verdict is shown', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async (p, c) => {
      if (p === `/api/grammar/topics/${T1}/submit`) {
        return {ok: true, results: [
          {exerciseId: E1, isCorrect: true, correctOption: 'has', explanation: 'Present perfect with has.'},
          {exerciseId: E2, isCorrect: false, correctOption: 'went', explanation: 'Simple past for yesterday.'},
        ]};
      }
      return undefined;
    }});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator(`input[type=radio][name="${E1}"]`).first().waitFor();
    const submit = f.page.getByRole('button', {name: en.grammar.submit, exact: true});
    assert.equal(await submit.isDisabled(), true);
    const leaked = await f.page.locator('.text-band-good', {hasText: 'has'}).evaluateAll(els => els.map(e => e.outerHTML.slice(0, 200)));
    assert.equal(leaked.length, 0, 'correct option visible before submit: ' + leaked.join(' | '));
    await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).check();
    assert.equal(await submit.isDisabled(), true, 'enabled with one answer');
    await f.page.locator(`input[type=radio][name="${E2}"][value="went"]`).check();
    assert.equal(await submit.isDisabled(), false);
    await submit.click();
    await until(async () => posts(f, `/api/grammar/topics/${T1}/submit`).length === 1, 'submit not posted once');
    assert.deepEqual(posts(f, `/api/grammar/topics/${T1}/submit`)[0].body.answers.map(a => a.selectedOption), ['has', 'went']);
    await f.page.getByText(en.grammar.correct, {exact: true}).first().waitFor();
    assert.equal(await f.page.getByRole('button', {name: en.grammar.submit, exact: true}).count(), 0);
    assert.match(await f.page.locator(`[data-grammar-quiz]`).textContent(), /Simple past for yesterday\./);
    assert.equal(await f.page.locator(`input[type=radio][name="${E2}"]`).first().isDisabled(), true);
    noErrors(f);
  } finally { await close(f); }
});

await check('Correct It: a malformed submit response shows the generic error and keeps answers', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async p => p === `/api/grammar/topics/${T1}/submit` ? {ok: true, nope: true} : undefined});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator(`input[type=radio][name="${E1}"]`).first().waitFor();
    await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).check();
    await f.page.locator(`input[type=radio][name="${E2}"][value="go"]`).check();
    await f.page.getByRole('button', {name: en.grammar.submit, exact: true}).click();
    await f.page.getByText(en.apiErrors.generic, {exact: true}).waitFor();
    assert.equal(await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).isChecked(), true);
  } finally { await close(f); }
});

await check('Write Your Own: sample released only after the attempt; text survives the quiz; checked-by named', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async p => {
      if (p === `/api/grammar/topics/${T1}/submit`) return {ok: true, results: [
        {exerciseId: E1, isCorrect: true, correctOption: 'has', explanation: 'Right.'},
        {exerciseId: E2, isCorrect: true, correctOption: 'went', explanation: 'Right.'}]};
      return p === `/api/grammar/exercises/${E1}/produce`
        ? {ok: true, attemptId: 'a1', verdict: 'needs_correction', checkedBy: 'GrammarEvaluationService', sampleAnswer: 'She has gone home.', explanation: 'Use has with she.', issues: ['Missing auxiliary']}
        : undefined;
    }});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    const area = f.page.locator(`[data-production-answer="${E1}"] textarea`);
    await area.waitFor();
    assert.equal(await f.page.locator(`[data-production-answer="${E1}"] [data-checked-by]`).count(), 0);
    await area.fill('She gone home');
    await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).check();
    await f.page.getByRole('button', {name: en.grammar.checkMine, exact: true}).first().click();
    await until(async () => posts(f, `/api/grammar/exercises/${E1}/produce`).length === 1, 'produce not posted');
    await f.page.locator(`[data-production-answer="${E1}"] [data-checked-by]`).waitFor();
    assert.equal(await f.page.locator(`[data-production-answer="${E1}"] [data-checked-by]`).getAttribute('data-checked-by'), 'GrammarEvaluationService');
    assert.match(await f.page.locator(`[data-production-answer="${E1}"]`).textContent(), /She has gone home\./);
    assert.equal(await area.inputValue(), 'She gone home', 'typed text lost after verdict');
    await f.page.locator(`input[type=radio][name="${E2}"][value="went"]`).check();
    await f.page.getByRole('button', {name: en.grammar.submit, exact: true}).click();
    await f.page.getByText(en.grammar.correct, {exact: true}).first().waitFor();
    assert.equal(await area.inputValue(), 'She gone home', 'typed text lost after quiz submit');
    assert.equal(await f.page.locator(`[data-production-answer="${E1}"] [data-checked-by]`).count(), 1);
  } finally { await close(f); }
});

await check('Translate With It and Activate It show the structure checklist, verdict and evaluator', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async (p, c) => {
      if (p !== `/api/grammar/exercises/${E1}/practice`) return undefined;
      if (c.body.activity === 'translate_it') return {ok: true, attemptId: 'a2', activity: 'translate_it', verdict: 'partial', checkedBy: null,
        structures: {used: ['has'], missing: ['V3'], complete: false}, sampleAnswer: 'She has already gone.', explanation: 'Add the past participle.', issues: []};
      return {ok: true, attemptId: 'a3', activity: 'activate_it', verdict: 'correct', checkedBy: 'GrammarEvaluationService',
        structures: {used: ['has'], missing: [], complete: true}, sampleAnswer: 'x', explanation: 'Well done.', issues: []};
    }});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    const tr = f.page.locator(`[data-translate-input="${E1}"]`);
    await tr.waitFor();
    const check = f.page.locator(`[data-translate-check="${E1}"]`);
    assert.equal(await check.isDisabled(), true);
    await tr.fill('x');
    assert.equal(await check.isDisabled(), true, 'short answer enabled');
    await tr.fill('She has gone');
    await check.click();
    await f.page.locator(`[data-translate-verdict="partial"]`).waitFor();
    assert.match(await f.page.locator('[data-translate-structures]').textContent(), /Not found: V3/);
    assert.equal(await f.page.locator(`[data-translate="${E1}"] [data-practice-checked-by]`).count(), 0, 'translate shows evaluator name');
    const ac = f.page.locator(`[data-activate-input="${E1}"]`);
    await ac.fill('I have visited Paris.');
    await f.page.locator(`[data-activate-check="${E1}"]`).click();
    await f.page.locator('[data-activate-verdict="correct"]').waitFor();
    assert.match(await f.page.locator('[data-practice-checked-by]').textContent(), /GrammarEvaluationService/);
    assert.equal(await tr.inputValue(), 'She has gone', 'translate input lost');
  } finally { await close(f); }
});

await check('a failed practice check shows the mapped error and keeps the answer', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async p => p === `/api/grammar/exercises/${E1}/practice` ? {status: 502, json: {error: 'evaluation_failed'}} : undefined});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    const ac = f.page.locator(`[data-activate-input="${E1}"]`);
    await ac.waitFor();
    await ac.fill('I visited Rome.');
    await f.page.locator(`[data-activate-check="${E1}"]`).click();
    await f.page.getByText(en.apiErrors.generic, {exact: true}).waitFor();
    assert.equal(await ac.inputValue(), 'I visited Rome.');
    assert.equal(await f.page.locator(`[data-activate-check="${E1}"]`).isDisabled(), false);
  } finally { await close(f); }
});

await check('double press on a write sends one request', async () => {
  let release;
  const gate = new Promise(r => { release = r; });
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined,
    api: async p => { if (p === `/api/grammar/exercises/${E1}/produce`) { await gate; return {ok: true, verdict: 'correct', checkedBy: 'x', sampleAnswer: 's', explanation: 'e', issues: []}; } return undefined; }});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator(`[data-production-answer="${E1}"] textarea`).fill('She has gone');
    const b = f.page.locator(`[data-production-answer="${E1}"] button`);
    await b.click();
    await b.click({force: true}).catch(() => {});
    await f.page.waitForTimeout(300);
    release();
    await until(async () => posts(f, `/api/grammar/exercises/${E1}/produce`).length >= 1, 'produce not sent');
    await f.page.waitForTimeout(300);
    assert.equal(posts(f, `/api/grammar/exercises/${E1}/produce`).length, 1);
  } finally { await close(f); }
});

await check('materials retry keeps Correct It answers and Write Your Own text', async () => {
  let calls = 0;
  const f = await fixture({view: async rt => {
    if (rt !== `/app/grammar/${T1}`) return undefined;
    calls++;
    return topicDetail(calls === 1 ? {materials: {ok: false}} : {});
  }});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator('[data-region-retry="grammar-materials"]').waitFor();
    await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).check();
    await f.page.locator(`[data-production-answer="${E1}"] textarea`).fill('draft text');
    await f.page.locator('[data-region-retry="grammar-materials"]').click();
    await f.page.locator('[data-resource-blocks]').waitFor();
    assert.equal(await f.page.locator(`input[type=radio][name="${E1}"][value="has"]`).isChecked(), true, 'answer lost');
    assert.equal(await f.page.locator(`[data-production-answer="${E1}"] textarea`).inputValue(), 'draft text', 'draft lost');
  } finally { await close(f); }
});

await check('topic with no exercises shows the empty state and no mastery card', async () => {
  const f = await fixture({view: async rt => rt === `/app/grammar/${T1}` ? topicDetail({exercises: []}) : undefined});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.getByText(en.grammar.noExercises, {exact: true}).waitFor();
    assert.equal(await f.page.locator('[data-topic-mastery]').count(), 0);
  } finally { await close(f); }
});

await check('unknown topic shows not-found and invalid id never calls the view', async () => {
  const f = await fixture({view: async () => ({kind: 'not_found'})});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await until(async () => (await f.page.locator('h1').count()) > 0 && (await f.page.locator('[data-grammar-topic]').count()) === 0, 'topic shown for not-found');
    await f.page.goto(base + '/app/grammar/nope');
    await f.page.waitForTimeout(300);
    assert.equal(f.state.requests.some(r => r.query.includes('route=%2Fapp%2Fgrammar%2Fnope')), false);
  } finally { await close(f); }
});

await check('EN and UZ labels are localised on the topic page', async () => {
  const f = await fixture({locale: 'uz', view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : undefined});
  try {
    await f.page.goto(base + `/app/grammar/${T1}`);
    await f.page.locator(`[data-grammar-quiz]`).waitFor();
    assert.equal(await f.page.getByRole('button', {name: uz.grammar.submit, exact: true}).count(), 1);
    assert.equal(await f.page.getByRole('button', {name: en.grammar.submit, exact: true}).count(), 0);
  } finally { await close(f); }
});

for (const width of [390, 1440]) {
  await check(`no horizontal overflow on topic and lesson pages at ${width}px`, async () => {
    const f = await fixture({width, view: async rt => rt === `/app/grammar/${T1}` ? topicDetail() : rt === `/app/grammar/lessons/${L1}` ? lessonDetail : undefined});
    try {
      await f.page.goto(base + `/app/grammar/${T1}`);
      await f.page.locator(`[data-grammar-quiz]`).waitFor();
      await noOverflow(f);
      await f.page.goto(base + `/app/grammar/lessons/${L1}`);
      await f.page.locator('[data-grammar-lesson-body-card]').waitFor();
      await noOverflow(f);
    } finally { await close(f); }
  });
}

const fails = results.filter(r => r.status === 'FAIL').length;
fs.writeFileSync(new URL('browser-grammar-v48-results.json', out), JSON.stringify({suite: 'V48 Grammar', date: new Date().toISOString(), results, counts: {PASS: results.length - fails, FAIL: fails}}, null, 2));
await browser.close();
console.log(`V48 browser: ${results.length - fails} pass, ${fails} fail`);
process.exit(fails ? 1 : 0);
