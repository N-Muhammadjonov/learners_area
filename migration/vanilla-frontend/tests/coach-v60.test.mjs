/** V60 AI Coach: pure adapter contract tests (no DOM). The browser never ranks, scores or invents advice. */
import {test} from 'node:test';
import assert from 'node:assert/strict';

const sent = [];
let next = null;
globalThis.fetch = async (url, init = {}) => {
  sent.push({url: String(url), method: init.method ?? 'GET'});
  return next();
};
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

const C = await import('../js/adapters/coach.js');
const {fmtDate} = await import('../modules/shared/dates.js');
const {ApiError} = await import('../js/api-client.js');

const EV = 'e0000000-0000-4000-8000-000000000001';
const weakness = (over = {}) => ({category: 'GRAMMAR_TENSE', label: 'Tense', area: 'grammar', href: '/app/grammar', action: 'Practise',
  occurrenceCount: 3, recentSeverity: 'high', status: 'open', lastSeenAt: '2026-10-20T08:00:00.000Z', ...over});
const evalRow = (over = {}) => ({id: EV, evaluationType: 'writing', overallEstimate: 5.5, verdict: null, checkedByName: 'AI', createdAt: '2026-10-21T09:30:00.000Z', ...over});
const rec = (over = {}) => ({area: 'grammar', href: '/app/grammar', categories: ['GRAMMAR_TENSE'], reason: 'Repeated', occurrenceCount: 3, ...over});
const dto = (c = {}) => ({weaknesses: [weakness()], recentEvaluations: [evalRow()], recommendations: [rec()], ...c});
const bad = (fn) => assert.throws(fn, (e) => e instanceof ApiError && e.status === 502);

test('coach: valid analytics pass and keep the server recommendation order', () => {
  const out = C.coachDTO(dto({
    weaknesses: [weakness(), weakness({category: 'WRITING_TASK_RESPONSE', area: 'writing', href: '/app/writing', status: 'improving'})],
    recommendations: [rec({area: 'writing', href: '/app/writing', categories: ['WRITING_TASK_RESPONSE']}), rec({area: 'grammar'})],
  }));
  assert.deepEqual(out.recommendations.map((r) => r.area), ['writing', 'grammar']);
  assert.equal(out.weaknesses[1].status, 'improving');
});

test('coach: an empty but valid analytics payload is accepted (an honest empty state)', () => {
  const out = C.coachDTO({weaknesses: [], recentEvaluations: [], recommendations: []});
  assert.deepEqual([out.weaknesses.length, out.recentEvaluations.length, out.recommendations.length], [0, 0, 0]);
});

test('coach: a null overall estimate is a real "no estimate" state, not a number', () => {
  assert.equal(C.coachDTO(dto({recentEvaluations: [evalRow({overallEstimate: null})]})).recentEvaluations[0].overallEstimate, null);
});

test('coach: rejects unknown statuses, areas, severities and categories', () => {
  bad(() => C.coachDTO(dto({weaknesses: [weakness({status: 'resolvedish'})]})));
  bad(() => C.coachDTO(dto({weaknesses: [weakness({area: 'reading'})]})));
  bad(() => C.coachDTO(dto({weaknesses: [weakness({recentSeverity: 'critical'})]})));
  bad(() => C.coachDTO(dto({weaknesses: [weakness({category: 'grammar_tense'})]})));
  bad(() => C.coachDTO(dto({recommendations: [rec({categories: []})]})));
  bad(() => C.coachDTO(dto({recommendations: [rec({categories: ['bad code']})]})));
});

test('coach: rejects counts that are not whole non-negative numbers (no fabricated progress)', () => {
  for (const occurrenceCount of [-1, 1.5, '3', null, 1000001]) bad(() => C.coachDTO(dto({weaknesses: [weakness({occurrenceCount})]})));
  for (const overallEstimate of [10, -0.1, '5', NaN]) bad(() => C.coachDTO(dto({recentEvaluations: [evalRow({overallEstimate})]})));
});

test('coach: rejects duplicate weakness categories (a pattern is tracked once)', () => {
  bad(() => C.coachDTO(dto({weaknesses: [weakness(), weakness()]})));
});

test('coach: every destination must be an internal /app path (fail closed, no external link)', () => {
  for (const href of ['https://evil.example/app', '//evil.example', '/app/../admin', '/app/grammar?x=1', 'javascript:alert(1)', '/api/assignments', '/application', '', '/app/' + 'a'.repeat(300)]) {
    bad(() => C.coachDTO(dto({recommendations: [rec({href})]})));
  }
  bad(() => C.coachDTO(dto({weaknesses: [weakness({href: 'https://x.example/app/writing'})]})));
});

test('isAppHref: accepts the server destinations used by main and nothing else', () => {
  for (const ok of ['/app', '/app/grammar', '/app/speaking/practice', '/app/vocabulary', '/app/vocabulary/review', '/app/writing']) {
    assert.equal(C.isAppHref(ok), true, ok);
  }
  for (const no of [null, undefined, 3, '/app/%2e%2e', '/app/a b', 'app/grammar', ' /app/grammar']) assert.equal(C.isAppHref(no), false, String(no));
});

test('due queue: valid rows pass; a non-ok or malformed queue is refused', () => {
  assert.deepEqual(C.dueDTO({ok: true, due: [{id: 'v1', term: 'mitigate'}]}), [{id: 'v1', term: 'mitigate'}]);
  assert.deepEqual(C.dueDTO({ok: true, due: []}), []);
  bad(() => C.dueDTO({ok: false, due: []}));
  bad(() => C.dueDTO({ok: true}));
  bad(() => C.dueDTO({ok: true, due: [{id: '', term: 'x'}]}));
  bad(() => C.dueDTO({ok: true, due: [{id: 'v1', term: 'x'.repeat(201)}]}));
  bad(() => C.dueDTO({ok: true, due: Array.from({length: 101}, (_, i) => ({id: 'v' + i, term: 'x'}))}));
});

test('transport: fetchDue requests the due route with a bounded limit and nothing else', async () => {
  sent.length = 0;
  next = () => json(200, {ok: true, due: []});
  await C.fetchDue(new AbortController().signal, 10);
  assert.deepEqual(sent.map((s) => [s.method, s.url]), [['GET', '/api/vocabulary/due?limit=10']]);
  for (const limit of [0, 41, 1.5, NaN]) {
    await assert.rejects(C.fetchDue(new AbortController().signal, limit), TypeError);
  }
});

test('transport: a 503 from the due route surfaces as a real error (no empty pretence)', async () => {
  next = () => json(503, {ok: false, error: 'temporarily_unavailable'});
  await assert.rejects(C.fetchDue(new AbortController().signal, 10), (e) => e.status === 503 && e.code === 'temporarily_unavailable');
});

test('transport: the proposed coach region is requested as its view region, and only that', async () => {
  sent.length = 0;
  next = () => json(200, {version: 1, route: '/app/coach', region: 'coach', data: {coach: dto()}});
  await C.fetchCoach(new AbortController().signal);
  assert.equal(sent[0].url, '/api/frontend/view?route=%2Fapp%2Fcoach&region=coach');
});

test('dates: server timestamps render in the centre timezone; invalid input is a dash, never a guess', () => {
  assert.equal(fmtDate('2026-10-30T23:30:00.000Z', 'en').includes('31'), true, 'Tashkent is UTC+5, so 23:30Z is the 31st');
  assert.match(fmtDate('2026-10-30T12:00:00.000Z', 'uz'), /2026/);
  assert.equal(fmtDate('not a date', 'en'), '—');
  assert.equal(fmtDate(null, 'uz'), '—');
  assert.equal(fmtDate(undefined), '—');
});

test('view envelope: a wrong version, route, region or missing payload is refused for the proposed coach region', async () => {
  const good = {version: 1, route: '/app/coach', region: 'coach', data: {coach: dto()}};
  const variants = [
    {...good, version: 2},
    {...good, route: '/app/assignments'},
    {...good, region: 'assignmentDetails'},
    {...good, data: {}},
    {...good, data: null},
    {version: 1, route: '/app/coach', region: 'coach'},
  ];
  for (const body of variants) {
    next = () => json(200, body);
    await assert.rejects(C.fetchCoach(new AbortController().signal), (e) => e instanceof ApiError && e.status === 502);
  }
  next = () => json(200, good);
  assert.equal((await C.fetchCoach(new AbortController().signal)).weaknesses.length, 1);
});
