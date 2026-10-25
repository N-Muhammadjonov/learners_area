/** V55 Mock Tests: the list-only native page. Pure checks only (no browser): the `mock` region
 * contract, route wiring, and a static guard that the page renders no runner controls. */
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mockDTO} from '../js/adapters/dashboard.js';
import routes from '../js/routes.js';

const attempt = (over = {}) => ({
  id: 'a1', mockTestId: 'm1', title: 'Full Mock 1', skill: 'full',
  startedAt: '2026-09-01T09:00:00Z', finishedAt: '2026-09-01T10:00:00Z',
  rawScore: 22, estimatedBand: 5.5, ...over,
});
const base = (over = {}) => ({
  tests: [{id: 'm1', title: 'Full Mock 1', skill: 'full'}, {id: 'l1', title: 'Listening only', skill: 'listening'}],
  attempts: [attempt()],
  finishedCount: 1,
  catalogueUnavailable: false,
  attemptsUnavailable: false,
  attemptTitlesUnavailable: false,
  ...over,
});

test('valid mock region passes through unchanged in shape', () => {
  const dto = mockDTO(base());
  assert.equal(dto.tests.length, 2);
  assert.equal(dto.attempts[0].estimatedBand, 5.5);
  assert.equal(dto.finishedCount, 1);
});

test('a null attempt title is allowed (page falls back to the untitled label)', () => {
  const dto = mockDTO(base({attempts: [attempt({title: null})]}));
  assert.equal(dto.attempts[0].title, null);
});

test('an unfinished attempt keeps a null band and raw score, never a zero', () => {
  const dto = mockDTO(base({attempts: [attempt({finishedAt: null, rawScore: null, estimatedBand: null})]}));
  assert.equal(dto.attempts[0].finishedAt, null);
  assert.equal(dto.attempts[0].estimatedBand, null);
});

test('protected fields never reach the page (questions, answers, snapshots)', () => {
  for (const key of ['snapshot', 'mockSnapshot', 'questions', 'answers']) {
    assert.throws(() => mockDTO(base({attempts: [attempt({[key]: []})]})), undefined, key);
  }
});

test('missing flags, a missing finishedCount or a non-array field are rejected', () => {
  assert.throws(() => mockDTO(base({catalogueUnavailable: 'no'})));
  assert.throws(() => mockDTO(base({attemptsUnavailable: undefined})));
  assert.throws(() => mockDTO(base({finishedCount: undefined})));
  assert.throws(() => mockDTO(base({tests: null})));
  assert.throws(() => mockDTO(base({attempts: {}})));
});

test('unknown skills and duplicate ids are rejected', () => {
  assert.throws(() => mockDTO(base({tests: [{id: 'x', title: 'X', skill: 'speaking-only'}]})));
  assert.throws(() => mockDTO(base({tests: [{id: 'm1', title: 'A', skill: 'full'}, {id: 'm1', title: 'B', skill: 'full'}]})));
  assert.throws(() => mockDTO(base({attempts: [attempt(), attempt()]})));
});

test('/app/mocks is a protected native route, not the unavailable placeholder', () => {
  const route = routes.find(r => r.pattern === '/app/mocks');
  assert.equal(route.protected, true);
  assert.equal(route.load.toString().includes('modules/mocks/page.js'), true);
  assert.equal(route.load.toString().includes('unavailable'), false);
});

test('the mocks page renders no runner controls (no start, submit, timer or inputs)', () => {
  const raw = fs.readFileSync(new URL('../modules/mocks/page.js', import.meta.url), 'utf8');
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.equal(/h\(\s*'(button|input|form|select|textarea)'/.test(code), false);
  assert.equal(/submit|timer|startMock|\bstart\(/i.test(code), false);
});
