import {test} from 'node:test';
import assert from 'node:assert/strict';
import {progressSummaryDTO, progressStreakDTO, progressTrendsDTO, progressMocksDTO} from '../js/adapters/progress-v54.js';
import {summarizeMocks} from '../modules/progress/mock-summary.js';
import {heatLevel} from '../modules/progress/trends.js';
import routes from '../js/routes.js';

const ALL_REGIONS = [];
const summary = (over = {}) => ({
  reading: {attempts: 2, submitted: 2, score: 0, total: 20, accuracy: 0},
  listening: null,
  speaking: {attempts: 1, submitted: 1, transcribed: 0},
  writing: {submissions: 0, latestBand: null, latestEvaluationAt: null, lastSubmittedAt: null, evaluationUnavailable: false},
  vocabulary: {total: 0, due: 0, byState: {new: 0, learning: 0, review: 0, known: 0, mastered: 0, activated: 0}},
  lessons: {total: null, open: null, inProgress: null, completed: null},
  assignments: null,
  mocks: null,
  unavailableRegions: ALL_REGIONS,
  ...over,
});
const assertBad = fn => assert.throws(fn, err => err.status === 502 && /invalid_progress_adapter/.test(err.code ?? err.message));

test('summary keeps actual zero, null (unavailable) and no-score distinct', () => {
  const d = progressSummaryDTO(summary());
  assert.equal(d.reading.accuracy, 0);
  assert.equal(d.listening, null);
  assert.equal(d.writing.latestBand, null);
  assert.equal(d.lessons.completed, null);
});

test('summary rejects malformed numbers and unknown unavailable regions', () => {
  assertBad(() => progressSummaryDTO(summary({reading: {attempts: -1, submitted: 0, score: 0, total: 0, accuracy: null}})));
  assertBad(() => progressSummaryDTO(summary({unavailableRegions: ['progress-unknown']})));
  assertBad(() => progressSummaryDTO(summary({unavailableRegions: ['progress-reading', 'progress-reading']})));
  assertBad(() => progressSummaryDTO(summary({writing: {submissions: 0, latestBand: 12, latestEvaluationAt: null, lastSubmittedAt: null, evaluationUnavailable: false}})));
  assertBad(() => progressSummaryDTO(summary({reading: {attempts: 1, submitted: 1, score: 1, total: 1, accuracy: 101}})));
});

test('summary requires every section key so partial failures are explicit', () => {
  const d = summary();
  delete d.mocks;
  assertBad(() => progressSummaryDTO(d));
});

test('streak is an integer count or null', () => {
  assert.deepEqual(progressStreakDTO({streak: 0}), {streak: 0});
  assert.deepEqual(progressStreakDTO({streak: null}), {streak: null});
  assertBad(() => progressStreakDTO({streak: -2}));
});

test('trends keep empty weeks null and reject out-of-range bands', () => {
  const week = (weekStart, value) => ({weekStart, value, count: value === null ? 0 : 1});
  const base = {reading: null, listening: null, writing: null, speaking: null, heatmap: null, retention: null};
  const ok = progressTrendsDTO({...base, writing: [week('2026-08-31', null), week('2026-09-07', 6.5)]});
  assert.equal(ok.writing[0].value, null);
  assert.equal(ok.writing[1].value, 6.5);
  assertBad(() => progressTrendsDTO({...base, writing: [week('2026-08-31', 10)]}));
  assertBad(() => progressTrendsDTO({...base, reading: [week('bad-date', 50)]}));
  assertBad(() => progressTrendsDTO({...base, heatmap: [[{day: '2026-08-31', count: 1}]]}));
});

test('retention accepts only CEFR levels A2..C2 with numeric scores', () => {
  const row = over => ({level: 'B1', attempts: 1, textsCompleted: 1, best: 60, recent: [60], average: 60, change: null, ...over});
  const base = {reading: null, listening: null, writing: null, speaking: null, heatmap: null};
  assert.equal(progressTrendsDTO({...base, retention: [row({})]}).retention[0].best, 60);
  assertBad(() => progressTrendsDTO({...base, retention: [row({level: 'Z9'})]}));
  assertBad(() => progressTrendsDTO({...base, retention: [row({recent: ['x']})]}));
});

test('mocks reject snapshots, questions and answers so source material never reaches the page', () => {
  const dto = {tests: [{id: 'm1', title: 'Full 1', skill: 'full'}], attempts: [], catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false};
  assert.equal(progressMocksDTO(dto).tests.length, 1);
  assertBad(() => progressMocksDTO({...dto, attempts: [{id: 'a', mockTestId: 'm1', title: 't', skill: 'full', finishedAt: null, estimatedBand: null, questions: []}]}));
  assertBad(() => progressMocksDTO({...dto, attempts: [{id: 'a', mockTestId: 'm1', title: 't', skill: 'full', finishedAt: null, estimatedBand: null, snapshot: {}}]}));
});

test('mock attempts convert finishedAt to Date and keep a removed mock as history', () => {
  const d = progressMocksDTO({
    tests: [{id: 'm1', title: 'Full 1', skill: 'full'}],
    attempts: [{id: 'a1', mockTestId: 'gone', title: 'Retired', skill: 'full', finishedAt: '2026-09-01T10:00:00Z', estimatedBand: 6}],
    catalogueUnavailable: false, attemptsUnavailable: false, attemptTitlesUnavailable: false,
  });
  assert.ok(d.attempts[0].finishedAt instanceof Date);
  const s = summarizeMocks(d.attempts, ['m1']);
  assert.equal(s.attempts, 1);
  assert.equal(s.completed, 0, 'removed mock must not count towards catalogue progress');
  assert.equal(s.latest, 6);
});

test('summarizeMocks uses only finished full mocks, sorts by finish time and reports first-to-latest change', () => {
  const at = iso => new Date(iso);
  const attempts = [
    {id: 'b', mockTestId: 'm1', skill: 'full', title: 'M1', finishedAt: at('2026-09-08T00:00:00Z'), estimatedBand: 7},
    {id: 'a', mockTestId: 'm1', skill: 'full', title: 'M1', finishedAt: at('2026-09-01T00:00:00Z'), estimatedBand: 5.5},
    {id: 'l', mockTestId: 'm2', skill: 'listening', title: 'L', finishedAt: at('2026-09-02T00:00:00Z'), estimatedBand: 9},
    {id: 'u', mockTestId: 'm2', skill: 'full', title: 'M2', finishedAt: null, estimatedBand: 8},
    {id: 'n', mockTestId: 'm2', skill: 'full', title: 'M2', finishedAt: at('2026-09-03T00:00:00Z'), estimatedBand: null},
  ];
  const s = summarizeMocks(attempts, ['m1', 'm2', 'm3']);
  assert.deepEqual(s.points.map(p => p.id), ['a', 'b']);
  assert.equal(s.attempts, 3, 'every finished full mock counts, even one without a band');
  assert.equal(s.completed, 2);
  assert.equal(s.total, 3);
  assert.equal(s.latest, 7);
  assert.equal(s.best, 7);
  assert.equal(s.change, 1.5);
  assert.equal(summarizeMocks([], ['m1']).latest, null);
  assert.equal(summarizeMocks([], ['m1']).change, null);
});

test('heat levels match the original thresholds 0 / 1 / 2–3 / 4–5 / 6+', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 9].map(heatLevel), [0, 1, 2, 2, 3, 3, 4, 4]);
});

test('/app/progress is a protected native route, not the unavailable placeholder', () => {
  const route = routes.find(r => r.pattern === '/app/progress');
  assert.equal(route.protected, true);
  assert.equal(route.load.toString().includes('modules/progress/page.js'), true);
});
