/** V59 Assignments: pure adapter contract tests (no DOM). Every validator must fail closed (502), never render. */
import {test} from 'node:test';
import assert from 'node:assert/strict';

// Stub fetch BEFORE the adapter (and api-client) load, so the transport can be asserted without a network.
const sent = [];
let next = null;
globalThis.fetch = async (url, init = {}) => {
  sent.push({url: String(url), method: init.method ?? 'GET', body: init.body === undefined ? undefined : JSON.parse(init.body)});
  return next();
};
const json = (status, body) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});

const A = await import('../js/adapters/assignments.js');
const {ApiError} = await import('../js/api-client.js');

const ID1 = 'a0000000-0000-4000-8000-000000000001';
const ID2 = 'a0000000-0000-4000-8000-000000000002';
const EV = 'e0000000-0000-4000-8000-000000000001';
const content = (over = {}) => ({module: 'writing', contentType: 'task2', sourceRef: 'w-1', versionId: 'v-1', versionNo: 1, versionStatus: 'published', ...over});
const item = (over = {}) => ({id: ID1, title: 'Task 2', description: null, instructions: null, status: 'not_started', dueAt: null, content: content(), ...over});
const block = (over = {}) => ({id: 'b1', type: 'text', position: 0, textContent: 'Read this.', linkUrl: null, objectKey: null, originalName: null, mimeType: null, size: null, ...over});
const detailRow = (over = {}) => ({assignmentId: ID1, response: null, evaluation: null, materials: [], ...over});
const bad = (fn) => assert.throws(fn, (e) => e instanceof ApiError && e.status === 502);

test('list: valid learner rows pass through in server order', () => {
  const out = A.assignmentListDTO({ok: true, assignments: [item({id: ID2, status: 'completed'}), item()]});
  assert.deepEqual(out.map((x) => x.id), [ID2, ID1]);
  assert.equal(out[0].status, 'completed');
  assert.equal(out[1].dueAt, null);
});

test('list: in_progress is a valid server status and is kept as-is', () => {
  assert.equal(A.assignmentListDTO({ok: true, assignments: [item({status: 'in_progress'})]})[0].status, 'in_progress');
});

test('list: rejects any shape it does not understand (fail closed)', () => {
  bad(() => A.assignmentListDTO(null));
  bad(() => A.assignmentListDTO({ok: false, assignments: []}));
  bad(() => A.assignmentListDTO({ok: true}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({status: 'done'})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({id: 'not-a-uuid'})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({title: ''})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({title: 'x'.repeat(201)})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({dueAt: 'tomorrow'})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({content: null})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item({content: content({versionNo: -1})})]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: [item(), item()]}));
  bad(() => A.assignmentListDTO({ok: true, assignments: Array.from({length: 501}, (_, i) => item({id: `a0000000-0000-4000-8000-${String(i).padStart(12, '0')}`}))}));
});

test('list: no target_user_id or other per-user field is read or required', () => {
  const out = A.assignmentListDTO({ok: true, assignments: [{...item(), target_user_id: 'someone-else'}]});
  assert.equal(Object.hasOwn(out[0], 'target_user_id'), false);
});

test('submit result: valid success passes; checkedBy and evaluation id are required', () => {
  const ok = A.submitResultDTO({ok: true, dispatchedTo: 'writing', evaluationId: EV, checkedBy: 'AI Writing Evaluator', verdict: 'correct'});
  assert.deepEqual(ok, {dispatchedTo: 'writing', evaluationId: EV, checkedBy: 'AI Writing Evaluator', verdict: 'correct'});
  assert.equal(A.submitResultDTO({ok: true, dispatchedTo: 'free_form', evaluationId: EV, checkedBy: 'AI'}).verdict, null);
  bad(() => A.submitResultDTO({ok: false, dispatchedTo: 'writing', evaluationId: EV, checkedBy: 'AI'}));
  bad(() => A.submitResultDTO({ok: true, dispatchedTo: 'speaking', evaluationId: EV, checkedBy: 'AI'}));
  bad(() => A.submitResultDTO({ok: true, dispatchedTo: 'writing', evaluationId: 'x', checkedBy: 'AI'}));
  bad(() => A.submitResultDTO({ok: true, dispatchedTo: 'writing', evaluationId: EV, checkedBy: '   '}));
  bad(() => A.submitResultDTO({ok: true, dispatchedTo: 'writing', evaluationId: EV, checkedBy: 'AI', verdict: 'x'.repeat(41)}));
});

test('details: valid projection keyed by assignment, materials sorted by position', () => {
  const map = A.assignmentDetailsDTO([detailRow({
      response: 'My essay text that is long enough.',
      evaluation: {checkedByName: 'AI', verdict: 'correct'},
      materials: [block({id: 'b2', position: 2}), block({id: 'b1', position: 1})],
    })]);
  const d = map.get(ID1);
  assert.equal(d.response, 'My essay text that is long enough.');
  assert.deepEqual(d.evaluation, {checkedByName: 'AI', verdict: 'correct'});
  assert.deepEqual(d.materials.map((m) => m.id), ['b1', 'b2']);
});

test('details: null evaluation and null response are real "not yet" states, not errors', () => {
  const d = A.assignmentDetailsDTO([detailRow()]).get(ID1);
  assert.equal(d.evaluation, null);
  assert.equal(d.response, null);
});

test('details: rejects duplicates, oversized responses, bad types and unsafe material references', () => {
  bad(() => A.assignmentDetailsDTO([detailRow(), detailRow()]));
  bad(() => A.assignmentDetailsDTO([detailRow({response: 'x'.repeat(20001)})]));
  bad(() => A.assignmentDetailsDTO([detailRow({evaluation: {checkedByName: 'AI'}, materials: null})]));
  bad(() => A.assignmentDetailsDTO([detailRow({evaluation: {checkedByName: ''}})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'video'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'link', linkUrl: 'javascript:alert(1)'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'link', linkUrl: 'ftp://x'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'file', objectKey: '../secrets'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'file', objectKey: '/etc/passwd'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({type: 'file', objectKey: 'a/../b'})]})]));
  bad(() => A.assignmentDetailsDTO([detailRow({materials: [block({position: -1})]})]));
  bad(() => A.assignmentDetailsDTO('nope'));
});

test('details: accepts a safe https link and an authorised object key', () => {
  const d = A.assignmentDetailsDTO([detailRow({materials: [
    block({id: 'l', type: 'link', linkUrl: 'https://example.com/reading'}),
    block({id: 'f', type: 'file', position: 1, objectKey: 'resources/abc-123/notes.pdf', originalName: 'notes.pdf', size: 1024}),
  ]})]).get(ID1);
  assert.equal(d.materials[0].linkUrl, 'https://example.com/reading');
  assert.equal(d.materials[1].objectKey, 'resources/abc-123/notes.pdf');
});

test('transport: list uses GET /api/assignments and never a POST or a target filter', async () => {
  sent.length = 0;
  next = () => json(200, {ok: true, assignments: [item()]});
  const out = await A.fetchAssignmentList(new AbortController().signal);
  assert.equal(out.length, 1);
  assert.deepEqual(sent.map((s) => [s.method, s.url]), [['GET', '/api/assignments']]);
});

test('transport: submit posts {response} to the evaluate route and maps server errors to ApiError', async () => {
  sent.length = 0;
  next = () => json(200, {ok: true, dispatchedTo: 'writing', evaluationId: EV, checkedBy: 'AI'});
  const res = await A.submitAssignment(ID1, 'A response that is long enough.', new AbortController().signal);
  assert.equal(res.checkedBy, 'AI');
  assert.deepEqual(sent[0].body, {response: 'A response that is long enough.'});
  assert.equal(sent[0].url, `/api/assignments/${ID1}/evaluate`);
  assert.equal(sent[0].method, 'POST');

  for (const [status, code] of [[409, 'no_submission'], [409, 'submission_not_written'], [404, 'not_found'], [401, 'unauthenticated'],
    [403, 'forbidden'], [400, 'response_required'], [500, 'prompt_missing'], [502, 'evaluator_failed']]) {
    next = () => json(status, {ok: false, error: code});
    await assert.rejects(A.submitAssignment(ID1, 'A response that is long enough.', new AbortController().signal),
      (e) => e instanceof ApiError && e.status === status && e.code === code);
  }
});

test('transport: a non-JSON or malformed success body is refused, not rendered', async () => {
  next = () => new Response('<html>oops</html>', {status: 200, headers: {'content-type': 'text/html'}});
  await assert.rejects(A.fetchAssignmentList(new AbortController().signal), (e) => e.code === 'invalid_response');
  next = () => json(200, {ok: true, dispatchedTo: 'writing', evaluationId: 'bad', checkedBy: 'AI'});
  await assert.rejects(A.submitAssignment(ID1, 'A response that is long enough.', new AbortController().signal), (e) => e.status === 502);
});

test('transport: an invalid assignment id never reaches the network', async () => {
  sent.length = 0;
  await assert.rejects(A.submitAssignment('../../etc', 'x'.repeat(20), new AbortController().signal), TypeError);
  assert.equal(sent.length, 0);
});

test('limits: the minimum and maximum response length match the server contract', () => {
  assert.equal(A.MIN_RESPONSE_LENGTH, 20);
  assert.equal(A.MAX_RESPONSE_LENGTH, 20000);
});

test('details transport: a region other than assignmentDetails is refused', async () => {
  next = () => json(200, {version: 1, route: '/app/coach', region: 'coach', data: {coach: []}});
  await assert.rejects(A.fetchAssignmentDetails(new AbortController().signal), (e) => e.status === 502);
});
