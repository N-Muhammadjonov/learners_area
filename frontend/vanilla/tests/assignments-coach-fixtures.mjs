/**
 * V59/V60 test harness. SYNTHETIC fixtures only: nothing here is live data and nothing here is evidence of backend
 * behaviour. Fixture PASS is reported as fixture PASS, never as live COMPLETE.
 *
 * Usage: call `setup(path)` BEFORE dynamically importing any app module, because js/api-client.js binds
 * globalThis.fetch once at load time. The stub routes every same-origin request through `setHandler`.
 */
import {JSDOM} from 'jsdom';

export const LEARNER = Object.freeze({
  user: {id: '11111111-1111-4111-8111-111111111111', role: 'student', accountStatus: 'active', name: 'Learner One'},
  expiresAt: 4102444800,
});
export const OTHER_LEARNER = Object.freeze({
  user: {id: '22222222-2222-4222-8222-222222222222', role: 'student', accountStatus: 'active', name: 'Learner Two'},
  expiresAt: 4102444800,
});
export const TEACHER = Object.freeze({
  user: {id: '33333333-3333-4333-8333-333333333333', role: 'teacher', accountStatus: 'active', name: 'Teacher'},
  expiresAt: 4102444800,
});

export const A1 = 'a0000000-0000-4000-8000-000000000001';
export const A2 = 'a0000000-0000-4000-8000-000000000002';
export const EVAL1 = 'e0000000-0000-4000-8000-000000000001';

const state = {handler: null, calls: []};
let dom = null;

export function setup(path = '/app/assignments') {
  dom?.window.close();
  dom = new JSDOM('<main id="host"></main>', {url: 'https://fixture.invalid' + path, pretendToBeVisual: true});
  for (const k of ['window', 'document', 'Node', 'HTMLElement', 'Element', 'Event', 'CustomEvent', 'HTMLInputElement']) {
    globalThis[k] = dom.window[k];
  }
  if (!globalThis.CSS) globalThis.CSS = {escape: (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\\' + c)};
  state.calls = [];
  state.handler = null;
  globalThis.fetch = async (url, init = {}) => {
    const path2 = String(url);
    const body = init.body === undefined ? undefined : JSON.parse(init.body);
    state.calls.push({path: path2, method: init.method ?? 'GET', body});
    if (init.signal?.aborted) throw init.signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (!state.handler) throw new Error('fixture: unexpected fetch ' + path2);
    const out = state.handler(path2, {...init, body});
    if (out && typeof out.then === 'function') {
      return new Promise((resolve, reject) => {
        const onAbort = () => reject(init.signal?.reason ?? new DOMException('Aborted', 'AbortError'));
        init.signal?.addEventListener('abort', onAbort, {once: true});
        out.then((v) => { init.signal?.removeEventListener('abort', onAbort); resolve(v); },
          (e) => { init.signal?.removeEventListener('abort', onAbort); reject(e); });
      });
    }
    return out;
  };
  return dom;
}

export const dom_ = () => dom;
export function setHandler(fn) { state.handler = fn; }
export function calls() { return state.calls; }
export function callsTo(prefix, method) {
  return state.calls.filter((c) => c.path.startsWith(prefix) && (!method || c.method === method));
}

/** A JSON Response exactly like the Arena API: application/json and {ok|error} bodies. */
export function json(status, body) {
  return new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json; charset=utf-8'}});
}
export function apiError(status, error) { return json(status, {ok: false, error}); }

export const until = async (cond, timeout = 2000) => {
  const end = Date.now() + timeout;
  while (!cond()) {
    if (Date.now() > end) throw new Error('until: timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};
export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export function makeRoot() {
  const root = document.createElement('div');
  document.getElementById('host').append(root);
  return root;
}

import {withOverlays} from '../js/i18n/with-overlays.js';
// The same dictionary the app loads: generated en/uz plus the Arena V59/V60 overlay.
export const en = withOverlays((await import('../js/i18n/en.js')).default, 'en');
export const uz = withOverlays((await import('../js/i18n/uz.js')).default, 'uz');

/* ---------- Valid DTO builders (match js/adapters/assignments.js and coach.js validators) ---------- */

export function assignment(over = {}) {
  return {
    id: A1,
    title: 'Task 2 essay',
    description: 'Opinion essay on urban transport.',
    instructions: 'Write at least 250 words. Give reasons and examples.',
    status: 'not_started',
    dueAt: '2026-10-30T12:00:00.000Z',
    content: {module: 'writing', contentType: 'task2', sourceRef: 'writing-task2-1', versionId: 'v-1', versionNo: 1, versionStatus: 'published'},
    ...over,
  };
}
export const listDTO = (items = [assignment()]) => ({ok: true, assignments: items});

export function detail(id, over = {}) {
  return {assignmentId: id, response: null, evaluation: null, materials: [], ...over};
}
/** The established /api/frontend/view envelope around one region payload. */
export const envelope = (route, region, payload) => ({version: 1, route, region, data: {[region]: payload}});
export const detailsDTO = (items = [detail(A1)]) => envelope('/app/assignments', 'assignmentDetails', items);

export const weakness = (over = {}) => ({
  category: 'GRAMMAR_TENSE', label: 'Tense consistency', area: 'grammar', href: '/app/grammar',
  action: 'Practise tense consistency', occurrenceCount: 3, recentSeverity: 'high', status: 'open',
  lastSeenAt: '2026-10-20T08:00:00.000Z', ...over,
});
export const evaluationRow = (over = {}) => ({
  id: EVAL1, evaluationType: 'writing', overallEstimate: 5.5, verdict: null,
  checkedByName: 'AI Writing Evaluator', createdAt: '2026-10-21T09:30:00.000Z', ...over,
});
export const recommendation = (over = {}) => ({
  area: 'grammar', href: '/app/grammar', categories: ['GRAMMAR_TENSE'],
  reason: 'Repeated in recent writing feedback.', occurrenceCount: 3, ...over,
});
export const coachPayload = (over = {}) => ({weaknesses: [weakness()], recentEvaluations: [evaluationRow()], recommendations: [recommendation()], ...over});
export const coachDTO = (over = {}) => envelope('/app/coach', 'coach', coachPayload(over));
export const dueDTO = (items = [{id: 'v-term-1', term: 'mitigate'}]) => ({ok: true, due: items});

/* ---------- Stateful synthetic server for cross-module flows (fixture only) ---------- */

/**
 * Derives the Coach view from the same state that Assignments submissions mutate, so a submit is observable through
 * Coach only via a re-read, exactly like the real backend. `failures` maps a path prefix to an injected failure.
 */
export function createFakeServer(initial = {}) {
  const s = {
    assignments: [assignment(), assignment({id: A2, title: 'Speaking part 2', status: 'completed', dueAt: null,
      content: {module: 'speaking', contentType: 'part2', sourceRef: 'sp-2', versionId: 'v-2', versionNo: 1, versionStatus: 'published'}})],
    details: new Map([[A1, detail(A1)], [A2, detail(A2, {response: null, evaluation: {checkedByName: 'AI Speaking', verdict: null}})]]),
    weaknesses: [],
    evaluations: [],
    due: [{id: 'v-term-1', term: 'mitigate'}],
    submitCount: 0,
    failures: {},
    ...initial,
  };
  const failure = (path) => {
    for (const [prefix, f] of Object.entries(s.failures)) if (path.startsWith(prefix)) return f;
    return null;
  };
  const handler = (path, init) => {
    const f = failure(path);
    if (f) return typeof f === 'function' ? f(path, init) : apiError(f.status, f.error);
    if (path === '/api/assignments' && init.method !== 'POST') {
      return json(200, listDTO(s.assignments.map((a) => ({...a}))));
    }
    const m = path.match(/^\/api\/assignments\/([0-9a-f-]{36})\/evaluate$/);
    if (m && init.method === 'POST') return evaluate(m[1], init.body);
    if (path.startsWith('/api/frontend/view?route=%2Fapp%2Fassignments')) {
      return json(200, envelope('/app/assignments', 'assignmentDetails', [...s.details.values()].map((d) => ({...d}))));
    }
    if (path.startsWith('/api/frontend/view?route=%2Fapp%2Fcoach')) {
      const recs = s.weaknesses.filter((w) => w.status !== 'resolved').map((w) => recommendation({
        area: w.area, href: w.href, categories: [w.category], occurrenceCount: w.occurrenceCount,
      }));
      return json(200, envelope('/app/coach', 'coach', {weaknesses: s.weaknesses.map((w) => ({...w})), recentEvaluations: s.evaluations.map((e) => ({...e})), recommendations: recs}));
    }
    if (path.startsWith('/api/vocabulary/due')) return json(200, dueDTO(s.due));
    return json(404, {ok: false, error: 'not_found'});
  };
  function evaluate(id, body) {
    const assignment_ = s.assignments.find((a) => a.id === id);
    if (!assignment_) return apiError(404, 'not_found');
    const text = body?.response ?? '';
    if (typeof text !== 'string' || text.length < 20 || text.length > 20000) return apiError(400, 'invalid_input');
    s.submitCount += 1;
    const evalId = `e0000000-0000-4000-8000-${String(s.submitCount).padStart(12, '0')}`;
    assignment_.status = 'completed';
    s.details.set(id, detail(id, {response: text, evaluation: {checkedByName: 'AI Writing Evaluator', verdict: 'needs_correction'}}));
    s.evaluations.unshift(evaluationRow({id: evalId, evaluationType: 'writing', overallEstimate: null, verdict: 'needs_correction'}));
    const existing = s.weaknesses.find((w) => w.category === 'GRAMMAR_TENSE');
    if (existing) existing.occurrenceCount += 1;
    else s.weaknesses.push(weakness({occurrenceCount: 1}));
    return json(200, {ok: true, dispatchedTo: 'writing', evaluationId: evalId, checkedBy: 'AI Writing Evaluator', verdict: 'needs_correction', reason: 'fixture'});
  }
  return {state: s, handler};
}

export const session = (user = LEARNER) => user;
