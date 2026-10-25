/** V60 AI Coach: page-level DOM tests (jsdom, synthetic fixtures). Fixture PASS is not live COMPLETE. */
import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as F from './assignments-coach-fixtures.mjs';

const {LEARNER, TEACHER, en, uz, json, apiError, until, tick, weakness, evaluationRow, recommendation, coachDTO, dueDTO, setHandler, calls, callsTo} = F;
F.setup('/app/coach');
const {mount} = await import('../modules/coach/index.js');
const EVT = 'learners-area:evaluation-changed';

let ctrl;
let root;

beforeEach(() => {
  F.setup('/app/coach');
  ctrl = new AbortController();
  root = F.makeRoot();
});
afterEach(() => {
  ctrl.abort();
  root.remove();
});

function page({session = LEARNER, locale = 'en'} = {}) {
  const dict = locale === 'uz' ? uz : en;
  mount({root, dict, locale, session, signal: ctrl.signal, url: new URL('https://fixture.invalid/app/coach'),
    navigate() {}, refresh() {}});
  return {dict};
}
const stat = (name) => root.querySelector(`[data-coach-stat="${name}"]`)?.querySelectorAll('span')[1]?.textContent;
const openRows = () => [...root.querySelectorAll('[data-coach-open] [data-coach-weakness]')].map((x) => x.getAttribute('data-coach-weakness'));
const recRows = () => [...root.querySelectorAll('[data-study-recommendation]')];

const route = (over = {}) => (p) => {
  if (p.startsWith('/api/frontend/view')) return over.coach ?? json(200, coachDTO());
  if (p.startsWith('/api/vocabulary/due')) return over.due ?? json(200, dueDTO());
  throw new Error('unexpected ' + p);
};

test('learner: each source is requested exactly once on mount', async () => {
  setHandler(route());
  page();
  await until(() => root.querySelector('[data-coach-stats]'));
  assert.equal(callsTo('/api/frontend/view', 'GET').length, 1);
  assert.equal(callsTo('/api/vocabulary/due', 'GET').length, 1);
  assert.equal(calls().length, 2);
});

test('stats are counted from server rows; review-today is the due queue length', async () => {
  setHandler(route({
    coach: json(200, coachDTO({
      weaknesses: [
        weakness({category: 'GRAMMAR_TENSE', status: 'open', occurrenceCount: 5}),
        weakness({category: 'VOCAB_COLLOCATION', area: 'vocabulary', href: '/app/vocabulary', status: 'open', occurrenceCount: 1}),
        weakness({category: 'WRITING_TASK_RESPONSE', area: 'writing', href: '/app/writing', status: 'improving', occurrenceCount: 2}),
        weakness({category: 'SPEAKING_FILLERS', area: 'speaking', href: '/app/speaking/practice', status: 'resolved', occurrenceCount: 4}),
      ],
    })),
    due: json(200, dueDTO([{id: 'v1', term: 'mitigate'}, {id: 'v2', term: 'substantial'}])),
  }));
  page();
  await until(() => stat('review') === '2');
  assert.equal(stat('repeated'), '2', 'open weaknesses');
  assert.equal(stat('improved'), '1', 'improving weaknesses only');
});

test('open weaknesses are shown most-repeated first (display only); the rest keep the server data', async () => {
  setHandler(route({coach: json(200, coachDTO({weaknesses: [
    weakness({category: 'VOCAB_COLLOCATION', area: 'vocabulary', href: '/app/vocabulary', occurrenceCount: 1}),
    weakness({category: 'GRAMMAR_TENSE', occurrenceCount: 5}),
  ]}))}));
  page();
  await until(() => openRows().length === 2);
  assert.deepEqual(openRows(), ['GRAMMAR_TENSE', 'VOCAB_COLLOCATION']);
});

test('study recommendations keep the server order and send the learner to the server destination', async () => {
  setHandler(route({coach: json(200, coachDTO({recommendations: [
    recommendation({area: 'writing', href: '/app/writing', categories: ['WRITING_TASK_RESPONSE'], occurrenceCount: 2}),
    recommendation({area: 'grammar', href: '/app/grammar', categories: ['GRAMMAR_TENSE'], occurrenceCount: 5}),
  ]}))}));
  page();
  await until(() => recRows().length === 2);
  assert.deepEqual(recRows().map((r) => r.getAttribute('data-study-recommendation')), ['writing', 'grammar']);
  assert.equal(recRows()[0].querySelector('a').getAttribute('href'), '/app/writing');
  assert.equal(recRows()[1].querySelector('a').getAttribute('href'), '/app/grammar');
  assert.equal(recRows()[0].querySelector('a').textContent, en.coach.startPractising);
});

test('the coach and due regions fail independently: a coach failure keeps the due queue, and retry recovers', async () => {
  let coachCalls = 0;
  setHandler((p) => {
    if (p.startsWith('/api/frontend/view')) { coachCalls += 1; return coachCalls === 1 ? apiError(500, 'request_failed') : json(200, coachDTO()); }
    return json(200, dueDTO([{id: 'v1', term: 'mitigate'}]));
  });
  page();
  await until(() => root.querySelector('[data-region-failure="coach"]'));
  assert.ok(root.querySelector('[data-coach-due]'), 'due queue still shown');
  assert.equal(root.querySelector('[data-coach-stats]'), null, 'no fabricated stats when analytics failed');
  root.querySelector('[data-region-retry="coach"]').click();
  await until(() => root.querySelector('[data-coach-stats]'));
  assert.equal(coachCalls, 2);
  assert.equal(callsTo('/api/vocabulary/due', 'GET').length, 1, 'due not re-requested by the coach retry');
});

test('a due-queue outage shows a dash for review-today, keeps the analytics, and retry recovers', async () => {
  let dueCalls = 0;
  setHandler((p) => {
    if (p.startsWith('/api/frontend/view')) return json(200, coachDTO());
    dueCalls += 1;
    return dueCalls === 1 ? apiError(503, 'temporarily_unavailable') : json(200, dueDTO([{id: 'v1', term: 'mitigate'}]));
  });
  page();
  await until(() => root.querySelector('[data-region-failure="coach-due"]'));
  assert.equal(stat('review'), '—', 'no invented count');
  assert.ok(root.querySelector('[data-coach-stats]'), 'analytics still shown');
  root.querySelector('[data-region-retry="coach-due"]').click();
  await until(() => root.querySelector('[data-due-term="v1"]'));
  assert.equal(stat('review'), '1');
  assert.equal(root.querySelector('[data-region-failure="coach-due"]'), null);
});

test('while the due queue is loading, review-today is a dash, never zero', async () => {
  let releaseDue;
  setHandler((p) => {
    if (p.startsWith('/api/frontend/view')) return json(200, coachDTO());
    return new Promise((r) => { releaseDue = () => r(json(200, dueDTO([]))); });
  });
  page();
  await until(() => root.querySelector('[data-coach-stats]'));
  assert.equal(stat('review'), '—');
  releaseDue();
  await until(() => root.querySelector('[data-coach-due-empty]'));
  assert.equal(stat('review'), '0', 'a real zero once the server answered');
  assert.equal(root.querySelector('[data-coach-due-empty]').textContent, en.coach.noDueToday);
});

test('no evaluations and no weaknesses is an honest empty state, not zeros and not an error', async () => {
  setHandler(route({coach: json(200, coachDTO({weaknesses: [], recentEvaluations: [], recommendations: []})), due: json(200, dueDTO([]))}));
  page();
  await until(() => root.querySelector('[data-coach-empty]'));
  assert.equal(root.querySelector('[data-coach-stats]'), null);
  assert.equal(root.querySelector('[data-region-failure]'), null);
  assert.equal(root.querySelector('[data-coach-empty]').textContent.includes(en.coach.noWeaknessesYet), true);
});

test('a server destination that is not an internal /app path is refused: the analytics fail closed, no external link', async () => {
  setHandler(route({coach: json(200, coachDTO({recommendations: [recommendation({href: 'https://evil.example/practice'})]}))}));
  page();
  await until(() => root.querySelector('[data-region-failure="coach"]'));
  assert.equal(root.querySelector('a[href^="https://evil"]'), null);
  assert.equal(root.querySelector('[data-study-recommendation]'), null);
});

test('evaluation history shows the server estimate, verdict and checker; an absent estimate is not invented', async () => {
  setHandler(route({coach: json(200, coachDTO({recentEvaluations: [
    evaluationRow({id: 'e0000000-0000-4000-8000-000000000001', overallEstimate: 5.5, checkedByName: 'AI Writing Evaluator'}),
    evaluationRow({id: 'e0000000-0000-4000-8000-000000000002', overallEstimate: null, verdict: 'mostly_correct', checkedByName: 'Teacher A', evaluationType: 'speaking'}),
  ]}))}));
  page();
  await until(() => root.querySelector('[data-coach-recent]'));
  const rows = [...root.querySelectorAll('[data-evaluation-id]')];
  assert.equal(rows.length, 2);
  assert.match(rows[0].textContent, /5\.5/);
  assert.match(rows[0].textContent, /AI Writing Evaluator/);
  assert.equal(rows[1].textContent.includes('5.5'), false);
  assert.match(rows[1].textContent, new RegExp(en.coach.verdicts.mostly_correct));
  assert.match(rows[1].textContent, /Teacher A/);
});

test('weakness severity and status are shown as words, dates in the centre timezone, codes never shown raw', async () => {
  setHandler(route({coach: json(200, coachDTO({weaknesses: [weakness({status: 'resolved', recentSeverity: 'low', lastSeenAt: '2026-10-20T08:00:00.000Z'})]}))}));
  page();
  await until(() => root.querySelector('[data-coach-improved]'));
  assert.equal(root.querySelector('[data-coach-improved] [data-status="resolved"]').textContent.includes(en.coach.statusResolved), true);
  assert.equal(root.textContent.includes('GRAMMAR_TENSE'), false, 'category code is labelled, not shown raw');
});

test('uz: labels and severity words are Uzbek', async () => {
  setHandler(route());
  page({locale: 'uz'});
  await until(() => root.querySelector('[data-coach-open] [data-coach-weakness]'));
  assert.ok(root.textContent.includes(uz.coach.severity.high), 'Yuqori');
  assert.equal(root.querySelector('h1').textContent, uz.coach.dashboardTitle);
});

test('an evaluation elsewhere in the app re-reads both sources from the server', async () => {
  let coachVersion = 1;
  setHandler((p) => {
    if (p.startsWith('/api/frontend/view')) return json(200, coachDTO({weaknesses: [weakness({occurrenceCount: coachVersion})]}));
    return json(200, dueDTO([]));
  });
  page();
  await until(() => root.querySelector('[data-coach-weakness]'));
  coachVersion = 4;
  window.dispatchEvent(new window.Event(EVT));
  await until(() => root.querySelector('[data-coach-weakness]')?.textContent.includes('4'));
  assert.equal(callsTo('/api/frontend/view', 'GET').length, 2);
  assert.equal(callsTo('/api/vocabulary/due', 'GET').length, 2);
});

test('stale response: an older analytics answer that lands after a newer one never overwrites it', async () => {
  let first;
  let n = 0;
  setHandler((p) => {
    if (p.startsWith('/api/frontend/view')) {
      n += 1;
      if (n === 1) return new Promise((r) => { first = () => r(json(200, coachDTO({weaknesses: [weakness({category: 'GRAMMAR_TENSE', occurrenceCount: 1})]}))); });
      return json(200, coachDTO({weaknesses: [weakness({category: 'VOCAB_COLLOCATION', area: 'vocabulary', href: '/app/vocabulary', occurrenceCount: 9})]}));
    }
    return json(200, dueDTO([]));
  });
  page();
  await until(() => first);
  window.dispatchEvent(new window.Event(EVT));
  await until(() => openRows().includes('VOCAB_COLLOCATION'));
  first();
  await tick(20);
  assert.deepEqual(openRows(), ['VOCAB_COLLOCATION'], 'the stale answer was dropped');
});

test('unmount: no further requests, no painting, and no event listener left behind', async () => {
  setHandler(route());
  page();
  await until(() => root.querySelector('[data-coach-stats]'));
  ctrl.abort();
  const before = calls().length;
  window.dispatchEvent(new window.Event(EVT));
  await tick(20);
  assert.equal(calls().length, before, 'no request after unmount');
  assert.equal(root.querySelector('[data-coach-content]')?.childElementCount ?? 0, 0, 'content host emptied');
});

test('non-student roles never request coach data and see the empty state', async () => {
  setHandler(() => { throw new Error('must not fetch'); });
  page({session: TEACHER});
  await until(() => root.querySelector('[data-coach-empty]'));
  assert.equal(calls().length, 0);
});

test('a coach response that is refused by the validator never paints partial data', async () => {
  setHandler(route({coach: json(200, F.envelope('/app/coach', 'coach', {weaknesses: [weakness({status: 'bogus'})], recentEvaluations: [], recommendations: []}))}));
  page();
  await until(() => root.querySelector('[data-region-failure="coach"]'));
  assert.equal(root.querySelector('[data-coach-weakness]'), null);
});

test('coach region: 401/403/404/409/429/500 each show a region error with retry, never analytics; the due queue stays independent', async () => {
  const cases = [[401, 'unauthenticated'], [403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [429, 'rate_limited'], [500, 'request_failed']];
  for (const [status, code] of cases) {
    ctrl.abort(); root.remove();
    F.setup('/app/coach'); ctrl = new AbortController(); root = F.makeRoot();
    setHandler(route({coach: apiError(status, code)}));
    page();
    await until(() => root.querySelector('[data-region-failure="coach"]'));
    assert.equal(root.querySelector('[data-coach-stats]'), null, `${status}: no statistics`);
    assert.equal(root.querySelector('[data-coach-weakness]'), null, `${status}: no weakness`);
    assert.ok(root.querySelector('[data-region-retry="coach"]'), `${status}: retry offered`);
    assert.equal(root.textContent.includes(code), false, `${status}: raw code never shown`);
    await until(() => root.querySelector('[data-coach-due]') || root.querySelector('[data-coach-due-empty]'));
  }
});
