/** V59 Assignments: page-level DOM tests (jsdom, synthetic fixtures). Fixture PASS is not live COMPLETE. */
import {test, beforeEach, afterEach} from 'node:test';
import assert from 'node:assert/strict';
import * as F from './assignments-coach-fixtures.mjs';

const {A1, A2, LEARNER, TEACHER, en, uz, json, apiError, until, tick, detail, detailsDTO, listDTO, assignment, setHandler, calls, callsTo} = F;
F.setup('/app/assignments');
const {mount} = await import('../modules/assignments/index.js');
const EVT = 'learners-area:evaluation-changed';

let ctrl;
let root;
let events;
const onEvt = () => events.push(1);

beforeEach(() => {
  F.setup('/app/assignments');
  ctrl = new AbortController();
  root = F.makeRoot();
  events = [];
  window.addEventListener(EVT, onEvt);
});
afterEach(() => {
  window.removeEventListener(EVT, onEvt);
  ctrl.abort();
  root.remove();
});

function page({session = LEARNER, locale = 'en'} = {}) {
  const dict = locale === 'uz' ? uz : en;
  mount({root, dict, locale, session, signal: ctrl.signal, url: new URL('https://fixture.invalid/app/assignments'),
    navigate() {}, refresh() {}});
  return {dict};
}
const cards = () => [...root.querySelectorAll('[data-assignment-card]')];
const submitBtn = (id = A1) => root.querySelector(`[data-assignment-submit="${id}"]`);
const textarea = (id = A1) => root.querySelector(`[data-assignment-response="${id}"]`);
function typeInto(id, value) {
  const t = textarea(id);
  t.value = value;
  t.dispatchEvent(new window.Event('input', {bubbles: true}));
}
const okList = (items) => json(200, listDTO(items));

test('learner: list and details load once each and cards keep the server order', async () => {
  setHandler((p) => {
    if (p === '/api/assignments') return okList([assignment(), assignment({id: A2, title: 'Speaking part 2', status: 'completed', dueAt: null})]);
    if (p.startsWith('/api/frontend/view')) return json(200, detailsDTO([detail(A1), detail(A2)]));
    throw new Error('unexpected ' + p);
  });
  page();
  await until(() => cards().length === 2);
  assert.deepEqual(cards().map((c) => c.getAttribute('data-assignment-id')), [A1, A2]);
  assert.equal(callsTo('/api/assignments', 'GET').length, 1);
  assert.equal(callsTo('/api/frontend/view', 'GET').length, 1);
});

test('status is shown from the server; the editor only on a task that is not done', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment(), assignment({id: A2, title: 'Done task', status: 'completed', dueAt: null})])
    : json(200, detailsDTO([detail(A1), detail(A2)])));
  page();
  await until(() => cards().length === 2);
  assert.equal(root.querySelector(`[data-assignment-status-label="not_started"]`).textContent, en.assignments.status.not_started);
  assert.equal(root.querySelector(`[data-assignment-status-label="completed"]`).textContent, en.assignments.status.completed);
  assert.ok(submitBtn(A1), 'editor on the open task');
  assert.equal(submitBtn(A2), null, 'no editor on a completed task');
  assert.equal(textarea(A2), null);
});

test('in_progress is a real status label (not guessed as Not started)', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([assignment({status: 'in_progress'})]) : json(200, detailsDTO([])));
  page();
  await until(() => cards().length === 1);
  assert.equal(root.querySelector('[data-assignment-status-label]').textContent, en.assignments.status.in_progress);
});

test('due date renders in the centre timezone; a missing deadline renders nothing', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment({dueAt: '2026-10-30T23:30:00.000Z'}), assignment({id: A2, title: 'No deadline', dueAt: null})])
    : json(200, detailsDTO([detail(A1), detail(A2)])));
  page();
  await until(() => cards().length === 2);
  assert.match(root.querySelector(`[data-assignment-id="${A1}"] [data-assignment-due]`).textContent, /31/, 'Tashkent 31st');
  assert.equal(root.querySelector(`[data-assignment-id="${A2}"] [data-assignment-due]`), null, 'no invented deadline');
});

test('a details failure never removes the list; materials show their own unavailable notice', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([assignment()]) : apiError(500, 'request_failed'));
  page();
  await until(() => root.querySelector('[data-assignment-materials-unavailable]'));
  assert.equal(cards().length, 1, 'list still rendered');
  assert.equal(root.querySelector('[data-region-failure="assignments-list"]'), null, 'list did not fail');
  assert.ok(submitBtn(A1), 'an open task still accepts a response');
  assert.equal(root.querySelector('[data-assignment-materials-unavailable]').textContent, en.assignments.materialsUnavailable);
});

test('a completed task whose details failed shows the metadata notice and still no editor', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment({status: 'completed'})])
    : apiError(500, 'request_failed'));
  page();
  await until(() => root.querySelector('[data-assignment-metadata-unavailable]'));
  assert.equal(root.querySelector('[data-assignment-metadata-unavailable]').textContent, en.assignments.detailsUnavailable);
  assert.equal(submitBtn(A1), null);
});

test('details retry re-requests only the details source; the list is untouched', async () => {
  let detailCalls = 0;
  setHandler((p) => {
    if (p === '/api/assignments') return okList([assignment()]);
    detailCalls += 1;
    return detailCalls === 1 ? apiError(500, 'request_failed') : json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => root.querySelector('[data-assignment-materials-unavailable]'));
  root.querySelector('[data-assignment-details-retry]').click();
  await until(() => !root.querySelector('[data-assignment-materials-unavailable]') && detailCalls === 2);
  assert.equal(callsTo('/api/assignments', 'GET').length, 1, 'list not re-requested');
  assert.equal(cards().length, 1);
});

test('list failure is its own region error; retry recovers and only the list is re-requested', async () => {
  let listCalls = 0;
  setHandler((p) => {
    if (p === '/api/assignments') {
      listCalls += 1;
      return listCalls === 1 ? apiError(500, 'request_failed') : okList([assignment()]);
    }
    return json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => root.querySelector('[data-region-failure="assignments-list"]'));
  assert.equal(cards().length, 0);
  root.querySelector('[data-region-retry="assignments-list"]').click();
  await until(() => cards().length === 1);
  assert.equal(listCalls, 2);
  assert.equal(callsTo('/api/frontend/view', 'GET').length, 1, 'details not re-requested by the list retry');
});

test('a server evaluation hides the editor and shows the checker and the verdict', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment()])
    : json(200, detailsDTO([detail(A1, {response: 'My earlier response, long enough.', evaluation: {checkedByName: 'AI Writing Evaluator', verdict: 'needs_correction'}})])));
  page();
  await until(() => root.querySelector('[data-assignment-evaluation]'));
  assert.equal(textarea(A1), null, 'no re-submission editor once evaluated');
  const ev = root.querySelector('[data-assignment-evaluation]');
  assert.match(ev.textContent, /AI Writing Evaluator/);
  assert.match(ev.textContent, new RegExp(en.coach.verdicts.needs_correction));
});

test('an unknown verdict is omitted rather than invented', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment({status: 'completed'})])
    : json(200, detailsDTO([detail(A1, {evaluation: {checkedByName: 'AI', verdict: 'brilliant'}})])));
  page();
  await until(() => root.querySelector('[data-assignment-evaluation]'));
  assert.equal(root.querySelector('[data-assignment-evaluation]').textContent, `${en.coach.checkedBy} AI`);
});

test('empty list shows the empty state, not an error', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([]) : json(200, detailsDTO([])));
  page();
  await until(() => root.querySelector('[data-assignments-empty]'));
  assert.equal(root.querySelector('[data-region-failure]'), null);
});

test('a short draft is refused client-side: no POST, inline message, draft kept', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)])));
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, '   short   ');
  submitBtn(A1).click();
  await until(() => root.querySelector('[data-assignment-error]'));
  assert.equal(root.querySelector('[data-assignment-error]').textContent, en.assignments.tooShort);
  assert.equal(callsTo('/api/assignments/', 'POST').length, 0);
  assert.equal(textarea(A1).value, '   short   ');
});

test('an oversized draft is refused client-side with the length message', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)])));
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'x'.repeat(20001));
  submitBtn(A1).click();
  await until(() => root.querySelector('[data-assignment-error]'));
  assert.equal(root.querySelector('[data-assignment-error]').textContent, en.assignments.tooLong);
  assert.equal(callsTo('/api/assignments/', 'POST').length, 0);
});

test('a valid submit posts the trimmed response, reloads both sources and notifies Coach once', async () => {
  const server = F.createFakeServer();
  setHandler(server.handler);
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, '   This is my answer and it is long enough.   ');
  submitBtn(A1).click();
  await until(() => root.querySelector('[data-assignment-notice]'));
  const post = callsTo('/api/assignments/', 'POST');
  assert.equal(post.length, 1);
  assert.deepEqual(post[0].body, {response: 'This is my answer and it is long enough.'});
  assert.equal(events.length, 1, 'one evaluation-changed event');
  assert.equal(callsTo('/api/assignments', 'GET').filter((c) => c.path === '/api/assignments').length, 2, 'list re-read from server');
  assert.equal(callsTo('/api/frontend/view', 'GET').length, 2, 'details re-read from server');
  await until(() => textarea(A1) === null);
  assert.ok(root.querySelector('[data-assignment-notice]').textContent.includes(en.assignments.submitted));
  assert.match(root.querySelector('[data-assignment-notice]').textContent, /AI Writing Evaluator/);
  assert.equal(root.querySelector(`[data-assignment-id="${A1}"]`).getAttribute('data-assignment-status'), 'completed');
});

test('double click submits exactly once while the first request is in flight', async () => {
  const server = F.createFakeServer();
  setHandler((p, i) => (i.method === 'POST'
    ? new Promise((r) => setTimeout(() => r(server.handler(p, i)), 40))
    : server.handler(p, i)));
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'A response that is long enough to submit.');
  const b = submitBtn(A1);
  b.click();
  b.click();
  submitBtn(A1)?.click();
  await until(() => events.length === 1);
  await tick(60);
  assert.equal(callsTo('/api/assignments/', 'POST').length, 1, 'one POST');
  assert.equal(events.length, 1);
});

test('the pending button is disabled and labelled as busy while the server works', async () => {
  let release;
  setHandler((p, i) => {
    if (i.method === 'POST') return new Promise((r) => { release = () => r(F.json(200, {ok: true, dispatchedTo: 'writing', evaluationId: 'e0000000-0000-4000-8000-000000000009', checkedBy: 'AI'})); });
    return p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'A response that is long enough to submit.');
  submitBtn(A1).click();
  await until(() => submitBtn(A1)?.disabled === true);
  assert.equal(submitBtn(A1).getAttribute('aria-busy'), 'true');
  assert.equal(textarea(A1).disabled, true);
  release();
  await until(() => events.length === 1);
});

test('each server error maps to a stable learner message and never shows a raw code; the draft survives', async () => {
  const cases = [
    [409, 'no_submission', en.assignments.noSubmission],
    [409, 'submission_not_written', en.assignments.submissionNotWritten],
    [404, 'not_found', en.apiErrors.notFound],
    [401, 'unauthenticated', en.apiErrors.unauthenticated],
    [403, 'forbidden', en.apiErrors.forbidden],
    [429, 'rate_limited', en.apiErrors.rateLimited],
    [400, 'response_required', en.assignments.tooShort],
    [400, 'invalid_input', en.apiErrors.invalid],
    [500, 'prompt_missing', en.apiErrors.generic],
    [502, 'evaluator_failed', en.assignments.genericError],
  ];
  for (const [status, code, expected] of cases) {
    F.setup('/app/assignments');
    ctrl.abort(); ctrl = new AbortController(); root.remove(); root = F.makeRoot(); events = [];
    setHandler((p, i) => {
      if (i.method === 'POST') return apiError(status, code);
      return p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)]));
    });
    page();
    await until(() => submitBtn(A1));
    const text = 'A response that is long enough to submit.';
    typeInto(A1, text);
    submitBtn(A1).click();
    await until(() => root.querySelector('[data-assignment-error]'));
    const shown = root.querySelector('[data-assignment-error]').textContent;
    assert.equal(shown, expected, `${status} ${code}`);
    assert.equal(root.textContent.includes(code), false, `raw code leaked for ${code}`);
    assert.equal(textarea(A1).value, text, 'draft survives the error');
    assert.equal(events.length, 0, 'no evaluation-changed after a failed submit');
    assert.equal(root.querySelector('[data-assignment-notice]'), null);
  }
});

test('a timeout shows the timeout message and keeps the draft', async () => {
  setHandler((p, i) => {
    if (i.method === 'POST') throw new DOMException('The operation timed out.', 'TimeoutError');
    return p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'A response that is long enough to submit.');
  submitBtn(A1).click();
  await until(() => root.querySelector('[data-assignment-error]'));
  assert.equal(root.querySelector('[data-assignment-error]').textContent, en.assignments.timeout);
  assert.equal(textarea(A1).value, 'A response that is long enough to submit.');
  assert.equal(submitBtn(A1).disabled, false, 'can retry');
});

test('a network failure is a generic error, never a fabricated success', async () => {
  setHandler((p, i) => {
    if (i.method === 'POST') throw new TypeError('Failed to fetch');
    return p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'A response that is long enough to submit.');
  submitBtn(A1).click();
  await until(() => root.querySelector('[data-assignment-error]'));
  assert.equal(root.querySelector('[data-assignment-error]').textContent, en.apiErrors.generic);
  assert.equal(root.querySelector('[data-assignment-notice]'), null);
  assert.equal(events.length, 0);
});

test('logout while a submit is in flight: no DOM change, no event, no further request', async () => {
  let release;
  setHandler((p, i) => {
    if (i.method === 'POST') return new Promise((r) => { release = () => r(json(200, {ok: true, dispatchedTo: 'writing', evaluationId: 'e0000000-0000-4000-8000-000000000009', checkedBy: 'AI'})); });
    return p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => submitBtn(A1));
  typeInto(A1, 'A response that is long enough to submit.');
  submitBtn(A1).click();
  await until(() => calls().some((c) => c.method === 'POST'));
  const before = calls().length;
  ctrl.abort();
  release?.();
  await tick(20);
  assert.equal(events.length, 0, 'no event after logout');
  assert.equal(root.querySelector('[data-assignment-card]'), null, 'nothing painted after logout');
  assert.equal(calls().length, before, 'no reload after logout');
});

test('a list response that arrives after the page is gone never paints', async () => {
  let release;
  setHandler((p) => {
    if (p === '/api/assignments') return new Promise((r) => { release = () => r(okList([assignment()])); });
    return json(200, detailsDTO([detail(A1)]));
  });
  page();
  await until(() => release);
  ctrl.abort();
  release();
  await tick(20);
  assert.equal(root.querySelector('[data-assignment-card]'), null);
  assert.equal(root.querySelector('[data-assignments-list]').childElementCount, 0, 'list host emptied on unmount');
});

test('materials render safely: https links open in a new tab, stored files use the authorised route', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment()])
    : json(200, detailsDTO([detail(A1, {materials: [
      {id: 'b1', type: 'text', position: 0, textContent: 'Read the passage carefully.', linkUrl: null, objectKey: null, originalName: null, mimeType: null, size: null},
      {id: 'b2', type: 'link', position: 1, textContent: null, linkUrl: 'https://example.com/reading', objectKey: null, originalName: 'Reading link', mimeType: null, size: null},
      {id: 'b3', type: 'file', position: 2, textContent: null, linkUrl: null, objectKey: 'resources/abc-123/notes.pdf', originalName: 'notes.pdf', mimeType: 'application/pdf', size: 10},
      {id: 'b4', type: 'image', position: 3, textContent: null, linkUrl: null, objectKey: 'resources/abc-123/chart.png', originalName: 'chart.png', mimeType: 'image/png', size: 10},
    ]})])));
  page();
  await until(() => root.querySelector('[data-assignment-materials]'));
  const link = root.querySelector('a[href="https://example.com/reading"]');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  assert.equal(root.querySelector('a[href="/api/resources/resources/abc-123/notes.pdf"]').textContent, 'notes.pdf');
  assert.equal(root.querySelector('img').getAttribute('src'), '/api/resources/resources/abc-123/chart.png');
  assert.equal(root.querySelector('[data-resource-block="text"]').textContent, 'Read the passage carefully.');
  assert.equal(root.textContent.includes('resources/abc-123/notes.pdf'), false, 'raw object key is not shown as text');
});

test('a malformed details payload is refused: the list stays, materials show unavailable', async () => {
  setHandler((p) => p === '/api/assignments'
    ? okList([assignment()])
    : json(200, F.envelope('/app/assignments', 'assignmentDetails', [detail(A1, {materials: [{id: 'x', type: 'link', position: 0, linkUrl: 'javascript:alert(1)', textContent: null, objectKey: null, originalName: null, mimeType: null, size: null}]})])));
  page();
  await until(() => root.querySelector('[data-assignment-materials-unavailable]'));
  assert.equal(cards().length, 1);
  assert.equal(root.querySelector('a[href^="javascript"]'), null);
});

test('non-student roles never request learner assignments and see the staff notice', async () => {
  setHandler(() => { throw new Error('must not fetch'); });
  page({session: TEACHER});
  await until(() => root.querySelector('[data-assignments-empty]'));
  assert.equal(calls().length, 0);
  assert.match(root.textContent, new RegExp(en.assignments.staffNotice.slice(0, 20)));
});

test('accessibility: each response field has a programmatic label and an associated hint', async () => {
  setHandler((p) => p === '/api/assignments' ? okList([assignment()]) : json(200, detailsDTO([detail(A1)])));
  page();
  await until(() => textarea(A1));
  const ta = textarea(A1);
  assert.equal(root.querySelector(`label[for="${ta.id}"]`).textContent, en.assignments.responseLabel);
  const hint = root.querySelector(`#${ta.getAttribute('aria-describedby')}`);
  assert.equal(hint?.textContent, en.assignments.responseHint);
  assert.equal(submitBtn(A1).textContent, en.assignments.submit);
});
