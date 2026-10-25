/**
 * V59 + V60 cross-module flow (jsdom, SYNTHETIC stateful server). Proves the chain
 *   response -> server evaluation -> weakness history -> Coach recommendation
 * is re-read from the server, and covers logout, account switch, stale responses, double submit and failure.
 * Fixture PASS only. Live COMPLETE needs the backend endpoints that are reported BLOCKED.
 */
import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as F from './assignments-coach-fixtures.mjs';

const {LEARNER, OTHER_LEARNER, A1, en, json, until, tick, detail, assignment, setHandler, calls, callsTo, createFakeServer} = F;
F.setup('/app/assignments');
const {mount: mountAssignments} = await import('../modules/assignments/index.js');
const {mount: mountCoach} = await import('../modules/coach/index.js');
const {api} = await import('../js/api-client.js');
const EVT = 'learners-area:evaluation-changed';

const RESPONSE = 'Learning English has changed my life because I can now read, write and speak with confidence.';
const open = [];

beforeEach(() => {
  F.setup('/app/assignments');
  open.length = 0;
});
afterEach(() => {
  for (const {ctrl, root} of open) { ctrl.abort(); root.remove(); }
});

function start(mount, {session = LEARNER, locale = 'en', path = '/app'} = {}) {
  const ctrl = new AbortController();
  const root = F.makeRoot();
  open.push({ctrl, root});
  mount({root, dict: locale === 'uz' ? F.uz : en, locale, session, signal: ctrl.signal,
    url: new URL('https://fixture.invalid' + path), navigate() {}, refresh() {}});
  return {ctrl, root};
}
const startAssignments = (o) => start(mountAssignments, {path: '/app/assignments', ...o});
const startCoach = (o) => start(mountCoach, {path: '/app/coach', ...o});

const card = (root, id = A1) => root.querySelector(`[data-assignment-id="${id}"]`);
const submitBtn = (root, id = A1) => root.querySelector(`[data-assignment-submit="${id}"]`);
const typeIn = (root, text, id = A1) => {
  const t = root.querySelector(`[data-assignment-response="${id}"]`);
  t.value = text;
  t.dispatchEvent(new window.Event('input', {bubbles: true}));
};
const openRows = (root) => [...root.querySelectorAll('[data-coach-open] [data-coach-weakness]')].map((x) => x.getAttribute('data-coach-weakness'));
const stat = (root, name) => root.querySelector(`[data-coach-stat="${name}"]`)?.querySelectorAll('span')[1]?.textContent;

test('end to end: an empty Coach, a submitted response, then Coach shows the server-recorded weakness and evaluation', async () => {
  const server = createFakeServer();
  setHandler(server.handler);

  const coach1 = startCoach();
  await until(() => coach1.root.querySelector('[data-coach-empty]'));
  coach1.ctrl.abort();

  const assign = startAssignments();
  await until(() => submitBtn(assign.root));
  typeIn(assign.root, RESPONSE);
  submitBtn(assign.root).click();
  await until(() => assign.root.querySelector('[data-assignment-notice]'));
  assert.equal(server.state.submitCount, 1, 'server recorded one evaluation');
  assert.equal(server.state.weaknesses[0].category, 'GRAMMAR_TENSE', 'server recorded the weakness');
  assign.ctrl.abort();

  const coach2 = startCoach();
  await until(() => coach2.root.querySelector('[data-coach-weakness]'));
  assert.deepEqual(openRows(coach2.root), ['GRAMMAR_TENSE']);
  assert.equal(stat(coach2.root, 'repeated'), '1');
  assert.ok(coach2.root.querySelector('[data-evaluation-id]'), 'evaluation history from the server');
  assert.equal(coach2.root.querySelector('[data-study-recommendation] a').getAttribute('href'), '/app/grammar');
  assert.equal(coach2.root.querySelector('[data-checked-by]').textContent.includes('AI Writing Evaluator'), true);

  const assign2 = startAssignments();
  await until(() => card(assign2.root)?.getAttribute('data-assignment-status') === 'completed');
  assert.equal(submitBtn(assign2.root), null, 'no re-submit editor after the server evaluated it');
  assert.ok(assign2.root.querySelector('[data-assignment-evaluation]'), 'the evaluation is shown from the server');
  assert.equal(calls().filter((c) => c.method === 'POST').length, 1);
});

test('live: Coach open in the same document updates from the server after an evaluation elsewhere', async () => {
  const server = createFakeServer();
  setHandler(server.handler);
  const coach = startCoach();
  await until(() => coach.root.querySelector('[data-coach-empty]'));
  const assign = startAssignments();
  await until(() => submitBtn(assign.root));
  typeIn(assign.root, RESPONSE);
  submitBtn(assign.root).click();
  await until(() => coach.root.querySelector('[data-coach-weakness]'));
  assert.deepEqual(openRows(coach.root), ['GRAMMAR_TENSE']);
  assert.equal(callsTo('/api/frontend/view?route=%2Fapp%2Fcoach', 'GET').length, 2, 'Coach re-read the server once more');
});

test('a second evaluation of another task increments the same server pattern (seen twice), not a new one', async () => {
  const second = 'a0000000-0000-4000-8000-000000000003';
  const server = createFakeServer({
    assignments: [assignment(), assignment({id: second, title: 'Second essay'})],
    details: new Map([[A1, detail(A1)], [second, detail(second)]]),
  });
  setHandler(server.handler);
  const coach = startCoach();
  await until(() => coach.root.querySelector('[data-coach-empty]'));
  const assign = startAssignments();
  await until(() => submitBtn(assign.root, A1));
  typeIn(assign.root, RESPONSE, A1);
  submitBtn(assign.root, A1).click();
  await until(() => coach.root.querySelector('[data-coach-weakness]'));
  typeIn(assign.root, RESPONSE, second);
  submitBtn(assign.root, second).click();
  await until(() => coach.root.querySelector('[data-coach-weakness]')?.textContent.includes('2'));
  assert.deepEqual(openRows(coach.root), ['GRAMMAR_TENSE']);
  assert.equal(server.state.weaknesses.length, 1);
  assert.equal(server.state.weaknesses[0].occurrenceCount, 2);
});

test('double click across the page submits once: one server evaluation, one weakness increment', async () => {
  const server = createFakeServer();
  setHandler((p, i) => (i.method === 'POST'
    ? new Promise((r) => setTimeout(() => r(server.handler(p, i)), 40))
    : server.handler(p, i)));
  const assign = startAssignments();
  await until(() => submitBtn(assign.root));
  typeIn(assign.root, RESPONSE);
  const b = submitBtn(assign.root);
  b.click(); b.click(); submitBtn(assign.root)?.click();
  await until(() => assign.root.querySelector('[data-assignment-notice]'));
  await tick(60);
  assert.equal(server.state.submitCount, 1);
  assert.equal(server.state.weaknesses[0].occurrenceCount, 1);
  assert.equal(calls().filter((c) => c.method === 'POST').length, 1);
});

test('logout while a submit is in flight: the server keeps its result, the old page never paints or notifies', async () => {
  const server = createFakeServer();
  setHandler((p, i) => {
    if (i.method !== 'POST') return server.handler(p, i);
    const r = server.handler(p, i);
    return new Promise((res) => setTimeout(() => res(r), 60));
  });
  let events = 0;
  const onEvt = () => { events += 1; };
  window.addEventListener(EVT, onEvt);
  try {
    const assign = startAssignments();
    await until(() => submitBtn(assign.root));
    typeIn(assign.root, RESPONSE);
    submitBtn(assign.root).click();
    await until(() => server.state.submitCount === 1);
    assign.ctrl.abort(); // logout / navigation
    await tick(90);
    assert.equal(events, 0, 'no event from a dead page');
    assert.equal(assign.root.querySelector('[data-assignment-card]'), null);
    // A new session reads the server truth.
    const coach = startCoach();
    await until(() => coach.root.querySelector('[data-coach-weakness]'));
    assert.deepEqual(openRows(coach.root), ['GRAMMAR_TENSE']);
  } finally {
    window.removeEventListener(EVT, onEvt);
  }
});

test('account switch: a second learner never sees the first learner\'s weaknesses or evaluations', async () => {
  const serverA = createFakeServer({weaknesses: [{category: 'GRAMMAR_TENSE', label: 'Tense', area: 'grammar', href: '/app/grammar', action: 'x', occurrenceCount: 4, recentSeverity: 'high', status: 'open', lastSeenAt: '2026-10-20T08:00:00.000Z'}],
    evaluations: [{id: 'e0000000-0000-4000-8000-0000000000aa', evaluationType: 'writing', overallEstimate: 6, verdict: null, checkedByName: 'AI', createdAt: '2026-10-20T08:00:00.000Z'}]});
  const serverB = createFakeServer();
  let current = serverA;
  setHandler((p, i) => current.handler(p, i));

  const a = startCoach({session: LEARNER});
  await until(() => a.root.querySelector('[data-coach-weakness]'));
  a.ctrl.abort();

  current = serverB;
  const b = startCoach({session: OTHER_LEARNER});
  await until(() => b.root.querySelector('[data-coach-empty]'));
  assert.equal(b.root.textContent.includes('GRAMMAR_TENSE'), false);
  assert.equal(b.root.querySelector('[data-evaluation-id]'), null);
  assert.equal(b.root.textContent.includes('e0000000-0000'), false);
});

test('stale across accounts: learner A\'s slow answer, landing after a switch, never paints into learner B', async () => {
  const serverA = createFakeServer({weaknesses: [{category: 'WRITING_TASK_RESPONSE', label: 'Task', area: 'writing', href: '/app/writing', action: 'x', occurrenceCount: 2, recentSeverity: 'medium', status: 'open', lastSeenAt: '2026-10-20T08:00:00.000Z'}]});
  const serverB = createFakeServer();
  let releaseA;
  let aPending = false;
  let current = serverA;
  setHandler((p, i) => {
    if (current === serverA && p.startsWith('/api/frontend/view')) {
      aPending = true;
      return new Promise((r) => { releaseA = () => r(serverA.handler(p, i)); });
    }
    return current.handler(p, i);
  });

  const a = startCoach({session: LEARNER});
  await until(() => aPending);
  a.ctrl.abort(); // A logs out while the request is outstanding
  current = serverB;
  const b = startCoach({session: OTHER_LEARNER});
  await until(() => b.root.querySelector('[data-coach-empty]'));
  releaseA();
  await tick(30);
  assert.equal(b.root.textContent.includes('WRITING_TASK_RESPONSE'), false);
  assert.equal(b.root.querySelector('[data-coach-weakness]'), null);
  assert.equal(a.root.querySelector('[data-coach-weakness]'), null, 'the aborted page never painted');
});

test('post-submit list re-read fails: no stale editor is shown, the region retry recovers the completed state', async () => {
  const server = createFakeServer();
  setHandler((p, i) => {
    if (i.method === 'POST') {
      const r = server.handler(p, i);
      server.state.failures['/api/assignments'] = {status: 500, error: 'request_failed'};
      return r;
    }
    return server.handler(p, i);
  });
  const assign = startAssignments();
  await until(() => submitBtn(assign.root));
  typeIn(assign.root, RESPONSE);
  submitBtn(assign.root).click();
  await until(() => assign.root.querySelector('[data-region-failure="assignments-list"]'));
  assert.equal(assign.root.querySelector('[data-assignment-submit]'), null, 'no editor offered from stale state');
  assert.equal(server.state.submitCount, 1);
  delete server.state.failures['/api/assignments'];
  assign.root.querySelector('[data-region-retry="assignments-list"]').click();
  await until(() => card(assign.root)?.getAttribute('data-assignment-status') === 'completed');
  assert.equal(submitBtn(assign.root), null);
});

test('Coach re-read fails after an evaluation: a visible coach error with retry, never silent stale analytics', async () => {
  const server = createFakeServer();
  setHandler(server.handler);
  const coach = startCoach();
  await until(() => coach.root.querySelector('[data-coach-empty]'));
  const assign = startAssignments();
  await until(() => submitBtn(assign.root));
  typeIn(assign.root, RESPONSE);
  server.state.failures['/api/frontend/view?route=%2Fapp%2Fcoach'] = {status: 500, error: 'request_failed'};
  submitBtn(assign.root).click();
  await until(() => coach.root.querySelector('[data-region-failure="coach"]'));
  assert.equal(coach.root.querySelector('[data-coach-weakness]'), null);
  delete server.state.failures['/api/frontend/view?route=%2Fapp%2Fcoach'];
  coach.root.querySelector('[data-region-retry="coach"]').click();
  await until(() => coach.root.querySelector('[data-coach-weakness]'));
  assert.deepEqual(openRows(coach.root), ['GRAMMAR_TENSE']);
});

test('api.request fresh: a re-read never joins an identical GET that started before the change', async () => {
  let n = 0;
  const releases = [];
  setHandler((p) => {
    n += 1;
    const id = n;
    return new Promise((r) => releases.push(() => r(json(200, {id}))));
  });
  const c = new AbortController();
  const plain1 = api.request('/api/probe-fresh', {signal: c.signal});
  const plain2 = api.request('/api/probe-fresh', {signal: c.signal});
  assert.equal(n, 1, 'identical concurrent GET is shared (dedupe)');
  const fresh = api.request('/api/probe-fresh', {signal: c.signal, fresh: true});
  assert.equal(n, 2, 'fresh read goes to the network');
  releases[1]();
  assert.equal((await fresh).id, 2);
  releases[0]();
  assert.equal((await plain1).id, 1);
  assert.equal((await plain2).id, 1);
  c.abort();
});
